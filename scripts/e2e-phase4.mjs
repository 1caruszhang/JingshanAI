import {chromium} from '@playwright/test';
import {createServer} from 'vite';
import * as esbuild from 'esbuild';
import {spawn} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = join(__dirname, '..');

let vitePort = 0;

async function buildElectron() {
  await esbuild.build({
    entryPoints: ['electron/main.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron', 'better-sqlite3'],
    outfile: 'dist-electron/main/main.cjs',
  });
  await esbuild.build({
    entryPoints: ['electron/preload.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
    outfile: 'dist-electron/preload/preload.js',
  });
}

async function startVite() {
  const vite = await createServer({
    configFile: 'vite.config.ts',
    root,
    server: {port: 0},
  });
  await vite.listen();
  const address = vite.httpServer.address();
  vitePort = typeof address === 'string' ? 0 : address.port;
  console.log(`Vite dev server ready at http://localhost:${vitePort}`);
  return vite;
}

function launchElectron(userDataDir) {
  const env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  env.VITE_DEV_SERVER_URL = `http://localhost:${vitePort}`;
  // Kimi Code exposes OpenAI-compatible embeddings and Anthropic-compatible chat endpoints under /coding/v1.
  // If the configured base URL omits the /v1 suffix (common with Kimi Code), append it for this test.
  const normalizeV1 = (url) => {
    const trimmed = url.replace(/\/+$/, '');
    return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
  };
  env.ANTHROPIC_BASE_URL = normalizeV1(process.env.ANTHROPIC_BASE_URL ?? 'https://api.kimi.com/coding/v1');
  env.EMBEDDING_BASE_URL = normalizeV1(process.env.EMBEDDING_BASE_URL ?? 'https://api.kimi.com/coding/v1');
  env.EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? 'kimi-embedding';

  return spawn(
    'node',
    [
      join(root, 'node_modules/electron/cli.js'),
      join(root, 'dist-electron/main/main.cjs'),
      '--remote-debugging-port=9223',
      `--user-data-dir=${userDataDir}`,
    ],
    {
      cwd: root,
      env,
      stdio: 'pipe',
    },
  );
}

async function waitForCdp(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://localhost:9223/json/version');
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('CDP not available within timeout');
}

async function main() {
  const userDataDir = mkdtempSync(join(tmpdir(), 'nai-agent-e2e-'));
  let electronProc;
  let vite;

  try {
    await buildElectron();
    vite = await startVite();

    console.log('Launching Electron...');
    electronProc = launchElectron(userDataDir);

    electronProc.stdout.on('data', (d) => console.log('[electron]', d.toString().trim()));
    electronProc.stderr.on('data', (d) => console.error('[electron]', d.toString().trim()));

    await waitForCdp();
    console.log('Electron CDP ready');

    const browser = await chromium.connectOverCDP('http://localhost:9223');
    const context = browser.contexts()[0];
    const pages = context.pages();
    const page = pages.find((p) => p.url().includes(`localhost:${vitePort}`));
    if (!page) {
      throw new Error('App page not found in CDP targets');
    }

    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    console.log('Step 1: Dashboard loaded');
    await page.screenshot({path: 'e2e-p4-01-dashboard.png'});

    // Open "create enterprise KB" via the enterprise + button in sidebar
    console.log('Step 2: Open create enterprise KB');
    const addProjectBtn = page.locator('aside button').filter({has: page.locator('svg.lucide-plus')}).first();
    await addProjectBtn.evaluate((el) => el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true})));
    await page.waitForTimeout(1500);
    await page.screenshot({path: 'e2e-p4-02-kb-create.png'});

    // Fill company info and knowledge text
    console.log('Step 3: Create project and ingest knowledge');
    await page.locator('input').first().fill('Phase4 E2E Project');
    const companyText = `GEO Agent is an enterprise GEO optimization platform developed by NAI Labs in 2024.
It helps companies improve their visibility in AI-generated search results.
The platform supports knowledge base management, content generation, and visibility tracking.
NAI Labs is headquartered in Hangzhou, China.
The main product colors are orange (#F37021) and dark gray.`;
    await page.locator('textarea').last().fill(companyText);
    await page.locator('button').filter({hasText: /创建项目并录入/}).first().click();

    // Wait for creation to finish
    await page.waitForSelector('text=企业知识库已建立', {timeout: 30000});
    await page.screenshot({path: 'e2e-p4-03-project-created.png'});
    console.log('✅ Project created');

    // Enter knowledge base
    console.log('Step 4: Enter knowledge base');
    await page.locator('button').filter({hasText: /进入知识库/}).first().click();
    await page.waitForTimeout(1500);
    await page.screenshot({path: 'e2e-p4-04-kb-ingest.png'});

    // Wait for indexing to complete (status badge changes to 已索引)
    console.log('Step 5: Wait for indexing');
    let indexed = false;
    for (let i = 0; i < 60; i++) {
      await page.reload();
      await page.waitForTimeout(1000);

      // Re-enter project KB after reload by clicking the project in the sidebar enterprise list
      const projectBtn = page.locator('aside nav button').filter({hasText: /Phase4 E2E Project/}).first();
      await projectBtn.evaluate((el) => el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true})));
      await page.waitForTimeout(800);

      const indexedBadge = page.locator('text=已索引').first();
      const failedBadge = page.locator('text=失败').first();
      if (await indexedBadge.isVisible().catch(() => false)) {
        indexed = true;
        break;
      }
      if (await failedBadge.isVisible().catch(() => false)) {
        throw new Error('Indexing failed');
      }
    }
    if (!indexed) {
      throw new Error('Indexing did not complete within timeout');
    }
    await page.screenshot({path: 'e2e-p4-06-indexed.png'});
    console.log('✅ Entry indexed');

    // Navigate to AI Agent and ask a question
    console.log('Step 6: Ask question in AI Agent');
    const aiAgentBtn = page.locator('aside nav button').filter({hasText: /智能Agent|AI Agent/}).first();
    await aiAgentBtn.evaluate((el) => el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true})));
    await page.waitForTimeout(2000);
    await page.screenshot({path: 'e2e-p4-07-ai-agent.png'});

    const chatInput = page.locator('textarea').first();
    await chatInput.fill('What is GEO Agent and who developed it?');
    await chatInput.press('Enter');

    // Wait for response
    await page.waitForTimeout(15000);
    await page.screenshot({path: 'e2e-p4-08-answer.png'});

    const sources = page.locator('text=参考来源').first();
    if (await sources.isVisible().catch(() => false)) {
      console.log('✅ RAG answer returned with sources');
    } else {
      throw new Error('No sources shown in RAG answer');
    }

    console.log('All Phase 4 verification checks passed.');
    await browser.close();
  } finally {
    if (electronProc) {
      electronProc.kill();
      await new Promise((resolve) => {
        electronProc.on('exit', resolve);
        setTimeout(resolve, 5000);
      });
    }
    if (vite) await vite.close();
    await new Promise((r) => setTimeout(r, 500));
    rmSync(userDataDir, {recursive: true, force: true});
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Phase 4 E2E verification failed:', err);
    process.exit(1);
  });
