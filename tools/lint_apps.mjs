// Static validation gate for the themed apps.
// - syntax-checks every inline <script> via `node --check` (as a module, so
//   top-level await is allowed), and
// - verifies each app references the shared engine + required UX hooks.
// Usage: node tools/lint_apps.mjs
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPS_DIR = join(ROOT, 'apps');
const tmp = mkdtempSync(join(tmpdir(), 'balint-'));

const REQUIRED = [
  ['shared/frames-data.js',       /shared\/frames-data\.js/],
  ['shared/badapple.js',          /shared\/badapple\.js/],
  ['shared/badapple-anywhere.js', /shared\/badapple-anywhere\.js/],
  ['anywhere forms API',          /BADAPPLE_OPTS|BadAppleAnywhere/],
  ['render target',               /id\s*=\s*["']stage["']/],
  ['gallery link',                /href\s*=\s*["']\.\.\/\.\.\/index\.html/],
];
const SOFT = [
  ['no rogue <audio>',      /^(?![\s\S]*new\s+Audio\s*\()/],          // should use BadApple.audioElement()
];

function scripts(html){
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))){
    const attrs = m[1] || '';
    if (/\bsrc\s*=/.test(attrs)) continue; // external include, skip
    out.push(m[2]);
  }
  return out;
}

let pass = 0, fail = 0;
const rows = [];
for (const slug of readdirSync(APPS_DIR)){
  const file = join(APPS_DIR, slug, 'index.html');
  if (!existsSync(file)) { rows.push([slug, 'MISSING', '', 'no index.html']); fail++; continue; }
  const html = readFileSync(file, 'utf8');
  const size = (html.length/1024).toFixed(0)+'KB';
  const problems = [];

  for (const [name, re] of REQUIRED) if (!re.test(html)) problems.push('missing ' + name);
  const warns = [];
  for (const [name, re] of SOFT) if (!re.test(html)) warns.push('no ' + name);

  let si = 0;
  for (const code of scripts(html)){
    si++;
    const f = join(tmp, slug + '.' + si + '.mjs');
    writeFileSync(f, code);
    try { execSync('node --check "' + f + '"', { stdio: 'pipe' }); }
    catch (e){ problems.push('JS#' + si + ' syntax: ' + String(e.stderr||e.message).split('\n').find(l=>/SyntaxError|Error/.test(l))); }
  }

  const ok = problems.length === 0;
  if (ok) pass++; else fail++;
  rows.push([slug, ok ? 'OK' : 'FAIL', size, [...problems, ...warns.map(w=>'(warn) '+w)].join('; ')]);
}

const w = Math.max(...rows.map(r=>r[0].length));
console.log('slug'.padEnd(w), 'status', 'size', 'notes');
console.log('-'.repeat(w+40));
for (const r of rows){
  console.log(r[0].padEnd(w), r[1].padEnd(6), (r[2]||'').padEnd(5), r[3]);
}
console.log('\n' + pass + ' OK, ' + fail + ' FAIL of ' + rows.length);
process.exit(fail ? 1 : 0);
