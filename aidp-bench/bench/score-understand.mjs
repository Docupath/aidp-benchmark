/**
 * Layer 3, Understand: the scorer for the work an agentic system does with the world's conventions
 * rather than with the page or with the customer's instructions.
 *
 * The layer exists because a value can be read perfectly off the page and still be wrong, or right
 * but unusable, and no capture metric can see the difference. `05/04/2026` read faithfully off a US
 * invoice is the fourth of May; delivered as the fifth of April it is a different date, correctly
 * formatted. `7.761,00` read faithfully off a German invoice is seven thousand; delivered as 7.761
 * it is off by a factor of a thousand. "Germany" is printed on the page and `DE` never is, so a
 * country code is not a reading at all: it is knowledge applied to a reading.
 *
 * Every measure here is computed offline from evidence a run already collected, and three of the six
 * need no answer key at all, which means any system can be scored on them without the corpus.
 *
 *   Normalisation  was the value delivered in canonical form
 *   Parsing        was a compound value separated into the fields that hold its parts
 *   Decoding       were standards-bearing strings interpreted rather than passed through raw
 *   Consistency    does the delivered document agree with its own arithmetic
 *
 * Computation and Attribution are scored in scoreInference() and are not repeated here.
 */
import { normStr, normNum, normDate, parseNumber, fieldKind } from './base-score.mjs';
import { RULES } from './rules.mjs';

const squash = (v) => normStr(v).replace(/[^a-z0-9À-ÿ]+/g, '');
const digitsOf = (v) => String(v ?? '').replace(/\D/g, '');
const isEmpty = (v) => v == null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

/** Fields whose value is never printed on the page: knowledge applied to a reading, not a reading. */
const INFERRED_FIELDS = new Set(['Country Code', 'Currency Code']);

/**
 * Kind of value a ground-truth string is, which decides how its canonical form is judged. With exact
 * numbers on, the field's name is consulted too: a postal code or a line number written in digits is
 * an identifier, has no canonical numeric form, and is counted with text (see base-score.mjs).
 */
export function kindOf(gtValue, leaf = '', rules = RULES) {
  const s = String(gtValue ?? '').trim();
  if (!s) return null;
  if (rules.exactNumbers) {
    const k = fieldKind(s, leaf);
    return k === 'identifier' ? 'text' : k;
  }
  if (normDate(s)) return 'date';
  if (!/[A-Za-zÀ-ÿ]/.test(s) && normNum(s) != null) return 'number';
  return 'text';
}

/**
 * Does the returned value MEAN the same as the key, whatever its punctuation? The same calendar date,
 * or exactly the same number. This is the whole of what Normalisation asks: "22.02.2026" for
 * 22/02/2026 is understood, "02/22/2026" is not, and "1.234,56" for 1234.56 is understood while
 * "1.23456" is not.
 */
export function sameMeaning(kind, gtValue, outValue) {
  if (kind === 'date') {
    const g = normDate(String(gtValue ?? '').trim()), o = normDate(String(outValue ?? '').trim());
    return !!(g && o && g === o);
  }
  if (kind === 'number') {
    const g = parseNumber(gtValue), o = parseNumber(outValue);
    return g != null && o != null && g === o;
  }
  return false;
}

/**
 * Was the right content delivered in the wrong convention rather than misread?
 *
 * Two cases matter and they are the two the industry's field accuracy cannot separate. A date whose
 * three components are the same numbers in a different order was read correctly and converted
 * wrongly. A number whose digits are identical but whose value is not was read correctly and had its
 * separators misjudged. Both are normalisation failures wearing a reading failure's clothes.
 */
