/**
 * AIDP-Bench scoring library: raw evidence in, per-document records and per-measure units out.
 *
 * Runs entirely offline. No model is called and nothing is downloaded. score-run.mjs,
 * bootstrap.mjs and calibration.mjs all score through this one module, so a figure printed by any of
 * them comes from the same verdicts.
 *
 * A UNIT is what one document contributes to one measure: { p, n } (passes out of checks) for a
 * measure pooled over checks, or { v } for a measure averaged over documents. Every measure, layer and
 * score in aidp-score.mjs is computed from these units alone, which is what lets a bootstrap resample
 * documents without re-scoring anything.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  scoreLegibility, scoreStructure, scoreCapture, scoreInference, scoreConformance, scoreTrust, scoreStability,
} from './score-das.mjs';
import { scoreFacts } from './base-score.mjs';
import { scoreUnderstand, kindOf, misconversion } from './score-understand.mjs';
import { BUDGETS, countErrors, budgetCoverage } from './budgets.mjs';
import { RULES, FIELD_KEY_TYPES } from './rules.mjs';
import { RULE_PACKS, buildExpectation } from './rule-packs.mjs';

export const BUDGET_IDS = ['strict', 'critical', 'money'];
export const HEADLINE_BUDGET = 'critical';
export const LANES = ['pipeline', 'prompt'];

const DIFFICULTY = { none: 'clean', light: 'clean', medium: 'degraded', heavy: 'hostile' };
const scaleBand = (gtj) => {
  const rows = (gtj.gt?.Items ?? gtj.gt?.['Line Items'] ?? []).length
    || Object.values(gtj.gt ?? {}).filter(Array.isArray).reduce((a, x) => a + x.length, 0);
  return rows <= 10 ? '1-10' : rows <= 100 ? '11-100' : '101-500';
};
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

// -------------------------------------------------------------------------------------------------
// corpus and evidence
// -------------------------------------------------------------------------------------------------
export function loadCorpus(dir) {
  const root = path.resolve(dir);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const byId = new Map(manifest.docs.map((d) => [d.id, d]));
  const gtCache = new Map(), textCache = new Map();
  // The contracted output schema of each type, written beside the keys by materialize-gt.mjs. A corpus
  // without one (keys collected before a contract was written beside them) is checked against its answer keys' structure.
  const contractFile = readJson(path.join(root, 'contract.json'));
  return {
    root, manifest, byId,
    contract: contractFile?.contracts ?? null,
    contractVersion: contractFile?.fields_version ?? null,
    gt: (doc) => {
      if (!gtCache.has(doc.id)) gtCache.set(doc.id, JSON.parse(fs.readFileSync(path.join(root, doc.gt), 'utf8')));
      return gtCache.get(doc.id);
    },
    text: (doc) => {
      if (!textCache.has(doc.id)) textCache.set(doc.id, fs.readFileSync(path.join(root, doc.text), 'utf8'));
      return textCache.get(doc.id);
    },
  };
}

/**
 * Which documents a run is scored over.
 *
 *   plan      the document list the runner wrote into run-meta.json before it started. This is the
 *             default whenever it exists, because it is fixed before any result is seen.
 *   manifest  every document of the corpus (restricted to --types).
 *   evidence  every document with at least one lane of evidence on disk. Used for a run that never
 *             planned the whole corpus; it is stated in the output.
 */
export function resolvePopulation({ corpus, runDir, population = 'auto', types = null }) {
  const inTypes = (d) => !types || types.has(d.slug);
  const meta = readJson(path.join(runDir, 'run-meta.json'));
  let mode = population;
  if (mode === 'auto') mode = Array.isArray(meta?.documents) && meta.documents.length ? 'plan' : 'evidence';
  let ids;
  if (mode === 'plan') {
    if (!Array.isArray(meta?.documents)) throw new Error(`population "plan" needs run-meta.json with a documents list in ${runDir}`);
    ids = meta.documents;
  } else if (mode === 'manifest') {
    ids = corpus.manifest.docs.map((d) => d.id);
  } else if (mode === 'evidence') {
    const raw = path.join(runDir, 'raw');
    const seen = new Set();
    for (const f of fs.existsSync(raw) ? fs.readdirSync(raw) : []) {
      const m = f.match(/^(.+)\.(pipeline|prompt)\.json$/);
      if (m) seen.add(m[1]);
    }
    ids = [...seen];
  } else throw new Error(`unknown population "${population}"`);
  const docs = ids.map((id) => corpus.byId.get(id)).filter(Boolean).filter(inTypes);
  docs.sort((a, b) => a.id.localeCompare(b.id));
  return { mode, docs, planned: meta?.documents?.length ?? null };
}

