/**
 * Calibration, measured offline from the confidence the platform attached to every value it returned.
 *
 * Does the confidence attached to a value predict whether it is right? Three numbers, all computed on
 * the SAME set of values, so that none of them can be quoted over a friendlier population than the
 * others:
 *
 *   expected calibration error  ten equal-width confidence bins (0 to 0.1, ..., 0.9 to 1); for each, the
 *                               gap between the mean confidence and the share actually right, weighted
 *                               by the bin's size. 0 is perfect calibration.
 *   discrimination (AUROC)      the chance that a randomly chosen right value carries a higher
 *                               confidence than a randomly chosen wrong one. 0.5 is a coin flip.
 *   share of high-tier values   how much of the set the platform placed in its own top tier.
 *
 * THE SET: every value the system returned in a header field (line items excluded) of a field-key
 * document in the full lane, that the platform attached a confidence to, and that the answer key can
 * judge: right when the verdict is correct or normalised, wrong when it is wrong or invented. A field
 * left empty returned nothing and has nothing to calibrate. Returned header values that carry no
 * confidence are counted and reported beside the result.
 *
 *   node bench/calibration.mjs --corpus <dir> --run <run dir> [--json out.json]
 *   node bench/calibration.mjs --corpus corpus --tag aidp-v1-main
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RULES, FIELD_KEY_TYPES } from './rules.mjs';
import { loadCorpus, scoreDocuments } from './scoring.mjs';

const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Folders are recorded relative to the repository, so a published file carries no machine's paths.
const inRepo = (p) => (p ? path.relative(path.resolve(BENCH, '..'), p) || '.' : p);
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const CORPUS = path.resolve(opt('corpus', path.join(BENCH, 'corpus')));
const RUN = path.resolve(opt('run', path.join(path.resolve(opt('results', path.join(BENCH, 'results'))), opt('tag', 'aidp-v1-main'))));
const BINS = 10;
const isRowPath = (p) => /^[^.]+\.\d+(\.|$)/.test(p);

export function collect(verdictsByDoc, slugOf) {
  const set = [];
  let unscored = 0;
  for (const [id, { verdicts, raw }] of verdictsByDoc) {
    const fields = raw?.field_confidence?.fields ?? {};
    for (const v of verdicts) {
      if (v.verdict === 'missing' || /\.count$/.test(v.path) || isRowPath(v.path)) continue;
      const e = fields[v.path];
      if (!e || typeof e.c !== 'number') { unscored++; continue; }
      set.push({ id, slug: slugOf(id), path: v.path, c: Math.min(1, Math.max(0, e.c)), tier: e.tier ?? null, right: v.verdict === 'correct' || v.verdict === 'normalized' });
    }
  }
  return { set, unscored };
}

export function calibration(set) {
  const N = set.length;
  if (!N) return null;
  const bins = Array.from({ length: BINS }, (_, i) => ({ from: i / BINS, to: (i + 1) / BINS, n: 0, conf: 0, right: 0 }));
  for (const x of set) {
    const b = bins[Math.min(BINS - 1, Math.floor(x.c * BINS))];
    b.n++; b.conf += x.c; b.right += x.right ? 1 : 0;
  }
  let ece = 0;
  for (const b of bins) {
    if (!b.n) continue;
    b.mean_confidence = b.conf / b.n; b.accuracy = b.right / b.n;
    ece += (b.n / N) * Math.abs(b.accuracy - b.mean_confidence);
    delete b.conf;
  }
  // AUROC by the rank-sum (Mann-Whitney) statistic, ties sharing their average rank.
  const sorted = set.map((x) => ({ c: x.c, right: x.right })).sort((a, b) => a.c - b.c);
  let rankSumRight = 0;
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j < sorted.length && sorted[j].c === sorted[i].c) j++;
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) if (sorted[k].right) rankSumRight += avgRank;
    i = j;
  }
  const nR = set.filter((x) => x.right).length, nW = N - nR;
  const auroc = nR && nW ? (rankSumRight - (nR * (nR + 1)) / 2) / (nR * nW) : null;
  return {
    values: N, right: nR, wrong: nW,
    accuracy: nR / N,
    mean_confidence: set.reduce((a, x) => a + x.c, 0) / N,
    expected_calibration_error: ece,
    discrimination_auroc: auroc,
    high_tier_share: set.filter((x) => x.tier === 'high').length / N,
    bins: bins.map((b) => ({ ...b, from: +b.from.toFixed(1), to: +b.to.toFixed(1) })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const corpus = loadCorpus(CORPUS);
  const { verdicts, population } = scoreDocuments({ corpus, runDir: RUN, population: opt('population', 'auto'), rules: RULES, keepVerdicts: true });
  const slugOf = (id) => corpus.byId.get(id)?.slug;
  for (const id of [...verdicts.keys()]) if (!FIELD_KEY_TYPES.includes(slugOf(id))) verdicts.delete(id);
  const { set, unscored } = collect(verdicts, slugOf);
  const all = calibration(set);
  const byType = Object.fromEntries(FIELD_KEY_TYPES.map((t) => [t, calibration(set.filter((x) => x.slug === t))]));
  const out = { run: inRepo(RUN), population: population.mode, documents: verdicts.size, returned_header_values_without_confidence: unscored, overall: all, by_type: byType };
  const f = (x, d = 3) => (x == null ? 'n/a' : x.toFixed(d));
  console.log(`Calibration, full lane, header values of field-key documents: ${verdicts.size} documents, ${all?.values ?? 0} values (${unscored} returned without a confidence, left out).`);
  if (all) {
    console.log(`  expected calibration error ${f(all.expected_calibration_error)}, discrimination (AUROC) ${f(all.discrimination_auroc)}, high tier ${(all.high_tier_share * 100).toFixed(2)}% of values; ${(all.accuracy * 100).toFixed(2)}% of all values right`);
    console.log('  bins (confidence range: values, mean confidence, share right):');
    for (const b of all.bins) if (b.n) console.log(`    ${b.from.toFixed(1)} to ${b.to.toFixed(1)}: ${b.n}, ${f(b.mean_confidence)}, ${f(b.accuracy)}`);
    console.log('  by document type:');
    for (const [t, c] of Object.entries(byType)) console.log(`    ${t}: ${c ? `${c.values} values, ECE ${f(c.expected_calibration_error)}, AUROC ${f(c.discrimination_auroc)}, high tier ${(c.high_tier_share * 100).toFixed(2)}%` : 'no values'}`);
  }
  if (opt('json')) fs.writeFileSync(path.resolve(opt('json')), JSON.stringify(out, null, 1));
}