export function misconversion(gtValue, outValue, rules = RULES) {
  const g = String(gtValue ?? '').trim(), o = String(outValue ?? '').trim();
  if (!g || !o) return null;
  const gd = normDate(g), od = normDate(o);
  if (gd && od && gd !== od) {
    const parts = (x) => x.split('/').sort().join('/');
    if (parts(gd) === parts(od)) return 'date_order';
    return null;
  }
  const num = rules.exactNumbers ? parseNumber : normNum;
  const gn = num(g), on = num(o);
  if (gn != null && on != null && gn !== on && !/[A-Za-zÀ-ÿ]{3,}/.test(g)) {
    // Same characters read, different separator convention applied: 7761.00 delivered as 7.761 is a
    // thousand-fold error made by a reader that took "." for a decimal point. Compared on significant
    // digits, leading and trailing zeros stripped, because 7761.00 and 7.761 carry the same ones.
    // At least two significant digits are required, so that 100 against 1000 (both significant "1")
    // stays a reading failure rather than being laundered into a conversion failure.
    const sig = (x) => digitsOf(x).replace(/^0+/, '').replace(/0+$/, '');
    // Under conventionOnce a flipped sign is not a separator error: the digits are the key's, the
    // number is the negation, and no decimal or thousands convention explains it. It stays a plain
    // wrong value, Fidelity's to count, and outside Normalisation.
    if (rules.conventionOnce && Math.sign(gn) !== Math.sign(on)) return null;
    if (sig(g).length >= 2 && sig(g) === sig(o)) return 'number_separator';
  }
  return null;
}

/** Every populated leaf of the delivered output, as {path, value}. */
function outLeaves(obj, pre = '', out = []) {
  if (obj == null) return out;
  if (Array.isArray(obj)) { obj.forEach((v, i) => outLeaves(v, `${pre}.${i}`, out)); return out; }
  if (typeof obj === 'object') { for (const k of Object.keys(obj)) outLeaves(obj[k], pre ? `${pre}.${k}` : k, out); return out; }
  const s = String(obj);
  if (s.trim()) out.push({ path: pre, value: s });
  return out;
}

// -------------------------------------------------------------------------------------------------
// Normalisation
// -------------------------------------------------------------------------------------------------
/**
 * Of the values whose content the system got hold of, how many were delivered in canonical form?
 *
 * The denominator is deliberately not "every value". A value the system genuinely misread belongs to
 * Capture and is excluded here, because charging a reading failure to normalisation would make this
 * measure a second, blurrier copy of Fidelity. What is left is the population where the system had
 * the content and had only to write it down correctly.
 */
export function scoreNormalisation(verdicts, rules = RULES) {
  // understood: the value means what the key means, delivered in some other punctuation. With
  // normalisationByMeaning on these PASS, because the format they arrived in is Contract's to score,
  // and charging them here too would count one event twice. With it off they fail as non-canonical.
  const K = () => ({ canonical: 0, understood: 0, noncanonical: 0, misconverted: 0 });
  const kinds = { date: K(), number: K(), text: K() };
  const samples = [];
  for (const v of verdicts) {
    const kind = kindOf(v.gt, String(v.path).split('.').pop(), rules);
    if (!kind) continue;
    const bucket = kinds[kind];
    if (v.verdict === 'correct') { bucket.canonical++; continue; }
    if (v.verdict === 'normalized') {
      if (rules.normalisationByMeaning && sameMeaning(kind, v.gt, v.out)) { bucket.understood++; continue; }
      bucket.noncanonical++;
      if (samples.length < 40) samples.push({ path: v.path, gt: v.gt, out: v.out, why: 'non-canonical form' });
      continue;
    }
    if (v.verdict === 'wrong') {
      const mis = misconversion(v.gt, v.out, rules);
      if (mis) {
        bucket.misconverted++;
        if (samples.length < 40) samples.push({ path: v.path, gt: v.gt, out: v.out, why: mis });
      }
    }
  }
  const tot = (b) => b.canonical + b.understood + b.noncanonical + b.misconverted;
  const rate = (b) => (tot(b) ? (b.canonical + b.understood) / tot(b) : null);

  // Only dates and numbers carry a canonical form that a convention decides. Free text does not: a
  // description has no ISO form to be converted into, so a text value that matched only after case,
  // whitespace and punctuation were smoothed away is telling us about the comparison's tolerance,
  // not about the system's conversion. In this corpus those differences are things like "GSK- 04305"
  // against "GSK-04305", a space introduced beside a hyphen, which is a reading artefact and belongs
  // to Capture. Text is therefore counted and published as a diagnostic and kept out of the measure.
  const scoredKinds = ['date', 'number'];
  const all = K();
  for (const k of scoredKinds) for (const f of Object.keys(all)) all[f] += kinds[k][f];
  return {
    rate: rate(all), ...all, passed: all.canonical + all.understood, checked: tot(all),
    scored_kinds: scoredKinds,
    by_kind: Object.fromEntries(Object.entries(kinds).map(([k, b]) => [k, { rate: rate(b), passed: b.canonical + b.understood, checked: tot(b), scored: scoredKinds.includes(k), ...b }])),
    samples,
  };
}