// -------------------------------------------------------------------------------------------------
// the platform's review decision
// -------------------------------------------------------------------------------------------------
/**
 * Did the platform send this document to a person? This is what "caught" means in the safety panel:
 * the document reached somebody, not that a flag was raised somewhere inside it.
 *
 *   recorded       the extraction response's own document decision, field_report.document.auto_accept
 *                  (automation_report.auto_accept carries the same decision). Not accepted = routed.
 *   reconstructed  evidence collected before that decision was recorded holds only the platform's
 *                  per-field decisions (field_confidence.fields[*].auto_accept). A document passes
 *                  straight through only if every field it returned was accepted on its own, no
 *                  deterministic check flagged it, and the buyer and seller blocks were not suspected
 *                  of being swapped. Any one of those routes it to a person, and so does a returned
 *                  field that carries no decision of its own beside fields that do.
 *   no-confidence  no confidence was computed at all: nothing vouches for the document, so a person
 *                  has to look, which is also what the platform's review screen does.
 *   absent         the evidence carries confidence but no decision at all, neither the document's nor any
 *                  field's: published evidence that omits the decisions says nothing about routing, so the
 *                  document is neither caught nor escaped (routed is null), and a run made only of such
 *                  documents has no safety panel.
 */
export function reviewDecision(raw) {
  const docDecision = raw?.field_report?.document?.auto_accept ?? raw?.automation_report?.auto_accept;
  if (typeof docDecision === 'boolean') return { routed: !docDecision, signal: 'recorded' };
  const fc = raw?.field_confidence;
  const fields = fc?.fields ? Object.values(fc.fields) : [];
  if (fields.length && !fields.some((f) => typeof f?.auto_accept === 'boolean')) return { routed: null, signal: 'absent' };
  if (fc?.applied !== false && fields.length) {
    const flagged = (raw.derived_fields?.derivations ?? []).some((d) => d.kind === 'mismatch');
    const allAccepted = fields.every((f) => f && f.auto_accept === true);
    return { routed: flagged || !allAccepted || !!fc.summary_agreement?.party_swap_suspect, signal: 'reconstructed' };
  }
  return { routed: true, signal: 'no-confidence' };
}

// -------------------------------------------------------------------------------------------------
// one document, one lane
// -------------------------------------------------------------------------------------------------
function stripVerdicts(o) { const { verdicts, ...rest } = o; return rest; }
function stripRowMap(o) { const { out_to_gt, ...rest } = o; return rest; }

