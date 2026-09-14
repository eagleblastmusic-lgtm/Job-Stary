import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOTS = ['src', 'scripts', 'e2e'];
const TEXT_EXTENSIONS = new Set(['.ts', '.mjs', '.js']);
const violations = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dist' || entry.name === 'node_modules') continue;
      await walk(path);
      continue;
    }
    if (!TEXT_EXTENSIONS.has(extname(entry.name))) continue;
    if (path.replace(/\\/g, '/').endsWith('scripts/lint.mjs')) continue;
    const text = await readFile(path, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      if (/\b(TODO|FIXME)\b/.test(line)) violations.push(`${path}:${index + 1}: unresolved TODO/FIXME`);
      if (/\beval\s*\(/.test(line)) violations.push(`${path}:${index + 1}: eval() is forbidden`);
      if (/\bas\s+any\b|:\s*any\b|<any>/.test(line)) violations.push(`${path}:${index + 1}: explicit any requires a documented exception`);
      if (/[ \t]+$/.test(line)) violations.push(`${path}:${index + 1}: trailing whitespace`);
    });
  }
}

for (const root of ROOTS) await walk(root);
if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Static policy lint: PASS');
}
