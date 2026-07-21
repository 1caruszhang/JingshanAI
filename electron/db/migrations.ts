import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {getMigrationsPath} from '../utils/paths.ts';

interface SqliteDatabase {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    get: () => unknown;
    run: (...params: unknown[]) => void;
  };
  transaction: <T>(fn: () => T) => () => T;
}

export function runMigrations(db: SqliteDatabase): {
  currentVersion: number;
  targetVersion: number;
} {
  db.exec(`
    CREATE TABLE IF NOT EXISTS __migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const currentRow = db
    .prepare('SELECT MAX(version) as v FROM __migrations')
    .get() as {v: number | null} | undefined;
  const currentVersion = currentRow?.v ?? 0;

  const migrationsDir = getMigrationsPath();
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let applied = 0;

  for (const file of files) {
    const versionMatch = file.match(/^(\d+)_.*\.sql$/);
    if (!versionMatch) continue;

    const version = parseInt(versionMatch[1], 10);
    if (version <= currentVersion) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf-8');

    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO __migrations (version) VALUES (?)').run(version);
    })();

    applied++;
    console.log(`Applied migration ${version}: ${file}`);
  }

  return {
    currentVersion: currentVersion + applied,
    targetVersion: files.length,
  };
}
