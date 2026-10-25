// Ground-truth scorer. Field mode: per-field verdicts against the schema-exact GT. Fact mode: each
// rendered fact's value deep-searched in the output. Locale-aware normalization throughout.
//
// Verdicts: correct | normalized | wrong | missing (GT populated, output empty) | spurious (GT empty,
// output populated = hallucination). Sections excluded from field scoring: Barcodes (captured
// separately), plus any GT section that is entirely empty AND output empty.
//
// How a value is compared depends on what kind of value the answer key holds (fieldKind below):
//
//   number      a quantity, a rate or an amount of money. Passes only when the returned value parses,
//               locale-aware, to exactly the key's number: same sign, same magnitude. 24.60336 against
//               24603.36 fails, and so does -12.50 against 12.50. No digits-only comparison applies.
//   date        passes when it is the same calendar date, whatever its separators.
//   identifier  a value the key holds as digits but which is a code rather than a quantity: document
//               numbers, line numbers, postal codes, account and VAT numbers, article codes. Compared as
//               text, where the digits-only comparison is legitimate, because 4006-381-333931 and
//               4006381333931 name the same article.
//   text        everything else, compared after case, whitespace and punctuation are smoothed away.
import { RULES } from './rules.mjs';

const SKIP_SECTIONS = new Set(['Barcodes']);
// Free-text catch-all fields: legitimately filled from surrounding content, so neither their absence
// nor their presence is signal; excluded from verdicts.
const SKIP_FIELDS = new Set(['Payment Details Description']);

