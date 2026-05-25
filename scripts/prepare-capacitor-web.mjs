import { mkdir, rm, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const webDir = join(rootDir, 'www');
const files = ['index.html', 'manifest.json', 'sw.js'];

await rm(webDir, { recursive: true, force: true });
await mkdir(webDir, { recursive: true });

for (const file of files) {
  await copyFile(join(rootDir, file), join(webDir, file));
}

console.log(`Prepared ${files.length} web assets in www/`);
