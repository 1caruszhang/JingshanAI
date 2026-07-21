import {join} from 'node:path';
import {existsSync} from 'node:fs';

declare const __dirname: string;

function getExtensionSuffix(): string {
  switch (process.platform) {
    case 'win32':
      return '.dll';
    case 'darwin':
      return '.dylib';
    default:
      return '.so';
  }
}

export function loadVecExtension(db: {loadExtension: (path: string) => void}) {
  const suffix = getExtensionSuffix();
  const possiblePaths = [
    join(process.cwd(), 'node_modules/sqlite-vec/build/Release/vec0'),
    join(process.cwd(), 'node_modules/sqlite-vec-darwin-arm64/vec0'),
    join(process.cwd(), 'node_modules/sqlite-vec-darwin-x64/vec0'),
    join(process.cwd(), 'node_modules/sqlite-vec-linux-x64/vec0'),
    join(process.cwd(), 'node_modules/sqlite-vec-win32-x64/vec0'),
    join(process.cwd(), 'node_modules/sqlite-vec-windows-x64/vec0'),
    join(process.resourcesPath ?? '', 'vec0'),
    join(__dirname, '../../resources/vec0'),
  ];

  for (const extPath of possiblePaths) {
    try {
      const fullPath = `${extPath}${suffix}`;
      if (existsSync(fullPath)) {
        db.loadExtension(extPath);
        console.log('sqlite-vec loaded from:', extPath);
        return;
      }
    } catch {
      continue;
    }
  }

  console.warn('sqlite-vec extension not found, vector search will be unavailable');
}
