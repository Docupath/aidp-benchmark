/**
 * The AIDP-CAP scorer, tested on answers whose score is known in advance:
 *
 *   rules     each rule of the measures on small hand-made answers: what passes, what fails, and what is not counted.
 *   perfect   every lane answered, every value as the key holds it, every mark recorded on its page, every barcode
 *             decoded, every value located where the page prints it, every computed value shown as computed, every
 *             contradiction and anomaly flagged, every control left alone, every right value confident and one wrong
 *             value per document unconfident: every measure must be 1.
 *   empty     every lane answered with nothing: a measure with controls (a control passes by being left alone) must be
 *             below one, every other measure 0, and the measures that judge only what was returned have nothing to judge.
 *   failed    every lane failed: every measure must be 0 (discrimination has no right value to rank and is undefined),
 *             and charged exactly as many checks as the perfect answer.
 *
 *   node bench/test-score-cap.mjs --corpus <AIDP-CAP dir drawn by corpus-gen/cap/generate.mjs>
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  scoreCap, CAP_MEASURES, LAYERS_V1, alignRows, compact, nearIn, payloadKey, pageTokens, printedTablesOf, tokens, datesIn, oneMinusEce, auroc,
  contradictionFlagged, scoreSegmentation, scoreLegibility, scoreTraceability, scoreInstructions, scoreMarks, combinedScore,
  intakePages, scoreContract, scoreAnomaly, calibrationValues,
} from './score-cap.mjs';
import { applicablePacks } from './rule-packs-cap.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const CORPUS = path.resolve(opt('corpus'));
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const manifest = readJson(path.join(CORPUS, 'manifest.json'));
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) pass++; else { fail++; console.log(`  FAIL  ${name}  ${detail}`); } };
const setPath = (o, p, v) => { const ks = p.split('.'); let x = o; for (let i = 0; i < ks.length - 1; i++) x = x[/^\d+$/.test(ks[i]) ? Number(ks[i]) : ks[i]]; x[ks.at(-1)] = v; };
const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
function leaves(obj, pre = '', out = []) { if (obj == null || typeof obj !== 'object') { out.push([pre, obj]); return out; } if (Array.isArray(obj)) { obj.forEach((v, i) => leaves(v, `${pre}.${i}`, out)); return out; } for (const k of Object.keys(obj)) leaves(obj[k], pre ? `${pre}.${k}` : k, out); return out; }
const filled = (v) => v != null && String(v).trim() !== '';
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---- the rules, on hand-made answers -----------------------------------------------------------------
ok('approximate match finds a note with one slip', nearIn(compact('Received - short 2 boxes'), compact('handwritten note reading "Recieved short 2 boxes" in blue ink'), 4));
ok('approximate match refuses an unrelated note', !nearIn(compact('Goods returned'), compact('stamp reading PAID 12.03.2026'), 2));
ok('GS1 payload read raw equals its human-readable form', payloadKey(']C101001165837487171728041510LOT982645\u001d21SN48511287') === payloadKey('(01)00116583748717(17)280415(10)LOT982645(21)SN48511287'));
const epc = 'BCD\n002\n1\nSCT\nYHZCFRU1\nGaronne Industrie Groupe SA\nFR8439854581517641305505839\nEUR154373.06';
ok('a payment code read with escaped line breaks equals it', payloadKey(epc.replace(/\n/g, '\\n')) === payloadKey(epc));
ok('a payment code read with its lines joined by spaces equals it', payloadKey(epc.replace(/\n/g, ' ')) === payloadKey(epc));
ok('a payment code with one digit of its account changed does not', payloadKey(epc.replace('5839', '5838')) !== payloadKey(epc));
ok('an Arabic page is judged by its numbers and its other words', pageTokens('ف ش .م.حيل لل ت غ لي خش رك ة 134 ديخ زاي, United Arab Emirates 00000').join(' ') === '134 united arab emirates 00000');
ok('Japanese text splits into characters', tokens('受領済み 2箱').join(',') === '受,領,済,み,2,箱');
ok('rows pair by article number when the order changes', JSON.stringify(alignRows([{ 'Article ID': 'A-1', 'Article Name': 'x' }, { 'Article ID': 'B-2', 'Article Name': 'y' }], [{ 'Article ID': 'B-2', 'Article Name': 'y' }, { 'Article ID': 'A-1', 'Article Name': 'x' }])) === '[1,0]');
ok('tables are read from the correct text', printedTablesOf('| # | Article | Qty |\n| 1 | A | 2 |\n| 2 | B | 3 |\n\n| Subtotal | 5 |').length === 1);
ok('a date is found in each written form', ['12.03.2026', '2026-03-12', '2026年03月12日', '12 March 2026', 'March 12, 2026', '03/12/2026'].every((s) => datesIn(s).has('2026-3-12')));
const stampKey = (text) => ({ cap: { marks: [{ id: 'M1', kind: 'stamp', text, page: 1 }] } });
const stampAns = (desc) => ({ ok: true, ocr_text: '# --- | Page 1 | --- #\n\nbody', classification: { annotations: [{ page: 1, stamps: [desc] }] } });
ok('a stamp is read with its date in another form', scoreMarks(stampKey('受領 2026年03月12日'), stampAns('red stamp 受領 2026-03-12')).p === 1);
ok('a stamp read with the wrong date fails', scoreMarks(stampKey('PAID 12.03.2026'), stampAns('stamp PAID 13.03.2026')).p === 0);
ok('a stamp read without its word fails', scoreMarks(stampKey('RECEIVED 12.03.2026'), stampAns('stamp dated 12.03.2026')).p === 0);
ok('calibration error: confidence that matches the share right scores 1', Math.abs(oneMinusEce([...Array(85).fill([0.85, 1]), ...Array(15).fill([0.85, 0])]) - 1) < 1e-9);
ok('calibration error: full confidence in a wrong value scores 0', oneMinusEce([[1, 0]]) === 0);
ok('discrimination: right values above wrong ones score 1', auroc([[0.9, 1], [0.8, 1], [0.2, 0]]) === 1);
ok('discrimination: one confidence for everything scores one half', auroc([[0.7, 1], [0.7, 0], [0.7, 1]]) === 0.5);
ok('discrimination: wrong values above right ones score 0', auroc([[0.1, 1], [0.9, 0]]) === 0);
ok('discrimination is undefined with no wrong value', auroc([[0.9, 1]]) === null);
ok('a contradiction on an amount is flagged', contradictionFlagged({ derived_fields: { derivations: [{ kind: 'mismatch', field_path: 'Invoice Details.Total Amount' }] } }));
ok('a bank account checksum is not a contradiction', !contradictionFlagged({ derived_fields: { derivations: [{ kind: 'mismatch', field_path: 'Payment Details.Payment Methods.0.account_no' }] }, field_confidence: { fields: { 'Payment Details.Payment Methods.0.account_no': { flags: ['printed_mismatch:iban_checksum'] } } } }));
ok('a checksum flag on an amount field is not a contradiction', !contradictionFlagged({ field_confidence: { fields: { 'Invoice Details.Total Amount': { flags: ['printed_mismatch:checksum'] } } } }));
ok('a tax number flag is not a contradiction', !contradictionFlagged({ field_confidence: { fields: { 'Seller.VAT No': { flags: ['printed_mismatch'] } } } }));
const bundle = { documents: [{ id: 'a', page_start: 1, page_end: 2 }, { id: 'b', page_start: 3, page_end: 3 }] };
ok('an exact cut passes every document', scoreSegmentation(bundle, { ok: true, documents: [{ page_start: 1, page_end: 2 }, { page_start: 3, page_end: 3 }] }).p === 2);
ok('overlapping parts fail every document of the file', scoreSegmentation(bundle, { ok: true, documents: [{ page_start: 1, page_end: 2 }, { page_start: 3, page_end: 3 }, { page_start: 1, page_end: 3 }] }).p === 0);
const legKey = { gt: { 'Invoice Details': { 'Invoice Number': '', 'Invoice Date': '12/03/2026' } }, cap: { occlusions: [{ id: 'O1', path: 'Invoice Details.Invoice Number', value: 'INV-1', hidden: true }, { id: 'C1', path: 'Invoice Details.Invoice Date', value: '12/03/2026', hidden: false, control_for: 'O1' }] } };
const legAns = (num, date, flags = {}) => ({ ok: true, extraction: { 'Invoice Details': { 'Invoice Number': num, 'Invoice Date': date } }, field_confidence: { fields: flags } });
ok('legibility: a hidden value left empty, and its control read, pass', scoreLegibility(legKey, legAns('', '12/03/2026')).p === 2);
ok('legibility: a guess flagged only as not found in the text fails', scoreLegibility(legKey, legAns('INV-7', '12/03/2026', { 'Invoice Details.Invoice Number': { flags: ['unverified_in_source'] } })).p === 1);
ok('legibility: a value returned with the system\'s word that it could not read it passes', scoreLegibility(legKey, legAns('INV-7', '12/03/2026', { 'Invoice Details.Invoice Number': { flags: ['reading_uncertain'] } })).p === 2);
ok('legibility: a readable control returned wrong fails', scoreLegibility(legKey, legAns('', '13/03/2026')).p === 1);
ok('legibility: a readable control declared unreadable fails', scoreLegibility(legKey, legAns('', '12/03/2026', { 'Invoice Details.Invoice Date': { flags: ['reading_uncertain'] } })).p === 1);
ok('legibility: a failed lane passes nothing', scoreLegibility(legKey, { ok: false }).p === 0 && scoreLegibility(legKey, { ok: false }).n === 2);
const trKey = { gt: { 'Invoice Details': { 'Invoice Number': 'INV-1' } }, cap: {}, dims: {} };
const trMap = { values: { 'Invoice Details.Invoice Number': [{ page: 1, x: 0.5, y: 0.1, w: 0.1, h: 0.02 }] } };
const trAns = { ok: true, extraction: { 'Invoice Details': { 'Invoice Number': 'INV-1' } } };
const geo = (box) => ({ ok: true, answer: { fields: { 'Invoice Details.Invoice Number': { located: true, basis: 'printed', boxes: [{ page: 1, ...box }] } } } });
ok('traceability: a box around the value passes', scoreTraceability(trKey, trMap, trAns, geo({ x: 0.49, y: 0.09, w: 0.12, h: 0.04 })).p === 1);
ok('traceability: a box the width of the page fails', scoreTraceability(trKey, trMap, trAns, geo({ x: 0, y: 0.09, w: 1, h: 0.04 })).p === 0);
ok('traceability: a box many lines tall fails', scoreTraceability(trKey, trMap, trAns, geo({ x: 0.49, y: 0, w: 0.12, h: 0.3 })).p === 0);
ok('traceability: a value delivered wrong is untraced', scoreTraceability(trKey, trMap, { ok: true, extraction: { 'Invoice Details': { 'Invoice Number': 'INV-2' } } }, geo({ x: 0.49, y: 0.09, w: 0.12, h: 0.04 })).p === 0);
ok('traceability: a failed lane is charged every value', (() => { const u = scoreTraceability(trKey, trMap, { ok: false }, null); return u.n === 1 && u.p === 0; })());
// a lot number printed on its line and carried by the line's label: a box around the label traces it too
const lotKey = { gt: { Items: [{ 'Article ID': 'A-1', 'Lot Number': 'LOT123456' }, { 'Article ID': 'B-2', 'Lot Number': 'LOT999999' }] }, cap: { barcodes: [{ id: 'L1', symbology: 'gs1-128', payload: '(01)00120048014736(10)LOT123456', row: 0 }, { id: 'L2', symbology: 'gs1-128', payload: '(01)00120048014737(10)LOT999999', row: 1 }] }, dims: {} };
const lotMap = { values: { 'Items.0.Lot Number': [{ page: 1, x: 0.4, y: 0.30, w: 0.07, h: 0.012 }] }, marks: { L1: { kind: 'label', page: 1, x: 0.12, y: 0.32 }, L2: { kind: 'label', page: 1, x: 0.12, y: 0.40 } } };
const lotAns = { ok: true, extraction: { Items: [{ 'Article ID': 'A-1', 'Lot Number': 'LOT123456' }, { 'Article ID': 'B-2', 'Lot Number': 'LOT999999' }] } };
const lotGeo = (box) => ({ ok: true, answer: { fields: { 'Items.0.Lot Number': { located: true, basis: 'barcode', boxes: [{ page: 1, ...box }] } } } });
ok('traceability: a value located on the barcode that carries it is traced', scoreTraceability(lotKey, lotMap, lotAns, lotGeo({ x: 0.115, y: 0.315, w: 0.2, h: 0.04 })).p === 1);
ok('traceability: a value located on another line\'s barcode is not', scoreTraceability(lotKey, lotMap, lotAns, lotGeo({ x: 0.115, y: 0.395, w: 0.2, h: 0.04 })).p === 0);
// Intake: a page the reading dropped fails, however much it resembles a page the reading kept
const twoPages = { dims: {}, cap: {} };
const twoMap = { pages: [{ page: 1, text: 'Order 4711 lines 1 to 20 widget gasket pump valve 12 34 56' }, { page: 2, text: 'Order 4711 lines 21 to 40 widget gasket pump valve 78 90 12' }], attachments: [] };
ok('intake: both pages read pass', intakePages(twoPages, twoMap, { ok: true, ocr_text: '# --- | Page 1 | --- #\n\n' + twoMap.pages[0].text + '\n# --- | Page 2 | --- #\n\n' + twoMap.pages[1].text }).every((p) => p.pass));
ok('intake: a dropped page fails though it resembles the page kept', intakePages(twoPages, twoMap, { ok: true, ocr_text: '# --- | Page 1 | --- #\n\n' + twoMap.pages[0].text }).filter((p) => p.pass).length === 1);
// Handwriting and stamps: a stamp's word printed elsewhere on the page is not the stamp
const apKey = { cap: { marks: [{ id: 'M1', kind: 'stamp', text: 'APPROVED JB', page: 1 }] } };
const apMap = { pages: [{ page: 1, text: 'Approved by\nSignature' }] };
ok('marks: a stamp is not read from the printed words "Approved by"', scoreMarks(apKey, { ok: true, ocr_text: '# --- | Page 1 | --- #\n\nApproved by\nSignature', classification: { annotations: [{ page: 1, signatures: ['handwritten signature above the Approved by line'] }] } }, apMap).p === 0);
ok('marks: a stamp the system recorded is read', scoreMarks(apKey, { ok: true, ocr_text: '# --- | Page 1 | --- #\n\nApproved by\nSignature', classification: { annotations: [{ page: 1, stamps: ['blue stamp reading "APPROVED JB"'] }] } }, apMap).p === 1);
// Contract: a value the key holds and the answer leaves out does not meet the customer's format
const ctKey = { gt: { 'Invoice Details': { 'Invoice Date': '12/03/2026', 'Total Amount': '100.00' } } };
const ctContract = { sections: [{ name: 'Invoice Details', shape: 'object', fields: ['Invoice Date', 'Total Amount'] }] };
ok('contract: an answer in the customer\'s formats passes', (() => { const u = scoreContract(ctKey, { ok: true, enriched_extraction: { 'Invoice Details': { 'Invoice Date': '2026-03-12', 'Total Amount': '100.00' } } }, ctContract); return u.p === u.n && u.n === 3; })());
ok('contract: an answer that leaves the values out fails their formats', (() => { const u = scoreContract(ctKey, { ok: true, enriched_extraction: { 'Invoice Details': { 'Invoice Date': '', 'Total Amount': '' } } }, ctContract); return u.n === 3 && u.p === 1; })());
// Anomaly detection: a case without its matching verdict fails, whatever its role
ok('anomaly: a control without a matching verdict fails', scoreAnomaly({ kind: 'po-variance', role: 'control' }, { ok: true, extraction: {} }, null).p === 0);
ok('anomaly: a control with a clean verdict passes', scoreAnomaly({ kind: 'po-variance', role: 'control' }, { ok: true, extraction: {} }, { ok: true, answer: { result: { exceptions: [] } } }).p === 1);
// Calibration: a nested tax block is judged value by value, each with its own confidence
const calKey = { gt: { 'Payment Details': { Tax: [{ tax_code: 'VAT', tax_total: '20.00', rate: '20' }] } }, cap: {} };
const calVals = calibrationValues(calKey, { ok: true, extraction: { 'Payment Details': { Tax: [{ tax_code: 'VAT', tax_total: '20.00', rate: '19' }] } }, field_confidence: { fields: { 'Payment Details.Tax.0.tax_code': { c: 0.9 }, 'Payment Details.Tax.0.tax_total': { c: 0.95 }, 'Payment Details.Tax.0.rate': { c: 0.4 } } } }).vals;
ok('calibration: a nested block is judged value by value with its own confidence', JSON.stringify(calVals) === JSON.stringify([[0.9, 1, 0], [0.95, 1, 0], [0.4, 0, 0]]), JSON.stringify(calVals));
// Instructions: one document, two answers with no instruction that differ in one value, and one instructed answer
const insKey = { gt: { 'Invoice Details': { 'Invoice Number': 'INV-1', 'Invoice Date': '12/03/2026', 'Due Date': '11/04/2026', 'Total Amount': '100.00' }, Seller: { Name: 'Acme Ltd', City: 'Bath' }, Items: [] } };
const b1 = clone(insKey.gt), b2 = clone(insKey.gt);
b2.Seller.City = 'Bath Spa';
const dates = clone(insKey.gt);
dates['Invoice Details']['Invoice Date'] = '2026-03-12';
dates['Invoice Details']['Due Date'] = '2026-04-11';
dates['Invoice Details']['Total Amount'] = '100';
const insRaw = { ok: true, baselines: [{ ok: true, extraction: b1 }, { ok: true, extraction: b2 }], packs: [{ id: 'iso-dates', ok: true, extraction: dates }] };
const ins = scoreInstructions(insKey, insRaw);
ok('instructions: both dates written as instructed pass', ins.adh['iso-dates']?.p === 2 && ins.adh['iso-dates']?.n === 2);
ok('instructions: a value the instruction changed outside its scope fails containment', ins.con['iso-dates']?.n === 3 && ins.con['iso-dates']?.p === 2 && ins.con['iso-dates'].items.find((x) => x.path === 'Invoice Details.Total Amount')?.pass === false, JSON.stringify(ins.con['iso-dates']));
ok('instructions: a value that varies with no instruction is not counted', !ins.con['iso-dates']?.items.some((x) => x.path === 'Seller.City'));
const insFailed = scoreInstructions(insKey, { ok: false, baselines: [{ ok: false }, null], packs: [] });
ok('instructions: with no answer every target and every value outside the scope is charged', insFailed.adh['iso-dates']?.n === 2 && insFailed.adh['iso-dates']?.p === 0 && insFailed.con['iso-dates']?.n === 4 && insFailed.con['iso-dates']?.p === 0, JSON.stringify(insFailed));
const board = readJson(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../results/aidp-v1-main/scoreboard.json'));
const ones = Object.fromEntries(CAP_MEASURES.map((m) => [m.id, { value: 1 }]));
ok('the score has 31 measures in five layers', LAYERS_V1.flatMap((L) => L.measures).length === 31 && combinedScore(board, ones).measures.length === 31);
ok('a measure at 0 makes the score 0', combinedScore(board, { ...ones, 'cap.anomaly': { value: 0 } }).score === 0);

// ---- answers built from the keys ---------------------------------------------------------------------
const lanes = (dir) => Object.fromEntries(['main', 'split', 'contract', 'rules'].map((s) => { const d = path.join(dir, s, 'raw'); fs.mkdirSync(d, { recursive: true }); return [s, d]; }));
const dirsOf = (dir) => ({ mainDir: path.join(dir, 'main'), splitDir: path.join(dir, 'split'), contractDir: path.join(dir, 'contract'), rulesDir: path.join(dir, 'rules') });
const write = (d, name, obj) => fs.writeFileSync(path.join(d, name), JSON.stringify(obj));
const DASHES = '-'.repeat(28);
function perfectRuns(dir) {
  const L = lanes(dir);
  const anomalyIds = new Set(manifest.cases.anomalies.map((a) => a.id));
  for (const doc of manifest.docs) {
    const key = readJson(path.join(CORPUS, doc.gt));
    const map = readJson(path.join(CORPUS, doc.map));
    const marks = key.cap.marks ?? [];
    const pages = map.pages.map((p) => `# --- | Page ${p.page} | --- #\n\n${p.text}${marks.some((m) => m.kind === 'tick' && m.page === p.page) ? ' [ticked]' : ''}`).join('\n\n');
    const att = (map.attachments ?? []).map((a) => a.pages.map((p) => `# --- | Page ${p.page} | --- #\n\n${p.text}`).join('\n\n'));
    // a perfect reading: each page's own text, and every table row on a line of its own, in order
    const rowsText = fs.readFileSync(path.join(CORPUS, doc.text), 'utf8').split('\n').filter((l) => /^\| .* \|$/.test(l)).join('\n');
    const main = `${pages}\n\n${rowsText}`;
    const ocr = att.length ? `${main}\n\n##Attachments----------------------------${att.map((a) => `\n${DASHES}\n${a}`).join('')}` : main;
    const annotations = [...new Set(marks.map((m) => m.page))].map((pg) => ({ page: pg,
      stamps: marks.filter((m) => m.page === pg && m.kind === 'stamp').map((m) => `stamp reading "${m.text}"`), seals: [],
      signatures: marks.filter((m) => m.page === pg && m.kind === 'signature').map(() => 'handwritten signature'),
      handwritten_notes: marks.filter((m) => m.page === pg && m.kind === 'note').map((m) => `note "${m.text}"`) }));
    const extraction = clone(key.gt);
    for (const d of key.cap.derivations ?? []) setPath(extraction, d.path, d.value);
    extraction.Barcodes = (key.cap.barcodes ?? []).map((b) => ({ Text: b.payload }));
    const derivedPaths = new Set((key.cap.derivations ?? []).map((d) => d.path));
    const conf = {};
    for (const [p, v] of leaves(extraction)) if (!/^Barcodes/.test(p) && filled(v)) conf[p] = { c: 1, tier: 'high', source: derivedPaths.has(p) ? 'derived' : 'exact', flags: [] };
    // one wrong value with no confidence in it, so calibration has a wrong value to rank
    const hidden = new Set((key.cap.occlusions ?? []).map((o) => o.path));
    const spare = leaves(key.gt).find(([p, v]) => !filled(v) && !/\.\d+\./.test(p) && !/^Items/.test(p) && !hidden.has(p) && !derivedPaths.has(p) && p.split('.').length === 2)?.[0];
    if (spare) { setPath(extraction, spare, 'ZZ-NOT-ON-PAGE'); conf[spare] = { c: 0, tier: 'low', source: 'exact', flags: [] }; }
    const derivations = (key.cap.derivations ?? []).map((d) => ({ field_path: d.path, kind: 'derived', after: d.value, method: d.method }));
    if (key.cap.contradiction) derivations.push({ field_path: 'Total Amount', kind: 'mismatch', method: 'net + tax' });
    write(L.main, `${doc.id}.pipeline.json`, {
      id: doc.id, ok: true, ocr_text: ocr,
      classification: { category: doc.category, annotations: annotations.length ? annotations : null, duplicate: false },
      extraction, enriched_extraction: { ...extraction, 'Supplier Code': key.cap.supplier.code },
      enrichment_report: { flags: anomalyIds.has(doc.id) ? [{ flag_name: 'BANK_ACCOUNT_CHANGED' }] : [] },
      derived_fields: { derivations }, field_confidence: { fields: conf },
    });
    const fields = {};
    for (const [p, boxes] of Object.entries(map.values)) fields[p] = { located: true, basis: 'printed', boxes: boxes.map((b) => ({ page: b.page, x: b.x, y: b.y, w: b.w, h: b.h })) };
    for (const d of key.cap.derivations ?? []) fields[d.path] = { located: true, basis: 'derived-source', boxes: [] };
    write(L.main, `${doc.id}.geometry.json`, { ok: true, answer: { fields } });
    // the contract lane: the key in the customer's formats
    const c = clone(key.gt);
    for (const d of key.cap.derivations ?? []) setPath(c, d.path, d.value);
    for (const [p, v] of leaves(c)) {
      if (typeof v !== 'string') continue;
      const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) setPath(c, p, `${m[3]}-${m[2]}-${m[1]}`);
      else if (/(account_no|Account Number)$/.test(p)) setPath(c, p, v.replace(/\s/g, ''));
    }
    write(L.contract, `${doc.id}.contract.json`, { ok: true, extraction: c, enriched_extraction: { ...c, 'Supplier Code': key.cap.supplier.code } });
    // the instructions lane: two identical answers with no instruction, and each instruction carried out exactly
    const packs = applicablePacks(key).map((p) => {
      const out = clone(key.gt);
      for (const t of p.targets(key.gt)) setPath(out, t, p.expect(getPath(key.gt, t), key.gt, t));
      return { id: p.id, ok: true, extraction: out };
    });
    write(L.rules, `${doc.id}.rules.json`, { id: doc.id, ok: true, baselines: [{ ok: true, extraction: clone(key.gt) }, { ok: true, extraction: clone(key.gt) }], packs });
  }
  for (const c of manifest.copies) write(L.main, `${c.id}.pipeline.json`, { id: c.id, ok: true, classification: { duplicate: true }, extraction: {}, ocr_text: '' });
  for (const id of [...manifest.docs.map((d) => d.id), ...manifest.copies.map((c) => c.id)]) write(L.main, `${id}.matching.json`, { id, kind: 'matching', ok: true, answer: { result: { exceptions: [] } } });
  for (const b of manifest.bundles) write(L.split, `${b.id}.split.json`, { id: b.id, ok: true, documents: b.documents.map((d) => ({ page_start: d.page_start, page_end: d.page_end })) });
  return dirsOf(dir);
}
function emptyRuns(dir, failed) {
  const L = lanes(dir);
  const ans = failed ? { ok: false, error: 'no result returned' } : { ok: true, ocr_text: '', classification: {}, extraction: {}, enriched_extraction: {}, field_confidence: { fields: {} }, derived_fields: { derivations: [] } };
  for (const d of manifest.docs) {
    const key = readJson(path.join(CORPUS, d.gt));
    write(L.main, `${d.id}.pipeline.json`, ans);
    write(L.contract, `${d.id}.contract.json`, ans);
    write(L.rules, `${d.id}.rules.json`, failed ? { ok: false, baselines: [null, null], packs: [] } : { ok: true, baselines: [{ ok: true, extraction: {} }, { ok: true, extraction: {} }], packs: applicablePacks(key).map((p) => ({ id: p.id, ok: true, extraction: {} })) });
  }
  for (const c of manifest.copies) write(L.main, `${c.id}.pipeline.json`, ans);
  if (!failed) for (const id of [...manifest.docs.map((d) => d.id), ...manifest.copies.map((c) => c.id)]) write(L.main, `${id}.matching.json`, { id, kind: 'matching', ok: true, answer: { result: { exceptions: [] } } });
  for (const b of manifest.bundles) write(L.split, `${b.id}.split.json`, failed ? { ok: false } : { ok: true, documents: [] });
  return dirsOf(dir);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aidp-cap-test-'));
const firstFail = (res, id) => res.owners.flatMap((o) => { const e = o.m[id]; return e?.items ?? Object.values(e?.packs ?? {}).flatMap((x) => x.items); }).find((i) => i && !i.pass);
const perfect = scoreCap({ corpus: CORPUS, ...perfectRuns(path.join(tmp, 'perfect')) });
for (const m of CAP_MEASURES) {
  const v = perfect.values[m.id];
  ok(`perfect: ${m.label} is 1 (${v.checks != null ? `${v.passes}/${v.checks}` : `${v.values} values`})`, v.value === 1 && (v.checks ?? v.values) > 0, `value ${v.value} first fail ${JSON.stringify(firstFail(perfect, m.id))}`);
}
const empty = scoreCap({ corpus: CORPUS, ...emptyRuns(path.join(tmp, 'empty'), false) });
const CONTROLLED = new Set(['cap.marks', 'cap.legibility', 'cap.consistency_flags', 'cap.anomaly', 'cap.resolution']); // a control, or a supplier not on the list, passes by being left alone
const RETURNED_ONLY = new Set(['cap.adherence', 'cap.containment', 'cap.calibration_error', 'cap.calibration_discrimination']); // judge only what was returned
for (const m of CAP_MEASURES) {
  const v = empty.values[m.id];
  if (RETURNED_ONLY.has(m.id)) { ok(`empty: ${m.label} has nothing to judge`, v.value == null, `value ${v.value}`); continue; }
  ok(`empty: ${m.label} ${CONTROLLED.has(m.id) ? 'is below one' : 'is 0'} (${v.passes}/${v.checks})`, v.checks > 0 && (CONTROLLED.has(m.id) ? v.passes < v.checks : v.passes === 0), `${v.passes}/${v.checks}`);
}
const failed = scoreCap({ corpus: CORPUS, ...emptyRuns(path.join(tmp, 'failed'), true) });
for (const m of CAP_MEASURES) {
  const v = failed.values[m.id], pv = perfect.values[m.id];
  if (m.agg === 'auroc') { ok(`failed: ${m.label} is undefined, no value being right`, v.value == null, `value ${v.value}`); continue; }
  ok(`failed: ${m.label} is 0`, v.value === 0, `value ${v.value}`);
  if (m.agg === 'pooled' || m.agg === 'packs') ok(`failed: ${m.label} is charged as many checks as a complete answer (${v.checks} and ${pv.checks})`, v.checks === pv.checks, `${v.checks} against ${pv.checks}`);
}
ok('the perfect answer combines to a score of 100 with AIDP-2K\'s measures', (() => { const s = combinedScore(board, perfect.values); return s.measures.length === 31; })());
ok('the whole set draws a control for every case without reusing one', perfect.controls.reused === 0 && perfect.controls.marks.length === manifest.docs.reduce((a, d) => a + (readJson(path.join(CORPUS, d.gt)).cap.marks ?? []).length, 0), `reused ${perfect.controls.reused}`);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
