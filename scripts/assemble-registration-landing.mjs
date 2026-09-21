import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const partsDir = path.join(root, 'src/components/registration_parts');
const outFile = path.join(root, 'src/components/RegistrationLanding.tsx');

const parts = fs
  .readdirSync(partsDir)
  .filter((f) => /^part\d+\.txt$/.test(f))
  .sort();

if (parts.length === 0) {
  console.error('No registration parts found in', partsDir);
  process.exit(1);
}

const full = parts.map((f) => fs.readFileSync(path.join(partsDir, f), 'utf8')).join('');
fs.writeFileSync(outFile, full);
console.log('Assembled', outFile, 'from', parts.length, 'parts (', full.length, 'bytes)');
