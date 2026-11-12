// Checks dist/ against Cloudflare Pages' free-plan limits and prints a summary.
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const MAX_FILES = 20000;
const MAX_FILE = 25 * 1024 * 1024; // 25 MiB per file
const root = 'dist';

let files = 0, bytes = 0, biggest = { size: 0, path: '' };
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) { walk(p); continue; }
    files++;
    bytes += s.size;
    if (s.size > biggest.size) biggest = { size: s.size, path: relative(root, p) };
  }
};
walk(root);

const mib = (n) => (n / 1048576).toFixed(2) + ' MiB';
console.log('\nCloudflare Pages check (free plan)');
console.log(`  files        ${files} / ${MAX_FILES}`);
console.log(`  total size   ${mib(bytes)}`);
console.log(`  largest file ${mib(biggest.size)} (${biggest.path}) / 25 MiB limit`);
if (!existsSync(join(root, 'model', 'tileset.json'))) console.log('  WARNING: no model in dist/model – run `npm run model` first.');

const ok = files <= MAX_FILES && biggest.size <= MAX_FILE;
console.log(ok ? '  OK – within limits.\n' : '  OVER LIMIT – Cloudflare Pages will reject this upload.\n');
if (!ok) process.exit(1);
