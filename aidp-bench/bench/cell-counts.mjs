/**
 * The count behind every cell of the paper's results tables.
 *
 * The white paper prints two tables from a scoreboard: Table 2, every score-bearing measure read from
 * the page and from the correct text with its 95% range, and Table 4, every
 * measure by document type with an Overall column. This script re-scores the run's raw evidence with the
 * scorer's own functions (scoring.mjs, aidp-score.mjs, bootstrap.mjs; it holds no scoring logic of its
 * own) and writes, for every cell: what the figure counts, how many were checked and how many passed,
 * over how many documents, and whether the figure is a pooled ratio or an average of per-document rates.
 * It then recomputes every published figure from those counts and compares it with the scoreboard.
 *
 * For a cell that prints 100.00% it adds what a reader may claim instead:
 *   - nothing failed: the one-sided 95% lower confidence bound for zero failures in n trials, exact
 *     Clopper-Pearson, 0.05^(1/n), by the measure's own unit and by documents;
 *   - something failed but the rate rounds to 100.00%: the rate to the fewest decimals that do not.
 *
 *   node bench/cell-counts.mjs --corpus <corpus dir> --tag <main tag> --stability-tag <tag> [--rules-tag <tag>]
 *        [--results <dir>] [--board <scoreboard.json>] [--bootstrap <bootstrap.json>] [--paper <dir>] [--json <out>]
 *
 *   --board       the published scoreboard to check against (default <results>/<tag>/scoreboard.json)
 *   --bootstrap   the published ranges (default <results>/<tag>/bootstrap.json)
 *   --paper       a folder holding the paper's table2.json and table4.json, to check every printed cell
 *   --json        where to write the full result (never under the results folder)
 *
 * Read-only: no model is called, and it writes nothing except --json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES } from './rules.mjs';
import { loadCorpus, scoreDocuments, scoreStabilityRuns } from './scoring.mjs';
import { scoreLegibility } from './score-das.mjs';
import { MEASURES, combine, weightsFor } from './aidp-score.mjs';
import { bootstrap } from './bootstrap.mjs';

const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const need = (n) => { const v = opt(n); if (!v) { console.error(`give --${n}`); process.exit(2); } return v; };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

const CORPUS = path.resolve(need('corpus'));
const ROOT = path.resolve(opt('results', path.join(BENCH, 'results')));
const TAG = need('tag');
const STAB_TAG = need('stability-tag');
const RULES_TAG = opt('rules-tag', null);
const RUN = path.join(ROOT, TAG);
const STAB = path.join(ROOT, STAB_TAG);
const RULESRUN = RULES_TAG ? path.join(ROOT, RULES_TAG) : null;
const BOARD = path.resolve(opt('board', path.join(RUN, 'scoreboard.json')));
const BOOT = path.resolve(opt('bootstrap', path.join(RUN, 'bootstrap.json')));
const PAPER = opt('paper') ? path.resolve(opt('paper')) : null;
const OUT = opt('json') ? path.resolve(opt('json')) : null;
if (OUT && (OUT + path.sep).startsWith(ROOT + path.sep)) { console.error(`refusing to write under ${ROOT}`); process.exit(2); }
for (const [what, dir] of [['main run', RUN], ['stability run', STAB], ...(RULESRUN ? [['rules run', RULESRUN]] : [])]) {
  if (!fs.existsSync(path.join(dir, 'raw'))) { console.error(`no raw evidence for the ${what} at ${path.join(dir, 'raw')}`); process.exit(2); }
}

// -------------------------------------------------------------------------------------------------
// what the tables print (the paper's table builder)
// -------------------------------------------------------------------------------------------------
const F = 'type-equal';
const W = weightsFor(F);
const ANNEX_TYPES = ['purchase-order', 'invoice', 'credit-note', 'consignment-order', 'consignment-invoice', 'freight-invoice'];
const TYPE_NAME = {
  'purchase-order': 'Purchase order', invoice: 'Invoice', 'credit-note': 'Credit note',
  'consignment-order': 'Consignment order', 'consignment-invoice': 'Consignment invoice', 'freight-invoice': 'Freight invoice',
};
// Table 2 prints "not tested" in the text column for these: the text lane neither reads nor classifies,
// and repeatability is measured from the page only.
const UNTESTED_TEXT = new Set(['read.words', 'read.numbers', 'capture.identification', 'trust.stability']);
const LANE = { page: 'pipeline', text: 'prompt' };
const LANE_NAME = { page: 'page', text: 'correct text' };
// The items behind a measure that is an average of per-document rates.
const ITEMS = {
  'read.words': { found: 'words_found', total: 'words_total', unit: 'printed words' },
  'read.numbers': { found: 'nums_found', total: 'nums_total', unit: 'printed numbers' },
  'trust.stability': { unit: 'fields compared across the three runs' },
};

const ALPHA = 0.05;
/**
 * A number to d decimals exactly as the paper's table builder prints it. Both round the exact binary
 * value correctly; they differ only on an exact tie, which Python rounds to even and toFixed rounds up
 * (797 of 800 is 99.625 exactly, printed 99.62%).
 */
