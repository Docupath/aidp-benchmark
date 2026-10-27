/**
 * Unit checks for the AIDP v1.0 scoring rules, on small hand-made cases. No corpus, no evidence, no
 * network. Exits non-zero on the first failed group.
 *
 *   node bench/test-scoring.mjs
 */
import { scoreFields, scoreFacts, parseNumber, fieldKind, isPlainNumber, isIdentifierField } from './base-score.mjs';
import { scoreNormalisation, sameMeaning } from './score-understand.mjs';
import { scoreConformance, scoreTrust, tokens, barcodePayloads } from './score-das.mjs';
import { reviewDecision, safetyPanel, failedLane, scoreLane } from './scoring.mjs';
import { scoreUnits, weightsFor, MEASURES, LAYERS, FLAVOURS } from './aidp-score.mjs';
import { RULES, withRules, FIELD_KEY_TYPES } from './rules.mjs';
import { BUDGETS } from './budgets.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};
const OFF = withRules({ exactNumbers: false, keepMisclassified: false, failedLanesFail: false, normalisationByMeaning: false, contractPooled: false, routedEscalation: false });
const verdictOf = (gt, out, rules = RULES) => scoreFields(gt, out, rules).filter((v) => !/\.count$/.test(v.path));
const one = (sec, field, key, got, rules = RULES) => verdictOf({ [sec]: { [field]: key } }, { [sec]: { [field]: got } }, rules)[0];

console.log('=== 1. Locale-aware exact number parsing ===');
const cases = [
  ['1.234,56', 1234.56], ['1,234.56', 1234.56], ["1'234.56", 1234.56], ['1 234,56', 1234.56], ['EUR 1,234.56', 1234.56],
  ['-1234.56', -1234.56], ['1234.56-', -1234.56], ['(1,234.56)', -1234.56], ['1.234.567', 1234567], ['1,234,567', 1234567],
  ['1,234', 1234], ['0,125', 0.125], ['12,5', 12.5], ['24.60336', 24.60336], ['17307.420', 17307.42], ['0.00', 0], ['-0.00', 0],
  ['4006-381-333931', null], ['2026-02-22', null], ['', null], ['n/a', null],
];
for (const [s, want] of cases) ok(`parseNumber(${JSON.stringify(s)}) = ${want}`, parseNumber(s) === want, `got ${parseNumber(s)}`);
ok('isPlainNumber accepts 1234.56, -12, 7 and a JSON number', ['1234.56', '-12', '7'].every(isPlainNumber) && isPlainNumber(17.5));
ok('isPlainNumber rejects 1.234,56, 1,234.56, EUR 12, 12.', !['1.234,56', '1,234.56', 'EUR 12', '12.'].some(isPlainNumber));

console.log('\n=== 2. Which fields are numbers and which are identifiers ===');
for (const f of ['Item No', 'Order Number', 'Postal Code', 'VAT No', 'Article ID', 'Invoice Number', 'account_no', 'Your Reference Number']) ok(`"${f}" is an identifier field`, isIdentifierField(f));
for (const f of ['Quantity', 'Unit Price', 'Net Amount', 'Total Tax', 'Total Amount', 'Tax Rate', 'tax_total', 'rate', 'Discount %']) ok(`"${f}" is a numeric field`, !isIdentifierField(f));
ok('a key of digits in Postal Code is an identifier', fieldKind('8001', 'Postal Code') === 'identifier');
ok('a key of digits in Net Amount is a number', fieldKind('17307.42', 'Net Amount') === 'number');
ok('an Arabic address ending in digits is text, not a number', fieldKind('شارع الشيخ زايد، مبنى 12', 'Address') === 'text');
ok('a Japanese payment term containing 30 is text, not a number', fieldKind('お支払いは30日以内にお願いします。', 'Payment Terms') === 'text');
ok('a DD/MM/YYYY key is a date', fieldKind('22/02/2026', 'Invoice Date') === 'date');