/** Score one successful lane. `raw` is the stored response for that lane. */
export function scoreLane(entry, lane, raw, corpus, rules = RULES) {
  const { doc, gtj } = entry;
  const output = raw.extraction ?? {};
  const derived = raw.derived_fields ?? null;

  // Read. A lane that returned no text at all read nothing, and scores zero rather than vanishing.
  let L0 = null;
  if (lane !== 'prompt') {
    const readOpts = { numbersEndAtGap: rules.numbersEndAtGap, qrPayloadLines: rules.qrPayloadLines };
    if (raw.ocr_text) L0 = scoreLegibility(raw.ocr_text, corpus.text(doc), readOpts);
    else if (rules.failedLanesFail) L0 = scoreLegibility(' ', corpus.text(doc), readOpts);
  }

  const L1 = scoreStructure({
    gt: gtj.gt ?? {}, output,
    expectedCategory: lane === 'pipeline' ? gtj.category : null,   // only the full lane classifies
    actualCategory: raw.classification?.category ?? null,
    categoryAlt: gtj.category_alt ?? [],
  });

  // Capture. A value the derivation engine filled is the system doing its job, not an invention, so
  // those paths are removed from the spurious count and audited by Computation instead.
  let L2 = null, facts = null;
  const classOk = lane === 'prompt' || L1.category_ok !== false || rules.keepMisclassified;
  if (gtj.mode === 'fields' && gtj.gt && classOk) {
    L2 = scoreCapture(gtj.gt, output, rules);
    // Under restraintCountsDerived a value the key leaves empty is invented whether or not the system
    // labelled it as derived, so nothing is removed; otherwise derived fills leave the invention count.
    const derivedPaths = rules.restraintCountsDerived ? new Set()
      : new Set((derived?.derivations ?? []).filter((d) => d.kind === 'derived').map((d) => d.field_path));
    if (derivedPaths.size) {
      const keep = L2.verdicts.filter((v) => !(v.verdict === 'spurious' && derivedPaths.has(v.path)));
      L2 = { ...L2, verdicts: keep };
      const c = { correct: 0, normalized: 0, wrong: 0, missing: 0, spurious: 0 };
      for (const v of keep) c[v.verdict]++;
      const gtPop = c.correct + c.normalized + c.wrong + c.missing;
      const right = c.correct + c.normalized;
      const returned = right + c.wrong + c.spurious;
      Object.assign(L2, c, {
        gt_populated: gtPop,
        completeness: gtPop ? (right + c.wrong) / gtPop : 1,
        correctness: (right + c.wrong) ? right / (right + c.wrong) : 1,
        hallucination: returned ? c.spurious / returned : 0,
        precision: returned ? right / returned : 1,
        recall: gtPop ? right / gtPop : 1,
        score: gtPop ? (right / gtPop) * (1 - (returned ? c.spurious / returned : 0)) : 1,
      });
    }
    // CONVENTION-ONLY ERRORS (conventionOnce): a wrong date or number whose only fault is a convention
    // (misconversion: a day-month order, or a decimal or thousands separator with the key's digits and
    // sign) is Normalisation's and leaves Fidelity's count. It is still a wrong value everywhere else.
    if (rules.conventionOnce) {
      let n = 0;
      for (const v of L2.verdicts) {
        if (v.verdict !== 'wrong') continue;
        const kind = kindOf(v.gt, String(v.path).split('.').pop(), rules);
        if (kind !== 'date' && kind !== 'number') continue;
        const mis = misconversion(v.gt, v.out, rules);
        if (mis) { v.convention = mis; n++; }
      }
      L2.convention = n;
    }
  } else if (gtj.facts?.length) {
    const f = scoreFacts(gtj.facts, output, rules);
    const hard = f.filter((x) => !x.soft);
    facts = { total: hard.length, hit: hard.filter((x) => x.hit).length, rate: hard.length ? hard.filter((x) => x.hit).length / hard.length : null };
  }

  const L3 = scoreInference({ gt: gtj.gt ?? {}, output, derived, confidence: raw.field_confidence, expectedDerived: gtj.expected_derived ?? [], rowMap: L1.out_to_gt });
  const L4 = scoreConformance({ gt: gtj.gt ?? {}, output, impact: raw.impact, rules, contract: corpus.contract?.[doc.slug] ?? null });
  const U = scoreUnderstand({ gt: gtj.gt ?? null, output, verdicts: L2?.verdicts ?? null, rules });

  const review = reviewDecision(raw);
  const isClean = !(doc.dims?.mismatch || doc.dims?.missingTotals || doc.dims?.stickerMismatch);
  const L5 = {};
  for (const b of BUDGET_IDS) {
    L5[b] = scoreTrust({
      captureAgg: L2, structure: L1, derived,
      expectedFlags: gtj.expected_flags ?? [],
      isCleanControl: isClean,
      scorable: !!L2,
      errorBudget: () => countErrors({ verdicts: L2?.verdicts ?? [], structure: L1, budget: b, amended: rules.criticalBudgetAmended }),
      routed: review.routed,
      rules,
    });
  }
  L5.coverage = L2 ? Object.fromEntries(BUDGET_IDS.map((b) => [b, budgetCoverage(L2.verdicts, b, rules.criticalBudgetAmended)])) : null;

  const rec = {
    ok: true, L0, L1: stripRowMap(L1), L2: L2 ? stripVerdicts(L2) : null, facts, L3, L4, L5,
    understand: U,
    review,
    ms: raw.ms ?? null,
    cls_ms: raw.classification?.ms ?? null,
    misses: L2 ? L2.verdicts.filter((v) => v.verdict === 'wrong' || v.verdict === 'missing').slice(0, 10)
      .map((v) => ({ path: v.path, verdict: v.verdict, gt: String(v.gt).slice(0, 60), out: String(v.out).slice(0, 60) })) : [],
    inventions: L2 ? L2.verdicts.filter((v) => v.verdict === 'spurious').slice(0, 6)
      .map((v) => ({ path: v.path, out: String(v.out).slice(0, 60) })) : [],
  };
  rec.units = laneUnits(rec);
  return { rec, verdicts: L2?.verdicts ?? null };
}

/** What one successful lane contributes to every measure. */
export function laneUnits(x) {
  const u = {};
  if (x.L0) { u['read.words'] = { v: x.L0.word_recall }; u['read.numbers'] = { v: x.L0.numeric_recall }; }
  if (x.L0 && x.L0.barcodes_total) u['read.barcodes'] = { p: x.L0.barcodes_found, n: x.L0.barcodes_total };
  if (x.L1.category_ok != null) u['capture.identification'] = { p: x.L1.category_ok ? 1 : 0, n: 1 };
  if (x.L1.gt_rows > 0) {
    u['capture.rows_recall'] = { p: x.L1.matched_rows, n: x.L1.gt_rows };
    u['capture.rows_precision'] = { p: x.L1.matched_rows, n: x.L1.out_rows };
  }
  if (x.L2) {
    const right = x.L2.correct + x.L2.normalized;
    u['capture.completeness'] = { p: right + x.L2.wrong, n: x.L2.gt_populated };
    u['capture.fidelity'] = { p: right, n: right + x.L2.wrong - (x.L2.convention ?? 0) };
    u['capture.restraint'] = { p: right + x.L2.wrong, n: right + x.L2.wrong + x.L2.spurious };
  }
  if (x.facts) u['facts.recall'] = { p: x.facts.hit, n: x.facts.total };
  const N = x.understand?.normalisation;
  if (N) {
    u['understand.dates'] = { p: N.by_kind.date.passed, n: N.by_kind.date.checked };
    u['understand.numbers'] = { p: N.by_kind.number.passed, n: N.by_kind.number.checked };
  }
  const W = x.understand?.world_knowledge;
  if (W) u['understand.codes'] = { p: W.correct, n: W.checked };
  const P = x.understand?.parsing;
  if (P) u['understand.parsing'] = { p: P.populated - P.swallowed, n: P.populated };
  const D = x.understand?.decoding;
  if (D) u['understand.decoding'] = { p: D.delivered - D.residue, n: D.delivered };
  const C = x.understand?.consistency;
  if (C) u['understand.consistency'] = { p: C.passed, n: C.checked };
  if (x.L4) {
    if (x.L4.schema != null) u['reason.schema'] = { v: x.L4.schema };
    u['reason.format'] = { v: x.L4.format };
    u['reason.contract'] = { p: x.L4.contract_passed, n: x.L4.contract_checks };
  }
  if (x.L3) u['trust.provenance'] = { p: x.L3.traceable_values, n: x.L3.delivered_values };
  if (x.L5?.[HEADLINE_BUDGET]?.scorable) u['trust.verification'] = { p: x.L5[HEADLINE_BUDGET].verified ? 1 : 0, n: 1 };
  return u;
}

