/**
 * The AIDP Score, pinned. Agentic IDP Accuracy Standard (AIDP) v1.0.
 *
 * One number exists under this standard and its formula is part of the standard, so there is nothing
 * to shop: the equal-weight geometric mean of every score-bearing measure, nothing excluded, the
 * weakest included, each measure capped at one. The geometric mean is deliberate. A collapse in any
 * single component drags it in a way an arithmetic mean would launder.
 *
 * One weighting, read from the corpus itself: each of the six field-key document types counts equally,
 * exactly as each does in AIDP-2K, which holds 200 documents of every type. Nothing outside the
 * published corpus enters the score, so anyone holding the corpus and a run's outputs recomputes it to
 * the last decimal. A weighting taken from one vendor's production traffic could be checked by no one
 * else and would move whenever that traffic moved.
 *
 * Every measure except the two Read measures is computed per document type (pooled over that type's
 * checks) and then combined across the six field-key types, each weighted 1. The Read measures are a
 * per-document average over every document of all ten types, the four fact-key types included.
 *
 * Every figure here is computed from the per-document units in the scoreboard (scoring.mjs), never
 * from a rounded rollup, so a bootstrap can resample documents and recompute all of it.
 */
import { FIELD_KEY_TYPES } from './rules.mjs';

/** The one weighting. Kept as a list so every report loops over it the same way. */
export const FLAVOURS = ['type-equal'];
export const FLAVOUR_LABEL = { 'type-equal': 'type-equal' };

/** The per-type weights: each of the six field-key types counts once, as each does in the corpus. */
export function weightsFor(flavour = 'type-equal') {
  if (flavour === 'type-equal') return Object.fromEntries(FIELD_KEY_TYPES.map((t) => [t, 1]));
  throw new Error(`unknown weighting "${flavour}"`);
}

/**
 * The sixteen score-bearing measures, in register order.
 *
 *   id          the unit key the scorer writes per document (scoring.mjs, laneUnits)
 *   agg         'pooled': passes over checks, summed across documents; 'mean': averaged per document
 *   weighting   'document': one value over every document of the population; 'type': one value per
 *               field-key type, the six combined with equal weights
 *   population  the document types the measure is computed over
 *   source      'pipeline' (the full lane of the main run) or 'stability' (the repeatability runs)
 */
const FK = FIELD_KEY_TYPES;
const byType = { agg: 'pooled', weighting: 'type', population: FK, source: 'pipeline' };
export const MEASURES = [
  // Layer 1, Read
  { id: 'read.words', label: 'Printed text, words', capability: 'Printed text', layer: 'read', agg: 'mean', weighting: 'document', population: null, source: 'pipeline', unit: 'documents' },
  { id: 'read.numbers', label: 'Printed text, numbers', capability: 'Printed text', layer: 'read', agg: 'mean', weighting: 'document', population: null, source: 'pipeline', unit: 'documents' },
  // Layer 2, Capture
  { id: 'capture.identification', label: 'Identification, document type', capability: 'Identification', layer: 'capture', ...byType, unit: 'documents' },
  { id: 'capture.rows_recall', label: 'Line items, recall', capability: 'Line items', layer: 'capture', ...byType, unit: 'answer-key rows' },
  { id: 'capture.rows_precision', label: 'Line items, precision', capability: 'Line items', layer: 'capture', ...byType, unit: 'returned rows' },
  { id: 'capture.completeness', label: 'Completeness', capability: 'Completeness', layer: 'capture', ...byType, unit: 'answer-key values' },
  { id: 'capture.fidelity', label: 'Fidelity', capability: 'Fidelity', layer: 'capture', ...byType, unit: 'captured values' },
  { id: 'capture.restraint', label: 'Restraint, non-invention', capability: 'Restraint', layer: 'capture', ...byType, unit: 'returned values' },
  // Layer 3, Understand
  { id: 'understand.dates', label: 'Normalisation, dates', capability: 'Normalisation', layer: 'understand', ...byType, unit: 'dates recovered' },
  { id: 'understand.numbers', label: 'Normalisation, numbers', capability: 'Normalisation', layer: 'understand', ...byType, unit: 'numbers recovered' },
  { id: 'understand.codes', label: 'Normalisation, country and currency codes', capability: 'Normalisation', layer: 'understand', ...byType, unit: 'country and currency codes' },
  { id: 'understand.decoding', label: 'Decoding, payload syntax', capability: 'Decoding', layer: 'understand', ...byType, unit: 'delivered values' },
  { id: 'understand.consistency', label: 'Consistency, arithmetic', capability: 'Consistency', layer: 'understand', ...byType, unit: 'arithmetic checks' },
  // Layer 4, Reason
  { id: 'reason.contract', label: 'Contract', capability: 'Contract', layer: 'reason', ...byType, unit: 'schema and format checks' },
  // Layer 5, Trust
  { id: 'trust.stability', label: 'Repeatability, field stability', capability: 'Repeatability', layer: 'trust', agg: 'mean', weighting: 'type', population: FK, source: 'stability', unit: 'documents, three runs each' },
  { id: 'trust.provenance', label: 'Traceability, provenance', capability: 'Traceability', layer: 'trust', ...byType, unit: 'delivered values' },
];