console.log('\n=== 3. The amount comparison ===');
ok('24.60336 against key 24603.36 fails', one('Invoice Details', 'Net Amount', '24603.36', '24.60336').verdict === 'wrong');
ok('...and passed under the published scorer, which this rule changes', one('Invoice Details', 'Net Amount', '24603.36', '24.60336', OFF).verdict === 'normalized');
ok('a sign flip fails: 2310.98 against key -2310.98', one('Invoice Details', 'Net Amount', '-2310.98', '2310.98').verdict === 'wrong');
ok('...and passed under the published scorer', one('Invoice Details', 'Net Amount', '-2310.98', '2310.98', OFF).verdict === 'normalized');
ok('the same number in another locale passes: 1.234,56 for 1234.56', one('Invoice Details', 'Net Amount', '1234.56', '1.234,56').verdict === 'normalized');
ok('the same number with a trailing zero passes: 7761.0 for 7761.00', one('Invoice Details', 'Net Amount', '7761.00', '7761.0').verdict === 'normalized');
ok('a thousand-fold separator error fails: 7.761 for 7761.00', one('Invoice Details', 'Net Amount', '7761.00', '7.761').verdict === 'wrong');
ok('a rounded value fails: 12.3 for 12.34', one('Items', 'x', '12.34', '12.3').verdict === 'wrong');
ok('an identifier still matches without its separators: Article ID 4006-381-333931 for 4006381333931',
  verdictOf({ Items: [{ 'Article ID': '4006381333931', 'Article Name': 'Widget' }] }, { Items: [{ 'Article ID': '4006-381-333931', 'Article Name': 'Widget' }] })
    .find((v) => v.path.endsWith('Article ID')).verdict === 'normalized');
ok('a VAT number still matches without its spaces', one('Seller', 'VAT No', '162953333351864', '16295 3333 351864').verdict === 'normalized');
ok('an IBAN still matches without its spaces', one('Payment Details', 'IBAN', 'DE89370400440532013000', 'DE89 3704 0044 0532 0130 00').verdict === 'normalized');
ok('an IBAN with one digit changed fails, though its digits run past what a number holds', one('Payment Details', 'IBAN', 'DE89370400440532013000', 'DE89370400440532013001').verdict === 'wrong');
ok('an IBAN with another country code fails', one('Payment Details', 'IBAN', 'DE89370400440532013000', 'AT89370400440532013000').verdict === 'wrong');
ok('an Arabic street is not its house number alone', one('Seller', 'Street 1', 'شارع الشيخ زايد 134', '134').verdict === 'wrong');
ok('Japanese payment terms are not their number of days alone', one('Invoice Details', 'Payment Terms', 'お支払いは30日以内にお願いします。', '30').verdict === 'wrong');
ok('a postal code written in digits alone still matches with its hyphen', one('Seller', 'Postal Code', '1040061', '104-0061').verdict === 'normalized');
const tax = (got) => verdictOf({ 'Payment Details': { Tax: [{ tax_code: 'VAT', tax_total: '-8050.60', rate: '5' }] } }, { 'Payment Details': { Tax: [{ tax_code: 'VAT', tax_total: got, rate: '5' }] } })[0].verdict;
ok('a nested tax total with its sign flipped is no longer a full match', tax('8050.60') !== 'correct');
ok('a nested tax total written -8050.6 is a full match', tax('-8050.6') === 'correct');
const facts = [{ label: 'Opening Balance', value: '4009.81', soft: false }, { label: 'Account No', value: '0094-678479-22', soft: false }];
const fr = scoreFacts(facts, { a: '-4009.81', b: '0094678479 22' });
ok('a numeric fact is not found inside a value with the opposite sign', fr[0].hit === false);
ok('an identifier fact is still found without its separators', fr[1].hit === true);
ok('a numeric fact is found in another locale form', scoreFacts(facts, { a: '4.009,81' })[0].hit === true);

