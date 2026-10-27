/**
 * Repository-wide editorial guard, AIDP v1.0.
 *
 * The specification, the run reports, the methodology and the READMEs quote the same handful of figures, and any file
 * that no build script reads any more can keep a stale one alive. Eight things have to hold across every published file:
 *
 *   1. An AIDP Score appears only at a value recomputed here from a published scoreboard (the AIDP Score over the
 *      thirty-one measures, as corrected and as registered; or the board of the reference run or the held-out check),
 *      and a 95 per cent range given beside it, or beside AIDP-2K's thirteen measures on either run, is recomputed too.
 *   2. No safe-handling rate is stated, and no published run output carries a review decision: this edition makes no
 *      claim about processing without review (specification, "Decided after the run").
 *   3. No em dashes or en dashes.
 *   4. No local machine detail: no user folder or temporary folder of the machine the files were made on, written out
 *      or built from the home folder.
 *   5. Every relative link in a markdown file points at a file or folder that exists.
 *   6. Every JSON and JSON Lines file parses.
 *   7. The published sets are whole: 2,000 AIDP-2K documents, 300 held-out documents with 302 PDF fingerprints, and
 *      960 AIDP-CAP documents with 1,485 PDF fingerprints.
 *   8. No published text file is empty.
 *
 * Names that must never appear in a published file (customers, vendors and models) are checked before publication by
 * a separate script that reads private lists; neither the lists nor any fingerprint of them is published, so that
 * check does not live here.
 *
 *   node verify-repo.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aidpScore } from './aidp-bench/bench/aidp-score.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
// Bulk evidence is machine output, not prose: raw outputs, answers and answer keys are scanned by checks 4, 6 and 8 only,
// apart from the READMEs of the held-out and sample folders, which are prose.
const PROSE_SKIP = new Set(['node_modules', '.git', 'raw', 'answers', 'corpus', 'corpus-heldout', 'corpus-sample', 'evidence', 'outputs', 'samples', 'db-export', 'corpus-regenerated', 'rescore']);
const ALL_SKIP = new Set(['node_modules', '.git', 'corpus-regenerated', 'rescore']);

function walk(dir, skip, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, skip, out);
    else if (/\.(md|html|json|jsonl|mjs|js|py|sql|txt|csv)$/.test(e.name) || e.name === 'LICENSE') out.push(p);
  }
  return out;
}

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}\n        ${d}`); } };
const rel = (p) => path.relative(ROOT, p);
const prose = walk(ROOT, PROSE_SKIP).filter((p) => /\.(md|html)$/.test(p) || path.basename(p) === 'LICENSE')
  .concat(['aidp-bench/corpus-heldout/README.md', 'aidp-bench/corpus-sample/README.md'].map((p) => path.join(ROOT, p)).filter((p) => fs.existsSync(p)));
const code = walk(ROOT, PROSE_SKIP).filter((p) => /\.(mjs|js|py|sql)$/.test(p) && p !== SELF);
const everything = walk(ROOT, ALL_SKIP);
console.log(`scanning ${prose.length} prose files, ${code.length} code files and ${everything.length} files in all\n`);

// A file is only a claim if a reader sees it as text; style and script bodies are not.
const readable = (p) => {
  const s = fs.readFileSync(p, 'utf8');
  if (!p.endsWith('.html')) return s;
  return s.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]*>/g, ' ');
};
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

console.log('=== 1. An AIDP Score appears only at a recomputed value ===');
const RUNS = { 'the reference run': 'aidp-bench/results/aidp-v1-main', 'the held-out check': 'aidp-bench/results/aidp-v1-heldout-main' };
const allowed = new Map();
for (const [name, dir] of Object.entries(RUNS)) {
  const score = Number(aidpScore(readJson(`${dir}/scoreboard.json`))['type-equal']).toFixed(2);
  const r = readJson(`${dir}/bootstrap.json`).flavours['type-equal'].score;
  allowed.set(score, { name, lo: Number(r.low).toFixed(2), hi: Number(r.high).toFixed(2) });
  console.log(`        ${name}: ${score} (95% range ${Number(r.low).toFixed(2)} to ${Number(r.high).toFixed(2)})`);
}
// the AIDP Score over the thirty-one measures, recomputed from AIDP-2K's published board and AIDP-CAP's measures
const { combinedScore } = await import('./aidp-bench/bench/score-cap.mjs');
const CAP_BOARDS = { 'the AIDP Score': 'aidp-bench/results/aidp-v1-cap/scoreboard-cap.json', 'the AIDP Score as registered': 'aidp-bench/results/aidp-v1-cap/as-registered/scoreboard-cap.json' };
for (const [name, file] of Object.entries(CAP_BOARDS)) {
  const b = readJson(file);
  const score = (combinedScore(readJson(`${RUNS['the reference run']}/scoreboard.json`), b.measures).raw * 100).toFixed(2);
  if (score !== (b.aidp_score.raw * 100).toFixed(2)) { fail++; console.log(`  FAIL  ${name}: the board says ${(b.aidp_score.raw * 100).toFixed(2)}, recomputed ${score}`); }
  allowed.set(score, { name, lo: Number(b.bootstrap.score.low).toFixed(2), hi: Number(b.bootstrap.score.high).toFixed(2) });
  console.log(`        ${name}: ${score} (95% range ${Number(b.bootstrap.score.low).toFixed(2)} to ${Number(b.bootstrap.score.high).toFixed(2)})`);
}
// AIDP-2K's thirteen measures in the score, on the reference run and the held-out check: their ranges are checked too
const { thirteen } = await import('./aidp-bench/bench/score-cap.mjs');
const ranged = new Map(allowed);
for (const [name, dir] of Object.entries(RUNS)) {
  const t = thirteen(readJson(`${dir}/scoreboard.json`));
  ranged.set(t.score.toFixed(2), { name: `${name}, thirteen measures`, lo: t.low.toFixed(2), hi: t.high.toFixed(2) });
  console.log(`        ${name}, AIDP-2K's thirteen measures: ${t.score.toFixed(2)} (95% range ${t.low.toFixed(2)} to ${t.high.toFixed(2)})`);
}
const rogue = [], badRange = [];
for (const p of prose) {
  const t = readable(p);
  for (const m of t.matchAll(/AIDP Score(?: of| was| is|:)?\**\s*\**(\d{2}\.\d{2})/g)) if (!allowed.has(m[1])) rogue.push(`${m[1]} in ${rel(p)}`);
  for (const [score, { lo, hi }] of ranged) {
    for (const m of t.matchAll(new RegExp(`${score.replace('.', '\\.')}[^.\\n]{0,60}?range(?: of| from)? (\\d{2}\\.\\d{2}) to (\\d{2}\\.\\d{2})`, 'g'))) {
      if (m[1] !== lo || m[2] !== hi) badRange.push(`${rel(p)}: ${score}, ${m[1]} to ${m[2]}`);
    }
  }
}
ok(`every stated AIDP Score is a recomputed one (${[...allowed.keys()].join(' or ')})`, rogue.length === 0, rogue.join('; '));
ok('every 95 per cent range given beside a score is that run\'s bootstrap range', badRange.length === 0, badRange.join('; '));

console.log('\n=== 2. No safe-handling rate is stated ===');
const rated = [];
for (const p of prose) for (const m of readable(p).matchAll(/safe-handling rate[^.\n]{0,80}?(\d{1,3}\.\d{2})(?:%| per ?cent)/gi)) rated.push(`${rel(p)}: ${m[1]}`);
ok('no published prose states a safe-handling rate', rated.length === 0, rated.join('; '));
const decided = [];
for (const d of fs.readdirSync(path.join(ROOT, 'aidp-bench/results'))) {
  const raw = path.join(ROOT, 'aidp-bench/results', d, 'raw');
  if (!fs.existsSync(raw)) continue;
  for (const f of fs.readdirSync(raw)) if (f.endsWith('.json') && fs.readFileSync(path.join(raw, f), 'utf8').includes('"auto_accept')) decided.push(`${d}/${f}`);
}
ok('no published run output carries a review decision', decided.length === 0, decided.slice(0, 5).join(', '));
const withDecisions = Object.values(RUNS).filter((d) => readJson(`${d}/scoreboard.json`).decisions != null
  || /^## Review decisions/m.test(fs.readFileSync(path.join(ROOT, d, 'report.md'), 'utf8')));
for (const file of Object.values(CAP_BOARDS)) if (readJson(file).decisions != null || /"auto_accept/.test(fs.readFileSync(path.join(ROOT, file), 'utf8'))) withDecisions.push(file);
ok('no scoreboard or report carries the review decisions', withDecisions.length === 0, withDecisions.join(', '));

console.log('\n=== 3. No em dashes or en dashes ===');
const dashed = prose.filter((p) => /[–—]/.test(fs.readFileSync(p, 'utf8')));
ok('no published prose contains an em dash or en dash', dashed.length === 0, dashed.map(rel).join(', '));

console.log('\n=== 4. No local machine detail ===');
const LOCAL = /\/Users\/[A-Za-z0-9._-]+\/|\/home\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\Users\\|\/private\/(?:tmp|var)\/|\/var\/folders\/|\/Applications\/|process\.env\.HOME\s*\+|\$\{process\.env\.HOME\}|homedir\(\)\s*\+|join\(\s*(?:os\.)?homedir\(\)|join\(\s*process\.env\.HOME|['"`]~\//;
const local = everything.filter((p) => p !== SELF && LOCAL.test(fs.readFileSync(p, 'utf8')));
ok('no published file names a local user, application or temporary folder', local.length === 0, local.map(rel).join(', '));

console.log('\n=== 5. Every relative link resolves ===');
const broken = [];
for (const p of walk(ROOT, new Set(['node_modules', '.git', 'raw', 'corpus-regenerated', 'rescore'])).filter((x) => x.endsWith('.md'))) {
  const t = fs.readFileSync(p, 'utf8').replace(/```[\s\S]*?```/g, ' ');
  for (const m of t.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1].split('#')[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    if (!fs.existsSync(path.resolve(path.dirname(p), decodeURIComponent(target)))) broken.push(`${rel(p)} -> ${m[1]}`);
  }
}
ok('every relative markdown link points at something that exists', broken.length === 0, broken.slice(0, 20).join('; '));

console.log('\n=== 6. Every JSON file parses ===');
const bad = [];
for (const p of everything) {
  try {
    if (p.endsWith('.json')) JSON.parse(fs.readFileSync(p, 'utf8'));
    else if (p.endsWith('.jsonl')) fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).forEach((l) => JSON.parse(l));
  } catch (e) { bad.push(`${rel(p)}: ${String(e.message).slice(0, 80)}`); }
}
ok('every .json and .jsonl file parses', bad.length === 0, bad.slice(0, 20).join('; '));

console.log('\n=== 7. The published sets are whole ===');
const n2k = readJson('aidp-bench/corpus/manifest.json').docs.length;
const ho = readJson('aidp-bench/corpus-heldout/manifest.json').docs.length;
const sums = fs.readFileSync(path.join(ROOT, 'aidp-bench/corpus-heldout/PDF-SHA256SUMS'), 'utf8').split('\n').filter((l) => /^[0-9a-f]{64}  \S/.test(l)).length;
ok(`AIDP-2K holds 2,000 documents (${n2k})`, n2k === 2000);
ok(`the held-out check holds 300 documents (${ho}) and 302 PDF fingerprints (${sums})`, ho === 300 && sums === 302);
const cap = readJson('aidp-bench/corpus-cap/manifest.json').docs.length;
const capSums = fs.readFileSync(path.join(ROOT, 'aidp-bench/corpus-cap/PDF-SHA256SUMS'), 'utf8').split('\n').filter((l) => /^[0-9a-f]{64}  \S/.test(l)).length;
ok(`AIDP-CAP holds 960 documents (${cap}) and 1,485 PDF fingerprints (${capSums})`, cap === 960 && capSums === 1485);


console.log('\n=== 8. No published file is empty ===');
const empty = everything.filter((p) => fs.statSync(p).size === 0);
ok('no published text file is empty', empty.length === 0, empty.map(rel).join(', '));

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
