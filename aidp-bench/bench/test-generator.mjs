/**
 * The generator's settings, checked over all 2,000 documents: off by default, the published seed reproduces AIDP-2K
 * byte for byte; with --valid-accounts every bank account number carries valid check digits, and with
 * --due-dates-from-terms every due date follows the payment terms, and in both cases nothing else in an answer key or
 * on a page changes.
 *
 *   node aidp-bench/bench/test-generator.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TYPES, PER_TYPE } from '../corpus-gen/composition.mjs';
import { buildDoc, GEN_OPTIONS, generatorSettingsRecord } from '../corpus-gen/data.mjs';
import { gtText, attachmentGtText, combine } from '../corpus-gen/gttext.mjs';

const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = JSON.parse(fs.readFileSync(path.join(BENCH, 'corpus', 'manifest.json'), 'utf8')).seed;
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name}`); } };

// One document as materialize-gt.mjs writes it: the answer key file and the page text.
const written = (slug, i) => {
  const d = buildDoc(slug, i, SEED);
  const key = JSON.stringify({
    id: d.id, slug, category: d.category, category_alt: d.category_alt ?? [], mode: d.mode, locale: d.locale, dims: d.dims,
    gt: d.gt, facts: d.facts, expected_flags: d.expectedFlags, expected_derived: d.expectedDerived,
    expected_flags_future: d.expectedFuture,
  }, null, 1);
  const text = d.attachment ? combine(gtText(d.content), [attachmentGtText(d.attachment)]) : gtText(d.content);
  return { id: d.id, slug, gt: d.gt, key, text };
};
const corpus = () => TYPES.flatMap((slug) => Array.from({ length: PER_TYPE }, (_, i) => written(slug, i)));
const published = (x) => ({
  key: fs.readFileSync(path.join(BENCH, 'corpus', x.slug, `${x.id}.gt.json`), 'utf8'),
  text: fs.readFileSync(path.join(BENCH, 'corpus', x.slug, `${x.id}.gt.txt`), 'utf8'),
});
// The lines in which two versions of a file differ; a setting changes values, never the number of lines.
const changed = (a, b) => { const x = a.split('\n'), y = b.split('\n'); return x.length !== y.length ? null : x.map((l, k) => [l, y[k]]).filter(([l, m]) => l !== m); };

// An independent check of an IBAN (ISO 13616), not the generator's own: move the first four characters to the end,
// turn each letter into two digits (A = 10 ... Z = 35), and the whole number must leave 1 when divided by 97.
const ibanValid = (s) => {
  const x = s.replace(/\s+/g, '');
  const n = [...`${x.slice(4)}${x.slice(0, 4)}`].map((ch) => (/[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55))).join('');
  return BigInt(n) % 97n === 1n;
};
// A number is printed in groups ("DE12 3456 ...") and, in a payment QR code's text, without spaces.
const IBAN = /\b[A-Z]{2}\d{2}(?: \d{4}){4} \d{2}\b/g;
const IBAN_COMPACT = /(?<![A-Z0-9])([A-Z]{2})\d{2}(\d{18})(?!\d)/g;
const numbersIn = (xs) => [...new Set(xs.flatMap((x) => [x.key, x.text].flatMap((s) => [...s.matchAll(IBAN), ...s.matchAll(IBAN_COMPACT)].map((m) => m[0].replace(/\s+/g, '')))))];
const checkDigitsMasked = (s) => s.replace(IBAN, (m) => `${m.slice(0, 2)}..${m.slice(4)}`).replace(IBAN_COMPACT, '$1..$2');

console.log('=== 1. Off by default, the published seed reproduces every published answer key and page text ===');
const off = corpus();
ok(`all ${off.length} answer keys and page texts match the published files byte for byte`,
  off.length === 2000 && off.every((x) => { const p = published(x); return p.key === x.key && p.text === x.text; }));
ok('...and a corpus made this way records no generator setting', JSON.stringify(generatorSettingsRecord()) === '{}');
const before = numbersIn(off);
console.log(`        ${before.filter((s) => !ibanValid(s)).length} of the ${before.length} published bank account numbers fail the check of their check digits`);

console.log('\n=== 2. --valid-accounts: valid check digits, and nothing else changed ===');
GEN_OPTIONS.validAccounts = true;
const va = corpus();
const vaRecord = generatorSettingsRecord();
GEN_OPTIONS.validAccounts = false;
const after = numbersIn(va);
ok(`every one of the ${after.length} bank account numbers passes an independent check of its check digits`, after.length === before.length && after.every(ibanValid));
const vaDiffs = va.map((x, k) => [changed(x.key, off[k].key), changed(x.text, off[k].text)]);
ok(`only the two check digits of a number change, in the answer keys and on the pages (${vaDiffs.filter(([a, b]) => a?.length || b?.length).length} documents)`,
  vaDiffs.every(([a, b]) => a && b && [...a, ...b].every(([l, m]) => checkDigitsMasked(l) === checkDigitsMasked(m))));
ok('...and a corpus made this way records the setting in its manifest', JSON.stringify(vaRecord) === JSON.stringify({ generator_settings: { validAccounts: true } }));

console.log('\n=== 3. --due-dates-from-terms: due dates 30 days after the document date, and nothing else changed ===');
const DUE = { 'Invoice Details': ['Invoice Date', 'Due Date'], 'Order Details': ['PO Date', 'Due Date'], 'Consignment Details': ['Consignment Date', 'Payment Due Date'] };
const utc = (s) => { const [d, m, y] = s.split('/').map(Number); return Date.UTC(y, m - 1, d); }; // keys hold DD/MM/YYYY
const dueOf = (gt) => { for (const [sec, [from, to]] of Object.entries(DUE)) if (gt?.[sec]?.[to]) return [gt[sec][from], gt[sec][to]]; return null; };
GEN_OPTIONS.dueDatesFromTerms = true;
const dd = corpus();
GEN_OPTIONS.dueDatesFromTerms = false;
const keyed = dd.filter((x) => dueOf(x.gt));
ok(`every one of the ${keyed.length} keyed due dates is 30 days after its document date`,
  keyed.length > 0 && keyed.every((x) => { const [a, b] = dueOf(x.gt); return Math.round((utc(b) - utc(a)) / 86400000) === 30; }));
const ddDiffs = dd.map((x, k) => [changed(x.key, off[k].key), changed(x.text, off[k].text)]);
const moved = ddDiffs.filter(([a, b]) => a?.length || b?.length).length;
// the one page line that changes may differ only in its digits: the printed date, and nothing else on the line
const dateOnly = ([l, m]) => l.replace(/\d/g, '#') === m.replace(/\d/g, '#');
ok(`${moved} documents change, each in its due-date line in the answer key and in one date on its page, and nowhere else`,
  moved > 0 && ddDiffs.every(([a, b]) => a && b && ((a.length === 0 && b.length === 0)
    || (a.length === 1 && /"(?:Payment )?Due Date": /.test(a[0][0]) && b.length === 1 && dateOnly(b[0])))));

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