const fixed = (v, d) => {
  const s = v.toFixed(d);
  const rest = (v.toFixed(100).split('.')[1] ?? '').slice(d);
  if (!/^50*$/.test(rest)) return s;
  let k = BigInt(s.replace('.', '').replace('-', ''));
  if (k % 2n === 1n) k -= v >= 0 ? 1n : -1n;
  const digits = k.toString().padStart(d + 1, '0');
  return (v < 0 ? '-' : '') + (d ? `${digits.slice(0, -d)}.${digits.slice(-d)}` : digits);
};
const pct = (x, d = 2) => (x == null ? null : fixed(x * 100, d) + '%');
const printsHundred = (x) => x != null && fixed(x * 100, 2) === '100.00';
const zeroErrorBound = (n) => (n > 0 ? Math.pow(ALPHA, 1 / n) : null);
// A lower bound is never rounded up, so it is shown rounded down to two decimals.
const floorPct = (x) => (Math.floor(x * 10000 + 1e-9) / 100).toFixed(2) + '%';
// A rate below one that rounds to 100.00% is shown to the fewest decimals that do not print 100.
const enoughDecimals = (x) => {
  for (let d = 3; d <= 12; d++) { const s = fixed(x * 100, d); if (!/^100\.0+$/.test(s)) return { decimals: d, display: s + '%' }; }
  return null;
};

// -------------------------------------------------------------------------------------------------
// re-score the run, exactly as score-run.mjs does
// -------------------------------------------------------------------------------------------------
const t0 = Date.now();
const corpus = loadCorpus(CORPUS);
const { records, population } = scoreDocuments({ corpus, runDir: RUN, population: 'auto', rules: RULES });
const stability = scoreStabilityRuns({ corpus, stabDir: STAB, sampleIds: readJson(path.join(STAB, 'run-meta.json'))?.documents ?? null, rules: RULES });
const rescoreSeconds = (Date.now() - t0) / 1000;
const pub = fs.existsSync(BOARD) ? JSON.parse(fs.readFileSync(BOARD, 'utf8')) : null;
const bootPub = fs.existsSync(BOOT) ? readJson(BOOT) : null;

// -------------------------------------------------------------------------------------------------
// what each document contributes to a measure, in the scorer's own terms
// -------------------------------------------------------------------------------------------------
const readOpts = { numbersEndAtGap: RULES.numbersEndAtGap, qrPayloadLines: RULES.qrPayloadLines };

/** The printed words or numbers behind one document's Read value. */
function readItems(rec, laneKey, mid) {
  const l = rec.lanes[laneKey];
  const it = ITEMS[mid];
  if (l?.L0) return { found: l.L0[it.found], total: l.L0[it.total], failed_lane: false };
  // A failed lane is charged every item of the correct text and passes none (scoring.mjs, failedLane);
  // the scorer's own reading of an empty page gives the count.
  const L0 = scoreLegibility(' ', corpus.text(corpus.byId.get(rec.id)), readOpts);
  return { found: 0, total: L0[it.total], failed_lane: true };
}

/** One document's rate recomputed from its counts, by the scorer's rule for that measure. */
function rateFromCounts(x) {
  if (x.failed_lane || x.failed_row) return 0;                         // a failure scores zero
  if (x.kind === 'read') return x.total ? x.found / x.total : 1;        // multisetRecall: nothing to find is 1
  if (x.kind === 'stability') return x.checked ? 1 - x.drifted / x.checked : 1;  // scoreStability
  return null;
}

const perDocMismatch = [];
const contribCache = new Map();
function contributions(m, laneKey) {
  const key = `${m.id}|${laneKey}`;
  if (contribCache.has(key)) return contribCache.get(key);
  const inPop = (slug) => !m.population || m.population.includes(slug);
  const out = [];
  if (m.source === 'stability') {
    for (const r of stability?.rows ?? []) {
      if (!inPop(r.slug)) continue;
      const e = r.units?.[m.id];
      if (!e || e.v == null || Number.isNaN(e.v)) continue;
      out.push({ id: r.id, slug: r.slug, kind: 'stability', v: e.v, failed_row: !!r.failed, checked: r.failed ? 0 : r.fields_compared, drifted: r.failed ? 0 : r.fields_drifted });
    }
  } else {
    const lane = LANE[laneKey];
    for (const r of records) {
      if (!inPop(r.slug)) continue;
      const e = r.lanes[lane]?.units?.[m.id];
      if (!e) continue;
      if (m.agg === 'mean') {
        if (e.v == null || Number.isNaN(e.v)) continue;
        out.push({ id: r.id, slug: r.slug, kind: 'read', v: e.v, ...readItems(r, lane, m.id) });
      } else if (e.n) {
        out.push({ id: r.id, slug: r.slug, kind: 'pooled', p: e.p, n: e.n });
      }
    }
  }
  for (const x of out) if (x.kind !== 'pooled' && rateFromCounts(x) !== x.v) perDocMismatch.push({ measure: m.id, lane: laneKey, id: x.id, scorer: x.v, from_counts: rateFromCounts(x) });
  contribCache.set(key, out);
  return out;
}

