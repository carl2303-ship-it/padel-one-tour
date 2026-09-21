import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { gunzipSync } from 'zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const partsDir = path.join(root, 'src/components/registration_parts');
const outFile = path.join(root, 'src/components/RegistrationLanding.tsx');

const parts = fs
  .readdirSync(partsDir)
  .filter((f) => /^b64_\d+\.txt$/.test(f))
  .sort();

if (parts.length === 0) {
  console.error('No b64 parts found in', partsDir);
  process.exit(1);
}

const b64 = parts.map((f) => fs.readFileSync(path.join(partsDir, f), 'utf8').trim()).join('');
const full = gunzipSync(Buffer.from(b64, 'base64')).toString('utf8');
fs.writeFileSync(outFile, full);
console.log('Assembled', outFile, 'from', parts.length, 'b64 parts (', full.length, 'bytes)');