/** Populated leaves of an answer key: the values a complete answer would have delivered. */
function populatedLeaves(o) {
  if (o == null) return 0;
  if (Array.isArray(o)) return o.reduce((a, v) => a + populatedLeaves(v), 0);
  if (typeof o === 'object') return Object.entries(o).reduce((a, [k, v]) => a + (k === 'Barcodes' ? 0 : populatedLeaves(v)), 0);
  return String(o).trim() ? 1 : 0;
}

/**
 * A lane that failed or never ran. It stays in every denominator and passes nothing: each measure is
 * charged exactly the checks a complete, correct answer from that lane would have produced, so a
 * failure costs what success would have earned.
 */
export function failedLane(entry, lane, corpus, rules, error) {
  const { doc, gtj } = entry;
  const perfect = {
    ok: true,
    extraction: gtj.gt ?? {},
    ocr_text: lane === 'prompt' ? null : corpus.text(doc),
    classification: { category: gtj.category },
  };
  const { rec } = scoreLane(entry, lane, perfect, corpus, rules);
  const units = {};
  for (const [k, x] of Object.entries(rec.units)) units[k] = 'v' in x ? { v: 0 } : { p: 0, n: x.n };
  // The two measures whose denominator is normally the system's own output are charged the key's.
  const leaves = populatedLeaves(gtj.gt ?? {});
  if (gtj.mode === 'fields') units['trust.provenance'] = { p: 0, n: leaves };
  const factsTotal = (gtj.facts ?? []).filter((f) => !f.soft).length;
  if (rec.facts) units['facts.recall'] = { p: 0, n: factsTotal };
  return {
    ok: false, failed: true, error: error ?? 'no evidence for this lane',
    units,
    has_error: gtj.mode === 'fields',
    review: { routed: false, signal: 'failed' },
  };
}

// -------------------------------------------------------------------------------------------------
// a whole run
// -------------------------------------------------------------------------------------------------
/**
 * Score every document of a run. Returns the per-document records the scoreboard publishes, each lane
 * carrying its units, plus the verdicts of the full lane for callers that need them (calibration).
 */
export function scoreDocuments({ corpus, runDir, population = 'auto', types = null, rules = RULES, keepVerdicts = false, engineDir = null }) {
  const raw = path.join(runDir, 'raw');
  const pop = resolvePopulation({ corpus, runDir, population: rules.failedLanesFail ? population : 'evidence', types });
  const records = [];
  const verdicts = new Map();
  for (const doc of pop.docs) {
    const gtj = corpus.gt(doc);
    const entry = { doc, gtj };
    const rec = {
      id: doc.id, slug: doc.slug, locale: doc.locale, mode: gtj.mode,
      dims: doc.dims,
      difficulty: DIFFICULTY[doc.dims?.noise] ?? 'clean',
      scale: scaleBand(gtj),
      lanes: {},
    };
    for (const lane of LANES) {
      const r = readJson(path.join(raw, `${doc.id}.${lane}.json`));
      if (r && r.ok) {
        const { rec: lr, verdicts: vs } = scoreLane(entry, lane, r, corpus, rules);
        rec.lanes[lane] = lr;
        if (keepVerdicts && lane === 'pipeline' && vs) verdicts.set(doc.id, { verdicts: vs, raw: r });
      } else if (rules.failedLanesFail) {
        rec.lanes[lane] = failedLane(entry, lane, corpus, rules, r ? r.error : null);
      } else if (r) {
        rec.lanes[lane] = { ok: false, error: r.error };
      }
    }
    // The cross-engine lane is a diagnostic kept in its own run directory and never scored as a failure.
    if (engineDir) {
      const r = readJson(path.join(engineDir, 'raw', `${doc.id}.engine.json`));
      if (r?.ok) rec.lanes.engine = scoreLane(entry, 'engine', r, corpus, rules).rec;
    }
    records.push(rec);
  }
  return { records, population: pop, verdicts };
}

