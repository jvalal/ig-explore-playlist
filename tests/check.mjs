// Tiny assertion helper shared by every test file.
export function suite() {
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail = '') => {
    if (ok) pass++; else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  };
  const done = () => {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  };
  return { check, done };
}
export const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
export async function waitUntil(fn, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await tick(50);
  }
  return false;
}
