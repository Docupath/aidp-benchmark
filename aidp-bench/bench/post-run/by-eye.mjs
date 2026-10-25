/**
 * Print a seeded sample of the reading-order verdicts for checking by eye: for each kind of verdict,
 * the printed row (cells, with the ones a sticker covers marked) beside the lines of the platform's
 * reading the verdict rests on. The sample is fixed by its seed, so anyone can draw the same rows and
 * check them. The verdicts of the check made for the published figures are in
 * <out>/by-eye/verdicts.json, written by hand.
 *
 *   node bench/post-run/by-eye.mjs --corpus <AIDP-2K dir> [--per 6] [--seed aidp-v1.0-post-run-by-eye]
 */
import path from 'node:path';
import { context, generated, pipelineRaw, readJsonl, opt } from './lib.mjs';
import { printedTables } from './reading-order.mjs';
import { Rng } from '../../corpus-gen/rng.mjs';

const ctx = context();
const PER = Number(opt('per', '6'));
const rng = new Rng(opt('seed', 'aidp-v1.0-post-run-by-eye'));
const docs = readJsonl(path.join(ctx.outDir, 'reading-order.jsonl'));
if (!docs) throw new Error('run reading-order.mjs first');

const classes = new Map();
const add = (k, x) => { if (!classes.has(k)) classes.set(k, []); classes.get(k).push(x); };
for (const d of docs) {
  for (const v of d.verdicts ?? []) {
    if (v.v === 'pass' || v.v === 'pass relaxed') add(`${v.v} ${d.direction}${d.direction === 'rtl' ? (v.dir === 'D' ? ' as displayed' : ' logical') : ''}${v.covered ? ' with covered cells' : ''}`, { d, v });
    else if (v.verdict === 'fail') add(`fail: ${v.reason}`, { d, v });
  }
}
for (const [k, xs] of [...classes.entries()].sort()) {
  const pick = rng.shuffle(xs).slice(0, PER);
  console.log(`\n==================== ${k} (${xs.length} rows; ${pick.length} shown)`);
  for (const { d, v } of pick) {
    const doc = ctx.corpus.byId.get(d.id);
    const gen = generated(doc, ctx.seed);
    const t = printedTables(gen).find((x) => x.table === (v.t ?? v.table));
    const cells = t?.rows[v.row] ?? [];
    const covered = new Set(v.covered ?? v.covered_cells ?? []);
    const lines = String(pipelineRaw(ctx, d.id)?.ocr_text ?? '').split('\n');
    const li = v.line;
    console.log(`\n-- ${d.id} (${d.locale}, ${d.noise}) ${v.t ?? v.table} row ${v.row + 1}`);
    console.log(`   printed: ${cells.map((c, i) => (covered.has(i) ? `{${c}}` : c)).join(' | ')}`);
    if (li != null) for (let k = li; k < Math.min(lines.length, li + 3); k++) console.log(`   ${k === li ? 'line   ' : 'next   '} ${lines[k]}`);
    if (v.missing) console.log(`   missing: ${JSON.stringify(v.missing)}`);
  }
}