/**
 * The fields the page never prints. A country code is not on a German invoice; "Germany" is, and
 * `DE` is what a downstream system needs. Scoring these separately is the cleanest evidence that a
 * system applies knowledge rather than transcribing, because there is nothing on the page to copy.
 */
export function scoreWorldKnowledge(verdicts) {
  const out = {};
  for (const v of verdicts) {
    const field = v.path.split('.').pop();
    if (!INFERRED_FIELDS.has(field)) continue;
    const b = out[field] || (out[field] = { correct: 0, wrong: 0, missing: 0 });
    if (v.verdict === 'correct' || v.verdict === 'normalized') b.correct++;
    else if (v.verdict === 'missing') b.missing++;
    else if (v.verdict === 'wrong') b.wrong++;
  }
  let c = 0, n = 0;
  for (const b of Object.values(out)) { c += b.correct; n += b.correct + b.wrong + b.missing; }
  for (const [k, b] of Object.entries(out)) { const d = b.correct + b.wrong + b.missing; out[k].rate = d ? b.correct / d : null; out[k].checked = d; }
  return { rate: n ? c / n : null, checked: n, correct: c, by_field: out };
}

// -------------------------------------------------------------------------------------------------
// Parsing
// -------------------------------------------------------------------------------------------------
/**
 * Was a compound value separated into the fields that hold its parts?
 *
 * The page prints "Berliner Allee 19, 70173 Stuttgart, Germany" on one line and the contract has four
 * fields under it. A system that returns the whole line in the street field and leaves city, postal
 * code and country empty has read the page perfectly and delivered something a downstream system
 * cannot use. Field accuracy scores that as one wrong value and three missing ones, which points an
 * engineering team at the wrong problem.
 *
 * Detection is deliberately conservative: a field counts as swallowed only when it is empty in the
 * output AND its ground-truth content appears inside a sibling field in the same section that also
 * carries its own content.
 */
export function scoreParsing(gt, output) {
  let populated = 0, swallowed = 0;
  const samples = [];
  const check = (gRow, oRow, where) => {
    if (!gRow || typeof gRow !== 'object' || !oRow || typeof oRow !== 'object') return;
    const fields = Object.keys(gRow).filter((f) => !isEmpty(gRow[f]) && typeof gRow[f] === 'string');
    for (const f of fields) {
      populated++;
      if (!isEmpty(oRow[f])) continue;                       // delivered in its own field
      const need = squash(gRow[f]);
      if (need.length < 3) continue;                          // too short to attribute safely
      for (const sib of fields) {
        if (sib === f || isEmpty(oRow[sib])) continue;
        const host = squash(oRow[sib]);
        if (host.includes(need) && host.includes(squash(gRow[sib])) && host.length > squash(gRow[sib]).length) {
          swallowed++;
          if (samples.length < 25) samples.push({ where, field: f, swallowed_into: sib, expected: gRow[f], delivered: oRow[sib] });
          break;
        }
      }
    }
  };
  for (const sec of Object.keys(gt || {})) {
    const g = gt[sec], o = output?.[sec];
    if (Array.isArray(g)) {
      const arr = Array.isArray(o) ? o : [];
      g.forEach((row, i) => check(row, arr[i], `${sec}.${i}`));
    } else check(g, o, sec);
  }
  return { rate: populated ? 1 - swallowed / populated : null, populated, swallowed, samples };
}

