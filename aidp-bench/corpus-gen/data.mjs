// GT-first document builders. The ground truth (or fact list) is built FIRST and the renderer renders
// ONLY these values, so a model output value absent from GT is a hallucination by definition and a
// GT value absent from output is a completeness miss by definition.
//
// Scoring modes: 'fields' (types with a field contract; GT keyed exactly to the frozen field definitions) and
// 'facts' (types without one; label->value facts scored by deep search). Both carry the classification
// category, expected flags, and the dimension metadata.
import { Rng } from './rng.mjs';
import { LOCALES, PRODUCTS, SERVICES, gtNum, gtDate, addDays } from './lex.mjs';
import { skeleton, itemSkeleton, hasField, contractRow } from './schema.mjs';
import { ean13, gs1 } from './barcode.mjs';

const FIELD_MODE = new Set(['invoice', 'credit-note', 'customer-specific-invoice', 'purchase-order', 'consignment-invoice', 'consignment-order', 'freight-invoice', 'argentine-invoice']);
const ITEMY = new Set(['invoice', 'credit-note', 'customer-specific-invoice', 'purchase-order', 'consignment-invoice', 'consignment-order', 'quote', 'receipt']);
const BUNDLE_OK = new Set(['invoice', 'purchase-order', 'consignment-order']);

const CATEGORY = {
  invoice: 'Invoice', 'purchase-order': 'Purchase Order', 'credit-note': 'Credit Note', 'customer-specific-invoice': 'Customer-Specific Invoice',
  'legal-invoice': 'Legal Invoice', 'freight-invoice': 'Freight Invoice', 'consignment-invoice': 'Consignment Invoice',
  'argentine-invoice': 'Argentine Invoice', 'consignment-order': 'Consignment Order', quote: 'Quote', receipt: 'Receipt',
  'bank-statement': 'Bank Statement', 'form-i-9': 'Form I-9',
  'general-contract': 'General Contract', 'partnership-agreement': 'Partnership Agreement',
  'confidentiality-agreement-nda': 'Confidentiality Agreement (NDA)', 'e-signature-platform-contract': 'E-Signature Platform Contract',
  'execution-record': 'Execution Record', other: 'Other',
};

function party(r, loc, withVat) {
  const [city, postal] = r.pick(loc.cities);
  return {
    name: r.pick(loc.companies), street: r.pick(loc.streets), city, postal,
    country: loc.country, cc: loc.cc, countryDisp: loc.country,
    vat: withVat ? loc.vat(r) : '', reg: loc.vatField === 'Registration No' ? '' : (r.chance(0.5) ? `${loc.cc}-${r.digits(6)}` : ''),
  };
}
/**
 * Generator settings, both off by default so the published seed reproduces AIDP-2K exactly. Each one draws the same
 * random numbers as the default and changes only what is printed:
 *   validAccounts      bank account numbers (IBANs) carry valid check digits (ISO 13616, mod 97) instead of random
 *                      ones; only the two check digits change, and the account part keeps its random digits
 *   dueDatesFromTerms  the due date is 30 days after the document date, matching the payment terms of 30 days
 *                      that every page printing terms carries (a freight invoice prints none), instead of being
 *                      drawn separately from them
 */
export const GEN_OPTIONS = { validAccounts: false, dueDatesFromTerms: false };
/** Sets the generator settings from command-line flags: --valid-accounts and --due-dates-from-terms. */
export function applyGeneratorFlags(args) {
  GEN_OPTIONS.validAccounts = args.includes('--valid-accounts');
  GEN_OPTIONS.dueDatesFromTerms = args.includes('--due-dates-from-terms');
}
/** The settings that are on, for a corpus manifest: nothing when both are off, so the default manifest is unchanged. */
export function generatorSettingsRecord() {
  const on = Object.entries(GEN_OPTIONS).filter(([, v]) => v);
  return on.length ? { generator_settings: Object.fromEntries(on) } : {};
}
/** ISO 13616 check digits for a country code and the account part (the BBAN) of an IBAN. */
export function ibanCheckDigits(country, bban) {
  const digits = [...`${bban}${country}00`].map((ch) => (/[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55))).join('');
  return String(98n - (BigInt(digits) % 97n)).padStart(2, '0');
}
function iban(r, cc) {
  const country = cc === 'CH' ? 'CH' : cc === 'GB' ? 'GB' : cc === 'JP' ? 'DE' : cc;
  const drawn = r.digits(2);
  const groups = [r.digits(4), r.digits(4), r.digits(4), r.digits(4), r.digits(2)];
  return `${country}${GEN_OPTIONS.validAccounts ? ibanCheckDigits(country, groups.join('')) : drawn} ${groups.join(' ')}`;
}
function bic(r) { return `${'ABCDEFG'[r.int(0, 6)]}${'XYZQRS'[r.int(0, 5)]}BK${r.pick(['DE', 'CH', 'GB', 'FR', 'SE'])}${r.digits(2)}`; }

function pickDims(r, slug) {
  const locale = r.pick([...LOCALES.slice(0, 2), ...LOCALES, r.pick(LOCALES)]); // EN slightly heavier
  let scale = 'small';
  if (ITEMY.has(slug)) {
    const x = r.next();
    scale = x < 0.5 ? 'small' : x < 0.78 ? 'medium' : x < 0.93 ? 'large' : 'xl';
    if (scale === 'xl' && !['invoice', 'purchase-order'].includes(slug)) scale = 'large';
  }
  const nx = r.next();
  const noise = nx < 0.25 ? 'none' : nx < 0.6 ? 'light' : nx < 0.85 ? 'medium' : 'heavy';
  // missingTotals and mismatch are mutually exclusive: a doc with no printed totals cannot also carry a
  // contradicting printed total (the combination is unsatisfiable and unfair to score).
  const missingTotals = ['invoice', 'credit-note', 'customer-specific-invoice'].includes(slug) && r.chance(0.1);
  const mismatch = !missingTotals && ['invoice', 'purchase-order', 'customer-specific-invoice'].includes(slug) && r.chance(0.1);
  return {
    locale, scale, noise,
    coverPage: r.chance(0.06),
    bundle: BUNDLE_OK.has(slug) && r.chance(0.08),
    missingTotals,
    mismatch,
    stickerMismatch: slug === 'consignment-invoice' && r.chance(0.12),
  };
}

const itemsCount = (r, scale) => scale === 'small' ? r.int(1, 4) : scale === 'medium' ? r.int(18, 45) : scale === 'large' ? r.int(120, 220) : 500;

function makeItems(r, loc, n, bank, withLotSerial) {
  const items = [];
  for (let i = 0; i < n; i++) {
    const [pfx, name, desc] = r.pick(bank);
    const qty = r.int(1, 50);
    const price = loc.noDecimals ? r.int(100, 9000) : r.money(2, 480);
    const net = Math.round(qty * price * 100) / 100;
    items.push({
      no: String(i + 1), id: `${pfx}-${r.digits(5)}`, name, desc,
      qty, uom: r.pick(['pcs', 'EA', 'box', 'kg', 'set']), price, net,
      lot: withLotSerial ? `LOT${r.digits(6)}` : '', serial: withLotSerial && r.chance(0.6) ? `SN${r.digits(8)}` : '',
    });
  }
  return items;
}
const sum = (items) => Math.round(items.reduce((a, it) => a + it.net, 0) * 100) / 100;