/**
 * The repeatability runs. Each document of the declared sample is extracted three times with the
 * extraction cache bypassed; field stability is the share of fields whose value did not move. A
 * document whose repeats did not all succeed scores zero rather than being scored on fewer runs.
 */
export function scoreStabilityRuns({ corpus, stabDir, sampleIds = null, types = null, rules = RULES }) {
  const raw = path.join(stabDir, 'raw');
  if (!fs.existsSync(raw)) return null;
  let ids = sampleIds;
  if (!ids || !rules.failedLanesFail) {
    ids = fs.readdirSync(raw).filter((f) => f.endsWith('.stability.json')).map((f) => f.replace(/\.stability\.json$/, ''));
  }
  const rows = [];
  for (const id of ids) {
    const doc = corpus.byId.get(id);
    if (!doc) continue;
    if (types && !types.has(doc.slug)) continue;
    const r = readJson(path.join(raw, `${id}.stability.json`));
    const runs = r?.runs ?? [];
    const ok = runs.filter((x) => x?.ok);
    const complete = r && runs.length >= 2 && ok.length === runs.length;
    if (rules.failedLanesFail && !complete) {
      rows.push({ id, slug: doc.slug, failed: true, runs: runs.length, ok_runs: ok.length, field_stability: 0, units: { 'trust.stability': { v: 0 } } });
      continue;
    }
    const s = scoreStability(ok.map((x) => x.extraction));
    if (!s) continue;
    rows.push({ id, slug: doc.slug, ...s, units: { 'trust.stability': { v: s.field_stability } } });
  }
  if (!rows.length) return null;
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    docs: rows.length,
    repeats: Math.max(...rows.map((r) => r.runs ?? 0)),
    failed_docs: rows.filter((r) => r.failed).length,
    byte_identical_docs: rows.filter((r) => r.byte_identical).length,
    byte_identical_rate: rows.filter((r) => r.byte_identical).length / rows.length,
    field_stability: mean(rows.map((r) => r.field_stability)),
    fields_compared: rows.reduce((a, r) => a + (r.fields_compared ?? 0), 0),
    fields_drifted: rows.reduce((a, r) => a + (r.fields_drifted ?? 0), 0),
    drift_examples: rows.filter((r) => r.byte_identical === false).slice(0, 5).map((r) => ({ id: r.id, examples: r.examples })),
    rows: rows.map(({ examples, ...rest }) => rest),
  };
}

// -------------------------------------------------------------------------------------------------
// the safety panel
// -------------------------------------------------------------------------------------------------
/**
 * Escaped critical errors, catch rate and false-alarm rate, over the field-key documents of the full
 * lane, with "caught" meaning routed to a person. A document with a critical error (the critical error
 * budget, budgets.mjs) that the platform did not route escaped; a lane that failed counts as an
 * escaped critical error, because nothing usable and nothing warning anyone came back. A document whose evidence
 * carries confidence but records no decision (signal absent) is counted as undecided, beside the panel and never in
 * it, and a run in which every document is undecided or failed has no panel at all (available is false).
 */
export function safetyPanel(records, { lane = 'pipeline', budget = HEADLINE_BUDGET } = {}) {
  const cellOf = (hasError, routed) => (!hasError && !routed ? 'straight_through' : !hasError ? 'false_alarm' : routed ? 'caught' : 'escaped');
  const tally = () => ({ docs: 0, straight_through: 0, false_alarm: 0, caught: 0, escaped: 0, failed_lanes: 0, undecided: 0, signals: {} });
  const all = tally();
  const byType = {};
  for (const r of records) {
    if (r.mode !== 'fields') continue;
    const l = r.lanes[lane];
    if (!l) continue;
    let cell, signal;
    if (l.failed) { cell = 'escaped'; signal = 'failed'; }
    else if (l.ok && l.review?.signal === 'absent' && l.L5?.[budget]?.scorable) {
      // no decision in the evidence: neither caught nor escaped, and counted beside the panel so its denominators stay whole
      for (const t of [all, byType[r.slug] ??= tally()]) { t.undecided++; t.signals.absent = (t.signals.absent ?? 0) + 1; }
      continue;
    }
    else if (l.ok && l.L5?.[budget]?.scorable) {
      cell = cellOf(l.L5[budget].has_error, l.review?.routed === true);
      signal = l.review?.signal ?? 'unknown';
    }
    else continue;
    for (const t of [all, byType[r.slug] ??= tally()]) {
      t.docs++; t[cell]++;
      if (l.failed) t.failed_lanes++;
      t.signals[signal] = (t.signals[signal] ?? 0) + 1;
    }
  }
  // A panel needs decisions: where the evidence records none, a failed lane alone does not make one (specification 7.1).
  const available = Object.keys(all.signals).some((s) => s !== 'failed' && s !== 'absent');
  const rates = (t) => {
    const withError = t.caught + t.escaped, noError = t.straight_through + t.false_alarm;
    return {
      ...t,
      with_critical_error: withError,
      routed: t.caught + t.false_alarm,
      escaped_rate: available && t.docs ? t.escaped / t.docs : null,
      catch_rate: available && withError ? t.caught / withError : null,
      false_alarm_rate: available && noError ? t.false_alarm / noError : null,
    };
  };
  return {
    lane, budget, label: BUDGETS[budget].label, available,
    definition: 'caught = routed to a person by the platform; escaped = a critical error in a document that was not routed',
    ...rates(all),
    by_type: Object.fromEntries(Object.entries(byType).sort().map(([k, v]) => [k, rates(v)])),
  };
}

