/**
 * Recomputes the figures the white paper quotes from the reference run's evidence that no other script in this
 * repository prints. Read-only; no model calls.
 *
 *   1. Warnings on printed totals: the documents with a planted contradiction between the printed total and its
 *      lines, the other documents that drew the same warning, and those that drew the related payment-total warning.
 *   2. The separate subtotal check (printed subtotal against the sum of the captured lines) on the documents without
 *      a planted contradiction, each warning sorted by what the answer key shows: a line or the subtotal read
 *      differently from the page, a page whose own subtotal does not add up, or captured lines that do add up.
 *   3. Warnings about a sticker's lot that contradicts its printed line, on the documents with that planted problem.
 *   4. Computation on the documents printed without totals: the net and total amounts calculated, whether each
 *      calculated net amount equals the sum of the printed line amounts, and the calculated values the keys can check;
 *      then how Restraint counts those amounts, which the keys leave empty, and the tax totals returned again in the
 *      payment section of invoices and credit notes, where the keys are empty too.
 *   5. Restraint on freight invoices: the shipment totals and charge-line currencies returned where the key holds
 *      none, and whether each is right.
 *   6. Fact recall on receipts: the facts counted as missing, by label, and how the card payments were returned.
 *   7. The held-out check's consignment documents: Fidelity, the median document, the share of wrong values held by
 *      the five lowest documents, and a 95% range from resampling each type's documents (seeded).
 *   8. Traceability's count: the evidence entries it reads, the returned values that carry none, by section and by
 *      document type, and what Traceability and the AIDP Score would be if those values counted as untraceable.
 *
 *   node aidp-bench/bench/paper-checks.mjs --corpus aidp-bench/corpus --run aidp-bench/results/aidp-v1-main \
 *     [--heldout aidp-bench/results/aidp-v1-heldout-main]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { scoreFacts } from './base-score.mjs';
import { RULES } from './rules.mjs';
import { loadCorpus, scoreDocuments } from './scoring.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const CORPUS = path.resolve(opt('corpus', 'aidp-bench/corpus'));
const RUN = path.resolve(opt('run', 'aidp-bench/results/aidp-v1-main'));
const HELD = opt('heldout', null) ? path.resolve(opt('heldout')) : null;

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const manifest = readJson(path.join(CORPUS, 'manifest.json')).docs;
const key = (d) => readJson(path.join(CORPUS, d.gt));
const raw = (id, lane = 'pipeline') => readJson(path.join(RUN, 'raw', `${id}.${lane}.json`));
const board = readJson(path.join(RUN, 'scoreboard.json'));
const byId = new Map(board.docs.map((d) => [d.id, d]));
const num = (v) => { const s = String(v ?? '').replace(/[^\d.,-]/g, '').replace(/,/g, ''); return s === '' || s === '-' ? null : Number(s); };
const near = (a, b) => a != null && b != null && Math.abs(a - b) <= 0.005;
/** A returned amount as a number: separators dropped, a decimal comma read as a point. */
const amount = (s) => {
  let t = String(s ?? '').replace(/[^0-9.,-]/g, '');
  if (!t) return null;
  t = t.includes(',') && t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};
const derivations = (x) => x?.derived_fields?.derivations ?? [];
const full = manifest.filter((d) => d.mode === 'fields');
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const line = (s) => console.log(s);

// 1. warnings on printed totals ----------------------------------------------------------------------------
const TOTAL = /^(?:Invoice|Order) Details\.Total Amount$/;
const PAY_TOTAL = /^Payment Details\.Total$/;
let planted = 0, plantedWarned = 0, same = 0, related = 0;
for (const d of full) {
  const w = derivations(raw(d.id)).filter((x) => x.kind === 'mismatch');
  const hasTotal = w.some((x) => TOTAL.test(x.field_path ?? '') && /does not match/.test(x.reason ?? ''));
  const hasPay = w.some((x) => PAY_TOTAL.test(x.field_path ?? '') && /does not match/.test(x.reason ?? ''));
  if (d.dims.mismatch) { planted++; if (hasTotal) plantedWarned++; }
  else { if (hasTotal) same++; if (hasPay) related++; }
}
line(`1. Printed total against its lines: warned on ${plantedWarned} of the ${planted} documents with the planted contradiction; the same warning on ${same} of the other ${full.length - planted}, and the related payment-total warning on ${related} more.`);