console.log('\n=== 4. Count once: Normalisation scores meaning, Contract scores format ===');
const dateDoc = (out) => ({ gt: { 'Invoice Details': { 'Invoice Date': '22/02/2026' } }, out: { 'Invoice Details': { 'Invoice Date': out } } });
{
  const { gt, out } = dateDoc('22.02.2026');
  const vs = verdictOf(gt, out);
  const N = scoreNormalisation(vs);
  const C = scoreConformance({ gt, output: out });
  ok('a date with dots that means the right day passes Normalisation', N.by_kind.date.passed === 1 && N.by_kind.date.checked === 1, JSON.stringify(N.by_kind.date));
  ok('...and fails Contract', C.contract_checks >= 1 && C.format_checked === 1 && C.format_ok === 0, JSON.stringify({ checks: C.contract_checks, ok: C.format_ok }));
  ok('...and counted as a Fidelity pass (it was read correctly)', vs[0].verdict === 'normalized');
  const Nold = scoreNormalisation(verdictOf(gt, out, OFF), OFF);
  ok('...where the published scorer failed it in Normalisation as well (the double count)', Nold.by_kind.date.canonical === 0 && Nold.by_kind.date.noncanonical === 1);
}
{
  const { gt, out } = dateDoc('02/22/2026');
  const N = scoreNormalisation(verdictOf(gt, out));
  ok('a swapped day and month fails Normalisation', N.by_kind.date.passed === 0 && N.by_kind.date.misconverted === 1, JSON.stringify(N.by_kind.date));
  ok('...and passes the Contract format check (it is in the contracted shape)', scoreConformance({ gt, output: out }).format_ok === 1);
}
{
  const { gt, out } = dateDoc('22/02/2026');
  ok('a canonical date passes both', scoreNormalisation(verdictOf(gt, out)).by_kind.date.passed === 1 && scoreConformance({ gt, output: out }).format_ok === 1);
}
ok('sameMeaning: 1.234,56 means 1234.56', sameMeaning('number', '1234.56', '1.234,56'));
ok('sameMeaning: 1.23456 does not mean 1234.56', !sameMeaning('number', '1234.56', '1.23456'));
{
  const gt = { 'Invoice Details': { 'Net Amount': '1234.56', 'Invoice Date': '22/02/2026' } };
  const C1 = scoreConformance({ gt, output: { 'Invoice Details': { 'Net Amount': '1.234,56', 'Invoice Date': '22/02/2026' } } });
  ok('a number delivered as 1.234,56 fails the Contract number format', C1.number_format_checked === 1 && C1.number_format_ok === 0);
  const C2 = scoreConformance({ gt, output: { 'Invoice Details': { 'Net Amount': '1234.56', 'Invoice Date': '22/02/2026' } } });
  ok('a plain number passes it', C2.number_format_ok === 1);
}
{
  // Contract is pooled over checks. Document A has two date checks (one fails); document B is a
  // facts-mode document with no schema and no dates at all.
  const gtA = { 'Invoice Details': { 'Invoice Date': '22/02/2026', 'Due Date': '01/03/2026' } };
  const A = scoreConformance({ gt: gtA, output: { 'Invoice Details': { 'Invoice Date': '22.02.2026', 'Due Date': '01/03/2026' } } });
  const B = scoreConformance({ gt: {}, output: { anything: 'x' } });
  ok('a document with no checks contributes no Contract checks', B.contract_checks === 0 && B.contract == null);
  const pooled = (A.contract_passed + B.contract_passed) / (A.contract_checks + B.contract_checks);
  ok('so pooling it with another document leaves that document\'s Contract unchanged', pooled === A.contract, `${pooled} against ${A.contract}`);
  ok('where the published per-document mean gave it a free 1 and lifted the average', (A.format + B.format) / 2 === 0.75 && A.format === 0.5);
  const gtNoDates = { 'Invoice Details': { 'Invoice Number': 'INV-1' } };
  const D = scoreConformance({ gt: gtNoDates, output: { 'Invoice Details': { 'Invoice Number': 'INV-1' } } });
  ok('a document with no date checks adds no format checks, only its schema checks', D.format_checked === 0 && D.contract_checks === D.keys_defined);
}