// -------------------------------------------------------------------------------------------------
// diagnostics beside the score
// -------------------------------------------------------------------------------------------------
const pooled = (units, key) => {
  let p = 0, n = 0;
  for (const u of units) { const x = u?.[key]; if (x && 'n' in x) { p += x.p; n += x.n; } }
  return n ? { rate: p / n, passed: p, checked: n } : { rate: null, passed: p, checked: n };
};

/** Fact recall per fact-key type and barcode symbol recall pooled over payloads, full lane. */
export function besideTheScore(records, lane = 'pipeline') {
  const facts = {};
  for (const slug of [...new Set(records.filter((r) => r.mode !== 'fields').map((r) => r.slug))].sort()) {
    facts[slug] = pooled(records.filter((r) => r.slug === slug).map((r) => r.lanes[lane]?.units), 'facts.recall');
  }
  const factAll = pooled(records.map((r) => r.lanes[lane]?.units), 'facts.recall');
  const barcodes = pooled(records.map((r) => r.lanes[lane]?.units), 'read.barcodes');
  // Identification over all ten types, beside the six-type score-bearing figure.
  const identification = pooled(records.map((r) => r.lanes[lane]?.units), 'capture.identification');
  return { fact_recall: { ...factAll, by_type: facts }, barcode_recall: barcodes, identification_all_types: identification };
}

