// Copies a DJI Terra 3D Tiles export into public/model/ and fixes the tileset version.
//
//   npm run model                       -> uses the default source below
//   npm run model -- "E:/Jobs/terra_b3dms"  -> any other export (forward slashes are fine)
//
// Only asset.version is changed ("0.0" -> "1.0", which Cesium expects). Geometry,
// transforms, gltfUpAxis ("Z") and every tile/level are copied untouched.
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DEFAULT_SRC = 'D:/Cork-3D(1)/models/pc/0/terra_b3dms';
const src = resolve(process.argv[2] || DEFAULT_SRC);
const dest = resolve('public', 'model');

if (!existsSync(join(src, 'tileset.json'))) {
  console.error(`No tileset.json found in ${src}`);
  process.exit(1);
}

console.log(`Copying ${src}\n     -> ${dest}`);
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });

let files = 0, bytes = 0, rewritten = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) { walk(p); continue; }
    files++;
    bytes += s.size;
    if (!name.toLowerCase().endsWith('.json')) continue;
    const json = JSON.parse(readFileSync(p, 'utf8'));
    if (json.asset && json.asset.version !== '1.0') {
      json.asset.version = '1.0';
      writeFileSync(p, JSON.stringify(json));
      rewritten++;
    }
  }
};
walk(dest);

console.log(`Done: ${files} files, ${(bytes / 1048576).toFixed(1)} MiB, ${rewritten} tileset JSONs set to version 1.0.`);