/** Localized meta/totals/payment rows + GT/facts for the commercial family. */
function commercialCore(r, slug, dims) {
  const loc = dims.locale; const L = loc.labels;
  const seller = party(r, loc, true);
  const buyer = party(r, loc, ['purchase-order', 'consignment-invoice', 'consignment-order', 'customer-specific-invoice'].includes(slug));
  const d0 = { y: 2026, m: r.int(1, 5), d: r.int(1, 28) };
  const drawnDays = r.pick([14, 30, 45]);
  const due = addDays(d0, GEN_OPTIONS.dueDatesFromTerms ? 30 : drawnDays); // 30 days: the terms every page that prints terms carries
  const number = `${slug === 'purchase-order' ? 'PO' : slug === 'credit-note' ? 'CN' : slug.startsWith('consignment') ? 'CSG' : 'INV'}-${2026}-${r.digits(5)}`;
  const refPerson = r.pick(loc.people);
  const bank = r.chance(0.85) ? PRODUCTS : SERVICES;
  const withLotSerial = slug.startsWith('consignment');
  let items = makeItems(r, loc, itemsCount(r, dims.scale), bank, withLotSerial);
  const negate = slug === 'credit-note' && r.chance(0.35);
  if (negate) items = items.map((it) => ({ ...it, net: -it.net }));
  const net = sum(items);
  const taxRate = loc.taxRate;
  const taxRows = [];
  if (loc.dualTax) {
    const half = Math.round(net * (taxRate / 2) ) / 100;
    taxRows.push({ code: 'CGST', rate: taxRate / 2, total: half }, { code: 'SGST', rate: taxRate / 2, total: half });
  } else if (loc.hasRE && r.chance(0.35)) {
    taxRows.push({ code: 'IVA', rate: taxRate, total: Math.round(net * taxRate) / 100 }, { code: 'RE', rate: 5.2, total: Math.round(net * 5.2) / 100 });
  } else {
    taxRows.push({ code: loc.taxName, rate: taxRate, total: Math.round(net * taxRate) / 100 });
  }
  const tax = Math.round(taxRows.reduce((a, t) => a + t.total, 0) * 100) / 100;
  let total = Math.round((net + tax) * 100) / 100;
  let printedTotal = total;
  if (dims.mismatch) printedTotal = Math.round((total + r.pick([10, -7.5, 100, 0.9]) ) * 100) / 100;
  const pay = { iban: iban(r, loc.cc), bic: bic(r), bank: `${loc.country.split(' ')[0]} Commercial Bank`, terms: L.terms30 };
  return { loc, L, seller, buyer, d0, due, number, refPerson, items, net, tax, taxRows, total, printedTotal, pay, negate, withLotSerial };
}

/** GT for the field-mode commercial types, keyed to the frozen field definitions. */
function commercialGt(slug, c, dims) {
  const gt = skeleton(slug);
  const setIf = (sec, f, v) => { if (gt[sec] && f in gt[sec]) gt[sec][f] = v; };
  const vatField = c.loc.vatField ?? 'VAT No'; // JA 登録番号 is a registration number, not a VAT No
  const partyGt = (sec, p, vat) => {
    setIf(sec, 'Name', p.name);
    setIf(sec, 'Address', p.street); setIf(sec, 'Street 1', p.street);
    setIf(sec, 'City', p.city); setIf(sec, 'Postal Code', p.postal);
    setIf(sec, 'Country', p.country); setIf(sec, 'Country Code', p.cc);
    if (vat) setIf(sec, vatField, p.vat);
    if (p.reg && vatField !== 'Registration No') setIf(sec, 'Registration No', p.reg);
  };
  partyGt('Buyer', c.buyer, !!c.buyer.vat);
  partyGt('Seller', c.seller, true);
  // The PO, consignment, invoice and credit-note contracts all hold the buyer's address in Shipping
  // Details when no shipping address is printed (the name field stays empty). No ship-to block is
  // ever printed, so the GT follows that rule. (Invoice and credit note carry the
  // street in "Address", the others in "Street 1"; setIf writes whichever the schema has.)
  if (['purchase-order', 'consignment-invoice', 'consignment-order', 'invoice', 'credit-note'].includes(slug) && gt['Shipping Details']) {
    setIf('Shipping Details', 'Address', c.buyer.street);
    setIf('Shipping Details', 'Street 1', c.buyer.street); setIf('Shipping Details', 'City', c.buyer.city);
    setIf('Shipping Details', 'Postal Code', c.buyer.postal); setIf('Shipping Details', 'Country', c.buyer.country);
    setIf('Shipping Details', 'Country Code', c.buyer.cc);
  }
  const noDec = c.loc.noDecimals;
  const metaSec = gt['Invoice Details'] ? 'Invoice Details' : gt['Order Details'] ? 'Order Details' : 'Consignment Details';
  const m = (f, v) => setIf(metaSec, f, v);
  if (metaSec === 'Invoice Details') {
    m('Invoice Type', slug === 'credit-note' || c.negate ? 'Credit' : 'Debit');
    m('Invoice Number', c.number); m('Invoice Date', gtDate(c.d0)); m('Due Date', gtDate(c.due));
    m('Payment Terms', c.L.terms30); m('Your Reference', c.refPerson); m('Buyer Reference', c.refPerson);
    m('Currency Code', c.loc.currency);
    if (!dims.missingTotals) { m('Net Amount', gtNum(c.net, noDec)); m('Total Tax', gtNum(c.tax, noDec)); m('Total Amount', gtNum(c.printedTotal, noDec)); }
  } else if (metaSec === 'Order Details') {
    m('PO Number', c.number); m('PO Date', gtDate(c.d0)); m('Due Date', gtDate(c.due));
    m('Payment Terms', c.L.terms30); m('Your Reference', c.refPerson); m('Currency Code', c.loc.currency);
    // THE KEY HOLDS WHAT THE PAGE PRINTS, in the field the contract defines for it. The PO contract
    // defines Contact Name as the ordering party's own person, chosen by the same rule as Your
    // Reference: on a supplier-authored form, the person under "Your reference", which is printed.
    m('Contact Name', c.refPerson);
    m('Net Amount', gtNum(c.net, noDec)); m('Total Amount', gtNum(c.printedTotal, noDec));
  } else {
    // The page prints "Your Reference: <person>", the customer's own contact named in the header, which
    // the consignment contract holds in Contact Name. The page prints "Due Date: <date>", which the
    // contract holds in Payment Due Date; no delivery date is printed, so Delivery Date stays empty.
    m('Consignment Number', c.number); m('Consignment Date', gtDate(c.d0)); m('Payment Due Date', gtDate(c.due));
    m('Payment Terms', c.L.terms30); m('Currency Code', c.loc.currency);
    m('Contact Name', c.refPerson);
  }
  const itemRows = c.items.map((it, idx) => {
    const o = itemSkeleton(slug);
    const set = (f, v) => { if (f in o) o[f] = v; };
    set('Item No', String(idx + 1));
    // The PO contract holds the buyer's line reference (a line number or a per-line order reference) in
    // line-level Order Number; the rendered Pos column IS that line number, so the GT holds it.
    if (slug === 'purchase-order') set('Order Number', String(idx + 1));
    set('Article ID', it.id); set('Article Name', it.name); set('Description', it.desc);
    set('Quantity', String(it.qty)); set('UOM', it.uom);
    set('Unit Price', gtNum(it.price, noDec)); set('Net Amount', gtNum(it.net, noDec));
    if (it.lot) set('Lot Number', it.lot);
    if (it.serial) set('Serial Number', it.serial);
    return o;
  });
  if (gt.Items) gt.Items = itemRows;
  if ('Barcodes' in gt) gt.Barcodes = []; // array shape; barcode capture scored separately, not as fields
  // Payment details (invoice family schemas).
  if (gt['Payment Details']) {
    const pd = gt['Payment Details'];
    // Respect the SCHEMA SHAPE of Payment Methods: the array schemas (invoice and its variants) take structured
    // objects; the STRING schemas (consignment family) take the stated method label, and with only an IBAN
    // row printed that label is "IBAN".
    // The skeleton writes every field as "", so the shape cannot be read off it: it is decided by the
    // schema family. The invoice family's array holds the printed IBAN and its adjacent BIC, with the
    // method the contract gives an IBAN ("IBAN"); the consignment family's single text field holds the
    // method label.
    const arrayMethods = ['invoice', 'credit-note', 'customer-specific-invoice'].includes(slug);
    if ('Payment Methods' in pd) pd['Payment Methods'] = arrayMethods
      ? [{ payment_method: 'IBAN', account_no: c.pay.iban, BIC_or_Swift_code: c.pay.bic }]
      : 'IBAN';
    // GT-first: with the missing-totals dimension the totals block (incl the tax-summary line) is NOT
    // rendered, so the printed-only Tax fields must stay empty in GT (tax is never derivable from lines).
    if ('Tax' in pd && !dims.missingTotals) pd['Tax'] = c.taxRows.map((t) => ({ tax_code: t.code, tax_total: gtNum(t.total, noDec), rate: String(t.rate) }));
    if ('Tax Rate' in pd && !dims.missingTotals && c.taxRows.length === 1) pd['Tax Rate'] = String(c.taxRows[0].rate);
    // A consignment document has no header totals, and its contract has no field for those amounts but
    // Payment Details Subtotal and Total: they hold the printed subtotal and total. (For the other types
    // they repeat the header totals and stay empty.)
    if (slug.startsWith('consignment') && !dims.missingTotals) {
      if ('Subtotal' in pd) pd['Subtotal'] = gtNum(c.net, noDec);
      if ('Total' in pd) pd['Total'] = gtNum(c.printedTotal, noDec);
    }
    // For the other types Payment Details Total/Subtotal repeat the header totals in the contract, so the
    // GT leaves them empty.
  }
  // A top-level Payment Methods table (the purchase order's) is a list of rows in the contract: one
  // row for the printed IBAN, with the method the contract gives it ("IBAN").
  if (Array.isArray(gt['Payment Methods'])) {
    gt['Payment Methods'] = [contractRow(slug, 'Payment Methods', { 'Payment Method': 'IBAN', 'Account Number': c.pay.iban, 'BIC/SWIFT Code': c.pay.bic })];
  }
  return gt;
}

