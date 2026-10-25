import sharp from 'sharp';
import { readdir, access, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// Puts each approved mockup (a folder outside this public repo) next to the capture of the same name in shots/.
export async function compareShots(approved) {
  const shots = resolve(root, 'shots');
  let count = 0;
  for (const file of await readdir(approved)) {
    if (!file.endsWith('.png')) continue;
    const actual = resolve(shots, file);
    try { await access(actual); } catch { continue; }
    const height = file === 'library-desktop.png' ? 900 : 844;
    const left = await sharp(resolve(approved, file)).resize({ height }).png().toBuffer();
    const right = await sharp(actual).resize({ height }).png().toBuffer();
    const a = await sharp(left).metadata();
    const b = await sharp(right).metadata();
    await sharp({ create: { width: a.width + b.width + 16, height, channels: 4, background: '#242022' } })
      .composite([{ input: left, left: 0, top: 0 }, { input: right, left: a.width + 16, top: 0 }])
      .png().toFile(resolve(shots, `compare-${file}`));
    count++;
  }
  return count;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const approved = process.argv[2] ? resolve(process.argv[2]) : '';
  if (!approved || !(await stat(approved).catch(() => null))?.isDirectory()) {
    console.error(`${approved ? `No folder at ${approved}. ` : ''}Name the folder of approved mockups: node scripts/compare.mjs <folder>`);
    process.exit(1);
  }
  console.log(`Created ${await compareShots(approved)} mockup comparisons in shots/.`);
}
