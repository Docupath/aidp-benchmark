/**
 * AIDP-Bench scoring pass. Reads the raw evidence a run collected and produces the scoreboard.
 *
 * Runs entirely offline. No model is called, nothing is downloaded, and it can be re-run as often as
 * anyone likes: the numbers can be recomputed by anyone holding the raw evidence, including someone
 * who disagrees with a scoring choice and wants to substitute their own.
 *
 *   node bench/score-run.mjs --corpus <corpus dir> --tag <run tag> [--out-tag <tag>]
 *   node bench/score-run.mjs --corpus <corpus dir> --run <run dir> --out <board dir>
 *
 * Options
 *   --results <dir>        where run directories live (default aidp-bench/results)
 *   --tag <tag>            the main run (both lanes); its raw evidence is <results>/<tag>/raw
 *   --run <dir>            the main run directory, instead of --results and --tag
 *   --stability-tag <tag>  the repeatability runs (default the run's own: the tag with "-main" replaced by
 *                          "-stability", or <tag>-stability; "none" leaves them out)
 *   --rules-tag <tag>      the written-instruction runs (default the run's own, found the same way with "-rules";
 *                          "none" leaves them out). A run without its own is scored without them, never with
 *                          another run's.
 *   --engine-tag <tag>     an optional cross-engine lane (diagnostic)
 *   --population <mode>    auto (default) | plan | manifest | evidence, see scoring.mjs
 *   --types a,b,c          restrict to these document types
 *   --out-tag <tag> / --out <dir>   where scoreboard.json and report.md are written
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES } from './rules.mjs';
import {
  loadCorpus, scoreDocuments, scoreStabilityRuns, scoreRulesRun, safetyPanel, besideTheScore, rollup,
} from './scoring.mjs';
import { aidpScores, FLAVOURS, MEASURES, DIAGNOSTICS, LAYERS, measure, weightsFor, unitsOf } from './aidp-score.mjs';
import { AIDP_VERSION } from './score-das.mjs';

const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Folders are recorded relative to the repository, so a published file carries no machine's paths.
const inRepo = (p) => (p ? path.relative(path.resolve(BENCH, '..'), p) || '.' : p);
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };

const CORPUS = path.resolve(opt('corpus', path.join(BENCH, 'corpus')));
const ROOT = path.resolve(opt('results', path.join(BENCH, 'results')));
const TAG = opt('tag', null);
const RUN = path.resolve(opt('run', TAG ? path.join(ROOT, TAG) : ''));
if (!TAG && !opt('run')) { console.error('give --tag <run tag> or --run <run dir>'); process.exit(2); }
const firstExisting = (...tags) => tags.filter(Boolean).map((t) => path.join(ROOT, t)).find((d) => fs.existsSync(path.join(d, 'raw'))) ?? null;
// A run's repeatability and instruction runs are its own siblings (aidp-v1-main: aidp-v1-stability, aidp-v1-rules).
const siblingRun = (kind) => { const base = TAG ?? path.basename(RUN); return firstExisting(`${base.replace(/-main$/, '')}-${kind}`, `${base}-${kind}`); };
const chosenRun = (flag, kind) => (opt(flag) === 'none' ? null : opt(flag) ? path.join(ROOT, opt(flag)) : siblingRun(kind));
const STAB = chosenRun('stability-tag', 'stability');
const RULESRUN = chosenRun('rules-tag', 'rules');
const ENGINE = opt('engine-tag') ? path.join(ROOT, opt('engine-tag')) : null;
const TYPES = opt('types', null) ? new Set(opt('types').split(',').map((s) => s.trim()).filter(Boolean)) : null;
const OUT = opt('out') ? path.resolve(opt('out')) : path.join(ROOT, opt('out-tag', TAG ?? path.basename(RUN)));

if (!fs.existsSync(path.join(RUN, 'raw'))) { console.error(`no raw evidence at ${path.join(RUN, 'raw')}`); process.exit(2); }

const corpus = loadCorpus(CORPUS);
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

const { records, population } = scoreDocuments({ corpus, runDir: RUN, population: opt('population', 'auto'), types: TYPES, rules: RULES, engineDir: ENGINE });
const stability = STAB ? scoreStabilityRuns({ corpus, stabDir: STAB, sampleIds: readJson(path.join(STAB, 'run-meta.json'))?.documents ?? null, types: TYPES, rules: RULES }) : null;
const rulesReport = RULESRUN ? scoreRulesRun({ corpus, rulesDir: RULESRUN, baselineRawDir: path.join(RUN, 'raw'), sampleIds: readJson(path.join(RULESRUN, 'run-meta.json'))?.documents ?? null, rules: RULES }) : null;

// -------------------------------------------------------------------------------------------------
// the score, the safety panel, and what is reported beside them
// -------------------------------------------------------------------------------------------------
const board = {
  aidp_version: AIDP_VERSION,
  tag: path.basename(OUT), scored_at: new Date().toISOString(),
  rules: RULES,
  run: { dir: inRepo(RUN), meta: readJson(path.join(RUN, 'run-meta.json')), stability_dir: inRepo(STAB), rules_dir: inRepo(RULESRUN) },
  corpus: { seed: corpus.manifest.seed, ...(corpus.manifest.generator_settings ? { generator_settings: corpus.manifest.generator_settings } : {}), docs_in_corpus: corpus.manifest.docs.length, docs_scored: records.length, population: population.mode, planned: population.planned },
  weighting: { 'type-equal': { counts: 'each of the six field-key types weighted 1, as each holds 200 documents in the corpus' } },
  docs: records,
  stability,
};

let scores = null, scoreError = null;
try { scores = aidpScores(board); } catch (e) { scoreError = String(e.message ?? e); }
board.score = scores ? Object.fromEntries(FLAVOURS.map((f) => [f, scores[f].score])) : null;
board.score_error = scoreError;
board.layers = scores ? Object.fromEntries(FLAVOURS.map((f) => [f, scores[f].layers])) : null;
board.measures = scores ? Object.fromEntries(FLAVOURS.map((f) => [f, scores[f].measures])) : null;
board.registry = { score_bearing: MEASURES.map(({ id, label, layer, capability, unit }) => ({ id, label, layer, capability, unit })), diagnostic: DIAGNOSTICS, layers: LAYERS.map(({ key, name, capabilities, measures }) => ({ key, name, capabilities, measures })) };
// The safety panel needs the platform's own decision for each document. A run whose published evidence carries
// confidence but no decisions (this edition's: specification, "Decided after the run") has no panel, so the board
// keeps none.
const decisionCounts = (t) => ({ docs: t.docs, ready_for_approval: t.docs - t.routed - t.failed_lanes, sent_to_a_person: t.routed, failed_lanes: t.failed_lanes, undecided: t.undecided });
{
  const P = safetyPanel(records);
  board.decisions = !P.available ? null : { lane: P.lane, ...decisionCounts(P), signals: P.signals, by_type: Object.fromEntries(Object.entries(P.by_type).map(([k, v]) => [k, decisionCounts(v)])) };
}
board.beside = {
  ...besideTheScore(records),
  parsing: rollup(records, 'pipeline')?.understand?.parsing ?? null,
  verification_ran: rollup(records, 'pipeline')?.L5?.verification_ran ?? null,
  rules: rulesReport,
};

// Diagnostic breakdowns. The text lane is the same documents read from the corpus's own correct text,
// so the difference between the two lanes is the cost of reading the page.
const LANES = ['pipeline', 'prompt', 'engine'];
board.overall = Object.fromEntries(LANES.map((l) => [l, rollup(records, l)]).filter(([, v]) => v));
const groupBy = (key, vals) => Object.fromEntries(vals.map((v) => [v, Object.fromEntries(LANES.map((l) => [l, rollup(records.filter((r) => r[key] === v), l)]))]));
board.byType = groupBy('slug', [...new Set(records.map((r) => r.slug))].sort());
board.byDifficulty = groupBy('difficulty', ['clean', 'degraded', 'hostile']);
board.byScale = groupBy('scale', ['1-10', '11-100', '101-500']);
board.byLocale = Object.fromEntries([...new Set(records.map((r) => r.locale))].sort().map((l) => [l, rollup(records.filter((r) => r.locale === l), 'pipeline')]));

// The same measures over the text lane, as the lane-comparison diagnostic. The text lane does not
// classify and does not read a page, so Identification and Read have no value there.
const ranLanes = board.run.meta?.lanes ?? ['pipeline', 'prompt'];
board.text_lane = null;
if (ranLanes.includes('prompt')) {
  const textUnits = unitsOf({ docs: records.map((r) => ({ slug: r.slug, lanes: { pipeline: r.lanes.prompt } })).filter((d) => d.lanes.pipeline), stability });
  board.text_lane = Object.fromEntries(FLAVOURS.map((f) => [f, MEASURES.map((m) => ({ id: m.id, label: m.label, value: measure(m, textUnits, weightsFor(f)).value }))]));
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'scoreboard.json'), JSON.stringify(board, null, 1));

// -------------------------------------------------------------------------------------------------
// report
// -------------------------------------------------------------------------------------------------
// A rate of exactly one is an observation that no failure appeared in this sample, not a claim of
// perfection, and a sample cannot support the latter. It is reported as what it is.
// A rate below one is never printed as 100.00%: it gets the fewest decimals that do not round it up.
const noRoundUp = (v, d = 2) => { if (v == null) return 'n/a'; let s = v.toFixed(d); while (s.startsWith('100') && v < 100 && d < 12) s = v.toFixed(++d); return s; };
const pct = (x, d = 2) => (x == null ? 'n/a' : x >= 1 ? 'no failure observed' : noRoundUp(x * 100, d) + '%');
const n = (x) => Number(x ?? 0).toLocaleString('en-US');
let md = `# AIDP-Bench scoreboard: ${board.tag}\n\nAgentic IDP Accuracy Standard (AIDP) v${AIDP_VERSION}. Corpus seed \`${corpus.manifest.seed}\`${corpus.manifest.generator_settings ? ` (generator settings: ${Object.keys(corpus.manifest.generator_settings).join(', ')})` : ''}, ${n(records.length)} of ${n(corpus.manifest.docs.length)} documents scored (population: ${population.mode}${population.planned != null ? `, ${n(population.planned)} planned` : ''}).\n`;
if (scores) {
  md += `\n## The AIDP Score\n\n**${noRoundUp(scores['type-equal'].score)}**\n\n`;
  md += `Equal-weight geometric mean of ${MEASURES.length} score-bearing measures, each of the six field-key document types counting equally, as each does in the corpus. Layer scores recombine to the score exactly, weighted by their measure counts.\n\n`;
  md += `### Layers\n\n`;
  for (let i = 0; i < LAYERS.length; i++) {
    const e = scores['type-equal'].layers[i];
    // the unrounded layer score, so a layer below 100 is never printed as 100.00
    md += `- ${i + 1}. ${e.name} (${e.count} measure${e.count === 1 ? '' : 's'}): ${noRoundUp(e.raw != null ? e.raw * 100 : e.score)}\n`;
  }
  md += `\n### Measures\n\n`;
  for (let i = 0; i < MEASURES.length; i++) {
    const e = scores['type-equal'].measures[i];
    md += `- ${e.label} (${e.unit}): ${pct(e.value)}\n`;
  }
} else {
  md += `\n## The AIDP Score\n\nNot computable on this run: ${scoreError}\n`;
}
const D = board.decisions;
if (D) {
  md += `\n## Review decisions (field-key documents, full lane)\n\nWhat the platform decided for each document: marked ready for approval, or sent to a person.\n\n`;
  md += `- documents: ${n(D.docs)}, marked ready for approval: ${n(D.ready_for_approval)}, sent to a person: ${n(D.sent_to_a_person)}, failed lanes: ${n(D.failed_lanes)}${D.undecided ? `, without a decision in the evidence: ${n(D.undecided)}` : ''}\n`;
  md += `- review signal: ${Object.entries(D.signals).map(([k, v]) => `${k} ${n(v)}`).join(', ')}\n\nBy document type:\n\n`;
  for (const [t, x] of Object.entries(D.by_type)) md += `- ${t}: ${n(x.docs)} documents, marked ready ${n(x.ready_for_approval)}, sent to a person ${n(x.sent_to_a_person)}, failed lanes ${n(x.failed_lanes)}${x.undecided ? `, without a decision ${n(x.undecided)}` : ''}\n`;
}
const B = board.beside;
md += `\n## Beside the score\n\n`;
md += `- Barcode symbol recall, pooled over payloads: ${pct(B.barcode_recall.rate)} (${n(B.barcode_recall.passed)} of ${n(B.barcode_recall.checked)})\n`;
md += `- Fact recall, the four fact-key types: ${pct(B.fact_recall.rate)} (${n(B.fact_recall.passed)} of ${n(B.fact_recall.checked)})\n`;
for (const [t, x] of Object.entries(B.fact_recall.by_type)) md += `  - ${t}: ${pct(x.rate)} (${n(x.passed)} of ${n(x.checked)})\n`;
md += `- Identification over all ten types: ${pct(B.identification_all_types.rate)} (${n(B.identification_all_types.passed)} of ${n(B.identification_all_types.checked)})\n`;
md += `- Parsing check, fields not swallowed into a neighbouring field (diagnostic, not scored): ${pct(B.parsing?.rate)}; documents with at least one recorded check or derivation (diagnostic, not scored): ${pct(B.verification_ran)}\n`;
if (B.rules) for (const [pid, r] of Object.entries(B.rules)) md += `- Instructions, ${pid}: ${n(r.docs)} documents, adherence ${pct(r.adherence)}, zero collateral on ${n(r.zero_collateral_docs)}, failed ${n(r.failed)}\n`;
if (stability) md += `- Repeatability: ${n(stability.docs)} documents, ${stability.repeats} runs each with the extraction cache bypassed (each submission records in runs[].classification.cache_hit whether a stored page reading was reused), ${n(stability.byte_identical_docs)} byte identical, ${n(stability.failed_docs)} with a failed run\n`;
md += `\n## Lanes\n\n`;
for (const l of ['pipeline', 'prompt']) {
  const o = board.overall[l]; if (!o) continue;
  const lane = l === 'pipeline' ? 'full lane (the rendered PDF)' : 'text lane (the corpus text)';
  md += ranLanes.includes(l) ? `- ${lane}: ${n(o.docs)} documents, ${n(o.failed)} failed\n` : `- ${lane}: not run, as the run's metadata records\n`;
}
if (Array.isArray(board.text_lane?.['type-equal'])) {
  md += `\nMeasures, full lane against text lane:\n\n`;
  // The text lane neither reads nor classifies, and repeatability is measured from the page only.
  const untested = new Set(['read.words', 'read.numbers', 'capture.identification', 'trust.stability']);
  board.text_lane['type-equal'].forEach((t, i) => { if (untested.has(t.id)) return; const p = scores?.['type-equal']?.measures?.[i]; md += `- ${t.label}: ${pct(p?.value)} against ${pct(t.value)}\n`; });
}
fs.writeFileSync(path.join(OUT, 'report.md'), md);
console.log(md);
console.log(`wrote ${path.join(OUT, 'scoreboard.json')} and report.md`);