// -------------------------------------------------------------------------------------------------
// detailed rollups (diagnostic): counts behind every stage, per lane and per group
// -------------------------------------------------------------------------------------------------
const mean = (xs) => { const v = xs.filter((x) => x != null && !Number.isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const sum = (xs) => xs.reduce((a, b) => a + (b ?? 0), 0);

export function rollup(recs, lane) {
  const all = recs.map((r) => r.lanes[lane]).filter(Boolean);
  const ls = all.filter((l) => l.ok);
  if (!all.length) return null;

  const caps = ls.map((l) => l.L2).filter(Boolean);
  const S = (k) => sum(caps.map((c) => c[k]));
  const right = S('correct') + S('normalized');
  const gtPop = S('gt_populated');
  const returned = right + S('wrong') + S('spurious');

  const structs = ls.map((l) => l.L1).filter(Boolean);
  const withRows = structs.filter((s) => s.gt_rows > 0);
  const cls = structs.filter((s) => s.category_ok != null);

  const trustAll = ls.map((l) => l.L5).filter((t) => t && t[HEADLINE_BUDGET]?.scorable);
  const trust = trustAll.map((t) => t[HEADLINE_BUDGET]);
  const plantedTotal = sum(trust.map((t) => t.planted_flags));
  const plantedHit = sum(trust.map((t) => t.planted_flags_hit));

  const infs = ls.map((l) => l.L3).filter(Boolean);
  const confs = ls.map((l) => l.L4).filter(Boolean);
  const legs = ls.map((l) => l.L0).filter(Boolean);
  const factRecs = ls.map((l) => l.facts).filter(Boolean);
  const uns = ls.map((l) => l.understand).filter(Boolean);
  const uAt = (u, p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), u);
  const uSum = (p) => sum(uns.map((u) => uAt(u, p) ?? 0));
  const ratio = (n, d) => (d ? n / d : null);
  const kindAgg = (kind) => {
    const c = uSum(`normalisation.by_kind.${kind}.canonical`);
    const u = uSum(`normalisation.by_kind.${kind}.understood`);
    const n = uSum(`normalisation.by_kind.${kind}.noncanonical`);
    const m = uSum(`normalisation.by_kind.${kind}.misconverted`);
    return { canonical: c, understood: u, noncanonical: n, misconverted: m, checked: c + u + n + m, rate: ratio(c + u, c + u + n + m) };
  };

  return {
    docs: all.length,
    ok: ls.length,
    failed: all.filter((l) => !l.ok).length,
    understand: uns.length ? {
      normalisation: { by_kind: Object.fromEntries(['date', 'number', 'text'].map((k) => [k, { ...kindAgg(k), scored: k !== 'text' }])) },
      world_knowledge: { correct: uSum('world_knowledge.correct'), checked: uSum('world_knowledge.checked'), rate: ratio(uSum('world_knowledge.correct'), uSum('world_knowledge.checked')) },
      parsing: { populated: uSum('parsing.populated'), swallowed: uSum('parsing.swallowed'), rate: uSum('parsing.populated') ? 1 - uSum('parsing.swallowed') / uSum('parsing.populated') : null },
      decoding: { delivered: uSum('decoding.delivered'), residue: uSum('decoding.residue'), rate: uSum('decoding.delivered') ? 1 - uSum('decoding.residue') / uSum('decoding.delivered') : null },
      consistency: {
        checked: uSum('consistency.checked'), passed: uSum('consistency.passed'), rate: ratio(uSum('consistency.passed'), uSum('consistency.checked')),
        row: { checked: uSum('consistency.row.checked'), passed: uSum('consistency.row.passed'), sign_inverted: uSum('consistency.row.sign_inverted') },
        doc: { checked: uSum('consistency.doc.checked'), passed: uSum('consistency.doc.passed') },
      },
    } : null,
    L0: legs.length ? {
      docs: legs.length,
      word_recall: mean(legs.map((l) => l.word_recall)),
      numeric_recall: mean(legs.map((l) => l.numeric_recall)),
      cer: mean(legs.map((l) => l.cer)),
      cer_measurable: legs.filter((l) => l.cer_measurable).length,
      barcode_recall: sum(legs.map((l) => l.barcodes_total)) ? sum(legs.map((l) => l.barcodes_found)) / sum(legs.map((l) => l.barcodes_total)) : null,
      barcodes_total: sum(legs.map((l) => l.barcodes_total)),
    } : null,
    L1: {
      docs: structs.length,
      classification_docs: cls.length,
      classification_correct: cls.filter((s) => s.category_ok).length,
      classification_accuracy: cls.length ? cls.filter((s) => s.category_ok).length / cls.length : null,
      gt_rows: sum(withRows.map((s) => s.gt_rows)),
      out_rows: sum(withRows.map((s) => s.out_rows)),
      matched_rows: sum(withRows.map((s) => s.matched_rows)),
      row_recall: sum(withRows.map((s) => s.gt_rows)) ? sum(withRows.map((s) => s.matched_rows)) / sum(withRows.map((s) => s.gt_rows)) : null,
      row_precision: sum(withRows.map((s) => s.out_rows)) ? sum(withRows.map((s) => s.matched_rows)) / sum(withRows.map((s) => s.out_rows)) : null,
      count_exact_docs: withRows.filter((s) => s.count_exact).length,
      count_exact_rate: withRows.length ? withRows.filter((s) => s.count_exact).length / withRows.length : null,
      over_segmented: sum(withRows.map((s) => s.over_segmented)),
      under_segmented: sum(withRows.map((s) => s.under_segmented)),
    },
    L2: caps.length ? {
      docs: caps.length, gt_populated: gtPop,
      correct: right, wrong: S('wrong'), missing: S('missing'), spurious: S('spurious'),
      convention_only_wrong: S('convention'),
      completeness: gtPop ? (right + S('wrong')) / gtPop : null,
      correctness: (right + S('wrong')) ? right / (right + S('wrong')) : null,
      hallucination: returned ? S('spurious') / returned : null,
      precision: returned ? right / returned : null,
      recall: gtPop ? right / gtPop : null,
    } : null,
    facts: factRecs.length ? { docs: factRecs.length, total: sum(factRecs.map((f) => f.total)), hit: sum(factRecs.map((f) => f.hit)), rate: sum(factRecs.map((f) => f.total)) ? sum(factRecs.map((f) => f.hit)) / sum(factRecs.map((f) => f.total)) : null } : null,
    L3: {
      derivations: sum(infs.map((i) => i.derivations_total)),
      fills: sum(infs.map((i) => i.fills)),
      fills_verifiable: sum(infs.map((i) => i.fills_verifiable)),
      fills_correct: sum(infs.map((i) => i.fills_correct)),
      fills_unverifiable: sum(infs.map((i) => i.fills_unverifiable)),
      fills_non_scalar: sum(infs.map((i) => i.fills_non_scalar)),
      fills_unplaceable_row: sum(infs.map((i) => i.fills_unplaceable_row)),
      precision: sum(infs.map((i) => i.fills_verifiable)) ? sum(infs.map((i) => i.fills_correct)) / sum(infs.map((i) => i.fills_verifiable)) : null,
      recall: mean(infs.map((i) => i.recall)),
      attribution: mean(infs.map((i) => i.attribution)),
      provenance: sum(infs.map((i) => i.delivered_values)) ? sum(infs.map((i) => i.traceable_values)) / sum(infs.map((i) => i.delivered_values)) : null,
      delivered_values: sum(infs.map((i) => i.delivered_values)),
      traceable_values: sum(infs.map((i) => i.traceable_values)),
    },
    L4: {
      keys_defined: sum(confs.map((c) => c.keys_defined)),
      keys_conforming: sum(confs.map((c) => c.keys_conforming)),
      format_checked: sum(confs.map((c) => c.format_checked)),
      format_ok: sum(confs.map((c) => c.format_ok ?? 0)),
      number_format_checked: sum(confs.map((c) => c.number_format_checked ?? 0)),
      number_format_ok: sum(confs.map((c) => c.number_format_ok ?? 0)),
      contract_checks: sum(confs.map((c) => c.contract_checks ?? 0)),
      contract_passed: sum(confs.map((c) => c.contract_passed ?? 0)),
    },
    L5: {
      headline_budget: HEADLINE_BUDGET,
      docs: trust.length,
      verification_ran: trust.length ? trust.filter((t) => t.verified).length / trust.length : null,
      flagged_docs: trust.filter((t) => t.flagged).length,
      routed_docs: trust.some((t) => typeof t.routed === 'boolean') ? trust.filter((t) => t.routed === true).length : null,
      planted_flags: plantedTotal,
      planted_flags_hit: plantedHit,
      planted_flag_recall: plantedTotal ? plantedHit / plantedTotal : null,
    },
    avg_ms: mean(ls.map((l) => (l.ms ?? 0) + (l.cls_ms ?? 0))),
  };
}

/** Rule-pack adherence and containment, scored from the rules run against the text-lane baseline. */
export function scoreRulesRun({ corpus, rulesDir, baselineRawDir, rules = RULES, sampleIds = null }) {
  const rr = path.join(rulesDir, 'raw');
  if (!fs.existsSync(rr)) return null;
  const packs = {};
  const want = sampleIds ? new Set(sampleIds) : null;
  for (const f of fs.readdirSync(rr).filter((x) => x.endsWith('.rules.json'))) {
    const raw = readJson(path.join(rr, f));
    if (!raw) continue;
    if (want && !want.has(raw.id)) continue;
    const doc = corpus.byId.get(raw.id); if (!doc) continue;
    const gtj = corpus.gt(doc);
    const baseline = readJson(path.join(baselineRawDir, `${raw.id}.prompt.json`));
    const failure = { id: raw.id, slug: raw.slug, failed: true, adherence: 0, containment: 0, collateral_count: 0, auditable: false };
    if (!baseline?.ok) {
      // Containment needs the no-rule baseline of the same document. Without it the pack cannot be
      // scored, and under failedLanesFail that is a failure rather than an omission.
      if (rules.failedLanesFail) for (const p of raw.packs ?? []) (packs[p.id] ??= []).push({ ...failure, why: 'no baseline' });
      continue;
    }
    for (const p of raw.packs ?? []) {
      if (!p.ok) { if (rules.failedLanesFail) (packs[p.id] ??= []).push(failure); continue; }
      const r = scoreConformance({
        gt: gtj.gt ?? {}, output: p.extraction, impact: p.impact,
        // Under docNumberHeader the target is rebuilt from the answer key at scoring time, whatever target the run
        // stored; without it the stored target stands.
        rulePack: (() => {
          const def = rules.docNumberHeader ? RULE_PACKS.find((x) => x.id === p.id) : null;
          const e = def ? buildExpectation(def, gtj) : (p.expect ?? {});
          return { id: p.id, expect: e.expect ?? {}, may_also_change: e.may_also_change ?? [] };
        })(),
        baseline: baseline.extraction ?? {},
        rules,
      });
      (packs[p.id] ??= []).push({ id: raw.id, slug: raw.slug, ...r.rules });
    }
  }
  // A declared sample document with no evidence at all failed every pack that applies to it.
  if (want && rules.failedLanesFail) {
    const seen = new Set(fs.readdirSync(rr).filter((x) => x.endsWith('.rules.json')).map((x) => x.replace(/\.rules\.json$/, '')));
    for (const id of want) {
      if (seen.has(id)) continue;
      const doc = corpus.byId.get(id); if (!doc) continue;
      const gtj = corpus.gt(doc);
      for (const pack of RULE_PACKS.filter((x) => x.applies(gtj))) {
        (packs[pack.id] ??= []).push({ id, slug: doc.slug, failed: true, adherence: 0, containment: 0, collateral_count: 0, auditable: false, why: 'no evidence' });
      }
    }
  }
  const out = {};
  for (const [pid, rows] of Object.entries(packs)) {
    out[pid] = {
      docs: rows.length,
      failed: rows.filter((r) => r.failed).length,
      adherence: mean(rows.map((r) => r.adherence)),
      full_adherence_docs: rows.filter((r) => r.adherence === 1).length,
      containment: mean(rows.map((r) => r.containment)),
      zero_collateral_docs: rows.filter((r) => !r.failed && r.collateral_count === 0).length,
      mean_collateral_fields: mean(rows.map((r) => r.collateral_count)),
      auditable_docs: rows.filter((r) => r.auditable).length,
      worst: rows.slice().sort((a, b) => b.collateral_count - a.collateral_count).slice(0, 3)
        .map((r) => ({ id: r.id, collateral: r.collateral_count, sample: r.collateral?.slice(0, 3) })),
    };
  }
  return out;
}

export { FIELD_KEY_TYPES };
