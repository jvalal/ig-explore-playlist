// The hidden attribute must win over component display rules (it didn't once).
import { JSDOM } from 'jsdom';
import fs from 'fs';
import { EXT_DIR } from '../ext-dir.mjs';
import { suite } from '../check.mjs';

const { check, done } = suite();
const css = fs.readFileSync(EXT_DIR + 'sidepanel.css', 'utf8');
const html = fs.readFileSync(EXT_DIR + 'sidepanel.html', 'utf8')
  .replace('<link rel="stylesheet" href="sidepanel.css">', `<style>${css}</style>`)
  .replace(/<script.*<\/script>/g, '');
const { window } = new JSDOM(html);
const d = (sel) => window.getComputedStyle(window.document.querySelector(sel)).display;
const seen = { dock: d('#dock'), plNew: d('#pl-new'), empty: d('#empty'), hint: d('#dock-hint'), setupDone: d('#setup-done') };
check('every hidden element stays hidden with the real stylesheet', Object.values(seen).every((v) => v === 'none'), JSON.stringify(seen));
check('the [hidden] rule is the last rule in the stylesheet', /html \[hidden\] \{ display: none !important; \}\s*$/.test(css));
check('body uses min-height, not height (sticky footer)', /body \{ min-height: 100%; \}/.test(css) && !/(^|\n)body \{[^}]*(?<![-\w])height:/.test(css));
done();