/** Render-model for the commercial family (also reused by quote/receipt with tweaks). */
function commercialContent(slug, c, dims, titleOverride) {
  const { L, loc } = c;
  const noDec = loc.noDecimals;
  const title = titleOverride ?? (slug === 'credit-note' ? L.creditNote : slug === 'purchase-order' ? L.purchaseOrder : slug.startsWith('consignment') ? `CONSIGNMENT ${slug.endsWith('order') ? 'ORDER' : 'INVOICE'}` : L.invoice);
  const metaRows = [
    [['purchase-order', 'consignment-order'].includes(slug) ? L.orderNo : slug === 'credit-note' ? (L.creditNoteNo ?? L.invoiceNo) : L.invoiceNo, c.number],
    [['purchase-order', 'consignment-order'].includes(slug) ? L.orderDate : L.invoiceDate, loc.date(c.d0)],
    [L.dueDate, loc.date(c.due)],
    [L.reference, c.refPerson],
    [L.currency, loc.currency],
  ];
  const itemCols = [
    { k: 'no', label: L.pos }, { k: 'id', label: L.article }, { k: 'name', label: L.description },
    { k: 'desc', label: 'Spec' },
    ...(c.withLotSerial ? [{ k: 'lot', label: L.lot }, { k: 'serial', label: L.serial }] : []),
    { k: 'qty', label: L.qty, num: true }, { k: 'uom', label: L.uom },
    { k: 'price', label: L.unitPrice, num: true }, { k: 'net', label: L.amount, num: true },
  ];
  const rows = c.items.map((it) => ({
    no: it.no, id: it.id, name: it.name, desc: it.desc, lot: it.lot, serial: it.serial,
    qty: String(it.qty), uom: it.uom, price: loc.num(it.price), net: loc.num(it.net),
  }));
  const totalsRows = dims.missingTotals ? [] : [
    [L.subtotal, loc.num(c.net)],
    ...c.taxRows.map((t) => [`${t.code} ${t.rate}%`, loc.num(t.total)]),
    [L.total, loc.num(c.printedTotal), true],
  ];
  const paymentRows = [[L.bank, c.pay.bank], [L.iban, c.pay.iban], [L.bic, c.pay.bic], [L.paymentTerms, c.pay.terms]];
  return {
    kind: 'commercial', slug, locale: loc, dir: loc.dir, title,
    seller: c.seller, buyer: c.buyer, metaRows, itemCols, rows, totalsRows, paymentRows,
    footerNote: L.thanks, theme: null, noiseProfile: dims.noise, coverPage: dims.coverPage,
    barcodes: [], stickers: [],
  };
}

function addBarcodes(r, slug, c, content, dims) {
  const out = { gtBarcodes: [], expectedFuture: [] };
  const L = content;
  if (['invoice', 'customer-specific-invoice', 'credit-note'].includes(slug) && r.chance(0.35)) {
    const epc = `BCD\n002\n1\nSCT\n${c.pay.bic.replace(/\s/g, '')}\n${c.seller.name}\n${c.pay.iban.replace(/\s/g, '')}\n${c.loc.currency}${Math.abs(c.printedTotal).toFixed(2)}`;
    L.barcodes.push({ bcid: 'qrcode', text: epc, place: 'payment' });
    out.gtBarcodes.push(epc);
  }
  if (slug === 'purchase-order' && r.chance(0.5)) {
    L.barcodes.push({ bcid: 'code128', text: c.number, place: 'header' });
    out.gtBarcodes.push(c.number);
  }
  if (c.withLotSerial) {
    const n = Math.min(c.items.length, r.int(1, 3));
    for (let i = 0; i < n; i++) {
      const it = c.items[i];
      const gtin = ean13(`0${r.digits(11)}`);
      const lie = dims.stickerMismatch && i === 0; // sticker contradicts the printed lot
      const lot = lie ? `LOT${r.digits(6)}` : (it.lot || `LOT${r.digits(6)}`);
      const text = gs1({ gtin, lot, expiry: `28${String(r.int(1, 12)).padStart(2, '0')}15`, serial: it.serial || undefined });
      L.stickers.push({ bcid: 'gs1-128', text, rot: r.int(-8, 8), top: 18 + i * 9, left: r.int(8, 55) });
      out.gtBarcodes.push(text);
      if (lie) out.expectedFuture.push({ field: `Items.${i}.Lot Number`, kind: 'barcode-mismatch', printed: it.lot, sticker: lot });
    }
  }
  if (slug === 'receipt') {
    const code = ean13(`2${r.digits(11)}`);
    L.barcodes.push({ bcid: 'ean13', text: code, place: 'footer' });
    out.gtBarcodes.push(code);
  }
  return out;
}

