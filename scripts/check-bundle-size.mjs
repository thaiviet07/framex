import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const ASSETS_DIR = join(process.cwd(), 'dist', 'assets');
const MAX_ENTRY_JS_GZIP_KB = 80; // Initial entry JS budget (< 80 KB gzip, currently ~46 KB)
const MAX_CSS_GZIP_KB = 25;

const files = readdirSync(ASSETS_DIR);
let entryJsGzipKb = 0;
let cssGzipKb = 0;

console.log('Bundle size report (dist/assets):');
for (const file of files.sort()) {
  if (file.endsWith('.map')) {
    console.error(`❌ Public sourcemap found in production build: ${file}`);
    process.exit(1);
  }
  const full = join(ASSETS_DIR, file);
  const raw = readFileSync(full);
  const gz = gzipSync(raw);
  const rawKb = (statSync(full).size / 1024).toFixed(2);
  const gzKb = +(gz.byteLength / 1024).toFixed(2);
  console.log(`  • ${file.padEnd(36)} ${String(rawKb).padStart(8)} KB │ gzip: ${String(gzKb).padStart(6)} KB`);
  if (/^index-.*\.js$/.test(file)) entryJsGzipKb = gzKb;
  if (/^index-.*\.css$/.test(file)) cssGzipKb = gzKb;
}

if (entryJsGzipKb === 0) {
  console.error('❌ Entry JS chunk (index-*.js) not found in dist/assets');
  process.exit(1);
}
if (entryJsGzipKb > MAX_ENTRY_JS_GZIP_KB) {
  console.error(`❌ Entry JS gzip size ${entryJsGzipKb} KB exceeds budget of ${MAX_ENTRY_JS_GZIP_KB} KB`);
  process.exit(1);
}
if (cssGzipKb > MAX_CSS_GZIP_KB) {
  console.error(`❌ Main CSS gzip size ${cssGzipKb} KB exceeds budget of ${MAX_CSS_GZIP_KB} KB`);
  process.exit(1);
}
console.log(`✅ Bundle budget passed (entry JS: ${entryJsGzipKb} KB / ${MAX_ENTRY_JS_GZIP_KB} KB gzip, CSS: ${cssGzipKb} KB / ${MAX_CSS_GZIP_KB} KB gzip)`);
