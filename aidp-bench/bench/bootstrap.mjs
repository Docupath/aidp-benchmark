/**
 * Bootstrap confidence ranges for the AIDP Score, every layer and every measure.
 *
 * 2,000 resamples (--resamples), seeded (--seed), documents resampled WITH REPLACEMENT WITHIN THEIR
 * DOCUMENT TYPE, so every resample keeps the run's composition of types and only the documents inside
 * each type vary. The repeatability documents are resampled the same way, within type, from their own
 * sample. Every resample is scored with exactly the functions the score uses (aidp-score.mjs), from the
 * per-document units in the scoreboard, and the 95% range is the 2.5th to 97.5th percentile.
 *
 *   node bench/bootstrap.mjs --board <scoreboard.json> [--resamples 2000] [--seed aidp-v1.0-bootstrap] [--json out.json]
 */
import fs from 'node:fs';
// A figure below 100 is never rounded up to 100: it keeps the fewest decimals that avoid it.
const noRoundUp = (v, d = 2) => { if (v == null) return 'n/a'; let s = v.toFixed(d); while (s.startsWith('100') && v < 100 && d < 12) s = v.toFixed(++d); return s; };
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mulberry32, hashSeed } from '../corpus-gen/rng.mjs';
import { MEASURES, LAYERS, FLAVOURS, unitsOf, weightsFor, combine } from './aidp-score.mjs';

const geo = (xs) => Math.exp(xs.reduce((s, x) => s + Math.log(Math.min(x, 1)), 0) / xs.length);
const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

/**
 * Pack each document's units into a vector: for measure k, slot 2k holds the passes (or the value) and
 * slot 2k+1 the checks (or 1 when the document has a value). Resampling is then a sum of vectors.
 */
function pack(list) {
  const K = MEASURES.length;
  const byType = new Map();
  for (const x of list) {
    const v = new Float64Array(2 * K);
    MEASURES.forEach((m, k) => {
      const e = x.u[m.id];
      if (!e) return;
      if (m.agg === 'mean') { if (e.v != null && !Number.isNaN(e.v)) { v[2 * k] = e.v; v[2 * k + 1] = 1; } }
      else if (e.n) { v[2 * k] = e.p; v[2 * k + 1] = e.n; }
    });
    if (!byType.has(x.slug)) byType.set(x.slug, []);
    byType.get(x.slug).push(v);
  }
  return byType;
}

/** Sum the vectors of one resample (or of the full data, when draw is null), per type. */
function sums(byType, rnd) {
  const out = new Map();
  for (const [t, docs] of byType) {
    const s = new Float64Array(docs[0].length);
    for (let i = 0; i < docs.length; i++) {
      const d = docs[rnd ? Math.floor(rnd() * docs.length) : i];
      for (let j = 0; j < s.length; j++) s[j] += d[j];
    }
    out.set(t, s);
  }
  return out;
}

/** Every measure, layer and score of both weightings from per-type sums. */
function evaluate(pipeSums, stabSums, weightsByFlavour) {
  const res = {};
  for (const f of FLAVOURS) {
    const w = weightsByFlavour[f];
    const values = MEASURES.map((m, k) => {
      const src = m.source === 'stability' ? stabSums : pipeSums;
      const inPop = (t) => !m.population || m.population.includes(t);
      if (m.weighting === 'document') {
        let a = 0, b = 0;
        for (const [t, s] of src) if (inPop(t)) { a += s[2 * k]; b += s[2 * k + 1]; }
        return b ? a / b : null;
      }
      const perType = {};
      for (const t of Object.keys(w)) { const s = src.get(t); perType[t] = s && inPop(t) && s[2 * k + 1] ? s[2 * k] / s[2 * k + 1] : null; }
      return combine(perType, w);
    });
    if (values.some((v) => v == null)) { res[f] = null; continue; }
    const byId = new Map(MEASURES.map((m, k) => [m.id, values[k]]));
    res[f] = {
      score: geo(values) * 100,
      layers: LAYERS.map((L) => geo(L.measures.map((id) => byId.get(id))) * 100),
      measures: values.map((v) => v * 100),
    };
  }
  return res;
}

export function bootstrap(board, { resamples = 2000, seed = 'aidp-v1.0-bootstrap' } = {}) {
  const units = unitsOf(board);
  const pipe = pack(units.pipeline), stab = pack(units.stability);
  const W = Object.fromEntries(FLAVOURS.map((f) => [f, weightsFor(f)]));
  const point = evaluate(sums(pipe, null), sums(stab, null), W);
  const rnd = mulberry32(hashSeed(seed));
  const draws = Object.fromEntries(FLAVOURS.map((f) => [f, { score: [], layers: LAYERS.map(() => []), measures: MEASURES.map(() => []) }]));
  let skipped = 0;
  for (let r = 0; r < resamples; r++) {
    const e = evaluate(sums(pipe, rnd), sums(stab, rnd), W);
    if (FLAVOURS.some((f) => !e[f])) { skipped++; continue; }
    for (const f of FLAVOURS) {
      draws[f].score.push(e[f].score);
      e[f].layers.forEach((x, i) => draws[f].layers[i].push(x));
      e[f].measures.forEach((x, i) => draws[f].measures[i].push(x));
    }
  }
  const range = (xs, p) => { const s = xs.slice().sort((a, b) => a - b); return { point: +noRoundUp(p), low: +noRoundUp(quantile(s, 0.025)), high: +noRoundUp(quantile(s, 0.975)) }; };
  const out = { resamples, used: resamples - skipped, seed, method: 'documents resampled with replacement within their document type; repeatability documents likewise; 95% range = 2.5th to 97.5th percentile', flavours: {} };
  for (const f of FLAVOURS) {
    if (!point[f]) throw new Error(`the ${f} score is not computable on this board`);
    out.flavours[f] = {
      score: range(draws[f].score, point[f].score),
      layers: Object.fromEntries(LAYERS.map((L, i) => [L.name, range(draws[f].layers[i], point[f].layers[i])])),
      measures: Object.fromEntries(MEASURES.map((m, i) => [m.label, range(draws[f].measures[i], point[f].measures[i])])),
    };
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
  if (!opt('board')) { console.error('give --board <scoreboard.json>'); process.exit(2); }
  const board = JSON.parse(fs.readFileSync(path.resolve(opt('board')), 'utf8'));
  const t0 = Date.now();
  const out = bootstrap(board, { resamples: Number(opt('resamples', '2000')), seed: opt('seed', 'aidp-v1.0-bootstrap') });
  const show = (r) => `${noRoundUp(r.point)} [${noRoundUp(r.low)}, ${noRoundUp(r.high)}]`;
  console.log(`Bootstrap: ${out.used} of ${out.resamples} resamples, seed "${out.seed}", ${out.method}. ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
  for (const f of FLAVOURS) {
    const x = out.flavours[f];
    console.log(`\n${f}: AIDP Score ${show(x.score)}`);
    for (const [k, r] of Object.entries(x.layers)) console.log(`  layer ${k}: ${show(r)}`);
    for (const [k, r] of Object.entries(x.measures)) console.log(`    ${k}: ${show(r)}`);
  }
  if (opt('json')) fs.writeFileSync(path.resolve(opt('json')), JSON.stringify(out, null, 1));
}