function buildBundle(r, slug, c, dims) {
  // Two parent lines get granular breakdowns in an attachment; GT items = granular rows REPLACING parents.
  const loc = c.loc; const noDec = loc.noDecimals;
  const parents = c.items.slice(0, 2).map((p, pi) => {
    const k = r.int(2, 3);
    const rows = [];
    let left = p.net;
    for (let j = 0; j < k; j++) {
      const last = j === k - 1;
      const share = last ? left : Math.round(p.net * (0.2 + r.next() * 0.4) * 100) / 100;
      left = Math.round((left - share) * 100) / 100;
      const q = Math.max(1, Math.round(p.qty / k));
      rows.push({ name: `${p.name} ${r.pick(['Type A', 'Type B', 'Small', 'Large', '250ml', '1L', 'M', 'XL'])}-${j + 1}`, qty: q, price: Math.round((share / q) * 100) / 100, total: share });
    }
    return { parent: p, rows, ref: `ATT-${'AB'[pi]}` };
  });
  // Mark the parent rows in the rendered main doc with the references.
  parents.forEach((b, pi) => { c.items[pi].name = `${c.items[pi].name} SEE ${b.ref}`; });
  const granularGt = [];
  let no = 1;
  for (const b of parents) for (const row of b.rows) {
    const o = itemSkeleton(slug);
    const set = (f, v) => { if (f in o) o[f] = v; };
    set('Item No', String(no++)); set('Article Name', row.name); set('Description', b.parent.name.replace(/ SEE ATT-[AB]$/, ''));
    set('Quantity', String(row.qty)); set('Unit Price', gtNum(row.price, noDec)); set('Net Amount', gtNum(row.total, noDec));
    granularGt.push(o);
  }
  for (const it of c.items.slice(2)) {
    const o = itemSkeleton(slug);
    const set = (f, v) => { if (f in o) o[f] = v; };
    set('Item No', String(no++)); set('Article ID', it.id); set('Article Name', it.name); set('Description', it.desc);
    set('Quantity', String(it.qty)); set('UOM', it.uom); set('Unit Price', gtNum(it.price, noDec)); set('Net Amount', gtNum(it.net, noDec));
    granularGt.push(o);
  }
  const attachment = {
    kind: 'breakdown', locale: loc, dir: loc.dir, title: 'ATTACHMENT DOCUMENT',
    refDoc: c.number,
    blocks: parents.map((b) => ({
      heading: `${b.ref} - Breakdown`, refLine: `References: Line Item ${b.parent.no}: ${b.parent.name.replace(/ SEE ATT-[AB]$/, '')}`,
      cols: ['Variant', 'Qty', 'Unit Price', 'Line Total'],
      rows: b.rows.map((row) => [row.name, String(row.qty), loc.num(row.price), loc.num(row.total)]),
      subtotal: [`Sub-total (Line ${b.parent.no})`, loc.num(b.parent.net)],
    })),
  };
  return { granularGt, attachment };
}

