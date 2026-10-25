/**
 * AIDP-Bench stage scorer.
 *
 * Scores the evidence a run collected against a ground-truth-first corpus. The corpus generator writes
 * the answer key first and renders only values present in it, so "returned a value that is not in the
 * answer key" is an invention by construction rather than by judgement.
 *
 * The functions here work in stages, keyed L0 to L5 inside the per-document records, because those
 * are the units the evidence naturally falls into: what was read, which rows were found, which values
 * were captured, what was derived, what the contract required, and what reached a person. The
 * standard's five layers, its capabilities and its score are defined over these stages in
 * aidp-score.mjs, which is the only place the mapping lives.
 *
 * Every function that compares values takes the rule set of rules.mjs, so that a rule's effect can be
 * measured by turning it on alone. The default is always the full rule set.
 */
import { scoreFields, scoreFacts, aggregate, normStr, normNum, normDate, fieldKind, isPlainNumber } from './base-score.mjs';
import { RULES } from './rules.mjs';

export const AIDP_VERSION = '1.0';

/** The internal stages, with the question each one's evidence answers. */
export const DIMENSIONS = {
  L0: { name: 'Read',     question: 'Do the characters and barcodes come off the page?' },
  L1: { name: 'Locate',   question: 'Is it the right document, the right table, the right rows?' },
  L2: { name: 'Capture',  question: 'Is every value present, correct and real?' },
  L3: { name: 'Complete', question: 'Are values the page omitted supplied correctly, and in code?' },
  L4: { name: 'Comply',   question: "Are the customer's own business rules applied, and only where intended?" },
  L5: { name: 'Confirm',  question: 'Does the system verify its own output and surface what needs attention?' },
};

// ---------------------------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------------------------
const isEmpty = (v) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
const squash = (v) => normStr(v).replace(/[^a-z0-9À-￿]+/g, '');

/**
 * Content tokens of a text blob: words of >=2 chars and every number. Order independent.
 *
 * A number is a run of digit groups joined by ONE separator each (. , ' a space or a no-break space),
 * so a thousands separator stays inside it ("1 234,56", "1'234.56"). Two separators in a row, such as
 * the gap between two table columns that a reader lays out with spaces, end it.
 *
 * Allowing any RUN of separators inside a number would turn "SN66192301  12" in a column-aligned reading into
 * the one token 6619230112, matching nothing in the correct text, where the two numbers sit in separate cells,
 * and the measure would depend on how a reader lays out a table, which it is built not to do.
 * bench/layout-check.mjs shows it: a document's own correct text with its tables laid out in spaced columns
 * scores 100% under this pattern and 74.94% under one that lets any run of separators join digits, on all
 * 2,000 documents.
 */
