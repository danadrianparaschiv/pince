// Makes a copy of a photo with everything but the picture removed: location, time, camera.
// Phone photos carry the place they were taken, so only such copies belong in the repository.
// Usage: node scripts/strip-photo-metadata.mjs <photo.jpg|png|webp> <copy.jpg> [longest-edge-in-pixels]
// HEIC photos are converted first, on macOS with: sips -s format jpeg photo.heic --out photo.jpg
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

const [from, to, edge] = process.argv.slice(2);
const stop = message => { console.error(message); process.exit(1); };
if (!from || !to || (edge !== undefined && !(Number(edge) >= 200))) stop('Usage: node scripts/strip-photo-metadata.mjs <photo> <copy.jpg> [longest-edge-in-pixels]');
if (existsSync(to)) stop('The copy already exists; choose a new file name.');
const sharp = createRequire(new URL('../api/package.json', import.meta.url))('sharp');
// Turn the picture upright first: the orientation is part of what gets removed.
const upright = sharp(from).rotate();
if (edge) upright.resize({ width: Number(edge), height: Number(edge), fit: 'inside', withoutEnlargement: true });
await upright.jpeg({ quality: 88 }).toFile(to);
const left = await sharp(to).metadata();
if (left.exif || left.xmp || left.iptc) stop('Metadata is still present in the copy. Do not publish it.');
console.log('Wrote ' + to + ' (' + left.width + ' × ' + left.height + ') with no embedded metadata.');