// ---------------- fact-mode builders ----------------
function factDoc(slug, r, dims) {
  const loc = dims.locale; const L = loc.labels;
  const facts = []; const F = (label, value, soft = false) => { if (value !== '' && value != null) facts.push({ label, value: String(value), soft }); };
  const seller = party(r, loc, true); const buyer = party(r, loc, false);
  const d0 = { y: 2026, m: r.int(1, 5), d: r.int(1, 28) };
  const content = { kind: 'facty', slug, locale: loc, dir: loc.dir, seller, buyer, title: '', sections: [], noiseProfile: dims.noise, coverPage: false, barcodes: [], stickers: [], footerNote: '' };
  const noDec = loc.noDecimals;

  if (slug === 'quote') {
    const c = commercialCore(r, 'invoice', dims);
    const content2 = commercialContent('invoice', c, dims, L.quote);
    content2.metaRows = [[L.quoteNo, `Q-${r.digits(5)}`], [L.date, loc.date(c.d0)], ['Valid Until', loc.date(addDays(c.d0, 30))], [L.currency, loc.currency]];
    F('Quote Number', content2.metaRows[0][1]); F('Quote Date', gtDate(c.d0)); F('Currency', loc.currency);
    F('Seller Name', c.seller.name); F('Buyer Name', c.buyer.name);
    if (!dims.missingTotals) F('Total', gtNum(c.printedTotal, noDec));
    c.items.slice(0, 2).forEach((it) => F('Item ' + it.id, gtNum(it.net, noDec), true));
    return { content: content2, facts, core: c };
  }
  if (slug === 'receipt') {
    const c = commercialCore(r, 'invoice', { ...dims, scale: 'small' });
    c.items = makeItems(r, loc, r.int(3, 9), PRODUCTS, false);
    const net = sum(c.items); const tax = Math.round(net * loc.taxRate) / 100; const total = Math.round((net + tax) * 100) / 100;
    const paid = Math.ceil(total / 5) * 5; const change = Math.round((paid - total) * 100) / 100;
    const content2 = commercialContent('invoice', { ...c, net, tax, taxRows: [{ code: loc.taxName, rate: loc.taxRate, total: tax }], printedTotal: total }, dims, L.receipt);
    content2.kind = 'receipt';
    content2.metaRows = [[L.date, loc.date(c.d0) + ' 14:3' + r.int(0, 9)], ['Receipt No', `R-${r.digits(6)}`], ['Cashier', r.pick(loc.people)]];
    content2.paymentRows = [['Payment', r.pick(['CASH', 'VISA ****' + r.digits(4), 'MASTERCARD ****' + r.digits(4)])], ['Paid', loc.num(paid)], ['Change', loc.num(change)]];
    content2.footerNote = `${L.thanks} — This is not an invoice.`;
    F('Receipt Number', content2.metaRows[1][1]); F('Store Name', c.seller.name); F('Total', gtNum(total, noDec));
    F('Tax', gtNum(tax, noDec), true); F('Date', gtDate(c.d0), true);
    // Near-field-granularity facts (the receipt type has no field contract, so capture is verified via
    // facts; these cover every distinct printed value class on the document).
    F('Payment Method', content2.paymentRows[0][1]); F('Amount Paid', gtNum(paid, noDec)); F('Change', gtNum(change, noDec), true);
    F('Cashier', content2.metaRows[2][1], true); F('Line Count', String(c.items.length), true);
    F('First Item', c.items[0].name, true); F('Last Item', c.items[c.items.length - 1].name, true);
    return { content: content2, facts, core: c };
  }
  if (slug === 'bank-statement') {
    const accNo = `${r.digits(4)}-${r.digits(6)}-${r.digits(2)}`; const ib = iban(r, loc.cc);
    const opening = r.money(1000, 90000);
    let bal = opening; const txns = []; const txnAmts = [];
    const nTx = dims.scale === 'large' ? 60 : r.int(8, 22);
    for (let i = 0; i < nTx; i++) {
      const debit = r.chance(0.55); const amt = r.money(10, 4000);
      bal = Math.round((bal + (debit ? -amt : amt)) * 100) / 100;
      txnAmts.push(amt);
      txns.push([loc.date({ y: 2026, m: d0.m, d: Math.min(28, 1 + i) }), r.pick(['Card purchase', 'SEPA transfer', 'Direct debit', 'Salary', 'ATM withdrawal', 'Fee', 'Interest']), debit ? loc.num(amt) : '', debit ? '' : loc.num(amt), loc.num(bal)]);
    }
    content.title = L.statement;
    content.sections = [
      { table: { cols: ['', ''], rows: [['Account Holder', buyer.name], ['Account No', accNo], ['IBAN', ib], ['Statement Period', `${loc.date({ ...d0, d: 1 })} - ${loc.date({ ...d0, d: 28 })}`], ['Opening Balance', loc.num(opening)], ['Closing Balance', loc.num(bal)]] } },
      { heading: 'Transactions', table: { cols: ['Date', 'Description', 'Debit', 'Credit', 'Balance'], rows: txns } },
    ];
    F('Account Holder', buyer.name); F('Account No', accNo); F('IBAN', ib);
    F('Opening Balance', gtNum(opening, noDec)); F('Closing Balance', gtNum(bal, noDec));
    // Near-field-granularity facts: per-transaction anchors (first/middle/last) + count, so a dropped
    // or duplicated statement row is caught even though the type has no field contract.
    F('Transaction Count', String(txns.length), true);
    F('First Transaction Description', txns[0][1], true);
    F('Middle Transaction Amount', gtNum(txnAmts[Math.floor(txnAmts.length / 2)], noDec), true);
    F('Last Transaction Balance', gtNum(bal, noDec), true);
    return { content, facts };
  }
  if (slug === 'form-i-9') {
    const emp = r.pick(loc.people); const dob = `${String(r.int(1, 28)).padStart(2, '0')}/${String(r.int(1, 12)).padStart(2, '0')}/19${r.int(60, 99)}`;
    const ssn = `${r.digits(3)}-${r.digits(2)}-${r.digits(4)}`;
    content.title = 'Form I-9, Employment Eligibility Verification';
    content.sections = [
      { heading: 'Section 1. Employee Information and Attestation', table: { cols: ['', ''], rows: [['Last Name', emp.split(' ').slice(-1)[0]], ['First Name', emp.split(' ')[0]], ['Address', seller.street], ['City', seller.city], ['Date of Birth', dob], ['U.S. Social Security Number', ssn], ['Citizenship', 'A citizen of the United States']] } },
      { heading: 'Section 2. Employer Review and Verification', table: { cols: ['', ''], rows: [['Document Title', 'U.S. Passport'], ['Document Number', `5${r.digits(8)}`], ['Expiration Date', `0${r.int(1, 9)}/15/2031`], ['Employer Name', buyer.name]] } },
    ];
    F('Last Name', emp.split(' ').slice(-1)[0]); F('First Name', emp.split(' ')[0]); F('Date of Birth', dob, true); F('Document Number', content.sections[1].table.rows[1][1]);
    return { content, facts };
  }
  if (['general-contract', 'partnership-agreement', 'confidentiality-agreement-nda', 'e-signature-platform-contract'].includes(slug)) {
    const titles = { 'general-contract': 'MASTER SERVICES AGREEMENT', 'partnership-agreement': 'PARTNERSHIP AGREEMENT', 'confidentiality-agreement-nda': 'MUTUAL NON-DISCLOSURE AGREEMENT', 'e-signature-platform-contract': 'SERVICE CONTRACT' };
    content.title = titles[slug];
    const eff = gtDate(d0); const term = r.pick(['12 months', '24 months', '36 months']);
    const law = r.pick(['the laws of England and Wales', 'the laws of Switzerland', 'the laws of the State of New York', 'Swedish law']);
    content.sections = [
      { paragraphs: [`This ${content.title.toLowerCase()} (the "Agreement") is entered into as of ${loc.date(d0)} (the "Effective Date") by and between ${seller.name}, with its registered office at ${seller.street}, ${seller.city} ("Party A"), and ${buyer.name}, with its registered office at ${buyer.street}, ${buyer.city} ("Party B").`] },
      { heading: '1. Term', paragraphs: [`This Agreement shall remain in force for a period of ${term} from the Effective Date unless terminated earlier in accordance with Section 7.`] },
      { heading: '2. Confidentiality', paragraphs: ['Each party shall keep confidential all non-public information received from the other party and shall use it solely for the purposes of this Agreement.'] },
      { heading: '3. Governing Law', paragraphs: [`This Agreement shall be governed by ${law}.`] },
      { heading: 'Signatures', table: { cols: ['', ''], rows: [['Party A', seller.name + ' / ' + r.pick(loc.people)], ['Party B', buyer.name + ' / ' + r.pick(loc.people)], ['Date', loc.date(d0)]] } },
    ];
    if (slug === 'e-signature-platform-contract') content.footerNote = `Created and e-signed on an e-signature platform. Contract ID ${r.digits(7)}.`;
    F('Party A', seller.name); F('Party B', buyer.name); F('Effective Date', eff, true); F('Term', term, true);
    return { content, facts };
  }
  if (slug === 'execution-record') {
    const docName = `Agreement_${r.digits(4)}.pdf`;
    const p1 = r.pick(loc.people); const p2 = r.pick(loc.people);
    const e1 = p1.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com';
    const e2 = p2.toLowerCase().replace(/[^a-z]+/g, '.') + '@partner.example';
    content.title = 'EXECUTION RECORD / SIGNING CERTIFICATE';
    content.sections = [
      { table: { cols: ['', ''], rows: [['Document', docName], ['Status', 'Completed'], ['Completed At', `${loc.date(d0)} 16:42 UTC`]] } },
      { heading: 'Participants', table: { cols: ['Name', 'Email', 'Signed At', 'IP Address'], rows: [[p1, e1, `${loc.date(d0)} 15:02 UTC`, `83.24.${r.int(1, 254)}.${r.int(1, 254)}`], [p2, e2, `${loc.date(d0)} 16:41 UTC`, `192.168.${r.int(1, 254)}.${r.int(1, 254)}`]] } },
      { heading: 'Audit Trail', table: { cols: ['Time', 'Event'], rows: [['14:58 UTC', `Document sent to ${e2}`], ['15:01 UTC', `Opened by ${p1}`], ['15:02 UTC', `Signed by ${p1}`], ['16:41 UTC', `Signed by ${p2}`], ['16:42 UTC', 'Completed']] } },
    ];
    F('Document', docName); F('Status', 'Completed'); F('Participant 1', e1); F('Participant 2', e2);
    return { content, facts };
  }
  // other: delivery note
  content.title = 'DELIVERY NOTE';
  const dn = `DN-${r.digits(6)}`;
  content.sections = [
    { table: { cols: ['', ''], rows: [['Delivery Note No', dn], ['Date', loc.date(d0)], ['From', seller.name], ['To', buyer.name], ['Carrier', r.pick(['DHL', 'DB Schenker', 'Yamato', 'UPS'])]] } },
    { heading: 'Packages', table: { cols: ['Carton', 'Contents', 'Weight'], rows: [[`CTN-1`, 'Spare parts', `${r.int(2, 30)} kg`], [`CTN-2`, 'Documentation', `1 kg`]] } },
  ];
  facts.push({ label: 'Delivery Note No', value: dn }, { label: 'From', value: seller.name }, { label: 'To', value: buyer.name });
  return { content, facts };
}

