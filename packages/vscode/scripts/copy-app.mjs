// Copies the built Hearth web app (../../dist, from `npm run build` at the repo root) into media/app.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '..', '..', '..', 'dist');
const dest = resolve(here, '..', 'media', 'app');

if (!existsSync(join(src, 'index.html'))) {
  console.error(`copy-app: ${join(src, 'index.html')} not found. Build the app first: run \`npm ci && npm run build\` at the repo root.`);
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`copy-app: copied ${src} -> ${dest}`);