export function tokens(text, { numbersEndAtGap = true } = {}) {
  const s = String(text ?? '');
  const words = (s.toLowerCase().match(/[\p{L}][\p{L}\p{M}'-]{1,}/gu) ?? []);
  const number = numbersEndAtGap ? /\d+(?:[.,'  ]\d+)*/g : /\d[\d.,'  ]*\d|\d/g;
  const nums = (s.match(number) ?? []).map((n) => n.replace(/[^\d]/g, '')).filter((n) => n.length);
  return { words, nums };
}

/** Multiset recall of `need` inside `have`. Counts duplicates properly. */
function multisetRecall(need, have) {
  if (!need.length) return { found: 0, total: 0, rate: 1 };
  const pool = new Map();
  for (const h of have) pool.set(h, (pool.get(h) ?? 0) + 1);
  let found = 0;
  for (const n of need) { const c = pool.get(n) ?? 0; if (c > 0) { pool.set(n, c - 1); found++; } }
  return { found, total: need.length, rate: found / need.length };
}

/** Levenshtein distance, capped. Returns null when either side exceeds `cap` characters. */
export function levenshtein(a, b, cap = 8000) {
  if (a.length > cap || b.length > cap) return null;
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Uint32Array(b.length + 1);
  let cur = new Uint32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1, ins = cur[j - 1] + 1, sub = prev[j - 1] + cost;
      cur[j] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
    }
    const t = prev; prev = cur; cur = t;
  }
  return prev[b.length];
}

// ---------------------------------------------------------------------------------------------
// L0  Legibility
// ---------------------------------------------------------------------------------------------
/**
 * Did the marks come off the page? Compares the OCR text the pipeline actually produced against the
 * corpus's canonical text for the same document.
 *
 * Reported as content recall rather than raw character error rate for the headline, because a page
 * of correctly read text with the table columns emitted in a different order scores terribly on CER
 * while losing no information. CER is still computed, on documents short enough to align exactly,
 * so the classic number is available for comparison.
 */
/**
 * Barcode and QR payloads written in a text, each squashed for comparison. A payload is what follows a
 * "Barcode:" or "QR Code:" marker. Under qrPayloadLines (rules.mjs) a QR payload that carries one field per
 * line (a payment QR code: BCD, version, charset, SCT, BIC, name, IBAN, amount) is read whole: the canonical
 * text writes its fields on the lines under the marker, up to a blank line, a heading or the next marker,
 * and a reading may write them on the marker's line with escaped line breaks ("\n"). Without it only the
 * marker's own line is read, so a multi-line payload is compared by its first field alone.
 */
export function barcodePayloads(text, { qrPayloadLines = true } = {}) {
  if (!qrPayloadLines) {
    return (String(text).match(/(?:Barcode|QR Code)\s*:\s*([^\n]+)/gi) ?? []).map((l) => squash(l.replace(/^[^:]*:\s*/, '')));
  }
  const lines = String(text).split('\n');
  const marker = /(Barcode|QR Code)\s*:\s*(.+)$/i;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(marker);
    if (!m) continue;
    let payload = m[2];
    if (/^qr code$/i.test(m[1])) {
      while (i + 1 < lines.length && lines[i + 1].trim() && !marker.test(lines[i + 1]) && !/^\s*#/.test(lines[i + 1])) {
        payload += '\n' + lines[++i];
      }
      payload = payload.replace(/\\n/g, '\n');
    }
    out.push(squash(payload));
  }
  return out;
}

export function scoreLegibility(ocrText, canonicalText, opts = {}) {
  if (!ocrText || !canonicalText) return null;
  const need = tokens(canonicalText, opts), have = tokens(ocrText, opts);
  const w = multisetRecall(need.words, have.words);
  const n = multisetRecall(need.nums, have.nums);

  // Classic CER, only where both sides fit the alignment cap. Whitespace collapsed so that layout
  // choices (a table emitted as markdown vs as columns) are not scored as character errors.
  const flat = (s) => String(s).replace(/\s+/g, ' ').trim();
  const a = flat(canonicalText), b = flat(ocrText);
  const dist = levenshtein(a, b);
  const cer = dist == null ? null : (a.length ? dist / a.length : 0);

  // Barcode payloads are the hardest legibility target and are scored separately: the canonical text
  // marks them with a "Barcode:" / "QR Code:" prefix, so the payloads themselves can be compared.
  const bcOpts = { qrPayloadLines: opts.qrPayloadLines ?? true };
  const bcNeed = barcodePayloads(canonicalText, bcOpts), bcHave = barcodePayloads(ocrText, bcOpts);
  const bc = multisetRecall(bcNeed, bcHave);

  return {
    word_recall: w.rate, words_found: w.found, words_total: w.total,
    numeric_recall: n.rate, nums_found: n.found, nums_total: n.total,
    cer, cer_measurable: dist != null,
    barcode_recall: bcNeed.length ? bc.rate : null, barcodes_found: bc.found, barcodes_total: bcNeed.length,
    score: n.total ? (0.4 * w.rate + 0.6 * n.rate) : w.rate,  // numbers weighted: they are the money
  };
}

// ---------------------------------------------------------------------------------------------
// L1  Structure
// ---------------------------------------------------------------------------------------------
const ID_WORDS = /(^|[^a-z0-9])(no|nr|number|num|id|code|reference|ref|account)([^a-z0-9]|$)/i;
const rowKey = (it) => {
  if (!it || typeof it !== 'object') return '';
  // A line-item row identifies itself by its article and its description, exactly as it always has.
  // A row of a table with neither (a shipment, a container, a location, a tax line, a payment account)
  // identifies itself by its first identifier column instead: the shipment reference, the row id, the
  // container number, the tax code, the account number.
  const itemLike = ['Article ID', 'Item Code', 'Product Code', 'Article Name', 'Description', 'Item Description'].some((k) => k in it);
  const idField = itemLike ? null : Object.keys(it).find((k) => ID_WORDS.test(k));
  const id = squash(itemLike ? (it['Article ID'] ?? it['Item Code'] ?? it['Product Code'] ?? '') : (idField ? it[idField] ?? '' : ''));
  const name = squash(it['Article Name'] ?? it['Description'] ?? it['Item Description'] ?? '');
  return id + '|' + name;
};
/** Numeric fingerprint of a row: every money/quantity value by absolute value, sorted. */
const rowNums = (it) => {
  if (!it || typeof it !== 'object') return '';
  return Object.values(it).map((v) => normNum(v)).filter((n) => n != null && n !== 0)
    .map((n) => Math.abs(n)).sort((x, y) => x - y).join(',');
};

/**
 * Are the rows the right rows? Matched one-to-one, first on the identity key, then on the numeric
 * fingerprint, so a row whose description was rewritten still matches on its amounts. Rows left over
 * on the answer-key side are misses; rows left over on the output side are over-segmentation, which
 * in production means a wrapped cell counted as two rows or a page seam double-counting a row.
 */
export function scoreStructure({ gt, output, expectedCategory, actualCategory, categoryAlt = [] }) {
  const sections = Object.keys(gt ?? {}).filter((k) => Array.isArray(gt[k]) && k !== 'Barcodes');
  let gtRows = 0, outRows = 0, matched = 0;
  const perSection = {};

  // outToGt maps "<section>.<output row index>" -> ground-truth row index, so that any later layer
  // needing to look a row up in the answer key resolves it through the SAME alignment rather than
  // trusting that output row 7 is answer-key row 7. It very often is not: a system that captured
  // every row correctly but emitted them in a different order would otherwise be scored as having
  // got every one of them wrong.
  const outToGt = {};

  for (const sec of sections) {
    const g = gt[sec] ?? [], o = Array.isArray(output?.[sec]) ? output[sec] : [];
    gtRows += g.length; outRows += o.length;
    const used = new Set();
    let hit = 0;
    // pass 1: identity key
    for (let gi = 0; gi < g.length; gi++) {
      const k = rowKey(g[gi]);
      if (k === '|') continue;
      const idx = o.findIndex((orow, i) => !used.has(i) && rowKey(orow) === k);
      if (idx >= 0) { used.add(idx); hit++; outToGt[`${sec}.${idx}`] = gi; }
    }
    // pass 2: numeric fingerprint for rows the key could not place
    for (let gi = 0; gi < g.length; gi++) {
      if (Object.values(outToGt).includes(gi) && rowKey(g[gi]) !== '|'
          && o.some((orow, i) => used.has(i) && outToGt[`${sec}.${i}`] === gi)) continue;
      const fp = rowNums(g[gi]);
      if (!fp) continue;
      const idx = o.findIndex((orow, i) => !used.has(i) && rowNums(orow) === fp);
      if (idx >= 0) { used.add(idx); hit++; outToGt[`${sec}.${idx}`] = gi; }
    }
    hit = Math.min(hit, g.length);
    matched += hit;
    perSection[sec] = { gt: g.length, out: o.length, matched: hit };
  }

  const catOk = !expectedCategory ? null
    : (actualCategory === expectedCategory || categoryAlt.includes(actualCategory));
  const recall = gtRows ? matched / gtRows : 1;
  const precision = outRows ? matched / outRows : 1;
  const f1 = (recall + precision) ? (2 * recall * precision) / (recall + precision) : 1;

  return {
    category_expected: expectedCategory ?? null, category_actual: actualCategory ?? null, category_ok: catOk,
    gt_rows: gtRows, out_rows: outRows, matched_rows: matched,
    row_recall: recall, row_precision: precision, row_f1: f1,
    over_segmented: Math.max(0, outRows - gtRows), under_segmented: Math.max(0, gtRows - outRows),
    count_exact: gtRows === outRows,
    per_section: perSection,
    out_to_gt: outToGt,
    // A document with no table at all is scored on classification only.
    // Classification and row alignment are separate questions and are scored as a weighted
    // composite of the two. The earlier formula returned zero for the whole dimension whenever the
    // document type was wrong, which charged a single misclassification twice: once against the
    // classification term, and again by discarding a row alignment that was often perfectly correct.
    // A document can be assigned the wrong type and still have every one of its rows located.
    score: (() => {
      const cls = catOk === null ? null : (catOk ? 1 : 0);
      if (!gtRows) return cls == null ? 1 : cls;          // no table: classification is the whole story
      if (cls == null) return f1;                          // no classification in this lane: rows only
      return 0.4 * cls + 0.6 * f1;
    })(),
  };
}

// ---------------------------------------------------------------------------------------------
// L2  Capture   (delegates to the field scorer, base-score.mjs, then adds precision/recall framing)
// ---------------------------------------------------------------------------------------------
export function scoreCapture(gt, output, rules = RULES) {
  const verdicts = scoreFields(gt, output, rules).filter((v) => !/\.count$/.test(v.path));
  const agg = aggregate(verdicts);
  const right = agg.correct + agg.normalized;
  const returned = right + agg.wrong + agg.spurious;
  return {
    ...agg,
    precision: returned ? right / returned : 1,          // of everything we returned, how much was right
    recall: agg.gt_populated ? right / agg.gt_populated : 1, // of everything true, how much we got right
    f1: (returned && agg.gt_populated)
      ? (2 * right) / (returned + agg.gt_populated) : 1,
    verdicts,
    score: agg.gt_populated ? (right / agg.gt_populated) * (1 - agg.hallucination) : 1,
  };
}

// ---------------------------------------------------------------------------------------------
// L3  Inference
// ---------------------------------------------------------------------------------------------
const ATTRIBUTION_KEYS = ['method', 'reason', 'field_path'];

/** Every leaf path in a delivered document, with its value. */
function leavesOf(obj, pre = '', out = []) {
  if (obj == null || typeof obj !== 'object') { out.push([pre, obj]); return out; }
  if (Array.isArray(obj)) { obj.forEach((v, i) => leavesOf(v, `${pre}.${i}`, out)); return out; }
  for (const k of Object.keys(obj)) leavesOf(obj[k], pre ? `${pre}.${k}` : k, out);
  return out;
}

/**
 * Values the page never printed. Three questions, not one:
 *   recall       did the engine fill everything the corpus planted as safely fillable
 *   precision    were the values it filled actually correct against the answer key
 *   restraint    did it refuse to fill anything the answer key leaves empty
 *   attribution  does every single fill carry its method, its inputs and a written reason
 */
export function scoreInference({ gt, output, derived, confidence = null, expectedDerived = [], rowMap = null }) {
  const derivations = derived?.derivations ?? [];
  const fills = derivations.filter((d) => d.kind === 'derived');
  const endsWith = (d, p) => String(d.field_path || '').endsWith(p);

  const recallRows = expectedDerived.map((e) => ({ path: e.path, hit: fills.some((d) => endsWith(d, e.path)) }));
  const recall = recallRows.length ? recallRows.filter((r) => r.hit).length / recallRows.length : null;

  // Precision is scored ONLY where the answer key can settle the question, meaning it holds a
  // non-empty scalar at that path.
  //
  // Two classes of fill are deliberately excluded rather than counted as errors.
  //
  // The answer key leaves a field empty. The corpus generator renders only what a document prints,
  // and per-line tax and gross amounts are routinely NOT printed even though they are computable
  // from the printed net and rate. A correct derivation of such a value therefore lands on an empty
  // key entry, and is indistinguishable, with this corpus, from a genuine overreach. Counting it as
  // an error would penalise the engine for doing exactly what Layer 3 asks. These are reported as
  // `fills_unverifiable` so the reader can see how much of the engine's work this corpus cannot
  // adjudicate, which is a limitation of the corpus and is recorded as such.
  //
  // The path names a whole row rather than a leaf, e.g. "Items.1". Comparing an object against a
  // scalar is meaningless, so those are excluded too.
  const get = (obj, path) => String(path).split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

  // A derived value's field_path indexes the OUTPUT's rows. Looking it up in the answer key by the
  // same index compares two different rows whenever the system emitted rows in a different order,
  // which turns a correctly derived value into a recorded error. Paths inside a repeating section
  // are therefore translated through the row alignment before lookup, and a row the alignment could
  // not place is left unverifiable rather than counted wrong.
  const translate = (path) => {
    const m = String(path).match(/^([^.]+)\.(\d+)(\..+)?$/);
    if (!m || !rowMap) return path;
    const [, sec, idx, rest] = m;
    const gi = rowMap[`${sec}.${idx}`];
    if (gi == null) return null;
    return `${sec}.${gi}${rest ?? ''}`;
  };

  let verifiable = 0, right = 0, unverifiable = 0, nonScalar = 0, unplaceable = 0;
  const wrongFills = [];
  for (const d of fills) {
    const path = translate(d.field_path);
    if (path === null) { unplaceable++; continue; }
    const truth = get(gt, path);
    if (truth === undefined) { unverifiable++; continue; }
    if (truth !== null && typeof truth === 'object') { nonScalar++; continue; }
    if (isEmpty(truth)) { unverifiable++; continue; }
    verifiable++;
    const a = normNum(truth), b = normNum(d.after);
    const ok = (a != null && b != null) ? a === b : squash(truth) === squash(d.after);
    if (ok) right++; else wrongFills.push({ path, out_path: d.field_path, method: d.method, want: truth, got: d.after });
  }

  const attributed = derivations.filter((d) => ATTRIBUTION_KEYS.every((k) => d[k] != null && String(d[k]).length));

  // Traceability. Two weaker versions of this measure are not used, and the reason is worth
  // recording: neither would tell a reader anything.
  //
  // Asking whether a derivation record carries its own method and reason is tautological: it does,
  // by construction. Asking whether a delivered value carries a confidence entry was taken to be
  // tautological as well, on the view that the confidence engine scores every field. It does not: values
  // in payment and tax tables and in freight shipment tables carry no entry, and they fall outside the
  // count below (FINDINGS.md, B18).
  //
  // The question an auditor actually asks is whether a value can be traced to identifiable evidence.
  // Each confidence entry names the evidence behind the value it scores: an exact span in the source
  // text, a normalised match, a fuzzy match, a value computed by a stated method, or a value the
  // model inferred. An entry whose source is `none` is a value the system delivered and cannot point
  // at. Those, and only those, count against this figure.
  const confFields = confidence?.fields ?? {};
  const scored = Object.values(confFields);
  const traceable = scored.filter((e) => e && e.source && e.source !== 'none');
  const provenance = scored.length ? traceable.length / scored.length : null;
  const bySource = {};
  for (const e of scored) bySource[e?.source ?? 'none'] = (bySource[e?.source ?? 'none'] ?? 0) + 1;
  const precision = verifiable ? right / verifiable : null;
  const attribution = derivations.length ? attributed.length / derivations.length : 1;
  return {
    derivations_total: derivations.length,
    fills: fills.length,
    fills_verifiable: verifiable, fills_correct: right,
    fills_unverifiable: unverifiable, fills_non_scalar: nonScalar, fills_unplaceable_row: unplaceable,
    precision,
    recall, recall_rows: recallRows,
    attribution,
    provenance, delivered_values: scored.length, traceable_values: traceable.length, by_source: bySource,
    wrong_fills: wrongFills.slice(0, 6),
    score: 0.45 * (precision == null ? 1 : precision) + 0.35 * (recall == null ? 1 : recall)
         + 0.20 * (provenance == null ? attribution : provenance),
  };
}

// ---------------------------------------------------------------------------------------------
// L4  Conformance
// ---------------------------------------------------------------------------------------------
const DATE_OK = /^\d{2}\/\d{2}\/\d{4}$/;

/**
 * Does the output obey the contract? Three parts.
 *   schema      every section the answer key defines is present, and nothing extra is invented
 *   format      dates and numbers in the shape the contract promises
 *   rules       a plain-English instruction changed what it was told to change, and NOTHING ELSE.
 *               The second half is scope containment, and it is the failure mode nobody measures:
 *               a rule that fixes one field and quietly rewrites a neighbour has done damage that
 *               a per-field accuracy score will happily call an improvement.
 */
/**
 * A section name in a field listing can carry a description after the name ("Freight Shipments -
 * <what the section holds>"), while a system emits the key alone, "Freight Shipments". Comparing the
 * two strings verbatim would report the section as BOTH missing and extra, on every document of that
 * type, when the section is present and correctly named.
 *
 * That is a matter of how a listing names a section, not a schema break. Names are therefore reduced
 * to their key before comparison: everything from the first " - " onward is dropped, as is a trailing
 * parenthetical qualifier such as "Buyer (Client)".
 */
const sectionKey = (name) => String(name)
  .split(/\s+[-–—]\s+/)[0]
  .replace(/\s*\([^)]*\)\s*$/, '')
  .trim()
  .toLowerCase();