// ---------------- special field-mode builders ----------------
function freightDoc(r, dims) {
  const loc = dims.locale; const L = loc.labels;
  const c = commercialCore(r, 'invoice', dims);
  const shipRef = `SH-${r.digits(6)}`; const mbl = `MBL${r.digits(9)}`; const hbl = `HBL${r.digits(9)}`;
  const containers = [`MSKU${r.digits(7)}`, `TGHU${r.digits(7)}`].slice(0, r.int(1, 2));
  const charges = [
    ['Ocean Freight', shipRef, r.money(800, 4000)], ['THC Origin', shipRef, r.money(100, 400)],
    ['Documentation Fee', shipRef, r.money(40, 120)], ['Fuel Surcharge', shipRef, r.money(60, 500)],
  ].map(([d, ref, amt]) => ({ desc: d, ref, amt: Math.round(amt * 100) / 100 }));
  const net = Math.round(charges.reduce((a, x) => a + x.amt, 0) * 100) / 100;
  const tax = Math.round(net * loc.taxRate) / 100; const total = Math.round((net + tax) * 100) / 100;
  // Drawn here, in the same position in the sequence as before, so the page is unchanged; it is printed
  // as "MAERSK ESSEX / <voyage>" and keyed as the vessel name and the voyage number.
  const voyage = `23${r.digits(2)}W`;
  const gt = skeleton('freight-invoice');
  const setIf = (sec, f, v) => { if (gt[sec] && f in gt[sec]) gt[sec][f] = v; };
  ['Name', 'Address', 'City', 'Postal Code', 'Country', 'Country Code'].forEach((f) => { setIf('Buyer', f, { Name: c.buyer.name, Address: c.buyer.street, City: c.buyer.city, 'Postal Code': c.buyer.postal, Country: c.buyer.country, 'Country Code': c.buyer.cc }[f]); });
  // The seller's registration number is printed under the seller block whenever it exists, and the
  // freight schema's Seller has a Registration No field: the key holds it.
  ['Name', 'Address', 'City', 'Postal Code', 'Country', 'Country Code', 'VAT No', 'Registration No'].forEach((f) => { setIf('Seller', f, { Name: c.seller.name, Address: c.seller.street, City: c.seller.city, 'Postal Code': c.seller.postal, Country: c.seller.country, 'Country Code': c.seller.cc, 'VAT No': c.seller.vat, 'Registration No': c.seller.reg }[f]); });
  setIf('Invoice Details', 'Invoice Number', c.number); setIf('Invoice Details', 'Invoice Date', gtDate(c.d0));
  setIf('Invoice Details', 'Due Date', gtDate(c.due)); setIf('Invoice Details', 'Payment Terms', c.L.terms30);
  setIf('Invoice Details', 'Currency Code', loc.currency);
  // Amounts as PRINTED: a locale printing no decimals (ja-JP) prints these rounded, so the key holds
  // them rounded, exactly as the commercial types already do.
  const noDec = !!loc.noDecimals;
  setIf('Invoice Details', 'Net Amount', gtNum(net, noDec)); setIf('Invoice Details', 'Total Tax', gtNum(tax, noDec)); setIf('Invoice Details', 'Total Amount', gtNum(total, noDec));
  // THE SHIPMENT AND ITS CHARGES, as printed, in the tables the response returns them in (contract.mjs).
  // One shipment is printed. The response's projection gives a shipment's children position-derived ids
  // (SF1, ST1, DL1, AL1, S1-N1, S1-C1): the shipment holds them as links and each child row carries its
  // own, whatever the page prints, so the key holds them too. Every charge names the shipment, so the
  // contract puts it in that shipment's Line Charges and none in the invoice-level table; a charge with no
  // printed code takes its description as its code, as the contract says. "Origin" and "Destination" are
  // printed as "Hamburg, DE" and "Singapore, SG": the locations as printed, their countries' codes, and
  // the city in the structured location. No shipper, consignee, carrier, date, weight or incoterm is
  // printed, so those stay empty. The bills of lading, the vessel and its "Ocean Freight" charge make
  // this an ocean shipment, the contract's Mode Of Transport.
  const F = 'freight-invoice';
  const lineContainers = containers.map((cn, i) => contractRow(F, 'Line Containers', { ID: `S1-N${i + 1}`, 'Container ID': cn }));
  const lineCharges = charges.map((x, i) => contractRow(F, 'Line Charges', { 'Charge ID': `S1-C${i + 1}`, 'Charge Code': x.desc, Description: x.desc, Amount: gtNum(x.amt, noDec) }));
  gt['Freight Shipments'] = [contractRow(F, 'Freight Shipments', {
    'Shipment Reference': shipRef, 'Mode Of Transport': 'OCEAN', 'Master Bill Of Lading': mbl, 'House Bill Of Lading': hbl,
    'Vessel Name': 'MAERSK ESSEX', 'Voyage Number': voyage, 'Ship From': 'SF1', 'Ship To': 'ST1',
    'Origin Location': 'Hamburg, DE', 'Departure Location': 'DL1', 'Origin Country Code': 'DE',
    'Destination Location': 'Singapore, SG', 'Arrival Location': 'AL1', 'Destination Country Code': 'SG',
    Containers: lineContainers.map((x) => x.ID).join(','), 'Line Charges': lineCharges.map((x) => x['Charge ID']).join(','),
  })];
  gt['Ship From'] = [contractRow(F, 'Ship From', { ID: 'SF1' })];
  gt['Ship To'] = [contractRow(F, 'Ship To', { ID: 'ST1' })];
  gt['Departure Location'] = [contractRow(F, 'Departure Location', { ID: 'DL1', City: 'Hamburg' })];
  gt['Arrival Location'] = [contractRow(F, 'Arrival Location', { ID: 'AL1', City: 'Singapore' })];
  gt['Line Containers'] = lineContainers;
  gt['Line Charges'] = lineCharges;
  gt['Invoice Containers'] = containers.map((cn) => contractRow(F, 'Invoice Containers', { 'Container ID': cn })); // the contract's invoice-wide roll-up
  gt['Invoice Charges'] = [];
  gt['Tax'] = [contractRow(F, 'Tax', { tax_code: loc.taxName, tax_total: gtNum(tax, noDec), rate: String(loc.taxRate) })];
  gt['Payment Methods'] = []; // no payment block is printed on a freight invoice
  const facts = [
    { label: 'Master B/L', value: mbl }, { label: 'House B/L', value: hbl }, { label: 'Shipment Ref', value: shipRef },
    ...containers.map((cn) => ({ label: 'Container', value: cn })),
  ];
  const content = {
    kind: 'facty', slug: 'freight-invoice', locale: loc, dir: loc.dir, seller: c.seller, buyer: c.buyer,
    title: 'FREIGHT INVOICE', noiseProfile: dims.noise, coverPage: dims.coverPage, barcodes: [], stickers: [], footerNote: c.L.thanks,
    sections: [
      { table: { cols: ['', ''], rows: [[L.invoiceNo, c.number], [L.invoiceDate, loc.date(c.d0)], [L.dueDate, loc.date(c.due)], [L.currency, loc.currency]] } },
      { heading: 'Shipment', table: { cols: ['', ''], rows: [['Shipment Reference', shipRef], ['Master Bill of Lading', mbl], ['House Bill of Lading', hbl], ['Vessel / Voyage', `MAERSK ESSEX / ${voyage}`], ['Origin', 'Hamburg, DE'], ['Destination', 'Singapore, SG'], ['Containers', containers.join(', ')]] } },
      { heading: 'Charges', table: { cols: ['Description', 'Shipment', L.amount], rows: charges.map((x) => [x.desc, x.ref, loc.num(x.amt)]) } },
      { table: { cols: ['', ''], rows: [[L.subtotal, loc.num(net)], [`${loc.taxName} ${loc.taxRate}%`, loc.num(tax)], [L.total, loc.num(total)]] } },
    ],
  };
  return { content, gt, facts };
}