/** The counts of one cell, over the documents given, aggregated as the measure is defined. */
function tally(m, docs) {
  if (m.agg !== 'mean') {
    let p = 0, n = 0, bad = 0;
    for (const x of docs) { p += x.p; n += x.n; if (x.p < x.n) bad++; }
    return {
      rate: n ? p / n : null,
      counts: { unit: m.unit, checked: n, correct: p, failed: n - p },
      documents: docs.length, documents_with_failure: bad,
    };
  }
  let s = 0, perfect = 0, items = 0, itemsOk = 0, failedLanes = 0, noItems = 0;
  for (const x of docs) {
    const v = rateFromCounts(x);
    s += v;
    if (v === 1) perfect++;
    if (x.failed_lane || x.failed_row) failedLanes++;
    if (x.kind === 'read') { items += x.total; itemsOk += x.found; if (!x.total) noItems++; }
    else { items += x.checked; itemsOk += x.checked - x.drifted; if (!x.checked && !x.failed_row) noItems++; }
  }
  return {
    rate: docs.length ? s / docs.length : null,
    counts: { unit: 'documents', checked: docs.length, correct: perfect, failed: docs.length - perfect, note: 'correct = documents whose own rate is 1' },
    documents: docs.length, documents_with_failure: docs.length - perfect,
    pooled: { unit: ITEMS[m.id].unit, checked: items, correct: itemsOk, failed: items - itemsOk, rate: items ? itemsOk / items : null },
    failed_lanes: failedLanes,
    documents_without_items: noItems,
  };
}

const AGG = {
  pooled: 'pooled ratio: passes over checks, summed across the documents of the type',
  pooledOverall: 'mean of the six per-type pooled ratios, each type weighted 1 (not one pooled ratio)',
  mean: 'average of per-document rates',
  meanAll: 'average of per-document rates over every document of all ten types (not the mean of the six type columns)',
  meanOverall: 'mean of the six per-type averages of per-document rates, each type weighted 1',
};

/** One cell: a measure, a lane and a scope (a document type, or "overall"). */
function cellOf(m, laneKey, scope) {
  const list = contributions(m, laneKey);
  if (scope !== 'overall') {
    const t = tally(m, list.filter((x) => x.slug === scope));
    return { ...t, aggregation: m.agg === 'mean' ? AGG.mean : AGG.pooled };
  }
  if (m.weighting === 'document') return { ...tally(m, list), aggregation: AGG.meanAll };
  // Type-weighted: each type's own figure, combined by the scorer's own combine().
  const perType = {}, breakdown = [];
  for (const t of Object.keys(W)) {
    const x = tally(m, list.filter((d) => d.slug === t));
    perType[t] = x.rate;
    breakdown.push({ type: t, rate: x.rate, ...x.counts, documents: x.documents, documents_with_failure: x.documents_with_failure, ...(x.pooled ? { pooled: x.pooled } : {}) });
  }
  const all = tally(m, list.filter((d) => Object.hasOwn(W, d.slug)));
  const together = m.agg === 'mean' ? { average_over_all_documents_of_the_six: all.rate } : { pooled_ratio_of_the_six: all.rate };
  return { ...all, rate: combine(perType, W), aggregation: m.agg === 'mean' ? AGG.meanOverall : AGG.pooledOverall, ...together, per_type: breakdown };
}

