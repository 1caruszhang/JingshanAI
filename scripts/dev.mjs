import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {createServer} from 'vite';
import * as esbuild from 'esbuild';

const VITE_PORT = 5173;
const VITE_DEV_SERVER_URL = `http://localhost:${VITE_PORT}`;

mkdirSync('dist-electron/main', {recursive: true});
mkdirSync('dist-electron/preload', {recursive: true});

let electronProcess = null;
let isElectronStarted = false;

function startElectron() {
  if (electronProcess) {
    electronProcess.kill();
  }

  const env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;

  const electronPath = process.platform === 'win32'
    ? 'node_modules/electron/cli.js'
    : 'node_modules/.bin/electron';
  electronProcess = spawn('node', [electronPath, 'dist-electron/main/main.cjs'], {
    env: {
      ...env,
      VITE_DEV_SERVER_URL,
    },
    stdio: 'inherit',
  });

  electronProcess.on('exit', (code) => {
    if (!isElectronStarted) {
      return;
    }
    if (code !== 0 && code !== null) {
      console.log(`Electron exited with code ${code}`);
    }
  });
}

function createWatchContext(options, name, onBuild) {
  return esbuild.context({
    ...options,
    plugins: [
      {
        name: `${name}-watch`,
        setup(build) {
          build.onEnd((result) => {
            if (result.errors.length > 0) {
              console.error(`${name} build failed:`, result.errors);
              return;
            }
            console.log(`${name} rebuilt`);
            onBuild();
          });
        },
      },
    ],
  });
}

let mainReady = false;
let preloadReady = false;
let viteReady = false;

function maybeStartElectron() {
  if (mainReady && preloadReady && viteReady) {
    isElectronStarted = true;
    startElectron();
  }
}

const mainBuild = await createWatchContext(
  {
    entryPoints: ['electron/main.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron', 'better-sqlite3'],
    outfile: 'dist-electron/main/main.cjs',
    sourcemap: true,
  },
  'Main',
  () => {
    if (!mainReady) {
      mainReady = true;
      maybeStartElectron();
    } else {
      startElectron();
    }
  },
);

const preloadBuild = await createWatchContext(
  {
    entryPoints: ['electron/preload.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
    outfile: 'dist-electron/preload/preload.js',
    sourcemap: true,
  },
  'Preload',
  () => {
    if (!preloadReady) {
      preloadReady = true;
      maybeStartElectron();
    } else {
      startElectron();
    }
  },
);

const vite = await createServer({
  configFile: 'vite.config.ts',
  server: {
    port: VITE_PORT,
  },
});

await vite.listen(VITE_PORT);
viteReady = true;
console.log(`Vite dev server ready at ${VITE_DEV_SERVER_URL}`);

await mainBuild.watch();
await preloadBuild.watch();

function shutdown() {
  console.log('\nShutting down...');
  if (electronProcess) {
    electronProcess.kill();
  }
  mainBuild.dispose();
  preloadBuild.dispose();
  vite.close().then(() => {
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
