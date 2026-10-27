/**
 * Draws AIDP-CAP: the PDFs, the answer keys, the page texts, the maps of where every value lands, the customer's
 * supplier lists, the files that hold several documents, the copies sent twice, and the manifest. Deterministic from
 * --seed, like AIDP-2K: the keys, texts and manifest regenerate byte for byte. Needs a browser (npx playwright install
 * chromium) and mupdf (npm ci).
 *
 *   node aidp-bench/corpus-gen/cap/generate.mjs --seed <seed> --out <dir> [--concurrency 6] [--pilot <n per type>]
 *
 * --pilot draws only the first n documents of each type (the plan is always the whole corpus), to look at pages.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { Rng } from '../rng.mjs';
import { barcodePng } from '../barcode.mjs';
import { contractFor } from '../contract.mjs';
import { FIELDS_VERSION } from '../fields-snapshot.mjs';
import { planCap, textOf, getPath } from './build.mjs';
import * as K from './composition.mjs';
import { pageHtml, attachmentHtml } from './render.mjs';
import { drawMarks } from './marks.mjs';
import { readMap, turnPage, rescan, concat, pageCount } from './pdf.mjs';
import { capText } from './text.mjs';
import { supplierCsv, compactAccount } from './suppliers.mjs';
import { serveFonts, fontRecord } from './fonts.mjs';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.lastIndexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const SEED = opt('seed', null);
if (!SEED) { console.error('--seed is required'); process.exit(2); }
const OUT = path.resolve(opt('out', 'aidp-bench/corpus-cap'));
const CONC = Number(opt('concurrency', '6'));
const PILOT = opt('pilot', null) != null ? Number(opt('pilot')) : null;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const writeJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 1));

const t0 = Date.now();
const plan = planCap(SEED);
fs.mkdirSync(OUT, { recursive: true });
const docs = PILOT == null ? plan.docs : K.CAP_TYPES.flatMap((s) => plan.docs.filter((d) => d.slug === s).slice(0, PILOT));
console.log(`AIDP-CAP: ${docs.length} documents of ${plan.docs.length} planned -> ${OUT} (seed "${SEED}")`);

// ---- the customer's reference data ----------------------------------------------------------------
fs.mkdirSync(path.join(OUT, 'customer'), { recursive: true });
const suppliersCsv = supplierCsv(plan.suppliers);
fs.writeFileSync(path.join(OUT, 'customer', 'suppliers.csv'), suppliersCsv);
// the bank master: the approved account of every supplier that has one, written without spaces as a ledger keeps it
const bankCsv = ['VAT Number,Approved Account', ...plan.suppliers.filter((s) => s.approved_account).map((s) => `${s.vat},${compactAccount(s.approved_account)}`)].join('\n') + '\n';
fs.writeFileSync(path.join(OUT, 'customer', 'bank_master.csv'), bankCsv);

// ---- attachments' content ---------------------------------------------------------------------------
function attachmentContent(att, d) {
  const r = new Rng(`${SEED}:attachment:${att.id}`);
  const ct = d.content;
  const number = textOf(ct.metaRows?.find((x) => x.key === 'number')?.value ?? ct.sections?.[0]?.table?.rows?.[0]?.[1]);
  const person = r.pick(ct.locale.people);
  if (att.kind === 'letter') {
    return { ...att, title: 'COVER LETTER', paragraphs: [
      `Please find enclosed our ${ct.title.toLowerCase()} ${number}.`,
      r.pick(['The goods were dispatched in full and the delivery note is enclosed.', 'Please contact us if any line differs from your order.', 'Payment details are printed on the enclosed document.']),
      `Reference for your records: ${number}. Thank you for your business.`,
    ], closing: `Kind regards, ${person}` };
  }
  const items = ct.kind === 'commercial' ? ct.rows : [];
  if (att.kind === 'delivery-note') {
    const rows = items.slice(0, 30).map((row, i) => [String(i + 1), textOf(row.id) || '-', textOf(row.name), textOf(row.qty), textOf(row.uom)]);
    return { ...att, title: 'DELIVERY NOTE', intro: `Delivery for ${number}. Received in good condition unless noted.`, cols: ['Pos', 'Article', 'Description', 'Qty', 'Unit'], rows, footer: `Packed by ${person}` };
  }
  const cartons = Math.max(1, Math.min(18, Math.ceil(items.length / 3) || r.int(2, 6)));
  const rows = Array.from({ length: cartons }, (_, i) => [`CTN-${String(i + 1).padStart(2, '0')}`, `${r.int(1, 6)} items`, `${(r.int(15, 240) / 10).toFixed(1)} kg`]);
  return { ...att, title: 'PACKING LIST', intro: `Packing list for ${number}.`, cols: ['Carton', 'Contents', 'Gross weight'], rows, footer: `${cartons} cartons in total` };
}

// ---- drawing ------------------------------------------------------------------------------------
async function pdfOf(page, html) {
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  return page.pdf({ format: 'A4', printBackground: true });
}
const DIM = { 'gs1-128': { scale: 2, height: 9 }, gs1datamatrix: { scale: 3 }, qrcode: { scale: 2 }, code128: { scale: 2, height: 10 } };

async function drawDoc(page, d) {
  const dir = path.join(OUT, d.slug);
  fs.mkdirSync(dir, { recursive: true });
  d.theme = new Rng(`${SEED}:theme:${d.id}`).int(0, 3);
  const assets = { marks: await drawMarks(page, d, SEED), labels: {}, barcodes: {}, labelHeights: {} };
  for (const l of d.cap.labels) {
    assets.labels[l.id] = await barcodePng(l.symbology, l.payload, { ...DIM[l.symbology], includetext: l.symbology === 'gs1-128' });
    assets.labelHeights[l.id] = l.symbology === 'gs1datamatrix' ? 46 : 34;
  }
  for (const b of d.content.barcodes) assets.barcodes[b.id] = await barcodePng(b.symbology, b.payload, { ...DIM[b.symbology], includetext: b.symbology !== 'qrcode' });

  const real = pageHtml(d, assets, { map: false });
  let pdf = await pdfOf(page, real.html);
  const mapped = pageHtml(d, assets, { map: true });
  const mapPdf = await pdfOf(page, mapped.html);
  const m = await readMap(mapPdf);
  const n = await pageCount(pdf);
  if (n !== m.pages.length) throw new Error(`${d.id}: page and map differ in pages (${n} and ${m.pages.length})`);
  let turned = null;
  if (d.cond.upsideDown) {
    turned = Math.min(n - 1, Math.floor(d.cond.upsideDownAt * n));
    pdf = await turnPage(pdf, turned);
  }
  fs.writeFileSync(path.join(dir, `${d.id}.pdf`), pdf);

  // where each value, mark and label landed: a turned page's boxes are turned with it
  const flip = (b) => (turned != null && b.page === turned + 1 ? { ...b, x: 1 - b.x - (b.w ?? 0), y: 1 - b.y - (b.h ?? 0) } : b);
  const values = {};
  for (const c of mapped.cells) for (const p of c.paths) for (const b of m.cells[c.i] ?? []) (values[p] ??= []).push({ ...flip(b), occlusion: c.occ });
  const marksAt = {};
  for (const mk of mapped.marks) if (m.marks[mk.i]) marksAt[mk.id] = { kind: mk.kind, ...flip(m.marks[mk.i]) };
  for (const mk of d.cap.marks) mk.page = marksAt[mk.id]?.page ?? null;
  for (const o of d.cap.occlusions) o.page = marksAt[o.id]?.page ?? null;
  for (const l of d.cap.labels) l.page = marksAt[l.id]?.page ?? null;
  for (const b of d.cap.barcodes) b.page = marksAt[b.id]?.page ?? null;
  const unplaced = [...d.cap.marks, ...d.cap.occlusions, ...d.cap.labels].filter((x) => x.page == null).map((x) => x.id);
  if (unplaced.length) throw new Error(`${d.id}: marks not found on the map: ${unplaced.join(', ')}`);
  // a label sits on the page of the line it belongs to
  for (const l of d.cap.labels) {
    const linePages = new Set(Object.entries(values).filter(([p]) => p.startsWith(`Items.${l.row}.`)).flatMap(([, bs]) => bs.map((b) => b.page)));
    if (linePages.size && !linePages.has(l.page)) throw new Error(`${d.id}: label ${l.id} is on page ${l.page}, its line on ${[...linePages]}`);
  }
  // a readable control is the nearest value of the same kind, so a page break can fall between it and the value it
  // stands beside; each records its own page, and the scorer needs nothing more

  // attachments
  const attFiles = [];
  const attPages = [];
  for (const a of d.attachments) {
    const att = attachmentContent(a, d);
    const aPdf = await pdfOf(page, attachmentHtml(att, d, assets));
    fs.writeFileSync(path.join(dir, `${a.id}.pdf`), aPdf);
    const aMap = await readMap(await pdfOf(page, attachmentHtml({ ...att, scanned: false }, d, assets)));
    attFiles.push({ file: `${d.slug}/${a.id}.pdf`, external_attachment_id: a.id, kind: a.kind, scanned: a.scanned, pages: aMap.pages.length });
    attPages.push({ id: a.id, pages: aMap.pages.map((p) => ({ page: p.page, text: p.text })) });
  }

  const key = {
    id: d.id, slug: d.slug, category: d.category, category_alt: [], mode: 'fields', locale: d.dims.locale.id,
    dims: { scale: d.dims.scale, noise: d.dims.noise, coverPage: d.dims.coverPage, scanned: !!d.scanned, upside_down_page: turned == null ? null : turned + 1 },
    phase: d.phase, case: d.cap.case, gt: d.gt,
    cap: {
      supplier: d.cap.supplier, bank: d.cap.bank ?? null, po_number: d.cap.poNumber ?? null, amount_jump: d.amountJump ?? null,
      marks: d.cap.marks.map(({ id, kind, text, page: pg, place, row }) => ({ id, kind, text: kind === 'tick' ? null : text, page: pg, place, ...(row != null ? { row } : {}) })),
      occlusions: d.cap.occlusions, derivations: d.cap.derivations, contradiction: d.cap.contradiction,
      labels: d.cap.labels, barcodes: d.cap.barcodes, parsing: d.cap.parsing,
    },
  };
  writeJson(path.join(dir, `${d.id}.gt.json`), key);
  fs.writeFileSync(path.join(dir, `${d.id}.gt.txt`), capText(d));
  writeJson(path.join(dir, `${d.id}.map.json`), { id: d.id, pages: m.pages.map((p) => ({ page: p.page, width: p.width, height: p.height, text: p.text })), values, marks: marksAt, attachments: attPages });
  return { id: d.id, slug: d.slug, category: d.category, locale: d.dims.locale.id, phase: d.phase, role: d.role, case: d.caseKind ?? null,
    pages: n, scanned: !!d.scanned, file: `${d.slug}/${d.id}.pdf`, gt: `${d.slug}/${d.id}.gt.json`, text: `${d.slug}/${d.id}.gt.txt`, map: `${d.slug}/${d.id}.map.json`, attachments: attFiles };
}

const browser = await chromium.launch();
const BROWSER = { playwright: createRequire(import.meta.url)('playwright/package.json').version, chromium: browser.version() };
const manifestDocs = [];
const queue = [...docs];
let done = 0, failed = 0, retried = 0;
const freshPage = async () => { const p = await browser.newPage(); p.setDefaultTimeout(120000); await serveFonts(p); return p; };
await Promise.all(Array.from({ length: CONC }, async () => {
  let page = await freshPage();
  for (;;) {
    const d = queue.shift();
    if (!d) break;
    // a document is drawn from the seed alone, so drawing it again on a fresh page draws the same bytes: a page that
    // hangs or crashes is retried, and a document that still fails stops the corpus
    for (let attempt = 1; ; attempt++) {
      try { manifestDocs.push(await drawDoc(page, d)); break; } catch (e) {
        await page.close().catch(() => {});
        page = await freshPage();
        if (attempt < 3) { retried++; console.error(`retry ${d.id} (${attempt}): ${String(e?.message ?? e).split('\n')[0].slice(0, 160)}`); continue; }
        failed++; console.error(`FAIL ${d.id}: ${String(e?.stack ?? e).slice(0, 400)}`); break;
      }
    }
    if (++done % 100 === 0) console.log(`  ${done}/${docs.length}`);
  }
  await page.close();
}));
await browser.close();
if (failed) { console.error(`${failed} documents could not be drawn: no manifest is written, and the corpus is incomplete`); process.exit(1); }
manifestDocs.sort((a, b) => a.id.localeCompare(b.id));
const byId = new Map(manifestDocs.map((x) => [x.id, x]));

// ---- the copies sent twice -------------------------------------------------------------------------
fs.mkdirSync(path.join(OUT, 'copies'), { recursive: true });
const copies = [];
for (const c of plan.duplicates) {
  const orig = byId.get(c.of);
  if (!orig) continue;
  const bytes = fs.readFileSync(path.join(OUT, orig.file));
  const out = c.how === 'same-file' ? bytes : await rescan(bytes, 0.6);
  fs.writeFileSync(path.join(OUT, 'copies', `${c.id}.pdf`), out);
  copies.push({ id: c.id, of: c.of, how: c.how, file: `copies/${c.id}.pdf`, slug: orig.slug, category: orig.category });
}

// ---- files that hold several documents, and single-document controls ---------------------------------
fs.mkdirSync(path.join(OUT, 'bundles'), { recursive: true });
const rb = new Rng(`${SEED}:bundles`);
// a document with a transmittal cover sheet is left out: where such a sheet ends is a matter of convention
const pool = rb.shuffle(manifestDocs.filter((x) => x.phase === 'A' && !plan.docs.find((d) => d.id === x.id).dims.coverPage));
const bundles = [];
const B = K.BUNDLES;
let at = 0;
for (let b = 0; b < B.files && at < pool.length; b++) {
  const size = rb.int(B.docsMin, B.docsMax);
  const members = pool.slice(at, at + size);
  at += size;
  if (members.length < 2) break;
  const scanned = rb.chance(B.scanned);
  const bytes = await concat(members.map((x) => fs.readFileSync(path.join(OUT, x.file))), { scanned });
  const id = `cap-bundle-${String(b + 1).padStart(3, '0')}`;
  fs.writeFileSync(path.join(OUT, 'bundles', `${id}.pdf`), bytes);
  let p = 0;
  bundles.push({ id, file: `bundles/${id}.pdf`, scanned, control: false, documents: members.map((x) => ({ id: x.id, slug: x.slug, page_start: (p += 1, p), page_end: (p += x.pages - 1, p) })) });
}
const singles = pool.slice(at).filter((x) => x.pages >= 2).slice(0, B.controls);
for (let k = 0; k < singles.length; k++) {
  const x = singles[k];
  const scanned = rb.chance(B.scanned);
  const raw = fs.readFileSync(path.join(OUT, x.file));
  const bytes = scanned && !x.scanned ? await concat([raw], { scanned: true }) : raw;
  const id = `cap-single-${String(k + 1).padStart(3, '0')}`;
  fs.writeFileSync(path.join(OUT, 'bundles', `${id}.pdf`), bytes);
  bundles.push({ id, file: `bundles/${id}.pdf`, scanned: scanned || x.scanned, control: true, documents: [{ id: x.id, slug: x.slug, page_start: 1, page_end: x.pages }] });
}

// ---- contract and manifest -----------------------------------------------------------------------
const contracts = Object.fromEntries(K.CAP_TYPES.map((s) => [s, contractFor(s)]));
writeJson(path.join(OUT, 'contract.json'), { description: 'The output contract of each AIDP-CAP type: the same published contract as AIDP-2K (aidp-bench/corpus/contract.json). The customer contract that Contract is checked against adds the customer\'s own field and formats: see aidp-bench/bench/cap-customer.mjs.', fields_version: FIELDS_VERSION, contracts });
// a pilot draws only some documents: its cases and samples keep only those it drew
const drawn = new Set([...manifestDocs.map((x) => x.id), ...copies.map((x) => x.id)]);
const keep = (xs, idOf = (x) => x.id) => (PILOT == null ? xs : xs.filter((x) => drawn.has(idOf(x))));
const manifest = {
  seed: SEED, corpus: 'AIDP-CAP', count: K.CAP_PER_TYPE, types: K.CAP_TYPES,
  generator_settings: { valid_accounts: true, due_dates_from_terms: true, accounts: 'national formats: IBANs of each country\'s length and layout with valid check digits; domestic account numbers where the country uses no IBAN (US, IN, JP)' },
  drawing: { ...BROWSER, fonts: fontRecord(), note: 'pages and marks are drawn with these fonts only, so the same seed draws the same pages with this browser on any machine' },
  realized: realizedCounts(),
  composition: { scale: K.SCALE, noise: K.NOISE, conditions: K.CONDITIONS, name_kinds: K.NAME_KINDS, mark_kinds: K.MARK_KINDS, labels: K.LABELS, bundles: K.BUNDLES, anomalies: K.ANOMALIES, instructions_per_type: K.INSTRUCTIONS_PER_TYPE },
  customer: {
    catalogues: [
      { name: 'suppliers', file: 'customer/suppliers.csv', sha256: sha(suppliersCsv), columns: suppliersCsv.split('\n')[0].split(',') },
      { name: 'bank_master', file: 'customer/bank_master.csv', sha256: sha(bankCsv), columns: bankCsv.split('\n')[0].split(',') },
    ],
    suppliers: plan.suppliers.length,
  },
  phases: { A: manifestDocs.filter((x) => x.phase === 'A').map((x) => x.id), B: [...manifestDocs.filter((x) => x.phase === 'B').map((x) => x.id), ...copies.map((x) => x.id)] },
  cases: { links: keep(plan.links, (x) => x.invoice).filter((x) => PILOT == null || drawn.has(x.po)), anomalies: keep(plan.anomalies), controls: keep(plan.controls) },
  samples: { instructions: keep(plan.instructionsSample, (x) => x), contract: keep(plan.contractSample, (x) => x) },
  docs: manifestDocs, copies, bundles,
  pilot: PILOT,
};
writeJson(path.join(OUT, 'manifest.json'), manifest);

function realizedCounts() {
  const keys = plan.docs.filter((d) => byId.has(d.id));
  const c = (f) => keys.filter(f).length;
  const sum = (f) => keys.reduce((a, d) => a + f(d), 0);
  return {
    documents: keys.length, scanned: c((d) => d.scanned), with_attachments: c((d) => d.attachments.length), attachments: sum((d) => d.attachments.length),
    upside_down: c((d) => d.cond.upsideDown), with_marks: c((d) => d.cap.marks.length), marks: sum((d) => d.cap.marks.length),
    hidden_values: sum((d) => d.cap.occlusions.filter((o) => o.hidden).length), legibility_controls: sum((d) => d.cap.occlusions.filter((o) => !o.hidden).length),
    with_derivations: c((d) => d.cap.derivations.length), derivations: sum((d) => d.cap.derivations.length), contradictions: c((d) => !!d.cap.contradiction),
    labels: sum((d) => d.cap.labels.length), label_only_labels: sum((d) => d.cap.labels.filter((l) => l.label_only).length), barcodes: sum((d) => d.cap.barcodes.length),
    unlisted_suppliers: c((d) => !d.cap.supplier.listed), vat_printed: c((d) => d.cap.supplier.vat_printed),
    anomaly_cases: plan.anomalies.length, anomaly_controls: plan.controls.length, note: 'the shares in composition are drawn before case documents and their history clear their own conditions; these are the counts drawn',
  };
}
console.log(`AIDP-CAP: ${manifestDocs.length} documents, ${copies.length} copies, ${bundles.length} files for splitting, ${retried} retried, in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
process.exit(failed ? 1 : 0);