/**
 * Measures the harness computes and publishes that do not enter the score, each with its reason.
 * The registry is the complete list: a computed measure in neither MEASURES nor here is an omission.
 */
export const DIAGNOSTICS = [
  { id: 'understand.parsing', label: 'Parsing, field separation', reason: 'its detector does not yet test field separation, so Parsing is declared not yet scored until a detector that tests separation exists' },
  { id: 'trust.verification', label: 'Escalation, verification ran', reason: 'it records only that some deterministic check ran on a document, never whether the check was right, so it cannot tell a working check from a broken one; Escalation is reported by the safety panel instead' },
  { id: 'safety', label: 'Escalation: escaped critical errors, catch rate, false-alarm rate', reason: 'reported beside the score of any result that claims documents can proceed without a person, never folded into it; this edition makes no such claim' },
  { id: 'calibration', label: 'Calibration: expected calibration error, discrimination, share of high-tier values', reason: 'reported beside the score; computed by calibration.mjs on all returned header values' },
  { id: 'read.barcodes', label: 'Barcodes, symbol recall', reason: 'reported beside the score, pooled over payloads, because the platform consumes decoded payloads inside its own pipeline' },
  { id: 'facts.recall', label: 'Fact recall, the four fact-key types', reason: 'the four fact-key types have no field-level answer key; they are scored by fact recall beside the score and enter Read like every other document' },
  { id: 'rules', label: 'Instructions: adherence and containment', reason: 'reported beside the score from the declared rules sample' },
  { id: 'computation', label: 'Computation: derivation precision and recall', reason: 'reported beside the score; most derivations land on values the corpus prints, so the evidence is thin' },
  { id: 'capture.identification.all', label: 'Identification over all ten types', reason: 'reported beside the six-type score-bearing figure' },
];

/**
 * The five layers and the twenty-five capabilities. A layer is a stage of work, defined by the
 * knowledge it needs beyond the page; Trust is a property of the machine that did the other four.
 * Membership of the score-bearing measures is checked at runtime: a measure in no layer, or in two,
 * is a thrown error rather than a silent omission.
 */
export const LAYERS = [
  {
    key: 'read', name: 'Read', needs: 'Nothing beyond the page.',
    capabilities: ['Intake', 'Printed text', 'Handwriting and stamps', 'Barcodes', 'Reading order', 'Legibility'],
    measures: ['read.words', 'read.numbers'],
  },
  {
    key: 'capture', name: 'Capture', needs: 'Knowledge of what business documents look like.',
    capabilities: ['Identification', 'Segmentation', 'Line items', 'Completeness', 'Fidelity', 'Restraint'],
    measures: ['capture.identification', 'capture.rows_recall', 'capture.rows_precision', 'capture.completeness', 'capture.fidelity', 'capture.restraint'],
  },
  {
    key: 'understand', name: 'Understand', needs: "The world's conventions.",
    capabilities: ['Normalisation', 'Parsing', 'Decoding', 'Computation', 'Consistency'],
    measures: ['understand.dates', 'understand.numbers', 'understand.codes', 'understand.decoding', 'understand.consistency'],
  },
  {
    key: 'reason', name: 'Reason', needs: "This customer's records, contract and instructions.",
    capabilities: ['Resolution', 'Instructions', 'Contract'],
    measures: ['reason.contract'],
  },
  {
    key: 'trust', name: 'Trust', needs: 'Evidence about the system itself, across documents and runs.',
    capabilities: ['Repeatability', 'Traceability', 'Calibration', 'Anomaly detection', 'Escalation'],
    measures: ['trust.stability', 'trust.provenance'],
  },
];

// -------------------------------------------------------------------------------------------------
// aggregation
// -------------------------------------------------------------------------------------------------
/** The units a board carries: one entry per document of the full lane, and one per stability document. */
export function unitsOf(board, lane = 'pipeline') {
  return {
    pipeline: (board.docs ?? []).filter((d) => d.lanes?.[lane]).map((d) => ({ slug: d.slug, u: d.lanes[lane].units ?? {} })),
    stability: (board.stability?.rows ?? []).map((r) => ({ slug: r.slug, u: r.units ?? {} })),
  };
}