console.log('\n=== 5. Failed lanes and misclassified documents are never dropped ===');
const corpusStub = { text: () => 'Invoice 123 total 45.60 Widget' };
const gtj = {
  category: 'Invoice', category_alt: [], mode: 'fields', facts: [], expected_flags: [], expected_derived: [],
  gt: { 'Invoice Details': { 'Invoice Number': 'INV-123', 'Invoice Date': '22/02/2026', 'Net Amount': '45.60' }, Items: [{ 'Article Name': 'Widget', Quantity: '2', 'Unit Price': '22.80', 'Net Amount': '45.60' }] },
};
const entry = { doc: { id: 'x-000', slug: 'invoice', dims: {} }, gtj };
const failed = failedLane(entry, 'pipeline', corpusStub, RULES, 'timeout');
const u = failed.units;
ok('a failed lane scores zero on Read', u['read.words'].v === 0 && u['read.numbers'].v === 0);
ok('a failed lane is a failed identification', u['capture.identification'].p === 0 && u['capture.identification'].n === 1);
ok('a failed lane is charged every answer-key value in Completeness, Fidelity and Restraint',
  ['capture.completeness', 'capture.fidelity', 'capture.restraint'].every((k) => u[k].p === 0 && u[k].n === 7), JSON.stringify(u['capture.completeness']));
ok('a failed lane is charged its rows in line-item recall and precision', u['capture.rows_recall'].n === 1 && u['capture.rows_precision'].n === 1);
ok('a failed lane is charged its dates and numbers in Normalisation', u['understand.dates'].n === 1 && u['understand.numbers'].n === 4, JSON.stringify([u['understand.dates'], u['understand.numbers']]));
ok('a failed lane is charged its Contract checks', u['reason.contract'].p === 0 && u['reason.contract'].n > 0);
ok('a failed lane is charged its values in Traceability', u['trust.provenance'].n === 7);
const wrongType = { ok: true, classification: { category: 'Purchase Order' }, ocr_text: 'Invoice 123', extraction: { 'Order Details': { 'PO Number': 'INV-123' } } };
const mis = scoreLane(entry, 'pipeline', wrongType, corpusStub, RULES).rec;
ok('a misclassified document is scored on Capture', mis.L2 && mis.units['capture.completeness'].n === 7 && mis.units['capture.completeness'].p === 0);
ok('...where the published scorer dropped it', scoreLane(entry, 'pipeline', wrongType, corpusStub, OFF).rec.L2 === null);

console.log('\n=== 6. Caught means routed to a person ===');
ok('a recorded document decision is used as it is', reviewDecision({ field_report: { document: { auto_accept: true } } }).routed === false
  && reviewDecision({ field_report: { document: { auto_accept: false } } }).signal === 'recorded');