function legalDoc(r, dims) {
  const loc = LOCALES[0]; // legal invoices in the corpus are US-style LEDES-like
  const L = loc.labels;
  const lawFirm = r.pick(['Harrington & Wolfe LLP', 'Sterling Legal Group LLP', 'Caldwell Price LLP']);
  const client = r.pick(loc.companies);
  const d0 = { y: 2026, m: r.int(1, 5), d: r.int(1, 28) };
  const number = `LI-${r.digits(6)}`;
  const tks = [['Jane Smith', 'Partner', 450], ['Robert Diaz', 'Associate', 280], ['Emily Wong', 'Paralegal', 120]].slice(0, r.int(2, 3));
  const fees = [];
  for (let i = 0; i < r.int(4, 9); i++) {
    const tk = r.pick(tks); const hrs = r.int(1, 12) / 2;
    fees.push({ date: loc.date({ y: 2026, m: d0.m, d: r.int(1, 28) }), tk: tk[0], task: `L${r.int(1, 6)}${r.int(0, 9)}0`, desc: r.pick(['Review and revise agreement', 'Telephone conference with client', 'Draft motion', 'Legal research re: liability', 'Prepare deposition outline']), rate: tk[2], hours: hrs, amount: Math.round(tk[2] * hrs * 100) / 100 });
  }
  const netFees = Math.round(fees.reduce((a, f) => a + f.amount, 0) * 100) / 100;
  const gt = skeleton('legal-invoice');
  const setIf = (sec, f, v) => { if (gt[sec] && f in gt[sec]) gt[sec][f] = v; };
  setIf('Buyer (Client)', 'Name', client); setIf('Seller (Law Firm)', 'Name', lawFirm);
  setIf('Invoice Details', 'Invoice Number', number); setIf('Invoice Details', 'Invoice Date', gtDate(d0));
  setIf('Invoice Details', 'Matter Name', 'General Corporate Matters');
  setIf('Invoice Details', 'Currency', 'USD'); setIf('Invoice Details', 'Net Fees', gtNum(netFees)); setIf('Invoice Details', 'Net Total', gtNum(netFees));
  const facts = [
    { label: 'Timekeeper', value: tks[0][0] }, { label: 'Rate', value: gtNum(tks[0][2]) },
    { label: 'Fee line', value: gtNum(fees[0].amount) },
  ];
  const content = {
    kind: 'facty', slug: 'legal-invoice', locale: loc, dir: 'ltr',
    seller: { name: lawFirm, street: '1200 Sixth Avenue', city: 'New York', postal: '10036', country: 'United States', cc: 'US', vat: '' },
    buyer: { name: client, street: r.pick(loc.streets), city: 'Chicago', postal: '60601', country: 'United States', cc: 'US' },
    title: 'INVOICE FOR LEGAL SERVICES', noiseProfile: dims.noise, coverPage: dims.coverPage, barcodes: [], stickers: [], footerNote: 'Payment due upon receipt.',
    sections: [
      { table: { cols: ['', ''], rows: [['Invoice Number', number], ['Invoice Date', loc.date(d0)], ['Matter', 'General Corporate Matters'], ['Billing Period', `${loc.date({ ...d0, d: 1 })} - ${loc.date({ ...d0, d: 28 })}`]] } },
      { heading: 'Timekeeper Summary', table: { cols: ['Timekeeper', 'Classification', 'Rate', 'Hours', 'Amount'], rows: tks.map((t) => { const h = fees.filter((f) => f.tk === t[0]).reduce((a, f) => a + f.hours, 0); const amt = fees.filter((f) => f.tk === t[0]).reduce((a, f) => a + f.amount, 0); return [t[0], t[1], loc.num(t[2]), String(h), loc.num(Math.round(amt * 100) / 100)]; }) } },
      { heading: 'Fee Detail', table: { cols: ['Date', 'Timekeeper', 'Task', 'Description', 'Hours', 'Amount'], rows: fees.map((f) => [f.date, f.tk, f.task, f.desc, String(f.hours), loc.num(f.amount)]) } },
      { table: { cols: ['', ''], rows: [['Total Fees', loc.num(netFees)], ['TOTAL DUE', loc.num(netFees)]] } },
    ],
  };
  return { content, gt, facts };
}