// -------------------------------------------------------------------------------------------------
// Decoding
// -------------------------------------------------------------------------------------------------
/** GS1 application-identifier syntax surviving into a delivered value: the payload was never read. */
const GS1_RESIDUE = /\(\s*(0[0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|90|91|92|93)\s*\)/;

/**
 * Were standards-bearing strings interpreted rather than passed through raw?
 *
 * A barcode that decoded gives a payload like `(01)07612345678904(10)LOT679114(21)281215`, and the
 * lot, expiry and serial inside it are what the document actually means. A system that puts the
 * payload, or a fragment of it, into a business field has decoded the symbol and not read it. The
 * residue is machine-detectable without an answer key, which makes this scoreable on any system.
 */
export function scoreDecoding(output) {
  // The Barcodes section is where the raw payload belongs, so a payload found there is the system
  // doing its job and is excluded. The measure is about payload syntax reaching a BUSINESS field: a
  // lot number, an article name, a price. Counting the barcode section would score correct behaviour
  // as a defect and would make the number meaningless.
  const all = outLeaves(output);
  const leaves = all.filter((l) => !/^Barcodes(\.|$)/.test(l.path));
  const bad = leaves.filter((l) => GS1_RESIDUE.test(l.value));
  return {
    rate: leaves.length ? 1 - bad.length / leaves.length : null,
    delivered: leaves.length, residue: bad.length,
    payload_fields_excluded: all.length - leaves.length,
    samples: bad.slice(0, 15),
  };
}

// -------------------------------------------------------------------------------------------------
// Consistency
// -------------------------------------------------------------------------------------------------
const near = (a, b) => Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 0.005);
const pick = (o, names) => { for (const n of names) if (o && !isEmpty(o[n])) return normNum(o[n]); return null; };

/**
 * Does the delivered document agree with its own arithmetic?
 *
 * This needs no answer key: quantity times unit price should be the line amount, and subtotal plus
 * tax should be the total, in whatever the system returned. It is the cheapest honest check in the
 * whole standard and almost nobody publishes it.
 *
 * A failed check is not automatically a defect of the system. Some documents genuinely do not add up,
 * and reproducing a printed inconsistency faithfully is correct behaviour. That is why the count is
 * reported beside the corpus's own planted-mismatch flag rather than as a bare accuracy.
 */
export function scoreConsistency(output) {
  let rowChecked = 0, rowPassed = 0, docChecked = 0, docPassed = 0, signInverted = 0;
  const samples = [];
  for (const sec of Object.keys(output || {})) {
    const v = output[sec];
    if (!Array.isArray(v)) continue;
    for (const [i, row] of v.entries()) {
      if (!row || typeof row !== 'object') continue;
      const q = pick(row, ['Quantity']), p = pick(row, ['Unit Price']), a = pick(row, ['Net Amount', 'Amount']);
      if (q == null || p == null || a == null) continue;
      rowChecked++;
      // Magnitudes, not signed values. A credit note prints every line negative and is arithmetically
      // correct; charging it as a failure would measure the document's sign convention rather than
      // the system's arithmetic. Rows that agree only once the sign is ignored are counted separately
      // so the convention stays visible instead of being silently absorbed.
      if (near(q * p, a)) rowPassed++;
      else if (near(Math.abs(q * p), Math.abs(a))) { rowPassed++; signInverted++; }
      else if (samples.length < 15) samples.push({ where: `${sec}.${i}`, quantity: q, unit_price: p, amount: a, expected: +(q * p).toFixed(2) });
    }
  }
  for (const sec of Object.keys(output || {})) {
    const o = output[sec];
    if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
    const sub = pick(o, ['Subtotal', 'Net Amount']), tax = pick(o, ['Tax', 'Total Tax', 'Tax Amount']), tot = pick(o, ['Total', 'Total Amount', 'Amount Due']);
    if (sub == null || tax == null || tot == null) continue;
    docChecked++;
    if (near(sub + tax, tot) || near(Math.abs(sub + tax), Math.abs(tot))) docPassed++;
    else if (samples.length < 15) samples.push({ where: sec, subtotal: sub, tax, total: tot, expected: +(sub + tax).toFixed(2) });
  }
  const checked = rowChecked + docChecked, passed = rowPassed + docPassed;
  return {
    rate: checked ? passed / checked : null, checked, passed,
    row: { checked: rowChecked, passed: rowPassed, sign_inverted: signInverted },
    doc: { checked: docChecked, passed: docPassed },
    samples,
  };
}

// -------------------------------------------------------------------------------------------------
export function scoreUnderstand({ gt, output, verdicts, rules = RULES }) {
  return {
    normalisation: verdicts ? scoreNormalisation(verdicts, rules) : null,
    world_knowledge: verdicts ? scoreWorldKnowledge(verdicts) : null,
    parsing: gt ? scoreParsing(gt, output) : null,
    decoding: scoreDecoding(output),
    consistency: scoreConsistency(output),
  };
}