const fc = (aa, flag = false) => ({ field_confidence: { applied: true, fields: { a: { auto_accept: true }, b: { auto_accept: aa } } }, derived_fields: { derivations: flag ? [{ kind: 'mismatch' }] : [] } });
ok('without a recorded decision, every field accepted and no flag passes straight through', reviewDecision(fc(true)).routed === false && reviewDecision(fc(true)).signal === 'reconstructed');
ok('one field not accepted routes the document', reviewDecision(fc(false)).routed === true);
ok('a mismatch flag routes the document', reviewDecision(fc(true, true)).routed === true);
const noDecision = { field_confidence: { applied: true, fields: { a: { score: 0.9 }, b: { score: 0.8 } } } };
ok('evidence with confidence but no decision says nothing about routing', reviewDecision(noDecision).routed === null && reviewDecision(noDecision).signal === 'absent');
ok('...so its document has no safety-panel cell', scoreTrust({ captureAgg: {}, structure: {}, derived: { derivations: [] }, errorBudget: () => ({ count: 1, detail: {} }), routed: null }).cell === null);
ok('...and a panel over such documents counts none of them', safetyPanel([{ mode: 'fields', slug: 'invoice', lanes: { pipeline: { ok: true, review: { routed: null, signal: 'absent' }, L5: { critical: { scorable: true, has_error: true, flagged: false } } } } }]).docs === 0);
ok('...nor a flag-based cell', scoreTrust({ captureAgg: {}, structure: {}, derived: { derivations: [{ kind: 'mismatch' }] }, errorBudget: () => ({ count: 1, detail: {} }), routed: null }).cell_flag === null);
const undecidedDoc = { mode: 'fields', slug: 'invoice', lanes: { pipeline: { ok: true, review: { routed: null, signal: 'absent' }, L5: { critical: { scorable: true, has_error: true, flagged: false } } } } };
const PA = safetyPanel([undecidedDoc, { mode: 'fields', slug: 'invoice', lanes: { pipeline: failed } }]);
ok('a failed lane among documents without decisions makes no panel', PA.available === false && PA.escaped_rate === null && PA.catch_rate === null && PA.false_alarm_rate === null && PA.undecided === 1);
const PM = safetyPanel([undecidedDoc, { mode: 'fields', slug: 'invoice', lanes: { pipeline: { ok: true, review: { routed: true, signal: 'recorded' }, L5: { critical: { scorable: true, has_error: true, flagged: false } } } } }]);
ok('beside documents with decisions, one without is counted as undecided, never dropped silently', PM.available === true && PM.docs === 1 && PM.undecided === 1 && PM.signals.absent === 1 && PM.signals.recorded === 1 && PM.catch_rate === 1);
const partial = { field_confidence: { applied: true, fields: { a: { auto_accept: true }, b: { score: 0.9 } } } };
ok('a returned field with no decision of its own, beside fields that carry one, routes the document', reviewDecision(partial).routed === true && reviewDecision(partial).signal === 'reconstructed');
const noConfidence = { field_confidence: { applied: true, fields: {} } };
ok('a document with no confidence at all counts as sent to a person', reviewDecision(noConfidence).routed === true && reviewDecision(noConfidence).signal === 'no-confidence');
ok('...and so does a lane file with no confidence record at all', reviewDecision({ extraction: {} }).routed === true && reviewDecision({ extraction: {} }).signal === 'no-confidence');
const unscorable = { mode: 'fields', slug: 'invoice', lanes: { pipeline: { ok: true, review: { routed: null, signal: 'absent' }, L5: { critical: { scorable: false } } } } };
ok('a document the panel does not cover is never counted as undecided', safetyPanel([unscorable]).undecided === 0 && safetyPanel([unscorable]).docs === 0);
const errBudget = () => ({ count: 1, detail: {} });
const T = (routed, flag) => scoreTrust({ captureAgg: {}, structure: {}, derived: { derivations: flag ? [{ kind: 'mismatch' }] : [] }, errorBudget: errBudget, routed });
ok('a flagged document with an error that was NOT routed escaped', T(false, true).cell === 'escaped');
ok('...although the published reading counted it as caught', T(false, true).cell_flag === 'caught');
ok('an unflagged document with an error that was routed was caught', T(true, false).cell === 'caught');
const recs = [
  { mode: 'fields', slug: 'invoice', lanes: { pipeline: { ok: true, review: { routed: true, signal: 'recorded' }, L5: { critical: { scorable: true, has_error: true, flagged: false } } } } },
  { mode: 'fields', slug: 'invoice', lanes: { pipeline: { ok: true, review: { routed: false, signal: 'recorded' }, L5: { critical: { scorable: true, has_error: true, flagged: true } } } } },
  { mode: 'fields', slug: 'invoice', lanes: { pipeline: { ok: true, review: { routed: true, signal: 'recorded' }, L5: { critical: { scorable: true, has_error: false, flagged: false } } } } },
  { mode: 'fields', slug: 'invoice', lanes: { pipeline: { ok: true, review: { routed: false, signal: 'recorded' }, L5: { critical: { scorable: true, has_error: false, flagged: false } } } } },
  { mode: 'fields', slug: 'purchase-order', lanes: { pipeline: failed } },
  { mode: 'facts', slug: 'receipt', lanes: { pipeline: { ok: true, review: { routed: false }, L5: { critical: { scorable: false } } } } },
];
const P = safetyPanel(recs);
ok('the panel counts field-key documents only, a failed lane included', P.docs === 5);
ok('escaped critical errors: 2 of 5 (one unrouted, one failed lane)', P.escaped === 2 && Math.abs(P.escaped_rate - 0.4) < 1e-12);
ok('catch rate: 1 of 3 documents with a critical error', Math.abs(P.catch_rate - 1 / 3) < 1e-12);
ok('false-alarm rate: 1 of 2 documents without one', P.false_alarm_rate === 0.5);
ok('broken down by document type', P.by_type.invoice.docs === 4 && P.by_type['purchase-order'].escaped === 1);
ok('...and, with decisions recorded, available, with no document left undecided', P.available === true && P.undecided === 0);

