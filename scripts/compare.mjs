import sharp from 'sharp';
import { readdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const approved = 'C:/Users/GAMING/Documents/films/mk-cinema-concepts/velvet-premiere';

export async function compareShots() {
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
  console.log(`Created ${await compareShots()} mockup comparisons in shots/.`);
}