// 2. the subtotal check ------------------------------------------------------------------------------------
const sort = { 'a line read differently': 0, 'the subtotal read differently': 0, 'the page itself does not add up': 0, 'the captured lines add up': 0 };
let fired = 0;
for (const d of full) {
  if (d.dims.mismatch) continue;
  const x = raw(d.id);
  const w = derivations(x).find((q) => q.kind === 'mismatch' && /does not match the sum of line/.test(q.reason ?? ''));
  if (!w) continue;
  fired++;
  const g = key(d).gt;
  const keyPrinted = num(get(g, w.field_path));
  const keySum = (g.Items ?? []).reduce((a, r) => a + (num(r['Net Amount']) ?? 0), 0);
  const outPrinted = num(get(x.extraction, w.field_path));
  const outSum = (x.extraction.Items ?? []).reduce((a, r) => a + (num(r['Net Amount']) ?? 0), 0);
  if (!near(outSum, keySum)) sort['a line read differently']++;
  else if (!near(outPrinted, keyPrinted)) sort['the subtotal read differently']++;
  else if (!near(keyPrinted, keySum)) sort['the page itself does not add up']++;
  else sort['the captured lines add up']++;
}
line(`2. Subtotal check: fired on ${fired} documents without a planted contradiction: ${Object.entries(sort).map(([k, v]) => `${k} ${v}`).join(', ')}.`);

// 3. sticker lot warnings ---------------------------------------------------------------------------------
const stick = full.filter((d) => d.dims.stickerMismatch);
const lotWarned = stick.filter((d) => derivations(raw(d.id)).some((q) => /Lot Number disagrees with the matched GS1 barcode/.test(q.reason ?? ''))).length;
line(`3. Sticker lot contradicting its printed line: warned on ${lotWarned} of the ${stick.length} documents with that planted problem.`);

// 4. computation ----------------------------------------------------------------------------------------
const mt = full.filter((d) => d.dims.missingTotals);
let returned = 0, netEqual = 0, nets = 0, recorded = 0;
for (const d of mt) {
  const g = key(d).gt; const x0 = raw(d.id); const e = x0.extraction;
  recorded += derivations(x0).filter((q) => q.kind === 'derived' && /^[^.]+\.(?:Net|Total) Amount$/.test(q.field_path ?? '')).length;
  const sec = Object.keys(e).find((k) => /Details$/.test(k) && e[k] && typeof e[k] === 'object' && 'Net Amount' in e[k] && k !== 'Shipping Details');
  const net = sec ? num(e[sec]['Net Amount']) : null; const tot = sec ? num(e[sec]['Total Amount']) : null;
  if (net != null) { returned++; nets++; const s = (g.Items ?? []).reduce((a, r) => a + (num(r['Net Amount']) ?? 0), 0); if (near(net, s)) netEqual++; }
  if (tot != null) returned++;
}
let ver = 0, cor = 0, ver33 = 0;
const mtIds = new Set(mt.map((d) => d.id));
for (const d of board.docs) {
  const L3 = d.lanes?.pipeline?.L3; if (!L3) continue;
  ver += L3.fills_verifiable ?? 0; cor += L3.fills_correct ?? 0; if (mtIds.has(d.id)) ver33 += L3.fills_verifiable ?? 0;
}
line(`4. Computation on the ${mt.length} documents printed without totals: ${returned} of the ${mt.length * 2} missing net and total amounts returned, ${recorded} of them recorded as calculated by the derivation engine; every returned net amount equals the sum of the printed line amounts on ${netEqual} of ${nets}; the keys can check ${ver33} of them. Across all documents, ${cor} of the ${ver} calculated values a key holds matched.`);
const { records: scoredRecords, verdicts } = scoreDocuments({ corpus: loadCorpus(CORPUS), runDir: RUN, population: 'auto', rules: RULES, keepVerdicts: true });
const CALC = /^(?:Invoice|Order) Details\.(?:Net|Total) Amount$/;
let calcCounted = 0, calcElsewhere = 0, taxRepeated = 0, taxEqualsKey = 0;
const manifestById = new Map(manifest.map((d) => [d.id, d]));
for (const r of scoredRecords) {
  const vs = verdicts.get(r.id)?.verdicts ?? [];
  // the tax total returned again in the payment section, where the key leaves Tax Amount empty
  const pl = r.lanes?.pipeline;
  const tax = r.mode === 'fields' && pl?.ok && pl.L5?.critical?.scorable
    ? vs.find((v) => v.verdict === 'spurious' && v.path === 'Payment Details.Tax Amount') : null;
  if (tax) {
    taxRepeated++;
    if (near(amount(tax.out), amount(key(manifestById.get(r.id)).gt?.['Invoice Details']?.['Total Tax']))) taxEqualsKey++;
  }
  const calc = vs.filter((v) => v.verdict === 'spurious' && CALC.test(v.path));
  if (!mtIds.has(r.id)) { calcElsewhere += calc.length; continue; }
  calcCounted += calc.length;
}
line(`4b. The ${mt.length} documents printed without totals: Restraint counts ${calcCounted} calculated net and total amounts as values returned where the key is empty (${calcElsewhere} on other documents).`);
line(`4c. The tax total returned again in the payment section of invoices and credit notes (Payment Details.Tax Amount, which the key leaves empty): ${taxRepeated} documents, on ${taxEqualsKey} of them equal to the key's own Total Tax.`);

