import {getDbPath} from '../utils/paths.ts';
import {loadVecExtension} from './vec-loader.ts';
import {runMigrations} from './migrations.ts';

declare const require: NodeRequire;

let db: ReturnType<typeof initDb> | null = null;

function initDb() {
  const Database = require('better-sqlite3');
  const instance = new Database(getDbPath());
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  loadVecExtension(instance);
  runMigrations(instance);
  return instance;
}

export function getDb() {
  if (!db) {
    db = initDb();
  }
  return db;
}

function closeDb() {
  try {
    db?.close();
  } catch {
    // ignore
  }
}

process.on('exit', closeDb);
process.on('SIGINT', () => {
  closeDb();
  process.exit(0);
});
process.on('SIGTERM', () => {
  closeDb();
  process.exit(0);
});
