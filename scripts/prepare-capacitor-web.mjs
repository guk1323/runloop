import { mkdir, rm, copyFile, cp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const webDir = join(rootDir, 'www');
const files = ['index.html', 'manifest.json', 'sw.js', 'privacy.html'];
const assetDirs = ['assets'];

await rm(webDir, { recursive: true, force: true });
await mkdir(webDir, { recursive: true });

for (const file of files) {
  await copyFile(join(rootDir, file), join(webDir, file));
}

for (const dir of assetDirs) {
  await cp(join(rootDir, dir), join(webDir, dir), { recursive: true });
}

console.log(`Prepared ${files.length} web assets and ${assetDirs.length} asset directories in www/`);