// 5. freight restraint -----------------------------------------------------------------------------------
let totals = 0, totalsRight = 0, curr = 0, currRight = 0, counted = 0;
for (const d of full.filter((q) => q.slug === 'freight-invoice')) {
  const g = key(d).gt; const e = raw(d.id).extraction;
  const charges = new Map((e['Line Charges'] ?? []).map((c) => [c['Charge ID'], c]));
  for (const s of e['Freight Shipments'] ?? []) {
    const st = num(s['Shipment Total']); if (st == null) continue;
    totals++;
    const ids = String(s['Line Charges'] ?? '').split(',').map((v) => v.trim()).filter(Boolean);
    const sum = ids.reduce((a, id) => a + (num(charges.get(id)?.Amount) ?? 0), 0);
    if (ids.length && near(sum, st)) totalsRight++;
  }
  for (const c of e['Line Charges'] ?? []) if (c.Currency) { curr++; if (c.Currency === g['Invoice Details']?.['Currency Code']) currRight++; }
  counted += byId.get(d.id)?.lanes?.pipeline?.L2?.spurious ?? 0;
}
line(`5. Freight Restraint: ${totalsRight} of ${totals} shipment totals equal the sum of their charges; ${currRight} of ${curr} charge-line currencies are the document's own; Restraint counts ${counted} values on freight invoices.`);

// 6. receipts ---------------------------------------------------------------------------------------------
const misses = {}; let facts = 0, hit = 0, split = 0;
for (const d of manifest.filter((q) => q.slug === 'receipt')) {
  const g = key(d); const x = raw(d.id);
  for (const f of scoreFacts(g.facts, x.extraction, RULES)) {
    if (f.soft) continue; facts++; if (f.hit) { hit++; continue; }
    misses[f.label] = (misses[f.label] ?? 0) + 1;
    const m = String(f.value ?? g.facts.find((q) => q.label === f.label)?.value ?? '').match(/^([A-Za-z ]+?)\s*\*+\s*(\d{4})$/);
    if (f.label === 'Payment Method' && m) {
      const pay = JSON.stringify(x.extraction.Payments ?? []);
      if (pay.toUpperCase().includes(m[1].trim().toUpperCase()) && pay.includes(m[2])) split++;
    }
  }
}
line(`6. Receipts: ${hit} of ${facts} facts returned; missing by label ${JSON.stringify(misses)}; ${split} of the missing payment facts were returned as a card type and a masked card number in separate payment fields.`);