console.log('\n=== 7. The weighting and the exact recombination ===');
const fullUnits = () => Object.fromEntries(MEASURES.map((m) => [m.id, m.agg === 'mean' ? { v: 1 } : { p: 1, n: 1 }]));
const docs = [];
for (const t of FIELD_KEY_TYPES) docs.push({ slug: t, u: fullUnits() });
docs.push({ slug: 'receipt', u: { 'read.words': { v: 0.5 }, 'read.numbers': { v: 0.5 } } });
// One type, invoice, gets a weaker Completeness: 1 of 2.
docs.find((d) => d.slug === 'invoice').u['capture.completeness'] = { p: 1, n: 2 };
const units = { pipeline: docs, stability: FIELD_KEY_TYPES.map((t) => ({ slug: t, u: { 'trust.stability': { v: 1 } } })) };
const te = scoreUnits(units, weightsFor('type-equal'));
const comp = (s) => s.measures.find((m) => m.id === 'capture.completeness').value;
ok('one weighting, read from the corpus: each of the six field-key types counts equally', FLAVOURS.length === 1 && FLAVOURS[0] === 'type-equal' && FIELD_KEY_TYPES.every((t) => weightsFor()[t] === 1));
let prodThrew = false;
try { weightsFor('production-weighted'); } catch { prodThrew = true; }
ok('no production weighting exists to be chosen instead', prodThrew);
ok('type-equal gives each of the six types one sixth: completeness (5 + 0.5) / 6', Math.abs(comp(te) - 5.5 / 6) < 1e-12, String(comp(te)));
ok('Read is a per-document average over all ten types', Math.abs(te.measures[0].value - 6.5 / 7) < 1e-12);
ok('the fact-key document is in Read and in nothing else', !('capture.identification' in docs[docs.length - 1].u));
ok(`there are ${MEASURES.length} score-bearing measures in ${LAYERS.length} layers`, MEASURES.length === 16 && LAYERS.map((L) => L.measures.length).join(',') === '2,6,5,1,2');
ok('the layer scores recombine to the score (checked inside scoreUnits, which would have thrown)', typeof te.score === 'number');
let threw = false;
try { scoreUnits({ pipeline: docs.map((d) => ({ ...d, u: { ...d.u, 'reason.contract': undefined } })), stability: units.stability }, weightsFor('type-equal')); } catch { threw = true; }
ok('a score-bearing measure with no value is an error, not an omission', threw);