export const normStr = (v) => String(v ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:!'"()’´`]+$/g, '').trim();
const squash = (v) => normStr(v).replace(/[^a-z0-9-￿]+/g, '');

export function normNum(v) {
  let s = String(v ?? '').trim().replace(/[^\d.,\-']/g, '');
  if (!s || !/\d/.test(s)) return null;
  s = s.replace(/'/g, ''); // Swiss thousands
  const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
    else s = s.replace(/,/g, ''); // 1,234.56
  } else if (lastComma >= 0) {
    const frac = s.length - lastComma - 1;
    s = frac === 3 && (s.match(/,/g) || []).length >= 1 && s.length > 4 ? s.replace(/,/g, '') : s.replace(/,/g, '.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function normDate(v) {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return `${m[3].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[1]}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`;
  m = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (m) return `${m[3].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[1]}`;
  return null;
}

// Minus signs other than the ASCII hyphen that a document or a system may use for a negative number.
const MINUS_SIGNS = new RegExp(`[${String.fromCodePoint(0x2212, 0xfe63, 0xff0d)}]`, 'g');

/**
 * The number a value carries, parsed exactly and locale-aware. Unlike normNum it never rounds: the
 * question it answers is "is this the same number", and 24.60336 is not 24.60.
 *
 * Accepted: thousands separators of every convention in the corpus (1,234.56  1.234,56  1'234.56
 * 1 234,56), currency symbols and codes, a leading or trailing minus, and an accounting negative in
 * parentheses. A hyphen inside the digits (a range, a date, a code) is not a number and returns null.
 */
export function parseNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? (v === 0 ? 0 : v) : null;
  let s = String(v ?? '').replace(MINUS_SIGNS, '-').trim();
  if (!s || !/\d/.test(s)) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[^\d.,'\-]/g, '');                   // letters, currency, whitespace, symbols
  s = s.replace(/'/g, '');                            // Swiss thousands
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  else if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  if (!s || s.includes('-')) return null;
  const dots = (s.match(/\./g) ?? []).length, commas = (s.match(/,/g) ?? []).length;
  if (dots && commas) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (commas > 1) {
    s = s.replace(/,/g, '');                          // 1,234,567
  } else if (commas === 1) {
    const frac = s.length - s.indexOf(',') - 1;
    s = frac === 3 && s.length > 4 && !s.startsWith('0,') ? s.replace(',', '') : s.replace(',', '.');
  } else if (dots > 1) {
    s = s.replace(/\./g, '');                         // 1.234.567
  }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n === 0 ? 0 : (neg ? -n : n);
}

/** A value delivered as a plain machine-readable number: a JSON number, or digits with an optional
 *  leading minus and an optional decimal point. No separators, no currency, no units. */
export const isPlainNumber = (v) => (typeof v === 'number'
  ? Number.isFinite(v)
  : /^-?\d+(\.\d+)?$/.test(String(v ?? '').trim()));

/**
 * Does this field hold an identifier or a code rather than a quantity? Decided by the field's own
 * name: a field whose name contains one of these words names a thing rather than measuring it. These
 * are the only fields where a digits-only comparison may pass a value.
 *
 * In the answer keys this covers, among the fields that hold digits: Item No and Order Number on a
 * line (line positions), Postal Code, VAT No, and every document, reference, account and article
 * number. The numeric fields it leaves are Quantity, Unit Price, Net Amount, Tax Amount, Total Tax,
 * Total Amount, Tax Rate, tax_total, rate and every other amount, rate or count.
 */
const IDENTIFIER_WORDS = new Set([
  'no', 'nr', 'number', 'num', 'id', 'code', 'postal', 'zip', 'postcode', 'phone', 'telephone', 'tel', 'fax',
  'iban', 'bic', 'swift', 'account', 'reference', 'ref', 'vat', 'gln', 'ean', 'gtin', 'upc', 'sku', 'lot',
  'serial', 'batch', 'tracking', 'registration', 'cuit', 'cae',
]);
export function isIdentifierField(leaf) {
  return String(leaf ?? '').toLowerCase().split(/[^a-z0-9]+/).some((w) => IDENTIFIER_WORDS.has(w));
}

/**
 * The kind of value an answer-key value is: 'date', 'number', 'identifier' or 'text'. `leaf` is the
 * field's name, which separates a number from an identifier that happens to be written in digits.
 */
export function fieldKind(gtValue, leaf = '') {
  const s = String(gtValue ?? '').trim();
  if (!s) return null;
  if (normDate(s)) return 'date';
  // A letter of any script makes it text: "مبنى 12" is an address and "お支払いは30日以内" a payment term,
  // even though stripping their letters would leave a number behind.
  if (!/\p{L}/u.test(s) && parseNumber(s) != null) return isIdentifierField(leaf) ? 'identifier' : 'number';
  return 'text';
}

function valuesEqual(gt, out, leaf = '', rules = RULES) {
  const g = String(gt ?? '').trim(), o = String(out ?? '').trim();
  if (g === o) return 'correct';
  if (rules.exactNumbers && fieldKind(g, leaf) === 'number') {
    const gn = parseNumber(g), on = parseNumber(o);
    return gn != null && on != null && gn === on ? 'normalized' : 'wrong';
  }
  const gn = normNum(g), on = normNum(o);
  if (gn != null && on != null && /\d/.test(g) && /\d/.test(o) && !/[a-z]{3,}/i.test(g)) {
    if (gn === on) return 'normalized';
  }
  const gd = normDate(g), od = normDate(o);
  if (gd && od) return gd === od ? 'normalized' : 'wrong';
  if (normStr(g) === normStr(o)) return 'normalized';
  if (squash(g) && squash(g) === squash(o)) return 'normalized';
  return 'wrong';
}

const isEmpty = (v) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

function flatten(obj, prefix = '', out = {}) {
  if (obj === null || typeof obj !== 'object') { out[prefix] = obj; return out; }
  if (Array.isArray(obj)) { obj.forEach((v, i) => flatten(v, `${prefix}.${i}`, out)); if (!obj.length) out[prefix] = []; return out; }
  for (const k of Object.keys(obj)) flatten(obj[k], prefix ? `${prefix}.${k}` : k, out);
  return out;
}

/** Align GT items to output items: by exact/normalized Article-ish id or name, else by index. */
function alignItems(gtItems, outItems) {
  const keyOf = (it) => squash(it?.['Article ID'] || '') + '|' + squash(it?.['Article Name'] || it?.['Description'] || '');
  const used = new Set();
  return gtItems.map((g, gi) => {
    const gk = keyOf(g);
    let idx = -1;
    if (gk !== '|') idx = outItems.findIndex((o, oi) => !used.has(oi) && keyOf(o) === gk);
    if (idx < 0) idx = !used.has(gi) && gi < outItems.length ? gi : -1;
    if (idx >= 0) used.add(idx);
    return [g, idx >= 0 ? outItems[idx] : null];
  });
}

export function scoreFields(gt, output, rules = RULES) {
  const verdicts = []; // {path, verdict, gt, out}
  for (const sec of Object.keys(gt)) {
    if (SKIP_SECTIONS.has(sec)) continue;
    const g = gt[sec]; const o = output?.[sec];
    if (Array.isArray(g)) {
      const outArr = Array.isArray(o) ? o : [];
      if (g.length || outArr.length) verdicts.push({ path: `${sec}.count`, verdict: g.length === outArr.length ? 'correct' : 'wrong', gt: String(g.length), out: String(outArr.length) });
      for (const [gi, [gRow, oRow]] of alignItems(g, outArr).entries()) {
        for (const f of Object.keys(gRow)) {
          const gv = gRow[f]; const ov = oRow?.[f];
          if (isEmpty(gv) && isEmpty(ov)) continue;
          let verdict;
          if (isEmpty(gv)) verdict = 'spurious';
          else if (isEmpty(ov) || oRow == null) verdict = 'missing';
          else verdict = valuesEqual(gv, ov, f, rules);
          verdicts.push({ path: `${sec}.${gi}.${f}`, verdict, gt: gv, out: ov ?? '' });
        }
      }
      continue;
    }
    if (g && typeof g === 'object') {
      for (const f of Object.keys(g)) {
        if (SKIP_FIELDS.has(f)) continue;
        const gv = g[f]; const ov = o?.[f];
        const gEmpty = isEmpty(gv), oEmpty = isEmpty(ov);
        if (gEmpty && oEmpty) continue;
        let verdict;
        if (Array.isArray(gv) || (gv && typeof gv === 'object')) {
          // nested structures (Payment Methods, Tax): compare flattened value sets leniently. Values
          // (numbers/codes) carry the signal; labels like payment_method wording vary legitimately.
          // A numeric value inside them (a tax rate, a tax total) is found only by its exact number.
          const gl = Object.entries(flatten(gv)).filter(([, x]) => !isEmpty(x));
          const ol = Object.values(flatten(ov ?? {})).filter((x) => !isEmpty(x));
          const gf = gl.map(([, x]) => squash(x));
          const of_ = ol.map(squash);
          if (!gf.length && !of_.length) continue;
          const oNums = rules.exactNumbers ? ol.map(parseNumber).filter((n) => n != null) : [];
          const found = ([p, x], i) => (rules.exactNumbers && fieldKind(x, p.split('.').pop()) === 'number'
            ? oNums.includes(parseNumber(x))
            : of_.includes(gf[i]));
          const hit = gl.filter(found).length;
          const ratio = gf.length ? hit / gf.length : 0;
          verdict = gf.length === 0 ? 'spurious' : ratio === 1 ? 'correct' : ratio >= 0.67 ? 'normalized' : hit > 0 ? 'wrong' : (of_.length ? 'wrong' : 'missing');
        } else if (gEmpty) verdict = 'spurious';
        else if (oEmpty) verdict = 'missing';
        else verdict = valuesEqual(gv, ov, f, rules);
        verdicts.push({ path: `${sec}.${f}`, verdict, gt: gv, out: ov ?? '' });
      }
    }
  }
  return verdicts;
}

/** Fact mode: each fact's value must appear somewhere in the output (deep search, normalized). A
 *  numeric fact (an amount, a balance, a total) is found only where a delivered value parses to
 *  exactly the same number; digits merely contained in a longer value do not count. */
export function scoreFacts(facts, output, rules = RULES) {
  const leaves = Object.values(flatten(output ?? {})).filter((v) => !isEmpty(v));
  const leafSquash = leaves.map((v) => squash(v));
  const leafNums = leaves.map((v) => normNum(v)).filter((n) => n != null);
  const leafDates = leaves.map((v) => normDate(v)).filter(Boolean);
  const leafExact = rules.exactNumbers ? leaves.map((v) => parseNumber(v)).filter((n) => n != null) : [];
  return (facts ?? []).map((f) => {
    const v = String(f.value);
    if (rules.exactNumbers && fieldKind(v, f.label) === 'number') {
      const n = parseNumber(v);
      return { label: f.label, value: f.value, soft: !!f.soft, hit: n != null && leafExact.includes(n) };
    }
    const sq = squash(v);
    let hit = sq && leafSquash.some((l) => l === sq || (sq.length >= 6 && l.includes(sq)));
    if (!hit) { const n = normNum(v); if (n != null && /^\s*[\d.,'\s-]+\s*$/.test(v)) hit = leafNums.includes(n); }
    if (!hit) { const d = normDate(v); if (d) hit = leafDates.includes(d); }
    return { label: f.label, value: f.value, soft: !!f.soft, hit };
  });
}

export function scoreFlags(expectedFlags, expectedDerived, derivedFields) {
  const derivations = derivedFields?.derivations ?? [];
  const has = (path, kind) => derivations.some((d) => d.kind === kind && String(d.field_path || '').endsWith(path));
  const flagRecall = expectedFlags.map((f) => ({ ...f, hit: has(f.path, 'mismatch') }));
  const deriveRecall = expectedDerived.map((f) => ({ ...f, hit: has(f.path, 'derived') }));
  return { flagRecall, deriveRecall, flaggedCount: derivedFields?.flagged_count ?? 0, derivedCount: derivedFields?.derived_count ?? 0 };
}

/**
 * Confidence calibration: join the extraction's field_confidence report against the GT verdicts.
 * A tier is CALIBRATED when its empirical precision matches its promise (the 'high' tier must be
 * overwhelmingly correct). verdicts with empty output (missing) have no confidence entry and are skipped;
 * spurious outputs (GT empty, output filled) count as incorrect: they are exactly the hallucinations the
 * confidence layer should be wary of.
 */
export function reliability(verdicts, fieldConfidence) {
  const fields = fieldConfidence?.fields ?? {};
  const out = { joined: 0, tiers: { high: { n: 0, correct: 0 }, medium: { n: 0, correct: 0 }, low: { n: 0, correct: 0 } }, misranked_high: [] };
  for (const v of verdicts) {
    if (v.verdict === 'missing' || /\.count$/.test(v.path)) continue;
    const ev = fields[v.path];
    if (!ev) continue;
    const ok = v.verdict === 'correct' || v.verdict === 'normalized';
    const t = out.tiers[ev.tier] ?? (out.tiers[ev.tier] = { n: 0, correct: 0 });
    t.n++;
    if (ok) t.correct++;
    out.joined++;
    if (!ok && ev.tier === 'high') out.misranked_high.push({ path: v.path, c: ev.c, gt: v.gt, out: v.out, verdict: v.verdict });
  }
  out.misranked_high = out.misranked_high.slice(0, 8);
  return out.joined ? out : null;
}

export function aggregate(verdicts) {
  const c = { correct: 0, normalized: 0, wrong: 0, missing: 0, spurious: 0 };
  for (const v of verdicts) c[v.verdict]++;
  const gtPopulated = c.correct + c.normalized + c.wrong + c.missing;
  const captured = c.correct + c.normalized + c.wrong;
  return {
    ...c,
    gt_populated: gtPopulated,
    completeness: gtPopulated ? (captured / gtPopulated) : 1,
    correctness: captured ? ((c.correct + c.normalized) / captured) : 1,
    hallucination: (captured + c.spurious) ? (c.spurious / (captured + c.spurious)) : 0,
  };
}
