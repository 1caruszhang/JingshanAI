import type {App} from 'electron';
import {join} from 'node:path';
import {mkdirSync} from 'node:fs';

let appInstance: App | null = null;

export function setApp(instance: App) {
  appInstance = instance;
}

function getApp(): App {
  if (!appInstance) {
    throw new Error('Electron app is not initialized. Call setApp(app) first.');
  }
  return appInstance;
}

export function getUserDataPath(): string {
  const path = getApp().getPath('userData');
  mkdirSync(path, {recursive: true});
  return path;
}

export function getDbPath(): string {
  return join(getUserDataPath(), 'nai-agent.db');
}

export function getMigrationsPath(): string {
  if (getApp().isPackaged) {
    return join(process.resourcesPath, 'migrations');
  }
  return join(process.cwd(), 'electron/db/schema');
}