console.log('\n=== 8. Pre-run amendment ===');
{
  // Contract against the contract: the answer key still names the freight tables the old way, the
  // system returns them under the contract's names, plus a section the published format allows.
  const contract = {
    sections: [
      { name: 'Invoice Details', shape: 'object', fields: ['Invoice Number', 'Total Tax'] },
      { name: 'Invoice Charges', shape: 'array', fields: ['Description', 'Amount'] },
      { name: 'Line Containers', shape: 'array', fields: ['ID', 'Container ID'] },
    ],
    allowed: ['Invoice Details', 'Invoice Charges', 'Line Containers', 'Flags'],
  };
  const gtF = { 'Invoice Details': { 'Invoice Number': 'INV-1', 'Total Tax': '' }, Charges: { Description: '', Amount: '' } };
  const outF = { 'Invoice Details': { 'Invoice Number': 'INV-1', 'Total Tax': '' }, 'Invoice Charges': [], 'Line Containers': [{ ID: 'S1-N1', 'Container ID': 'MSKU1' }], Flags: [] };
  const byContract = scoreConformance({ gt: gtF, output: outF, contract });
  const byKey = scoreConformance({ gt: gtF, output: outF, contract, rules: withRules({ contractFromSchema: false }) });
  ok('sections the contract names (Invoice Charges, Line Containers, Flags) are not breaks against the contract', byContract.keys_conforming === byContract.keys_defined && byContract.contract_reference === 'contract', JSON.stringify(byContract.key_breaks));
  ok('...where the answer key\'s structure counted them as breaks', byKey.keys_conforming < byKey.keys_defined && byKey.contract_reference === 'answer key', JSON.stringify(byKey.key_breaks));
  const missing = scoreConformance({ gt: gtF, output: { 'Invoice Details': { 'Invoice Number': 'INV-1' }, Extra: {} }, contract });
  ok('a contracted section absent, a contracted field dropped and a section outside the format are breaks',
    ['Invoice Charges', 'Line Containers', 'Invoice Details.Total Tax', 'Extra'].every((p) => missing.key_breaks.some((b) => b.path === p)), JSON.stringify(missing.key_breaks));

  // Count once between Fidelity and Normalisation.
  const stub = { text: () => 'x' };
  const gtj2 = {
    category: 'Invoice', category_alt: [], mode: 'fields', facts: [], expected_flags: [], expected_derived: [],
    gt: { 'Invoice Details': { 'Invoice Date': '22/02/2026', 'Net Amount': '24603.36', 'Total Tax': '-512.40', 'Total Amount': '1234.56' } },
  };
  const e2 = { doc: { id: 'x-001', slug: 'invoice', dims: {} }, gtj: gtj2 };
  const out2 = { ok: true, classification: { category: 'Invoice' }, ocr_text: 'x', extraction: { 'Invoice Details': { 'Invoice Date': '02/22/2026', 'Net Amount': '24.60336', 'Total Tax': '512.40', 'Total Amount': '1243.56' } } };
  const now = scoreLane(e2, 'pipeline', out2, stub, RULES).rec;
  const before = scoreLane(e2, 'pipeline', out2, stub, withRules({ conventionOnce: false })).rec;
  ok('a swapped date and a separator error leave Fidelity: 2 convention-only errors found', now.L2.convention === 2, String(now.L2.convention));
  ok('Fidelity counts only the sign flip and the misread: 0 right of 2', now.units['capture.fidelity'].p === 0 && now.units['capture.fidelity'].n === 2, JSON.stringify(now.units['capture.fidelity']));
  ok('...where without the rule all four failed Fidelity', before.units['capture.fidelity'].n === 4);
  ok('Normalisation still fails the swapped date and the separator error', now.units['understand.dates'].p === 0 && now.units['understand.dates'].n === 1
    && now.understand.normalisation.by_kind.number.misconverted === 1, JSON.stringify(now.understand.normalisation.by_kind.number));
  ok('a flipped sign is not a convention error: outside Normalisation, a Fidelity failure', now.understand.normalisation.by_kind.number.checked === 1
    && before.understand.normalisation.by_kind.number.misconverted === 2);
  ok('convention-only errors are still errors for the safety panel', now.L5.critical.errors >= 4, String(now.L5.critical.errors));

  // Restraint: labelled or not, counted once.
  const gtj3 = { ...gtj2, gt: { 'Invoice Details': { 'Invoice Number': 'INV-9', 'Net Amount': '' } } };
  const e3 = { doc: { id: 'x-002', slug: 'invoice', dims: {} }, gtj: gtj3 };
  const out3 = { ok: true, classification: { category: 'Invoice' }, ocr_text: 'x', extraction: { 'Invoice Details': { 'Invoice Number': 'INV-9', 'Net Amount': '100.00' } },
    derived_fields: { derivations: [{ kind: 'derived', field_path: 'Invoice Details.Net Amount', method: 'sum', reason: 'computed', before: '', after: '100.00' }] } };
  const r3 = scoreLane(e3, 'pipeline', out3, stub, RULES).rec;
  const r3old = scoreLane(e3, 'pipeline', out3, stub, withRules({ restraintCountsDerived: false })).rec;
  ok('a value labelled as derived in a field the key leaves empty is an invention', r3.L2.spurious === 1 && r3.units['capture.restraint'].p === 1 && r3.units['capture.restraint'].n === 2, JSON.stringify(r3.units['capture.restraint']));
  ok('...where the earlier rule excused it', r3old.L2.spurious === 0);

  // The critical error budget.
  const C = BUDGETS.critical.counts;
  ok('Total Tax and PO Date are business-critical', C('Invoice Details.Total Tax') && C('Order Details.PO Date'));
  ok('...and were not before the amendment', !C('Invoice Details.Total Tax', false) && !C('Order Details.PO Date', false));
  ok('Consignment Number and Consignment Date are business-critical (second amendment)', C('Consignment Details.Consignment Number') && C('Consignment Details.Consignment Date'));
  ok('...and were not under the published budget', !C('Consignment Details.Consignment Number', false) && !C('Consignment Details.Consignment Date', false));
  ok('a consignment line position or row field named alike is not caught by it', !C('Items.0.Consignment Number'));
}