// -------------------------------------------------------------------------------------------------
// the published figure for a cell
// -------------------------------------------------------------------------------------------------
function published(m, laneKey, scope) {
  if (!pub) return undefined;
  const k = MEASURES.findIndex((x) => x.id === m.id);
  if (laneKey === 'text') {
    const tm = pub.text_lane?.[F]?.[k];
    if (!tm || tm.id !== m.id) throw new Error(`the published board's text lane does not list ${m.id} at position ${k}`);
    return tm.value ?? null;
  }
  const pm = pub.measures?.[F]?.[k];
  if (!pm || pm.id !== m.id) throw new Error(`the published board does not list ${m.id} at position ${k}`);
  if (scope === 'overall') return pm.value;
  if (pm.per_type) return pm.per_type[scope] ?? null;
  // Read by type is not stored on the board: the paper's table builder averages the stored per-document values.
  const vals = pub.docs.filter((d) => d.slug === scope).map((d) => d.lanes?.pipeline?.units?.[m.id]?.v).filter((v) => v != null);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

// -------------------------------------------------------------------------------------------------
// every cell
// -------------------------------------------------------------------------------------------------
const TOL = 1e-9;
const cells = [];
function addCell(table, column, m, laneKey, scope) {
  const c = cellOf(m, laneKey, scope);
  const pubRate = published(m, laneKey, scope);
  const shown = pubRate === undefined ? c.rate : pubRate;
  const cell = {
    table, column,
    measure_id: m.id, label: m.label, layer: m.layer,
    doc_type: scope, lane: LANE_NAME[laneKey],
    published_rate: pubRate === undefined ? 'no published scoreboard' : pubRate,
    published_display: shown == null ? (table === 'Annex' ? 'none' : 'not tested') : pct(shown),
    recomputed_rate: c.rate,
    difference: pubRate == null || c.rate == null ? null : c.rate - pubRate,
    matches: pubRate === undefined ? null : (pubRate == null && c.rate == null) || (pubRate != null && c.rate != null && Math.abs(c.rate - pubRate) <= TOL),
    aggregation: c.aggregation,
    measure_unit: m.unit,
    ...c,
  };
  delete cell.rate;
  if (printsHundred(shown)) cell.hundred = hundred(m, cell, shown);
  cells.push(cell);
  return cell;
}

/** What to print instead of 100.00%. */
function hundred(m, cell, rate) {
  if (rate !== 1) {
    const e = enoughDecimals(rate);
    return { exactly_one: false, rate, failed: cell.counts.failed, ...e, proposed_display: e.display };
  }
  const isMean = m.agg === 'mean';
  const own = isMean
    ? { unit: 'documents', n: cell.documents }
    : { unit: m.unit, n: cell.counts.checked };
  const mk = (x) => ({ ...x, bound: zeroErrorBound(x.n), bound_percent_4dp: pct(zeroErrorBound(x.n), 4), display: floorPct(zeroErrorBound(x.n)) });
  return {
    exactly_one: true,
    own_unit: mk(own),
    by_documents: mk({ unit: 'documents', n: cell.documents }),
    ...(isMean ? { by_pooled_items: mk({ unit: cell.pooled.unit, n: cell.pooled.checked }) } : {}),
    proposed_display: mk(own).display,
    why_own_unit: isMean
      ? 'the published figure is an average of one rate per document, so the document is the unit it counts'
      : `the published figure is passes over checks, so its own trials are the ${m.unit} it counts; checks inside one document are not independent, which is why the bound by documents is given beside it`,
  };
}

for (const m of MEASURES) {
  addCell('Table 2', 'Result from the page', m, 'page', 'overall');
  if (!UNTESTED_TEXT.has(m.id)) addCell('Table 2', 'Result from correct text', m, 'text', 'overall');
}
for (const m of MEASURES) {
  for (const t of ANNEX_TYPES) addCell('Annex', TYPE_NAME[t], m, 'page', t);
  addCell('Annex', 'Overall', m, 'page', 'overall');
}

// -------------------------------------------------------------------------------------------------
// the 95% ranges: what bootstrap.mjs produced before it rounded to two decimals
// -------------------------------------------------------------------------------------------------
/** bootstrap.mjs rounds every quantile with toFixed(2); run it once with toFixed made lossless. */
function unrounded(fn) {
  const orig = Number.prototype.toFixed;
  Number.prototype.toFixed = function lossless() { return String(this.valueOf()); };
  try { return fn(); } finally { Number.prototype.toFixed = orig; }
}

let ranges = null, bootCheck = null;
if (pub && bootPub) {
  const opts = { resamples: bootPub.resamples, seed: bootPub.seed };
  const again = bootstrap(pub, opts);
  const exact = unrounded(() => bootstrap(pub, opts));
  const A = again.flavours[F], X = exact.flavours[F], P = bootPub.flavours[F];
  const pairs = [['score', A.score, X.score, P.score],
    ...Object.keys(P.layers).map((k) => [`layer ${k}`, A.layers[k], X.layers[k], P.layers[k]]),
    ...Object.keys(P.measures).map((k) => [k, A.measures[k], X.measures[k], P.measures[k]])];
  let same = 0, total = 0, consistent = 0, moreThanTwo = 0;
  const differ = [];
  for (const [name, a, x, p] of pairs) {
    for (const q of ['point', 'low', 'high']) {
      total++;
      if (a[q] === p[q]) same++; else differ.push({ name, which: q, published: p[q], rerun: a[q] });
      if (+x[q].toFixed(2) === a[q]) consistent++;
      if (+x[q].toFixed(2) !== x[q]) moreThanTwo++;
    }
  }
  bootCheck = {
    values: total, rerun_equals_bootstrap_json: same, differ,
    unrounded_rounds_to_rerun: consistent,
    unrounded_values_with_more_than_two_decimals: moreThanTwo,
    note: moreThanTwo ? 'the lossless re-run took effect' : 'WARNING: no unrounded value has more than two decimals; bootstrap.mjs may no longer round with toFixed',
  };
  ranges = MEASURES.map((m) => {
    const p = P.measures[m.label], x = X.measures[m.label];
    const r = {
      table: 'Table 2', column: '95% range', measure_id: m.id, label: m.label,
      published: { low: p.low, high: p.high, display: `${fixed(p.low, 2)}% to ${fixed(p.high, 2)}%` },
      bootstrap_unrounded: { point: x.point, low: x.low, high: x.high },
      high_prints_100: fixed(p.high, 2) === '100.00',
    };
    if (r.high_prints_100) {
      // The same range to the fewest decimals at which neither end prints 100, rounded as usual, and
      // rounded outward (low down, high up) at the fewest decimals where the high end stays below 100.
      let d = 3;
      while (d < 8 && fixed(x.high, d).startsWith('100')) d++;
      let o = d;
      while (o < 8 && (Math.ceil(x.high * 10 ** o) / 10 ** o) >= 100) o++;
      r.unrounded_display = {
        decimals: d,
        rounded: `${fixed(x.low, d)}% to ${fixed(x.high, d)}%`,
        outward: `${(Math.floor(x.low * 10 ** o) / 10 ** o).toFixed(o)}% to ${(Math.ceil(x.high * 10 ** o) / 10 ** o).toFixed(o)}%`,
        one_sided: `at least ${(Math.floor(x.low * 100) / 100).toFixed(2)}% (the 2.5th percentile: a one-sided 97.5% lower limit)`,
      };
      // A resample that draws none of the documents with a failure scores exactly 100%. The bootstrap
      // draws each type's documents (all of them, as bootstrap.mjs packs them) with replacement.
      const list = contributions(m, 'page');
      const pool = {};
      for (const d of pub.docs) if (d.lanes?.pipeline && Object.hasOwn(W, d.slug)) pool[d.slug] = (pool[d.slug] ?? 0) + 1;
      const failing = {};
      const fails = (x2) => (x2.kind === 'pooled' ? x2.p < x2.n : rateFromCounts(x2) < 1);
      for (const x2 of list) if (Object.hasOwn(W, x2.slug) && fails(x2)) failing[x2.slug] = (failing[x2.slug] ?? 0) + 1;
      let share = 1;
      for (const [t, k] of Object.entries(failing)) share *= ((pool[t] - k) / pool[t]) ** pool[t];
      r.ceiling = {
        documents_with_a_failure: failing,
        documents_per_type_in_the_resampling: pool,
        expected_share_of_resamples_at_exactly_100: share,
        explanation: x.high >= 100
          ? 'the upper end is the 100% ceiling, reached by every resample that happens to draw none of the documents with a failure; it is not an estimate of the rate'
          : `the upper end the bootstrap produced is ${x.high}%, below 100%; it prints as 100.00% only because two decimals round it up. A resample that draws none of the documents with a failure scores exactly 100%, expected in ${(share * 100).toFixed(1)}% of resamples, fewer than the 2.5% that would put the 97.5th percentile on the ceiling`,
      };
    }
    return r;
  });
}

// -------------------------------------------------------------------------------------------------
// validation
// -------------------------------------------------------------------------------------------------
// 1. Per document: the re-scored units against the units stored on the published board.
function compareUnits() {
  if (!pub) return null;
  const byId = new Map(pub.docs.map((d) => [d.id, d]));
  let compared = 0;
  const differ = [];
  const seen = new Set();
  for (const r of records) {
    seen.add(r.id);
    const d = byId.get(r.id);
    if (!d) { differ.push({ id: r.id, what: 'not on the published board' }); continue; }
    for (const lane of ['pipeline', 'prompt']) {
      for (const m of MEASURES) {
        if (m.source === 'stability') continue;
        compared++;
        const a = JSON.stringify(r.lanes[lane]?.units?.[m.id] ?? null), b = JSON.stringify(d.lanes?.[lane]?.units?.[m.id] ?? null);
        if (a !== b) differ.push({ id: r.id, lane, measure: m.id, rescored: a, published: b });
      }
      for (const k of ['words_found', 'words_total', 'nums_found', 'nums_total']) {
        if (lane !== 'pipeline') continue;
        compared++;
        if ((r.lanes[lane]?.L0?.[k] ?? null) !== (d.lanes?.[lane]?.L0?.[k] ?? null)) differ.push({ id: r.id, lane, field: k, rescored: r.lanes[lane]?.L0?.[k], published: d.lanes?.[lane]?.L0?.[k] });
      }
    }
  }
  for (const d of pub.docs) if (!seen.has(d.id)) differ.push({ id: d.id, what: 'on the published board, not re-scored' });
  const pubRows = new Map((pub.stability?.rows ?? []).map((r) => [r.id, r]));
  for (const r of stability?.rows ?? []) {
    compared++;
    const q = pubRows.get(r.id);
    const a = JSON.stringify([r.fields_compared, r.fields_drifted, r.units]), b = JSON.stringify(q ? [q.fields_compared, q.fields_drifted, q.units] : null);
    if (a !== b) differ.push({ id: r.id, stability: true, rescored: a, published: b });
  }
  if ((pub.stability?.rows ?? []).length !== (stability?.rows ?? []).length) differ.push({ what: 'stability row count', rescored: stability?.rows?.length, published: pub.stability?.rows?.length });
  return { compared, differ: differ.length, examples: differ.slice(0, 20) };
}

// 2. Every printed cell of the paper's tables, when given.
function checkPaper() {
  if (!PAPER) return null;
  const t2 = readJson(path.join(PAPER, 'table2.json')), t4 = readJson(path.join(PAPER, 'table4.json'));
  if (!t2 || !t4) return { error: `table2.json or table4.json missing in ${PAPER}` };
  const res = { checked: 0, same: 0, by_caption_rules: 0, differ: [], printed_100: { 'Table 2': 0, Annex: 0 } };
  // The captions print some cells differently from the board's two decimals, and each such form is computed here from
  // the same evidence: a cell where no error was seen shows its lower bound, marked ≥; a rate below one that rounds to
  // 100.00% shows the fewest decimals that do not; a range whose upper end prints 100.00% shows its ends to the decimals
  // that avoid it, or only its lower end followed by "or higher" where the upper end is the maximum; and a figure whose
  // range is shown to more decimals is shown to the same decimals.
  const see = (where, printed, ours, captionForm = null) => {
    res.checked++;
    if (printed === ours) res.same++;
    else if (captionForm != null && printed === captionForm) { res.same++; res.by_caption_rules++; }
    else res.differ.push({ where, printed, ours, ...(captionForm != null ? { caption_form: captionForm } : {}) });
    if (String(printed).includes('100.00%')) res.printed_100[where.startsWith('Table 2') ? 'Table 2' : 'Annex']++;
  };
  const cellForm = (c, decimals = null) => {
    if (c?.hundred) return c.hundred.exactly_one ? `≥${c.hundred.proposed_display}` : c.hundred.proposed_display;
    return decimals && c?.published_rate != null ? pct(c.published_rate, decimals) : null;
  };
  const rangeForm = (r) => (!r?.high_prints_100 ? null
    : r.published.high >= 100 ? `${fixed(r.published.low, 2)}% or higher` : r.unrounded_display.rounded);
  const find = (table, column, id) => cells.find((c) => c.table === table && c.column === column && c.measure_id === id);
  // the measure rows, in register order (the paper's table builder), above the sensitivity figures, which are not measures
  const end = t2.rows.findIndex((r) => r.bold && /^Sensitivity/.test(String(r.cells?.[0] ?? '')));
  const rows = (end >= 0 ? t2.rows.slice(0, end) : t2.rows).filter((r) => !r.bold);
  if (rows.length !== MEASURES.length) return { error: `Table 2 has ${rows.length} measure rows, the register ${MEASURES.length}` };
  MEASURES.forEach((m, k) => {
    const [, counted, page, range, text] = rows[k].cells;
    const r = ranges?.find((x) => x.measure_id === m.id);
    const rangeDecimals = r?.high_prints_100 && r.published.high < 100 ? r.unrounded_display.decimals : null;
    const pageCell = find('Table 2', 'Result from the page', m.id);
    see(`Table 2, ${m.label}, page`, page, pageCell.published_display, cellForm(pageCell, rangeDecimals));
    const textCell = find('Table 2', 'Result from correct text', m.id);
    see(`Table 2, ${m.label}, correct text`, text, textCell ? textCell.published_display : 'not tested', cellForm(textCell));
    if (r) see(`Table 2, ${m.label}, 95% range`, range, r.published.display, rangeForm(r));
    // "What was counted" prints the Overall cell's own count (the paper's table builder).
    res.checked++;
    const printedN = Number((String(counted).match(/[\d,]+/) ?? ['NaN'])[0].replace(/,/g, ''));
    const ourN = m.agg === 'mean' ? pageCell.documents : pageCell.counts.checked;
    if (printedN === ourN) res.same++; else res.differ.push({ where: `Table 2, ${m.label}, what was counted`, printed: counted, ours: ourN });
  });
  if (t4.rows.length !== MEASURES.length) return { ...res, error: `the annex has ${t4.rows.length} rows, the register ${MEASURES.length}` };
  MEASURES.forEach((m, k) => {
    ANNEX_TYPES.forEach((t, j) => {
      const c = find('Annex', TYPE_NAME[t], m.id);
      see(`Annex, ${m.label}, ${TYPE_NAME[t]}`, t4.rows[k].cells[j + 1], c.published_display, cellForm(c));
    });
    const o = find('Annex', 'Overall', m.id);
    see(`Annex, ${m.label}, Overall`, t4.rows[k].cells[ANNEX_TYPES.length + 1], o.published_display, cellForm(o));
  });
  return res;
}

const unitsCheck = compareUnits();
const paperCheck = checkPaper();
const withPub = cells.filter((c) => c.matches !== null);
const mismatches = withPub.filter((c) => !c.matches);
const maxDiff = withPub.reduce((a, c) => Math.max(a, Math.abs(c.difference ?? 0)), 0);
const bitIdentical = withPub.filter((c) => c.published_rate === c.recomputed_rate).length;

const hundredCells = cells.filter((c) => c.hundred).map((c) => ({
  table: c.table, column: c.column, measure: c.label, measure_id: c.measure_id, doc_type: c.doc_type, lane: c.lane,
  rate: c.published_rate, aggregation: c.aggregation,
  checked: c.counts.checked, failed: c.counts.failed, unit: c.counts.unit, documents: c.documents,
  ...(c.pooled ? { pooled: c.pooled } : {}),
  ...c.hundred,
}));

// A bound shown in place of 100.00% can print lower than a cell of the same row that has failures: the
// one cell with no failure would then read as the worst. Listed so the choice of unit can weigh it.
const inversions = [];
for (const c of cells.filter((x) => x.table === 'Annex' && x.hundred?.exactly_one)) {
  const row = cells.filter((x) => x.table === 'Annex' && x.measure_id === c.measure_id && x !== c && typeof x.published_rate === 'number' && x.published_rate < 1);
  const above = (b) => row.filter((x) => x.published_rate > b).map((x) => ({ column: x.column, rate: x.published_rate, failed: x.counts.failed, unit: x.counts.unit }));
  const own = above(c.hundred.own_unit.bound), docs = above(c.hundred.by_documents.bound);
  if (own.length || docs.length) {
    inversions.push({
      measure: c.label, column: c.column,
      bound_own_unit: c.hundred.own_unit.display, bound_by_documents: c.hundred.by_documents.display,
      cells_with_failures_printing_higher: { own_unit: own, by_documents: docs },
    });
  }
}

const result = {
  about: "The count behind every cell of the paper's Table 2 and Table 4, from the run's raw evidence re-scored with the scorer's own functions. Read-only; no model calls.",
  generated_at: new Date().toISOString(),
  inputs: {
    corpus: CORPUS, results: ROOT, tag: TAG, stability_tag: STAB_TAG, rules_tag: RULES_TAG,
    rules_tag_note: 'the written-instruction run feeds Table 3 only; no cell of Table 2 or the annex uses it',
    scoreboard: pub ? BOARD : `none at ${BOARD}: nothing to check against`,
    bootstrap: bootPub ? BOOT : `none at ${BOOT}: ranges not reported`,
    paper: PAPER, population: population.mode, documents_scored: records.length,
    stability_documents: stability?.rows?.length ?? 0, rescore_seconds: rescoreSeconds,
  },
  definitions: {
    zero_error_bound: 'one-sided 95% lower confidence bound for a proportion with zero failures in n trials, exact Clopper-Pearson: 0.05^(1/n)',
    own_unit: "for a pooled measure, the check the published ratio counts (the register's unit); for a measure that averages one rate per document (Read, Repeatability), the document",
    display: 'a lower bound is rounded down to two decimals; a rate below one that prints 100.00% is given the fewest decimals that do not',
    overall: 'Overall is the six types combined with equal weight (each type its own pooled ratio or average), except Read, which averages every document of all ten types',
    counts: 'checked, correct and failed are in the measure unit named beside them; for an averaged measure that is documents (correct = documents whose own rate is 1), and pooled gives the items under it',
  },
  validation: {
    tolerance: TOL,
    cells_compared: withPub.length,
    cells_matching: withPub.length - mismatches.length,
    cells_bit_identical: bitIdentical,
    largest_difference: maxDiff,
    mismatches: mismatches.map((c) => ({ table: c.table, column: c.column, measure: c.measure_id, doc_type: c.doc_type, lane: c.lane, published: c.published_rate, recomputed: c.recomputed_rate })),
    per_document_rate_from_counts_differs_from_scorer: perDocMismatch.length,
    per_document_examples: perDocMismatch.slice(0, 10),
    rescored_units_against_published_board: unitsCheck,
    bootstrap: bootCheck,
    paper_tables: paperCheck,
  },
  hundred_cells: hundredCells,
  ranges_at_100: (ranges ?? []).filter((r) => r.high_prints_100),
  inversions,
  cells,
  ranges,
};

if (OUT) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(result, null, 1)); }

