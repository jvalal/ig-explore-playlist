// Runs every *.test.mjs in the given folders, one process each.
// Fails if any file exits non-zero or prints a line starting with FAIL.
import { readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ['unit'];
let bad = 0;
for (const dir of dirs) {
  const files = readdirSync(path.join(here, dir)).filter((f) => f.endsWith('.test.mjs')).sort();
  for (const f of files) {
    console.log(`\n=== ${dir}/${f}`);
    const r = spawnSync(process.execPath, [path.join(here, dir, f)], { encoding: 'utf8', env: process.env });
    process.stdout.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
    const printedFail = /^FAIL/m.test(r.stdout || '');
    if (r.status !== 0 || printedFail) {
      bad++;
      console.log(`!!! ${dir}/${f}: exit ${r.status}${printedFail ? ', printed FAIL' : ''}`);
    }
  }
}
console.log(bad ? `\n${bad} test file(s) failed` : '\nAll test files passed');
process.exit(bad ? 1 : 0);