console.log('\n=== 9. A number ends at a column gap ===');
{
  const nums = (t) => tokens(t).nums.join(' ');
  ok('two numbers in neighbouring columns of a space-aligned table are two numbers', nums('LOT981248 SN66192301  12     kg   242,21') === '981248 66192301 12 24221');
  ok('...as they are in the same row written with cell dividers', nums('| LOT981248 | SN66192301 | 12 | kg | 242,21 |') === '981248 66192301 12 24221');
  ok('a space as thousands separator stays inside the number', nums('Total 1 234,56 EUR') === '123456');
  ok("an apostrophe as thousands separator stays inside it", nums("CHF 1'234.56") === '123456');
  ok('a dotted date and a grouped IBAN stay one token each', nums('06.04.2026 DE52 4078 4431') === '06042026 5240784431');
  ok('a line break or a tab ends a number', nums('12\n34\t56') === '12 34 56');
  ok('with the correction off, the published pattern is reproduced exactly (glued cells)', tokens('SN66192301  12', { numbersEndAtGap: false }).nums.join(' ') === '6619230112');
  ok('the correction is on in the v1.0 rules', RULES.numbersEndAtGap === true);
}

console.log('\n=== 10. A QR payload is read whole ===');
{
  const key = 'Thank you.\n\n## Barcodes:\n\nQR Code: BCD\n002\n1\nSCT\nGQBKDE36\nWestbrook Pharma Ltd\nGB46216332051106773003\nGBP1973.38\n';
  const reading = '## Barcodes:\nQR Code: BCD\\n002\\n1\\nSCT\\nGQBKDE36\\nWestbrook Pharma Ltd\\nGB46216332051106773003\\nGBP1973.38\n';
  ok('a payment QR code written one field per line matches the same code written on one line', barcodePayloads(key)[0] === barcodePayloads(reading)[0]);
  ok('...and the whole payload is compared, not its first field', barcodePayloads(key)[0].includes('gb46216332051106773003'));
  ok('a different amount does not match', barcodePayloads(key)[0] !== barcodePayloads(reading.replace('1973.38', '1973.83'))[0]);
  ok('a GS1 barcode line is still read on its own line', barcodePayloads('Barcode: (01)00819811519898(10)LOT654420\nBarcode: (01)00093368165504(10)LOT927231').length === 2);
  ok('a QR payload stops at the next marker', barcodePayloads('QR Code: BCD\n002\nBarcode: (01)123')[0] === 'bcd002');
  ok('with the correction off, the published comparison is reproduced (first field only)', barcodePayloads(key, { qrPayloadLines: false })[0] === 'bcd');
  ok('the correction is on in the v1.0 rules', RULES.qrPayloadLines === true);
}

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