function argentineDoc(r, dims) {
  const loc = { ...LOCALES.find((l) => l.id === 'es-ES'), country: 'Argentina', cc: 'AR', currency: 'ARS', vat: () => '' };
  const cuit = () => `${r.pick(['20', '30', '33'])}-${r.digits(8)}-${r.int(0, 9)}`;
  const issuer = { name: r.pick(['Distribuidora Pampa SA', 'Industrias del Plata SRL', 'Comercial Buenos Aires SA']), cuit: cuit(), street: 'Av. Corrientes', no: String(r.int(100, 4000)), city: 'Buenos Aires', postal: `C10${r.digits(2)}`, prov: 'CABA' };
  const recipient = { name: r.pick(['Acme Argentina SA', 'Tecno Sur SRL']), cuit: cuit(), vatStatus: 'IVA Responsable Inscripto' };
  const d0 = { y: 2026, m: r.int(1, 5), d: r.int(1, 28) };
  const pos = String(r.int(1, 99)).padStart(4, '0'); const num = String(r.int(1, 99999999)).padStart(8, '0');
  const items = makeItems(r, loc, r.int(2, 8), PRODUCTS, false);
  const net = sum(items); const iva = Math.round(net * 21) / 100; const total = Math.round((net + iva) * 100) / 100;
  const cae = r.digits(14); const caeExp = gtDate(addDays(d0, 10));
  const gt = skeleton('argentine-invoice');
  const setIf = (sec, f, v) => { if (gt[sec] && f in gt[sec]) gt[sec][f] = v; };
  // GT values follow the contract's definitions: Document Type is the printed NUMERIC
  // code (01 = Factura A), Issue Date is the contract's ISO DateTime with T00:00:10, Province
  // is the printed single-letter AFIP code, Code Type is the hardcoded constant "INT", Authorization
  // Mode is "CAE" (the footer prints a CAE number). The renderer prints each of these (GT-first).
  const pad2 = (n) => String(n).padStart(2, '0');
  setIf('Invoice Details', 'Document Type', '01'); setIf('Invoice Details', 'POS (Point of Sale)', pos);
  setIf('Invoice Details', 'Issued Invoice Number', num); setIf('Invoice Details', 'Invoice Issue Date', `${d0.y}-${pad2(d0.m)}-${pad2(d0.d)}T00:00:10`);
  setIf('Issuer', 'Name', issuer.name); setIf('Issuer', 'Tax ID (CUIT)', issuer.cuit);
  setIf('Issuer', 'Street Address', issuer.street); setIf('Issuer', 'Address Number', issuer.no);
  setIf('Issuer', 'City/Locality', issuer.city); setIf('Issuer', 'Postal Code', issuer.postal); setIf('Issuer', 'Province/State', 'C');
  setIf('Recipient', 'Name', recipient.name); setIf('Recipient', 'Tax ID (CUIT)', recipient.cuit); setIf('Recipient', 'VAT Status', recipient.vatStatus);
  // The buyer block renders a full recipient address; GT must include it (GT-first).
  setIf('Recipient', 'Street Address', 'Av. Santa Fe'); setIf('Recipient', 'Address Number', '1200');
  setIf('Recipient', 'City/Locality', 'Buenos Aires'); setIf('Recipient', 'Postal Code', 'C1059');
  setIf('Document Totals', 'Taxable Amount', gtNum(net)); setIf('Document Totals', 'Total Document Amount', gtNum(total));
  setIf('Document Fiscal Information', 'Authorization Code', cae); setIf('Document Fiscal Information', 'Authorization Expiration Date', caeExp);
  setIf('Document Fiscal Information', 'Document Authorization Mode', 'CAE');
  if (gt.Items) gt.Items = items.map((it, i) => { const o = itemSkeleton('argentine-invoice'); const set = (f, v) => { if (f in o) o[f] = v; }; set('Number', String(i + 1)); set('Code Type', 'INT'); set('Description', it.name); set('Unit of Measure', it.uom); set('Quantity', String(it.qty)); set('Unit Price', gtNum(it.price)); set('Total Amount', gtNum(it.net)); return o; });
  if (gt['VAT Breakdown (Value Added Tax)']) gt['VAT Breakdown (Value Added Tax)'] = [{ Type: 'IVA', Rate: '21', 'Total Amount': gtNum(iva) }];
  const content = {
    kind: 'facty', slug: 'argentine-invoice', locale: loc, dir: 'ltr',
    seller: { name: issuer.name, street: `${issuer.street} ${issuer.no}`, city: issuer.city, postal: issuer.postal, country: 'Argentina', cc: 'AR', vat: `CUIT: ${issuer.cuit}` },
    buyer: { name: recipient.name, street: 'Av. Santa Fe 1200', city: 'Buenos Aires', postal: 'C1059', country: 'Argentina', cc: 'AR', vat: `CUIT: ${recipient.cuit}` },
    title: `FACTURA A`, noiseProfile: dims.noise, coverPage: false, barcodes: [{ bcid: 'code128', text: cae, place: 'footer' }], stickers: [],
    footerNote: `CAE N°: ${cae}   Fecha Vto. CAE: ${loc.date(addDays(d0, 10))}`,
    sections: [
      { table: { cols: ['', ''], rows: [['Código', '01'], ['Punto de Venta', pos], ['Comp. Nro', num], ['Fecha de Emisión', loc.date(d0)], ['CUIT Emisor', issuer.cuit], ['Provincia', 'C'], ['CUIT Receptor', recipient.cuit], ['Condición IVA', recipient.vatStatus]] } },
      { heading: 'Detalle', table: { cols: ['Nº', 'Descripción', 'U.M.', 'Cant', 'Precio Unit', 'Importe'], rows: items.map((it, i) => [String(i + 1), it.name, it.uom, String(it.qty), loc.num(it.price), loc.num(it.net)]) } },
      { table: { cols: ['', ''], rows: [['Importe Neto Gravado', loc.num(net)], ['IVA 21%', loc.num(iva)], ['Importe Total', loc.num(total)]] } },
    ],
  };
  return { content, gt, facts: [{ label: 'CAE', value: cae }] };
}

// ---------------- entry point ----------------
export function buildDoc(slug, index, seed) {
  const r = new Rng(`${seed}:${slug}:${index}`);
  const dims = pickDims(r, slug);
  const id = `${slug}-${String(index).padStart(3, '0')}`;
  const base = { id, slug, category: CATEGORY[slug], locale: dims.locale.id, dims: { scale: dims.scale, noise: dims.noise, coverPage: dims.coverPage, bundle: !!dims.bundle, missingTotals: !!dims.missingTotals, mismatch: !!dims.mismatch, stickerMismatch: !!dims.stickerMismatch } };
  const expectedFlags = []; const expectedDerived = []; let expectedFuture = [];

  if (slug === 'freight-invoice') { const x = freightDoc(r, dims); return { ...base, mode: 'fields', gt: x.gt, facts: x.facts, content: x.content, expectedFlags, expectedDerived, expectedFuture }; }
  if (slug === 'legal-invoice') { const x = legalDoc(r, dims); return { ...base, mode: 'facts', gt: x.gt, facts: x.facts, content: x.content, expectedFlags, expectedDerived, expectedFuture }; }
  if (slug === 'argentine-invoice') { const x = argentineDoc(r, dims); return { ...base, mode: 'fields', gt: x.gt, facts: x.facts, content: x.content, expectedFlags, expectedDerived, expectedFuture }; }

  // Lookalike families: classification may legitimately land on the sibling category.
  if (slug === 'customer-specific-invoice') base.category_alt = ['Invoice'];
  if (slug === 'e-signature-platform-contract') base.category_alt = ['General Contract']; // a service contract with an e-sign footer

  if (FIELD_MODE.has(slug)) {
    const c = commercialCore(r, slug, dims);
    const content = commercialContent(slug, c, dims);
    let gt = commercialGt(slug, c, dims);
    // Schema-agnostic facts so the pipeline lane can score even when classification lands on a
    // sibling category (fields are scored when the category matches; facts always).
    const noDec = c.loc.noDecimals;
    const facts = [
      { label: 'Document Number', value: c.number },
      { label: 'Date', value: gtDate(c.d0), soft: true },
      { label: 'Buyer Name', value: c.buyer.name },
      { label: 'Seller Name', value: c.seller.name },
      ...(dims.missingTotals ? [] : [{ label: 'Total', value: gtNum(c.printedTotal, noDec) }]),
    ];
    let attachment = null;
    if (dims.bundle && c.items.length >= 3 && c.items.length <= 8) {
      const b = buildBundle(r, slug, c, dims);
      gt.Items = b.granularGt;
      attachment = b.attachment;
      // re-render parent names that gained SEE ATT-x
      content.rows.forEach((row, i) => { if (c.items[i]) row.name = c.items[i].name; });
    }
    const bc = addBarcodes(r, slug, c, content, dims);
    expectedFuture = bc.expectedFuture;
    if (dims.mismatch) expectedFlags.push({ path: 'Total Amount', kind: 'mismatch' });
    // missingTotals docs render NO totals block at all (no tax line either), so only Net (sum of line
    // nets) and Total (net + zero tax) are derivable; Total Tax has nothing to derive from.
    if (dims.missingTotals) expectedDerived.push({ path: 'Net Amount', kind: 'derived' }, { path: 'Total Amount', kind: 'derived' });
    return { ...base, mode: 'fields', gt, facts, content, attachment, expectedFlags, expectedDerived, expectedFuture };
  }
  const x = factDoc(slug, r, dims);
  return { ...base, mode: 'facts', gt: null, facts: x.facts, content: x.content, expectedFlags, expectedDerived, expectedFuture: x.expectedFuture ?? [] };
}