// Contracted sections that the answer key deliberately does not carry. Barcodes is scored at Read
// rather than as fields, so its presence in the output is correct and is not an invented section.
const CONTRACTED_EXTRA = new Set(['barcodes', 'extra_fields_array']);

export function scoreConformance({ gt, output, rulePack = null, baseline = null, impact = null, rules: R = RULES, contract = null }) {
  const gtSections = Object.keys(gt ?? {});
  const outSections = Object.keys(output ?? {});
  const outKeys = new Set(outSections.map(sectionKey));
  const gtKeys = new Set(gtSections.map(sectionKey));
  const missingSections = gtSections.filter((s) => !outKeys.has(sectionKey(s)));
  const extraSections = outSections.filter((s) => !gtKeys.has(sectionKey(s)) && !CONTRACTED_EXTRA.has(sectionKey(s)));

  // Conformance has to be separated from capture or the same failure is counted twice. When the
  // system omits `Buyer.VAT No` on a document whose answer key holds a VAT number, that is a value
  // it failed to find, and Capture already records it as missing. Charging Comply for it as well
  // would penalise one defect in two places and make the two dimensions move together.
  //
  // What is measured here is the part Capture has no opinion about:
  //
  //   shape       every contracted section present, carrying the container it was defined with.
  //               An array that arrives as an object breaks every consumer downstream even when
  //               every value inside it is correct.
  //   emit-empty  of the contracted keys whose answer-key value is EMPTY, how many the system still
  //               emits, empty, rather than dropping. There is nothing to capture on those keys, so
  //               this is pure contract behaviour. It is also what actually breaks integrations: a
  //               consumer expecting a field to exist and receiving undefined rather than "".
  //   no invention every section in the output is one the contract defines.
  //
  // Documents whose answer key defines no schema, the facts-mode types whose templates are too open
  // to enumerate, are not scoreable here and return null rather than a perfect score.
  const shapeOf = (v) => Array.isArray(v) ? 'array' : (v && typeof v === 'object') ? 'object' : 'scalar';
  const outBySection = {};
  for (const k of outSections) outBySection[sectionKey(k)] = output[k];

  let keysDefined = 0, keysConforming = 0;
  const keyBreaks = [];
  const scoreable = gtSections.length > 0;

  // AGAINST THE CONTRACT (contractFromSchema). The reference is the published output contract of
  // the document type, contract.json beside the answer keys, never the answer key's own
  // structure: a section the contract names differently from the key, or that the key does not carry,
  // is checked as the contract defines it. Three checks, as below:
  //   shape       each contracted section present, in the contract's container shape;
  //   emit-empty  each contracted field emitted, on an object or on the first row of a list the system
  //               returned, unless the answer key holds a value there (then it is Capture's);
  //   no invention every section the system returned is one the published format allows.
  // The document still needs an answer key to be scoreable here (a facts-mode document has none).
  const useContract = !!(R.contractFromSchema && contract?.sections?.length && scoreable);
  if (useContract) {
    const gtBySection = {};
    for (const k of gtSections) gtBySection[sectionKey(k)] = gt[k];
    const allowed = new Set((contract.allowed ?? []).map(sectionKey));
    for (const sec of contract.sections) {
      const key = sectionKey(sec.name);
      const oval = outBySection[key];
      keysDefined++;
      if (oval === undefined) { keyBreaks.push({ path: sec.name, why: 'contracted section absent' }); continue; }
      const oShape = shapeOf(oval);
      const shapeOk = oShape === sec.shape || (sec.shape === 'array' && oShape === 'object') || (sec.shape === 'object' && Array.isArray(oval) && oval.length <= 1);
      if (!shapeOk) { keyBreaks.push({ path: sec.name, why: `shape ${sec.shape} returned as ${oShape}` }); continue; }
      keysConforming++;
      const oInner = Array.isArray(oval) ? (oval[0] ?? null) : oval;
      if (!oInner || typeof oInner !== 'object' || Array.isArray(oInner)) continue;   // no row to carry the fields
      const gval = gtBySection[key];
      const gInner = Array.isArray(gval) ? (gval[0] ?? null) : gval;
      for (const f of sec.fields) {
        if (gInner && typeof gInner === 'object' && !isEmpty(gInner[f])) continue;     // Capture's to count
        keysDefined++;
        if (f in oInner) keysConforming++;
        else keyBreaks.push({ path: `${sec.name}.${f}`, why: 'contracted field dropped instead of emitted empty' });
      }
    }
    for (const k of outSections) {
      if (allowed.has(sectionKey(k)) || CONTRACTED_EXTRA.has(sectionKey(k))) continue;
      keysDefined++; keyBreaks.push({ path: k, why: 'section not in the contract' });
    }
  } else if (scoreable) {
    for (const gsec of gtSections) {
      const gval = gt[gsec];
      const oval = outBySection[sectionKey(gsec)];
      keysDefined++;
      if (oval === undefined) { keyBreaks.push({ path: gsec, why: 'contracted section absent' }); continue; }

      // A repeating section holding exactly one entry is rendered by the generator as a bare object
      // while the system emits it as a one-element array, and several of those sections say so in
      // their own contract name: "Freight Shipments - Array of shipment objects", "Tax - Array of
      // tax breakdown objects", "Timekeeper (at least one entry is required)". The contract calls
      // for an array, the system produces an array, and the answer key holds an object. Scoring that
      // as a shape break charges the system for being right, so a bare object and a one-element
      // array carrying the same content are treated as the same contracted shape.
      const bothWaysArray = (a, b) => {
        if (shapeOf(a) === shapeOf(b)) return true;
        const one = Array.isArray(a) ? a : (Array.isArray(b) ? b : null);
        const other = Array.isArray(a) ? b : (Array.isArray(b) ? a : null);
        return !!(one && other && typeof other === 'object' && !Array.isArray(other) && one.length <= 1);
      };
      if (!bothWaysArray(gval, oval)) { keyBreaks.push({ path: gsec, why: `shape ${shapeOf(gval)} became ${shapeOf(oval)}` }); continue; }
      keysConforming++;

      const gInner = Array.isArray(gval) ? (gval[0] ?? null) : gval;
      const oInner = Array.isArray(oval) ? (oval[0] ?? null) : oval;
      if (!gInner || typeof gInner !== 'object' || Array.isArray(gInner)) continue;
      for (const gk of Object.keys(gInner)) {
        // Only keys the answer key leaves empty. Populated keys belong to Capture.
        if (!isEmpty(gInner[gk])) continue;
        keysDefined++;
        if (oInner && typeof oInner === 'object' && gk in oInner) keysConforming++;
        else keyBreaks.push({ path: `${gsec}.${gk}`, why: 'contracted key dropped instead of emitted empty' });
      }
    }
    for (const x of extraSections) { keysDefined++; keyBreaks.push({ path: x, why: 'section not in the contract' }); }
  }

  const schema = scoreable && keysDefined ? keysConforming / keysDefined : null;

  // Format conformance, checked only where the answer key itself is in the contracted format and the
  // system returned something (an empty value is Completeness's to count, not the contract's).
  //   dates    the contract's form is DD/MM/YYYY. A date returned as 22.02.2026 meant the right day,
  //            which Normalisation credits, and broke the contract, which is charged here and only here.
  //   numbers  the contract's form is a plain number (contractPooled): digits, an optional minus and an
  //            optional decimal point. 1.234,56 or "EUR 1234.56" means the right amount and is not one.
  let fmtTotal = 0, fmtOk = 0, numTotal = 0, numOk = 0;
  const fmtBreaks = [];
  const walk = (g, o, path = '') => {
    if (g == null || typeof g !== 'object') return;
    if (Array.isArray(g)) { g.forEach((v, i) => walk(v, Array.isArray(o) ? o[i] : undefined, `${path}.${i}`)); return; }
    for (const k of Object.keys(g)) {
      const gv = g[k], ov = o?.[k];
      if (gv && typeof gv === 'object') { walk(gv, ov, path ? `${path}.${k}` : k); continue; }
      if (isEmpty(gv) || isEmpty(ov)) continue;
      if (DATE_OK.test(String(gv))) {
        fmtTotal++;
        if (DATE_OK.test(String(ov))) fmtOk++;
        else if (fmtBreaks.length < 8) fmtBreaks.push({ path: path ? `${path}.${k}` : k, out: ov, why: 'date not DD/MM/YYYY' });
      } else if (R.contractPooled && fieldKind(gv, k) === 'number') {
        numTotal++;
        if (isPlainNumber(ov)) numOk++;
        else if (fmtBreaks.length < 8) fmtBreaks.push({ path: path ? `${path}.${k}` : k, out: ov, why: 'number not a plain number' });
      }
    }
  };
  walk(gt, output);
  const format = fmtTotal ? fmtOk / fmtTotal : 1;

  // rule adherence and scope containment, when a rule pack was applied on this document
  let rules = null;
  if (rulePack && baseline) {
    const get = (obj, p) => String(p).split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
    const targets = rulePack.expect ?? {};
    const adhered = Object.entries(targets).map(([p, want]) => {
      const got = get(output, p);
      const a = normNum(want), b = normNum(got);
      const ok = (a != null && b != null) ? a === b : squash(want) === squash(got);
      return { path: p, want, got: got ?? '', ok };
    });
    // collateral damage: any field that changed against the no-rule baseline and was NOT a target
    const flat = (obj, pre = '', out = {}) => {
      if (obj == null || typeof obj !== 'object') { out[pre] = obj; return out; }
      if (Array.isArray(obj)) { obj.forEach((v, i) => flat(v, `${pre}.${i}`, out)); return out; }
      for (const k of Object.keys(obj)) flat(obj[k], pre ? `${pre}.${k}` : k, out);
      return out;
    };
    const fb = flat(baseline), fo = flat(output);
    const targetPaths = new Set(Object.keys(targets));
    const allowed = new Set(rulePack.may_also_change ?? []);
    // Excluded from collateral for the same reasons they are excluded from Layer 2 field verdicts:
    // the Barcodes section is scored separately at Layer 0, and Payment Details Description is a
    // free-text catch-all legitimately filled from surrounding content. Both drift between two runs
    // of the SAME document with no instruction attached, so counting them here would charge the rule
    // engine for ordinary run-to-run variation. The stability axis measures that variation directly.
    const NOISE = (k) => /^Barcodes\./.test(k) || /Payment Details Description$/.test(k);
    const collateral = [];
    for (const k of new Set([...Object.keys(fb), ...Object.keys(fo)])) {
      if (targetPaths.has(k) || allowed.has(k) || NOISE(k)) continue;
      const a = fb[k], b = fo[k];
      if (isEmpty(a) && isEmpty(b)) continue;
      if (squash(a) !== squash(b)) collateral.push({ path: k, was: a ?? '', now: b ?? '' });
    }
    const touched = Object.keys(fb).length || 1;
    rules = {
      id: rulePack.id,
      adherence: adhered.length ? adhered.filter((a) => a.ok).length / adhered.length : 1,
      adhered,
      collateral_count: collateral.length,
      containment: 1 - Math.min(1, collateral.length / touched),
      collateral: collateral.slice(0, 8),
      reported_changes: impact?.changed_fields ?? null,
      // every change a rule makes must appear in the impact report, or it is unauditable
      auditable: impact ? (impact.changed_fields ?? 0) >= adhered.filter((a) => a.ok).length : null,
    };
  }

  const parts = [schema, format].filter((x) => x != null);
  if (rules) parts.push(rules.adherence, rules.containment);
  // Contract, the one score-bearing measure of this stage: every schema check and every format check
  // counted once, pooled. A document with no checks contributes nothing rather than a free pass.
  const checks = (scoreable ? keysDefined : 0) + fmtTotal + numTotal;
  const passed = (scoreable ? keysConforming : 0) + fmtOk + numOk;
  return {
    contract_reference: useContract ? 'contract' : 'answer key',
    schema, keys_defined: keysDefined, keys_conforming: keysConforming, key_breaks: keyBreaks.slice(0, 8),
    missing_sections: missingSections, extra_sections: extraSections,
    format, format_checked: fmtTotal, format_ok: fmtOk,
    number_format_checked: numTotal, number_format_ok: numOk, format_breaks: fmtBreaks,
    contract_checks: checks, contract_passed: passed, contract: checks ? passed / checks : null,
    rules,
    score: parts.reduce((a, b) => a + b, 0) / parts.length,
  };
}