// -------------------------------------------------------------------------------------------------
// summary
// -------------------------------------------------------------------------------------------------
const n = (x) => Number(x ?? 0).toLocaleString('en-US');
const name = (t) => (t === 'overall' ? 'Overall' : TYPE_NAME[t] ?? t);
console.log(`Cell counts for ${TAG} (stability ${STAB_TAG}${RULES_TAG ? `, rules ${RULES_TAG}: feeds no cell here` : ''})`);
console.log(`  re-scored ${n(records.length)} documents and ${n(stability?.rows?.length)} stability documents in ${rescoreSeconds.toFixed(1)} s`);
if (unitsCheck) console.log(`  per-document units against the published board: ${n(unitsCheck.compared)} compared, ${n(unitsCheck.differ)} differ`);
console.log(`  per-document rates recomputed from counts that differ from the scorer's: ${perDocMismatch.length}`);
if (pub) console.log(`  cells recomputed from counts: ${withPub.length - mismatches.length} of ${withPub.length} match the scoreboard within ${TOL} (${bitIdentical} bit-identical, largest difference ${maxDiff.toExponential(2)})`);
else console.log(`  no published scoreboard at ${BOARD}: counts written, nothing checked`);
for (const c of mismatches) console.log(`    MISMATCH ${c.table}, ${c.column}, ${c.measure_id}, ${c.lane}: published ${c.published_rate}, recomputed ${c.recomputed_rate}`);
if (bootCheck) console.log(`  bootstrap.mjs re-run on the published board: ${bootCheck.rerun_equals_bootstrap_json} of ${bootCheck.values} values equal bootstrap.json; ${bootCheck.note}`);
if (paperCheck) {
  if (paperCheck.error) console.log(`  paper tables: ${paperCheck.error}`);
  else console.log(`  paper tables: ${paperCheck.same} of ${paperCheck.checked} printed cells reproduced, ${paperCheck.by_caption_rules} of them in the form the captions prescribe; printing 100.00%: Table 2 ${paperCheck.printed_100['Table 2']}, annex ${paperCheck.printed_100.Annex}`);
  for (const d of paperCheck.differ ?? []) console.log(`    DIFFERS ${d.where}: printed ${d.printed}, ours ${d.ours}`);
}
console.log(`\nCells that print 100.00% (${hundredCells.length}):`);
for (const h of hundredCells) {
  const where = `${h.table}, ${h.measure}, ${h.table === 'Table 2' ? h.column.replace('Result from the ', '').replace('Result from ', '') : name(h.doc_type)}`;
  if (h.exactly_one) {
    const items = h.by_pooled_items ? `; ${n(h.by_pooled_items.n)} ${h.by_pooled_items.unit} gives ${h.by_pooled_items.display}` : '';
    console.log(`  - ${where}: ${n(h.own_unit.n)} of ${n(h.own_unit.n)} ${h.own_unit.unit}, ${n(h.documents)} documents -> ${h.own_unit.display} (by documents ${h.by_documents.display}${items})`);
  } else {
    console.log(`  - ${where}: ${n(h.checked - h.failed)} of ${n(h.checked)} ${h.unit}, ${n(h.failed)} failed, rate ${h.rate} -> ${h.proposed_display}`);
  }
}
if (ranges) {
  console.log('\nRanges whose upper end prints 100.00%:');
  for (const r of ranges.filter((x) => x.high_prints_100)) {
    console.log(`  - ${r.label}: printed ${r.published.display}; bootstrap low ${r.bootstrap_unrounded.low}, high ${r.bootstrap_unrounded.high}; documents with a failure ${JSON.stringify(r.ceiling.documents_with_a_failure)}; expected share of resamples at exactly 100% ${(r.ceiling.expected_share_of_resamples_at_exactly_100 * 100).toFixed(1)}%`);
    console.log(`      as rounded: ${r.unrounded_display.rounded}; rounded outward: ${r.unrounded_display.outward}; one-sided: ${r.unrounded_display.one_sided}`);
  }
}
if (inversions.length) {
  console.log(`\nAnnex cells with no failure whose bound would print below a cell of the same row that has failures (${inversions.length}):`);
  for (const v of inversions) {
    const list = (xs) => xs.map((x) => `${x.column} ${pct(x.rate)}`).join(', ') || 'none';
    console.log(`  - ${v.measure}, ${v.column}: own-unit bound ${v.bound_own_unit} is below ${list(v.cells_with_failures_printing_higher.own_unit)}; by-documents bound ${v.bound_by_documents} is below ${list(v.cells_with_failures_printing_higher.by_documents)}`);
  }
}
if (OUT) console.log(`\nwrote ${OUT}`);
