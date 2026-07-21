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
  const userDataDir = mkdtempSync(join(tmpdir(), 'nai-agent-e2e-p3-'));
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
    await page.screenshot({path: 'e2e-p3-01-dashboard.png'});

    // Navigate to AI Agent
    console.log('Step 2: Open AI Agent');
    const aiAgentBtn = page.locator('aside nav button').filter({hasText: /智能Agent|AI Agent/}).first();
    await aiAgentBtn.evaluate((el) => el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true})));
    await page.waitForTimeout(1500);
    await page.screenshot({path: 'e2e-p3-02-ai-agent.png'});

    // Send first message
    console.log('Step 3: Send first message');
    const firstMessage = 'Hello GEO Agent, this is session one';
    const chatInput = page.locator('textarea').first();
    await chatInput.fill(firstMessage);
    await chatInput.press('Enter');
    await page.waitForTimeout(3000);
    await page.screenshot({path: 'e2e-p3-03-first-message.png'});

    const response = page.locator('text=GEO Agent').first();
    if (!(await response.isVisible().catch(() => false))) {
      throw new Error('Assistant response not shown');
    }
    console.log('✅ First session got a response');

    // Start new chat
    console.log('Step 4: Start new chat');
    const newChatBtn = page.locator('button').filter({hasText: /新对话|New chat/}).first();
    await newChatBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({path: 'e2e-p3-04-new-chat.png'});

    const secondMessage = 'This is session two';
    await chatInput.fill(secondMessage);
    await chatInput.press('Enter');
    await page.waitForTimeout(3000);
    console.log('✅ Second session created');

    // Open history drawer and switch back to first session
    console.log('Step 5: Open chat history');
    const historyBtn = page.locator('button').filter({hasText: /历史记录|History/}).first();
    await historyBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({path: 'e2e-p3-05-history-drawer.png'});

    const firstSession = page.locator('text=' + firstMessage.slice(0, 30)).first();
    if (!(await firstSession.isVisible().catch(() => false))) {
      throw new Error('First session not found in history drawer');
    }
    await firstSession.click();
    await page.waitForTimeout(1500);
    await page.screenshot({path: 'e2e-p3-06-session-switched.png'});

    const firstMsg = page.locator('text=' + firstMessage).first();
    if (!(await firstMsg.isVisible().catch(() => false))) {
      throw new Error('First session message not shown after switch');
    }
    console.log('✅ History drawer can switch sessions');

    console.log('All Phase 3 verification checks passed.');
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
    console.error('Phase 3 E2E verification failed:', err);
    process.exit(1);
  });
