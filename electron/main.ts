import 'dotenv/config';
import {app, BrowserWindow, Menu} from 'electron';
import {join} from 'node:path';
import {setApp} from './utils/paths.ts';
import {registerIpcHandlers, setMainWindow} from './ipc/handlers.ts';

declare const __dirname: string;

setApp(app);

let mainWindow: BrowserWindow | null;

const isMac = process.platform === 'darwin';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    // macOS keeps traffic lights; Windows/Linux use frameless custom title bar
    ...(isMac
      ? {titleBarStyle: 'hiddenInset'}
      : {frame: false, titleBarStyle: 'hidden'}),
  });

  setMainWindow(mainWindow);

  // Remove the default File/Edit/View/Window/Help menu
  Menu.setApplicationMenu(null);

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-change', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-change', false);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    setMainWindow(null);
  });
}

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