// ---------------------------------------------------------------------------------------------
// L5  Trust
// ---------------------------------------------------------------------------------------------
/**
 * The layer that turns everything below it into money.
 *
 * Every document lands in exactly one cell of a two-by-two: did it contain an error, and did the
 * system raise a flag about it.
 *
 *                       no flag raised          flag raised
 *   no error            STRAIGHT THROUGH        false alarm
 *   has error           ESCAPED  <-- the one that costs money
 *
 * Straight-through rate is the top-left cell. Escaped error rate is the bottom-left. They are
 * reported as a pair because either one alone can be gamed: flag everything and escapes go to zero
 * while nothing goes straight through; flag nothing and the reverse.
 */
export function scoreTrust({ captureAgg, structure, derived, expectedFlags = [], isCleanControl = false, errorBudget, scorable = true, routed = null, rules: R = RULES }) {
  const derivations = derived?.derivations ?? [];
  const flags = derivations.filter((d) => d.kind === 'mismatch');
  const flagged = flags.length > 0;
  // What counts as surfacing the document. Under routedEscalation it is the platform's own decision to
  // send the document to a person (`routed`, see reviewDecision in scoring.mjs); a flag raised somewhere
  // inside a document that was then passed straight through reached nobody.
  const surfaced = R.routedEscalation ? routed === true : flagged;
  // Under routedEscalation a document whose evidence carries no decision (routed null) has no cell: it was neither
  // caught nor escaped, because the evidence does not say whether it reached a person.
  const decided = !R.routedEscalation || typeof routed === 'boolean';

  const E = errorBudget ?? defaultErrorBudget;
  const errors = E({ captureAgg, structure });
  const hasError = errors.count > 0;

  const endsWith = (d, p) => String(d.field_path || '').endsWith(p);
  const recallRows = expectedFlags.map((e) => ({ path: e.path, hit: flags.some((d) => endsWith(d, e.path)) }));

  // Verification coverage: did any deterministic check run on this document at all? A system that
  // never checks itself cannot catch anything, and most systems in this category never check.
  const verified = derivations.length > 0;

  const cellOf = (s) => (!hasError && !s ? 'straight_through' : !hasError && s ? 'false_alarm' : hasError && s ? 'caught' : 'escaped');
  return {
    flags_raised: flags.length,
    verified,
    flagged,
    routed,
    surfaced: decided ? surfaced : null,
    errors: errors.count, error_detail: errors.detail,
    has_error: hasError,
    cell: decided ? cellOf(surfaced) : null,
    cell_flag: decided ? cellOf(flagged) : null,
    planted_flags: expectedFlags.length,
    planted_flags_hit: recallRows.filter((r) => r.hit).length,
    planted_rows: recallRows,
    clean_control: isCleanControl,
    // A false alarm is a flag raised on a document that is actually correct. A flag on a document
    // that really does contain an error is the system working, whether or not the flag names the
    // same field, so it is not counted here.
    false_flag: decided ? !hasError && surfaced : null,
    // Documents scored in facts mode have no field verdicts, so no error count can be formed for
    // them and they are excluded from the Layer 5 population rather than silently counted as clean.
    scorable,
  };
}