// 7. held-out consignment -------------------------------------------------------------------------------
if (HELD) {
  const hb = readJson(path.join(HELD, 'scoreboard.json'));
  const rnd = (seed) => { let x = parseInt(crypto.createHash('sha256').update(seed).digest('hex').slice(0, 8), 16) >>> 0; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; };
  for (const slug of ['consignment-invoice', 'consignment-order']) {
    const rows = hb.docs.filter((d) => d.slug === slug).map((d) => { const L2 = d.lanes.pipeline.L2; const c = L2.correct + (L2.normalized ?? 0); return { id: d.id, c, w: L2.wrong, f: c / Math.max(1, c + L2.wrong), merged: d.lanes.pipeline.L1.matched_rows < d.lanes.pipeline.L1.gt_rows }; });
    const C = rows.reduce((a, r) => a + r.c, 0), W = rows.reduce((a, r) => a + r.w, 0);
    const f = rows.map((r) => r.f).sort((a, b) => a - b); const med = (f[(f.length - 1) >> 1] + f[f.length >> 1]) / 2;
    const low = [...rows].sort((a, b) => a.f - b.f).slice(0, 5);
    const R = rnd(`aidp-heldout-consignment:${slug}`); const v = [];
    for (let i = 0; i < 2000; i++) { let c = 0, w = 0; for (let k = 0; k < rows.length; k++) { const r = rows[Math.floor(R() * rows.length)]; c += r.c; w += r.w; } v.push(c / (c + w)); }
    v.sort((a, b) => a - b);
    line(`7. Held-out ${slug}: Fidelity ${(100 * C / (C + W)).toFixed(2)}% over ${rows.length} documents; median document ${(100 * med).toFixed(2)}%; the five lowest hold ${low.reduce((a, r) => a + r.w, 0)} of the ${W} wrong values, ${low.filter((r) => r.merged).length} of them with a table row merged or not matched; 95% range ${(100 * v[49]).toFixed(1)}% to ${(100 * v[1949]).toFixed(1)}%.`);
  }
}

// 8. Traceability's count ---------------------------------------------------------------------------------
// Traceability reads the platform's evidence entries (field_confidence.fields); a returned value with no entry falls
// outside its count (FINDINGS.md, B18). Barcode and flag fields are left out of the returned values, as Decoding
// and the flags are measured elsewhere.
const leavesOf = (o, pre = '', out = []) => {
  if (o == null) return out;
  if (Array.isArray(o)) { o.forEach((v, i) => leavesOf(v, `${pre}.${i}`, out)); return out; }
  if (typeof o === 'object') { for (const k of Object.keys(o)) leavesOf(o[k], pre ? `${pre}.${k}` : k, out); return out; }
  if (String(o).trim()) out.push(pre);
  return out;
};
const TR = {}; const bySection = {};
let returnedValues = 0, withoutEntry = 0, entries = 0, barcodeEntries = 0;
for (const d of full) {
  const x = raw(d.id); const conf = x.field_confidence?.fields ?? {};
  const t = (TR[d.slug] ??= { entries: 0, traceable: 0, returned: 0, without: 0 });
  const keys = Object.keys(conf);
  t.entries += keys.length; entries += keys.length;
  barcodeEntries += keys.filter((k) => /^Barcodes(\.|$)/.test(k)).length;
  t.traceable += Object.values(conf).filter((e) => e && e.source && e.source !== 'none').length;
  for (const p of leavesOf(x.extraction)) {
    if (/^(?:Barcodes|Flags)(?:\.|$)/.test(p)) continue;
    t.returned++; returnedValues++;
    if (!conf[p]) { t.without++; withoutEntry++; const s = p.split('.')[0]; bySection[s] = (bySection[s] ?? 0) + 1; }
  }
}
const mean = (xs) => xs.reduce((a, v) => a + v, 0) / xs.length;
const asScored = mean(Object.values(TR).map((t) => t.traceable / t.entries));
const untraceable = mean(Object.values(TR).map((t) => t.traceable / (t.entries + t.without)));
const measures = board.measures['type-equal'];
const geo = (vals) => 100 * Math.exp(mean(vals.map((v) => Math.log(v))));
const scoreNow = geo(measures.map((m) => m.value));
const scoreCounted = geo(measures.map((m) => (m.id === 'trust.provenance' ? untraceable : m.value)));
const fr = TR['freight-invoice'];
line(`8. Traceability's count: ${entries} evidence entries, ${barcodeEntries} of them for barcode values; ${withoutEntry} of the ${returnedValues} values returned outside the barcode and flag fields (${(100 * withoutEntry / returnedValues).toFixed(1)}%) carry none, by section ${JSON.stringify(Object.fromEntries(Object.entries(bySection).sort((a, b) => b[1] - a[1])))}; on freight invoices ${fr.without} of ${fr.returned} (${(100 * fr.without / fr.returned).toFixed(1)}%). Traceability as scored ${(100 * asScored).toFixed(2)}%; counting those values as untraceable ${(100 * untraceable).toFixed(2)}% (freight invoices ${(100 * fr.traceable / (fr.entries + fr.without)).toFixed(2)}%), and the AIDP Score ${scoreNow.toFixed(2)} would be ${scoreCounted.toFixed(2)}.`);