/** One measure over a list of units: pooled passes over checks, or the mean of per-document values. */
export function valueOver(m, list) {
  if (m.agg === 'mean') {
    let s = 0, c = 0;
    for (const x of list) { const e = x.u[m.id]; if (e && e.v != null && !Number.isNaN(e.v)) { s += e.v; c++; } }
    return c ? s / c : null;
  }
  let p = 0, n = 0;
  for (const x of list) { const e = x.u[m.id]; if (e && e.n) { p += e.p; n += e.n; } }
  return n ? p / n : null;
}

/** The weighted combination of per-type values; a type with no value for the measure is left out. */
export function combine(perType, weights) {
  let num = 0, den = 0;
  for (const [t, w] of Object.entries(weights)) {
    const x = perType[t];
    if (!(w > 0) || x == null || Number.isNaN(x)) continue;
    num += w * x; den += w;
  }
  return den ? num / den : null;
}

/** A measure under a weighting, with the per-type values it was combined from. */
export function measure(m, units, weights) {
  const list = units[m.source].filter((x) => !m.population || m.population.includes(x.slug));
  if (m.weighting === 'document') return { value: valueOver(m, list), per_type: null };
  const perType = {};
  for (const t of Object.keys(weights)) perType[t] = valueOver(m, list.filter((x) => x.slug === t));
  return { value: combine(perType, weights), per_type: perType };
}

const geo = (xs) => Math.exp(xs.reduce((s, x) => s + Math.log(Math.min(x, 1)), 0) / xs.length);
const r2 = (x) => +(x * 100).toFixed(2);

/**
 * The score, its layers and its measures under one weighting, from units. Throws when a score-bearing
 * measure has no value, and when the layer scores do not recombine to the score exactly.
 */
export function scoreUnits(units, weights, { measures = MEASURES, layers = LAYERS } = {}) {
  const values = measures.map((m) => ({ ...m, ...measure(m, units, weights) }));
  for (const v of values) if (v.value == null || Number.isNaN(v.value)) throw new Error(`score-bearing measure "${v.label}" has no value`);
  const byId = new Map(values.map((v) => [v.id, v]));
  const seen = new Set();
  const layerOut = layers.map((L) => {
    const members = L.measures.map((id) => {
      if (!byId.has(id)) throw new Error(`layer ${L.key}: "${id}" is not a score-bearing measure`);
      if (seen.has(id)) throw new Error(`measure "${id}" is in two layers`);
      seen.add(id);
      return byId.get(id);
    });
    return { key: L.key, name: L.name, count: members.length, raw: geo(members.map((m) => m.value)), measures: members.map((m) => ({ id: m.id, label: m.label, value: m.value })) };
  });
  const orphans = values.filter((v) => !seen.has(v.id));
  if (orphans.length) throw new Error(`measures in no layer: ${orphans.map((v) => v.label).join(', ')}`);
  const raw = geo(values.map((v) => v.value));
  const score = r2(raw);
  // The decomposition, executed rather than asserted: the count-weighted geometric mean of the layer
  // scores must be the score, to the last published decimal.
  const count = layerOut.reduce((s, L) => s + L.count, 0);
  const recombined = r2(Math.exp(layerOut.reduce((s, L) => s + L.count * Math.log(L.raw), 0) / count));
  if (recombined !== score) throw new Error(`layer recombination ${recombined} does not equal the score ${score}`);
  return {
    score, raw,
    layers: layerOut.map((L) => ({ ...L, score: r2(L.raw) })),
    measures: values.map((v) => ({ id: v.id, label: v.label, layer: v.layer, capability: v.capability, unit: v.unit, value: v.value, per_type: v.per_type })),
  };
}

/** The score, from a scoreboard. */
export function aidpScores(board) {
  const units = unitsOf(board);
  const out = {};
  for (const f of FLAVOURS) out[f] = scoreUnits(units, weightsFor(f));
  return out;
}

/** The score, as 0 to 100 rounded to two decimals, with its components. */
export function aidpScore(board) {
  const s = aidpScores(board);
  return {
    'type-equal': s['type-equal'].score,
    measures: Object.fromEntries(FLAVOURS.map((f) => [f, s[f].measures.map((m) => [m.label, m.value])])),
    formula: `equal-weight geometric mean of the ${MEASURES.length} score-bearing measures, each capped at one, nothing excluded`,
  };
}

/** Layer scores, recombining exactly to the score. */
export function layerScores(board) {
  const s = aidpScores(board);
  return Object.fromEntries(FLAVOURS.map((f) => [f, { score: s[f].score, layers: s[f].layers }]));
}

/** The published measures, in register order, as [label, value]. */
export function publishedMeasures(board, flavour = 'type-equal') {
  return aidpScores(board)[flavour].measures.map((m) => [m.label, m.value]);
}