/**
 * The error budget E, fixed in advance so that the straight-through number cannot be tuned after
 * the fact. A document is clean when every answer-key value was captured and matches after locale
 * normalization, nothing was invented, and the row count is exact.
 */
export function defaultErrorBudget({ captureAgg, structure }) {
  const detail = {
    wrong: captureAgg?.wrong ?? 0,
    missing: captureAgg?.missing ?? 0,
    spurious: captureAgg?.spurious ?? 0,
    row_count: structure && structure.gt_rows ? (structure.count_exact ? 0 : 1) : 0,
    misclassified: structure && structure.category_ok === false ? 1 : 0,
  };
  return { count: Object.values(detail).reduce((a, b) => a + b, 0), detail };
}

// ---------------------------------------------------------------------------------------------
// Stability axis
// ---------------------------------------------------------------------------------------------
/** Same document, run more than once. Byte-identical is the only clean pass; anything else is drift. */
export function scoreStability(outputs) {
  if (!outputs || outputs.length < 2) return null;
  const ser = outputs.map((o) => JSON.stringify(o));
  const identical = ser.every((s) => s === ser[0]);
  const flat = (obj, pre = '', out = {}) => {
    if (obj == null || typeof obj !== 'object') { out[pre] = obj === undefined ? '' : obj; return out; }
    if (Array.isArray(obj)) { obj.forEach((v, i) => flat(v, `${pre}.${i}`, out)); return out; }
    for (const k of Object.keys(obj)) flat(obj[k], pre ? `${pre}.${k}` : k, out);
    return out;
  };
  const maps = outputs.map((o) => flat(o));
  const paths = new Set(maps.flatMap((m) => Object.keys(m)));
  let drifted = 0;
  const examples = [];
  for (const p of paths) {
    const vals = new Set(maps.map((m) => JSON.stringify(m[p] ?? '')));
    if (vals.size > 1) { drifted++; if (examples.length < 6) examples.push({ path: p, values: [...vals].slice(0, 3) }); }
  }
  return {
    runs: outputs.length, byte_identical: identical,
    fields_compared: paths.size, fields_drifted: drifted,
    field_stability: paths.size ? 1 - drifted / paths.size : 1,
    examples,
  };
}
