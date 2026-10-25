/**
 * Does Printed text, numbers depend on how a reader lays out a table? It must not.
 *
 * Takes each document's own correct text, changes nothing but the layout of its tables (cell dividers
 * replaced by space-aligned columns, the way many readers emit a table), and measures how many of the
 * text's own numbers each version of the number pattern still finds. A measure that does not depend on
 * layout finds all of them. This is the check behind the column-gap rule (rules.mjs, numbersEndAtGap); it
 * needs nothing but the corpus.
 *
 *   node bench/layout-check.mjs --corpus <corpus dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import { tokens } from './score-das.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const CORPUS = path.resolve(opt('corpus', 'corpus'));
const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8'));

/** The same text with each markdown table row written as space-aligned columns. */
const spaced = (t) => t.split('\n')
  .filter((l) => !/^\s*\|?\s*:?-{3,}/.test(l))
  .map((l) => (/^\s*\|.*\|\s*$/.test(l) ? l.trim().replace(/^\|\s*|\s*\|$/g, '').split(/\s*\|\s*/).join('   ') : l))
  .join('\n');

function recall(need, have) {
  const pool = new Map();
  for (const h of have) pool.set(h, (pool.get(h) ?? 0) + 1);
  let found = 0;
  for (const n of need) { const c = pool.get(n) ?? 0; if (c > 0) { pool.set(n, c - 1); found++; } }
  return need.length ? found / need.length : 1;
}

let before = 0, after = 0, allFound = 0, n = 0;
for (const d of manifest.docs) {
  const file = path.join(CORPUS, d.slug ?? d.id.replace(/-\d+$/, ''), `${d.id}.gt.txt`);
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const relaid = spaced(text);
  before += recall(tokens(text, { numbersEndAtGap: false }).nums, tokens(relaid, { numbersEndAtGap: false }).nums);
  const r = recall(tokens(text).nums, tokens(relaid).nums);
  after += r;
  if (r === 1) allFound++;
  n++;
}
console.log(`${n} documents, each document's own correct text with its tables laid out as space-aligned columns.`);
console.log(`Average share of the text's own numbers found: first pattern ${(before / n * 100).toFixed(2)}%, corrected pattern ${(after / n * 100).toFixed(2)}% (every number found in ${allFound} of ${n} documents).`);
