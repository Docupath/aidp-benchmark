/**
 * AIDP-CAP: the documents, built answer key first, exactly as AIDP-2K's are.
 *
 * Each document is drawn by the AIDP-2K builders (data.mjs) from its own seeded stream, so its locale, layout, line
 * items and amounts are drawn the way AIDP-2K's are. A second stream, also seeded per document, draws the capability
 * conditions (composition.mjs), and a third, seeded once for the corpus, plans what involves several documents: the
 * purchase orders that invoices refer to, the documents submitted after the documents they refer to, and the
 * duplicates. Nothing is labelled after the fact: every value the page prints is held by the answer key in the field
 * the output contract defines for it, and every expected result of a capability (a derived value, a flag, a supplier
 * code, a hidden value) is written down here before the page is drawn.
 *
 * Every printed value is a CELL: its text and the key paths it is the printed form of. The renderer (cap/render.mjs)
 * draws cells only, and records where each one lands on the page, which is what Traceability is judged against.
 */
import crypto from 'node:crypto';
import { Rng } from '../rng.mjs';
import { LOCALES, gtNum, gtDate, addDays } from '../lex.mjs';
import { CATEGORY, GEN_OPTIONS, commercialCore, commercialGt, freightDoc } from '../data.mjs';
import { ean13, gs1 } from '../barcode.mjs';
import * as K from './composition.mjs';
import { supplierList, unlistedSupplier, printedName, resolvable, accountFor, compactAccount } from './suppliers.mjs';

const ITEMY = new Set(['invoice', 'credit-note', 'purchase-order', 'consignment-invoice', 'consignment-order']);
const PAYMENT_BLOCK = new Set(['invoice', 'credit-note', 'purchase-order', 'consignment-invoice', 'consignment-order']);
const DERIVATION_TYPES = new Set(['invoice', 'credit-note', 'purchase-order', 'consignment-invoice', 'consignment-order']);
const RESOLUTION_TYPES = new Set(['invoice', 'credit-note', 'consignment-invoice', 'freight-invoice']);
const BANK_CHECK_TYPES = new Set(['invoice', 'credit-note']);
const DUPLICATE_TYPES = new Set(['invoice', 'credit-note', 'consignment-invoice', 'freight-invoice']);
export { RESOLUTION_TYPES, BANK_CHECK_TYPES };

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const round2 = (x) => Math.round(x * 100) / 100;
const weighted = (r, table) => {
  let x = r.next();
  for (const [k, p] of Object.entries(table)) { if ((x -= p) < 0) return k; }
  return Object.keys(table).at(-1);
};
/** One printed value: its text and the key paths it prints. */
export const cell = (v, paths = [], extra = {}) => ({ v: String(v ?? ''), paths: [].concat(paths).filter(Boolean), ...extra });
const isCell = (x) => x && typeof x === 'object' && 'v' in x && 'paths' in x;
export const textOf = (x) => (isCell(x) ? x.v : String(x ?? ''));

// -------------------------------------------------------------------------------------------------
// dimensions and conditions
// -------------------------------------------------------------------------------------------------
function capDims(r, slug) {
  const locale = r.pick([...LOCALES.slice(0, 2), ...LOCALES, r.pick(LOCALES)]); // as AIDP-2K draws it: English slightly heavier
  const scale = ITEMY.has(slug) ? weighted(r, K.SCALE) : 'small';
  const noise = weighted(r, K.NOISE);
  return { locale, scale, noise, coverPage: r.chance(0.06), bundle: false, missingTotals: false, mismatch: false, stickerMismatch: false };
}

function drawConditions(rc, slug) {
  const C = K.CONDITIONS;
  const cond = {
    attachments: rc.chance(C.attachments) ? rc.int(1, 3) : 0,
    upsideDown: rc.chance(C.upsideDown),
    upsideDownAt: rc.next(),
    marks: rc.chance(C.marks) ? rc.int(1, 3) : 0,
    occlusions: rc.chance(C.occlusions),
    derivation: DERIVATION_TYPES.has(slug) && rc.chance(C.derivations),
    contradiction: false,
    bankLine: PAYMENT_BLOCK.has(slug) && rc.chance(C.bankLine),
    unlisted: rc.chance(C.unlistedSupplier),
    vatPrinted: rc.chance(C.vatPrinted),
    nameKind: weighted(rc, K.NAME_KINDS),
  };
  cond.contradiction = DERIVATION_TYPES.has(slug) && !cond.derivation && rc.chance(C.contradictions);
  // A hidden value (a document number, a reference, an account, an article number) never touches what a computed or
  // contradicted value is made of (amounts and dates), so the two may meet on one document.
  // an attachment repeats the document's number, people and lines, so a value hidden on the page would be readable there
  if (cond.occlusions && cond.attachments) cond.occlusions = false;
  return cond;
}

// -------------------------------------------------------------------------------------------------
// the corpus plan
// -------------------------------------------------------------------------------------------------
/**
 * The whole corpus, planned: suppliers, documents with their conditions, the purchase-order links, the anomaly
 * cases and their controls, the phase each document is submitted in, and the duplicate copies. Bundles for
 * Segmentation are planned after drawing (generate.mjs), because they need each document's page count.
 */
export function planCap(seed) {
  GEN_OPTIONS.validAccounts = true;      // printed bank accounts carry valid check digits
  GEN_OPTIONS.dueDatesFromTerms = true;  // due dates follow the 30-day terms every commercial page prints
  const suppliers = supplierList(seed);
  const byLocale = {};
  for (const s of suppliers) (byLocale[s.locale] ??= []).push(s);
  const docs = [];
  for (const slug of K.CAP_TYPES) {
    for (let i = 0; i < K.CAP_PER_TYPE; i++) {
      const id = `cap-${slug}-${String(i).padStart(3, '0')}`;
      const r = new Rng(`${seed}:${slug}:${i}`);
      const dims = capDims(r, slug);
      const core = slug === 'freight-invoice' ? { kind: 'freight', x: freightDoc(r, dims) } : { kind: 'commercial', c: commercialCore(r, slug, dims) };
      // The pt-PT name bank holds the publisher's own company name (CORPUS.md); AIDP-CAP never prints it.
      const other = dims.locale.companies.find((x) => !/^Docupath\b/i.test(x));
      if (core.kind === 'commercial' && /^Docupath\b/i.test(core.c.buyer.name)) core.c.buyer = { ...core.c.buyer, name: other };
      if (core.kind === 'freight' && /^Docupath\b/i.test(core.x.content.buyer.name)) { core.x.content.buyer.name = other; core.x.gt.Buyer.Name = other; }
      const rc = new Rng(`${seed}:cap:${slug}:${i}`);
      const cond = drawConditions(rc, slug);
      // The seller: a supplier on the customer's list, or one that is not on it.
      const loc = dims.locale;
      let supplier = null;
      for (let tries = 0; tries < 20; tries++) {
        const s = cond.unlisted ? unlistedSupplier(rc, loc.id, suppliers) : rc.pick(byLocale[loc.id]);
        const name = printedName(s, cond.nameKind);
        if (resolvable(suppliers, s, { name, vatPrinted: cond.vatPrinted, street: s.street, city: s.city })) { supplier = { s, name }; break; }
      }
      if (!supplier) throw new Error(`${id}: no resolvable supplier in 20 draws`);
      docs.push({ id, slug, category: CATEGORY[slug], dims, core, rc, cond, supplier: supplier.s, printedSellerName: supplier.name, phase: 'A', role: null });
    }
  }
  const plan = { seed, suppliers, docs, links: [], anomalies: [], controls: [], duplicates: [] };
  planCases(plan);
  for (const d of docs) materialize(d, plan);
  plan.instructionsSample = drawSample(plan, 'instructions', K.INSTRUCTIONS_PER_TYPE, (d) => d.phase === 'A');
  plan.contractSample = drawSample(plan, 'contract', 20, (d) => d.phase === 'A');
  return plan;
}

/** A registered draw: per type, documents ordered by the SHA-256 of seed, purpose and id, the first n kept. */
function drawSample(plan, purpose, perType, keep) {
  const out = [];
  for (const slug of K.CAP_TYPES) {
    const pool = plan.docs.filter((d) => d.slug === slug && keep(d)).sort((a, b) => sha(`${plan.seed}:${purpose}:${a.id}`).localeCompare(sha(`${plan.seed}:${purpose}:${b.id}`)));
    out.push(...pool.slice(0, perType).map((d) => d.id));
  }
  return out.sort();
}

/**
 * The cases that involve more than one document. Every case is a document submitted in the second phase, after
 * the documents it refers to; half of each kind are anomalies and half are controls of the same kind, so a system
 * that flags everything and one that flags nothing both score one half.
 *
 *   po-variance            an invoice that refers to an earlier purchase order and prices one of its lines 5 to 15%
 *                          above the order (control: the same prices)
 *   bank-list              an invoice or credit note from a supplier whose approved bank account is on the customer's
 *                          list, paid to a different account (control: the approved account)
 *   bank-history           the same from a supplier with no approved account on the list, whose two or more earlier
 *                          invoices or credit notes were paid to one account (control: that account again)
 *   amount-history         an invoice whose amount is 15 to 30 times the supplier's usual amount, its two or more
 *                          earlier invoices all within a narrow band of it (control: an amount within that band)
 *   duplicate              a document sent again under a new reference, as the same file or as a new scan of it
 *                          (control: a new document from a supplier seen before)
 */
function planCases(plan) {
  const rp = new Rng(`${plan.seed}:plan`);
  const A = K.ANOMALIES;
  const docs = plan.docs;
  const used = new Set();
  // Any document can be drawn for a case: its own capability conditions are cleared afterwards (below), so a case
  // never loses its evidence to another capability's condition.
  const clean = (d) => !used.has(d.id) && !d.historyFor;
  const byLocale = {};
  for (const s of plan.suppliers) (byLocale[s.locale] ??= []).push(s);
  /** A listed supplier of the document's locale that meets a test, drawn by the plan's own stream. */
  const supplierFor = (d, test) => rp.pick(byLocale[d.dims.locale.id].filter(test));
  const take = (d, phase, role, kind) => { used.add(d.id); d.phase = phase; d.role = role; d.caseKind = kind; };
  const pool = (pred) => rp.shuffle(docs.filter((d) => pred(d) && clean(d)));
  const ofSupplier = (code) => docs.filter((d) => d.supplier.code === code);
  /** A document drawn for one supplier is given to another: the history a case needs is built, not hoped for. */
  const reassign = (d, s) => {
    let name = printedName(s, d.cond.nameKind);
    if (!resolvable(plan.suppliers, s, { name, vatPrinted: d.cond.vatPrinted, street: s.street, city: s.city })) { d.cond.nameKind = 'legal'; name = s.name; }
    d.supplier = s; d.printedSellerName = name; d.cond.unlisted = false;
  };
  /** At least n earlier documents of the given types from the case's supplier, in the first phase. */
  const ensureHistory = (d, types, n) => {
    let history = ofSupplier(d.supplier.code).filter((x) => x.id !== d.id && types.has(x.slug) && x.phase === 'A' && !x.role && !used.has(x.id) && !x.historyFor);
    if (history.length < n) {
      const extra = pool((x) => x.id !== d.id && types.has(x.slug) && x.dims.locale.id === d.dims.locale.id && x.supplier.code !== d.supplier.code && !(x.slug === 'invoice' && x.core.c?.negate))
        .slice(0, n - history.length);
      for (const x of extra) reassign(x, d.supplier);
      history = [...history, ...extra];
    }
    if (history.length < n) return false;
    for (const h of history) h.historyFor = d.id;
    return true;
  };

  // po-variance: an invoice of the same locale takes the order's supplier, buyer and lines
  const pos = pool((d) => d.slug === 'purchase-order' && d.core.c.items.length >= 2 && d.core.c.items.length <= 45);
  for (const po of pos) {
    if (plan.links.length >= 2 * A.poVariance) break;
    if (!po.supplier.code) reassign(po, supplierFor(po, () => true));
    const inv = docs.find((x) => x.slug === 'invoice' && clean(x) && x.id !== po.id && x.dims.locale.id === po.dims.locale.id && !x.core.c.negate);
    if (!inv) continue;
    const anomaly = plan.links.length % 2 === 0;
    take(po, 'A', 'reference', 'po-variance');
    take(inv, 'B', anomaly ? 'anomaly' : 'control', 'po-variance');
    inv.supplier = po.supplier; inv.printedSellerName = po.printedSellerName; inv.cond.vatPrinted = po.cond.vatPrinted; inv.cond.nameKind = po.cond.nameKind;
    inv.link = { po: po.id, raise: anomaly ? { row: rp.int(0, po.core.c.items.length - 1), pct: rp.int(5, 15) } : null };
    plan.links.push({ invoice: inv.id, po: po.id, anomaly });
  }
  if (plan.links.length < 2 * A.poVariance) throw new Error(`only ${plan.links.length} purchase-order links`);

  // amount-history: an invoice whose supplier sent at least two earlier invoices. The supplier's usual amount is set
  // first: its earlier invoices and the control all come within a narrow band of one base amount, and the anomaly is
  // 15 to 30 times that amount, so "far above the supplier's usual" is true by construction.
  const INVOICES = new Set(['invoice', 'consignment-invoice']);
  let n = 0;
  for (const d of pool((x) => x.slug === 'invoice' && !x.core.c.negate)) {
    if (n >= 2 * A.historyAmountJump) break;
    if (!d.supplier.code) reassign(d, supplierFor(d, () => true));
    if (!ensureHistory(d, INVOICES, 2)) continue;
    take(d, 'B', n % 2 === 0 ? 'anomaly' : 'control', 'amount-history');
    const base = Math.abs(d.core.c.net);
    for (const h of docs.filter((x) => x.historyFor === d.id)) h.amountTarget = base * (0.8 + rp.next() * 0.45);
    d.amountTarget = n % 2 === 0 ? base * rp.int(15, 30) : base * (0.8 + rp.next() * 0.45);
    n++;
  }
  if (n < 2 * A.historyAmountJump) throw new Error(`only ${n} amount-history cases`);

  // bank-history: a supplier with no approved account on the list, whose earlier documents printed one account
  n = 0;
  for (const d of pool((x) => BANK_CHECK_TYPES.has(x.slug))) {
    if (n >= 2 * A.historyBankChange) break;
    if (d.supplier.approved_account || !d.supplier.code) reassign(d, supplierFor(d, (s) => !s.approved_account));
    // the history: two earlier invoices or credit notes, whose contract holds the account they were paid to
    if (!ensureHistory(d, BANK_CHECK_TYPES, 2)) continue;
    take(d, 'B', n % 2 === 0 ? 'anomaly' : 'control', 'bank-history');
    n++;
  }
  if (n < 2 * A.historyBankChange) throw new Error(`only ${n} bank-history cases`);

  // bank-list: a supplier whose approved account is on the list, its VAT number printed so the list can find it
  const bankList = pool((d) => BANK_CHECK_TYPES.has(d.slug));
  for (let k = 0; k < 2 * A.approvedBankMismatch; k++) {
    const d = bankList[k];
    d.cond.vatPrinted = true;
    if (!d.supplier.approved_account || !d.supplier.code) reassign(d, supplierFor(d, (s) => !!s.approved_account));
    take(d, 'B', k % 2 === 0 ? 'anomaly' : 'control', 'bank-list');
  }

  // duplicates: originals stay in the first phase and their copies come in the second; controls are new documents
  // from suppliers seen before
  const dupPool = pool((d) => DUPLICATE_TYPES.has(d.slug) && d.phase === 'A');
  for (let k = 0; k < A.duplicate; k++) {
    const orig = dupPool[k];
    if (!orig.supplier.code) reassign(orig, supplierFor(orig, () => true));
    used.add(orig.id); orig.role = 'original'; orig.caseKind = 'duplicate';
    plan.duplicates.push({ id: `${orig.id}--copy`, of: orig.id, how: k % 2 === 0 ? 'same-file' : 'rescan' });
  }
  const dupControls = pool((d) => DUPLICATE_TYPES.has(d.slug) && d.supplier.code && ofSupplier(d.supplier.code).some((x) => x.id !== d.id && x.phase === 'A'));
  if (dupControls.length < A.duplicate) throw new Error(`only ${dupControls.length} duplicate controls`);
  for (let k = 0; k < A.duplicate; k++) take(dupControls[k], 'B', 'control', 'duplicate');

  for (const d of docs) {
    if (d.role === 'anomaly') plan.anomalies.push({ id: d.id, kind: d.caseKind });
    if (d.role === 'control') plan.controls.push({ id: d.id, kind: d.caseKind });
  }
  for (const c of plan.duplicates) plan.anomalies.push({ id: c.id, kind: 'duplicate', of: c.of, how: c.how });
  // A case document carries no condition that could hide or contradict the evidence it is judged on, or give a system a
  // reason of its own to stop it. The history a case relies on keeps its conditions, except a page fed upside down and
  // what the case reads from it: the account, for a bank case; the amounts, for an amount case.
  for (const d of docs) {
    if (d.role) Object.assign(d.cond, { occlusions: false, derivation: false, contradiction: false, upsideDown: false, unlisted: false });
    else if (d.historyFor) {
      const kind = docs.find((x) => x.id === d.historyFor).caseKind;
      Object.assign(d.cond, { upsideDown: false, unlisted: false });
      if (kind === 'amount-history') Object.assign(d.cond, { derivation: false, contradiction: false });
      if (kind === 'bank-history') d.cond.keepAccount = true;
    }
  }
}

// -------------------------------------------------------------------------------------------------
// one document
// -------------------------------------------------------------------------------------------------
/** The account a supplier with none approved on the list is always paid to: stable, drawn from its own name. */
function usualAccount(seed, s) {
  const a = accountFor(new Rng(`${seed}:usual-account:${s.code || s.name}`), s.cc);
  return { account: a.account, bic: a.bic };
}
function otherAccount(rc, s, avoid) {
  for (;;) { const a = accountFor(rc, s.cc); if (compactAccount(a.account) !== compactAccount(avoid)) return a.account; }
}

/** Totals from the lines, the way commercialCore computes them: each tax row its rate of the net. */
function retotal(c) {
  c.net = round2(c.items.reduce((a, it) => a + it.net, 0));
  c.taxRows = c.taxRows.map((t) => ({ ...t, total: Math.round(c.net * t.rate) / 100 }));
  c.tax = round2(c.taxRows.reduce((a, t) => a + t.total, 0));
  c.total = round2(c.net + c.tax);
  c.printedTotal = c.total;
}

function materialize(d, plan) {
  const { rc, cond, slug } = d;
  const s = d.supplier;
  d.cap = { supplier: { code: s.code, kind: d.cond.nameKind, vat_printed: cond.vatPrinted, listed: !!s.code }, marks: [], occlusions: [], derivations: [], contradiction: null, labels: [], barcodes: [], parsing: [], case: d.role ? { kind: d.caseKind, role: d.role } : null };

  if (d.core.kind === 'freight') return materializeFreight(d, plan);
  const c = d.core.c;
  const loc = c.loc;
  // the seller is the supplier, printed under the drawn form of its name
  c.seller = { ...c.seller, name: d.printedSellerName, street: s.street, city: s.city, postal: s.postal, country: s.country, cc: s.cc, countryDisp: s.country, vat: cond.vatPrinted ? s.vat : '', reg: '' };
  // the bank account printed: the approved one, the supplier's usual one, or for an anomaly another one, each written
  // as the supplier's country writes accounts (an IBAN, or a domestic account number where the country has none)
  const usual = s.approved_account ? { account: s.approved_account, bic: s.approved_bic } : usualAccount(plan.seed, s);
  c.pay = { ...c.pay, iban: usual.account, bic: usual.bic };
  if (d.role === 'anomaly' && (d.caseKind === 'bank-list' || d.caseKind === 'bank-history')) c.pay = { ...c.pay, iban: otherAccount(rc, s, usual.account) };
  c.pay.isIban = !!s.account_is_iban;
  d.cap.bank = { printed: c.pay.iban, approved: s.approved_account || null, usual: usual.account };

  // an invoice that refers to a purchase order takes its supplier, buyer and lines
  if (d.link) {
    const po = plan.docs.find((x) => x.id === d.link.po).core.c;
    c.buyer = { ...po.buyer };
    c.items = po.items.map((it) => ({ ...it }));
    c.taxRows = po.taxRows.map((t) => ({ ...t }));
    if (d.link.raise) {
      const it = c.items[d.link.raise.row];
      it.price = loc.noDecimals ? Math.round(it.price * (1 + d.link.raise.pct / 100)) : round2(it.price * (1 + d.link.raise.pct / 100));
      it.net = round2(it.qty * it.price);
    }
    retotal(c);
    d.cap.poNumber = po.number;
  }
  // an amount set by the case plan: the unit prices scaled so the net comes to the planned amount
  if (d.amountTarget) {
    const f = d.amountTarget / Math.max(Math.abs(c.net), 1);
    for (const it of c.items) { it.price = loc.noDecimals ? Math.max(1, Math.round(it.price * f)) : Math.max(0.01, round2(it.price * f)); it.net = round2(it.qty * it.price); }
    retotal(c);
  }

  // a printed contradiction: one figure that does not add up, everything else consistent with what is printed
  if (cond.contradiction) {
    const kinds = ['total', 'subtotal', 'line', ...(c.taxRows.length === 1 ? ['tax'] : [])];
    const kind = rc.pick(kinds);
    // the gap is 1 to 10 per cent of the figure, and never less than 0.10 (1 in a currency printed without decimals),
    // so it lies well outside the standard's tolerance for rounding (section 5.4: 0.02 or half of one per cent)
    const gap = (amount) => { const g = Math.max(Math.abs(amount) * (0.01 + rc.next() * 0.09), loc.noDecimals ? 1 : 0.1); const v = loc.noDecimals ? Math.round(g) : round2(g); return rc.chance(0.5) ? v : -v; };
    if (kind === 'total') { c.printedTotal = round2(c.total + gap(c.total)); }
    if (kind === 'subtotal') { c.net = round2(c.net + gap(c.net)); c.taxRows = c.taxRows.map((t) => ({ ...t, total: Math.round(c.net * t.rate) / 100 })); c.tax = round2(c.taxRows.reduce((a, t) => a + t.total, 0)); c.total = round2(c.net + c.tax); c.printedTotal = c.total; }
    if (kind === 'line') { const k = rc.int(0, c.items.length - 1); c.items[k].net = round2(c.items[k].net + gap(c.items[k].net)); retotal(c); d.cap.contradictionRowIndex = k; }
    if (kind === 'tax') { retotal(c); c.taxRows = [{ ...c.taxRows[0], total: round2(c.taxRows[0].total + gap(c.taxRows[0].total)) }]; c.tax = c.taxRows[0].total; c.total = round2(c.net + c.tax); c.printedTotal = c.total; }
    d.cap.contradiction = { kind, ...(kind === 'line' ? { row: d.cap.contradictionRowIndex } : {}) };
    delete d.cap.contradictionRowIndex;
  }

  // the answer key, written by the AIDP-2K builder from the same model the page is drawn from
  const gt = commercialGt(slug, c, d.dims);
  if (d.cap.poNumber && gt['Invoice Details'] && 'Purchase Order Number' in gt['Invoice Details']) gt['Invoice Details']['Purchase Order Number'] = d.cap.poNumber;
  // the AIDP-2K builder writes the method an IBAN takes ("IBAN"); a domestic account number prints no method
  if (!c.pay.isIban) {
    const pm = gt['Payment Details']?.['Payment Methods'];
    if (Array.isArray(pm) && pm[0]) pm[0].payment_method = '';
    if (Array.isArray(gt['Payment Methods']) && gt['Payment Methods'][0]) gt['Payment Methods'][0]['Payment Method'] = '';
    if (typeof pm === 'string') gt['Payment Details']['Payment Methods'] = '';
  }
  d.gt = gt;
  d.content = commercialCells(slug, c, d, gt);
  if (cond.derivation) applyDerivations(d, c, gt);
  if (slug.startsWith('consignment')) applyLabels(d, c, gt);
  addBarcodes(d, c);
  if (cond.occlusions) applyOcclusions(d);
  planMarks(d);
  planAttachments(d);
  d.cap.parsing = parsingGroups(d);
  d.scanned = d.dims.noise === 'heavy' || cond.occlusions || cond.upsideDown;
}

// -------------------------------------------------------------------------------------------------
// the commercial page as cells
// -------------------------------------------------------------------------------------------------
function has(gt, path) {
  let o = gt;
  for (const p of path.split('.')) {
    if (Array.isArray(o)) { if (!/^\d+$/.test(p) || Number(p) >= o.length) return false; o = o[Number(p)]; continue; }
    if (!o || typeof o !== 'object' || !(p in o)) return false;
    o = o[p];
  }
  return true;
}

function metaPaths(slug, gt) {
  if (gt['Order Details']) return { sec: 'Order Details', number: 'PO Number', date: 'PO Date', due: 'Due Date', ref: ['Your Reference', 'Contact Name'], terms: 'Payment Terms', net: 'Order Details.Net Amount', total: 'Order Details.Total Amount' };
  if (gt['Consignment Details']) return { sec: 'Consignment Details', number: 'Consignment Number', date: 'Consignment Date', due: 'Payment Due Date', ref: ['Contact Name'], terms: 'Payment Terms', net: 'Payment Details.Subtotal', total: 'Payment Details.Total' };
  return { sec: 'Invoice Details', number: 'Invoice Number', date: 'Invoice Date', due: 'Due Date', ref: ['Your Reference'], terms: 'Payment Terms', net: 'Invoice Details.Net Amount', total: 'Invoice Details.Total Amount' };
}

function commercialCells(slug, c, d, gt) {
  const { L, loc } = c;
  const P = (...paths) => paths.filter((p) => has(gt, p));
  const M = metaPaths(slug, gt);
  const addr = (sec) => (gt[sec] && 'Address' in gt[sec] ? 'Address' : 'Street 1');
  const shipTo = gt['Shipping Details'] && (gt['Shipping Details'].City || gt['Shipping Details']['Postal Code']);
  const vatPath = (sec) => (gt[sec] && 'Registration No' in gt[sec] && c.loc.vatField === 'Registration No' ? `${sec}.Registration No` : `${sec}.VAT No`);
  const sellerVat = vatPath('Seller');
  const title = slug === 'credit-note' ? L.creditNote : slug === 'purchase-order' ? L.purchaseOrder : slug.startsWith('consignment') ? `CONSIGNMENT ${slug.endsWith('order') ? 'ORDER' : 'INVOICE'}` : L.invoice;
  const seller = {
    name: cell(c.seller.name, P('Seller.Name')),
    street: cell(c.seller.street, P(`Seller.${addr('Seller')}`)), postal: cell(c.seller.postal, P('Seller.Postal Code')), city: cell(c.seller.city, P('Seller.City')),
    country: cell(c.seller.country, P('Seller.Country', 'Seller.Country Code')),
    vat: c.seller.vat ? cell(c.seller.vat, P(sellerVat)) : null,
  };
  const ship = (f) => (shipTo ? [`Shipping Details.${f === 'street' ? addr('Shipping Details') : f}`] : []);
  const buyer = {
    name: cell(c.buyer.name, P('Buyer.Name')),
    street: cell(c.buyer.street, P(`Buyer.${addr('Buyer')}`, ...ship('street'))), postal: cell(c.buyer.postal, P('Buyer.Postal Code', ...ship('Postal Code'))),
    city: cell(c.buyer.city, P('Buyer.City', ...ship('City'))), country: cell(c.buyer.country, P('Buyer.Country', 'Buyer.Country Code', ...ship('Country'), ...ship('Country Code'))),
    vat: c.buyer.vat ? cell(c.buyer.vat, P(vatPath('Buyer'))) : null,
  };
  const meta = `${M.sec}.`;
  const metaRows = [
    { key: 'number', label: ['purchase-order', 'consignment-order'].includes(slug) ? L.orderNo : slug === 'credit-note' ? (L.creditNoteNo ?? L.invoiceNo) : L.invoiceNo, value: cell(c.number, P(meta + M.number)) },
    { key: 'date', label: ['purchase-order', 'consignment-order'].includes(slug) ? L.orderDate : L.invoiceDate, value: cell(loc.date(c.d0), P(meta + M.date)) },
    { key: 'due', label: L.dueDate, value: cell(loc.date(c.due), P(meta + M.due)) },
    { key: 'ref', label: L.reference, value: cell(c.refPerson, P(...M.ref.map((f) => meta + f))) },
    { key: 'currency', label: L.currency, value: cell(loc.currency, P(meta + 'Currency Code')) },
  ];
  if (d.cap.poNumber) metaRows.splice(1, 0, { key: 'po', label: 'PO Number', value: cell(d.cap.poNumber, P('Invoice Details.Purchase Order Number')) });
  const lotSerial = c.withLotSerial;
  const itemCols = [
    { k: 'no', label: L.pos }, { k: 'id', label: L.article }, { k: 'name', label: L.description }, { k: 'desc', label: 'Spec' },
    ...(lotSerial ? [{ k: 'lot', label: L.lot }, { k: 'serial', label: L.serial }] : []),
    { k: 'qty', label: L.qty, num: true }, { k: 'uom', label: L.uom }, { k: 'price', label: L.unitPrice, num: true }, { k: 'net', label: L.amount, num: true },
  ];
  const ipath = (i, f) => P(`Items.${i}.${f}`);
  const rows = c.items.map((it, i) => ({
    no: cell(it.no, [...ipath(i, 'Item No'), ...(slug === 'purchase-order' ? ipath(i, 'Order Number') : [])]),
    id: cell(it.id, ipath(i, 'Article ID')), name: cell(it.name, ipath(i, 'Article Name')), desc: cell(it.desc, ipath(i, 'Description')),
    lot: cell(it.lot, ipath(i, 'Lot Number')), serial: cell(it.serial, ipath(i, 'Serial Number')),
    qty: cell(String(it.qty), ipath(i, 'Quantity')), uom: cell(it.uom, ipath(i, 'UOM')),
    price: cell(loc.num(it.price), ipath(i, 'Unit Price')), net: cell(loc.num(it.net), ipath(i, 'Net Amount')),
  }));
  const taxPaths = (j) => [...P(`Payment Details.Tax.${j}.tax_total`), ...(c.taxRows.length === 1 ? P('Invoice Details.Total Tax') : [])];
  const totalsRows = [
    { key: 'net', label: L.subtotal, value: cell(loc.num(c.net), P(M.net)) },
    ...c.taxRows.map((t, j) => ({ key: `tax${j}`, label: [cell(t.code, P(`Payment Details.Tax.${j}.tax_code`)), cell(' ', []), cell(`${t.rate}%`, [...P(`Payment Details.Tax.${j}.rate`), ...(c.taxRows.length === 1 ? P('Payment Details.Tax Rate') : [])])], value: cell(loc.num(t.total), taxPaths(j)) })),
    { key: 'total', label: L.total, value: cell(loc.num(c.printedTotal), P(M.total)), em: true },
  ];
  const ibanPath = P('Payment Details.Payment Methods.0.account_no', 'Payment Methods.0.Account Number');
  const acctLabel = c.pay.isIban ? L.iban : (L.account ?? 'Account No');
  const bicPath = P('Payment Details.Payment Methods.0.BIC_or_Swift_code', 'Payment Methods.0.BIC/SWIFT Code');
  const paymentRows = [
    { key: 'bank', label: L.bank, value: cell(c.pay.bank, []) },
    ...(d.cond.bankLine
      ? [{ key: 'bankline', label: `${acctLabel} / ${L.bic}`, value: [cell(c.pay.iban, ibanPath), cell(`  ${c.pay.isIban ? 'BIC' : 'SWIFT'} `, []), cell(c.pay.bic, bicPath)], compound: 'bank-line' }]
      : [{ key: 'iban', label: acctLabel, value: cell(c.pay.iban, ibanPath) }, { key: 'bic', label: c.pay.isIban ? L.bic : 'SWIFT', value: cell(c.pay.bic, bicPath) }]),
    { key: 'terms', label: L.paymentTerms, value: cell(c.pay.terms, P(meta + M.terms)) },
  ];
  return {
    kind: 'commercial', slug, locale: loc, dir: loc.dir, title, seller, buyer, metaRows, itemCols, rows, totalsRows, paymentRows,
    footerNote: L.thanks, noiseProfile: d.dims.noise, coverPage: d.dims.coverPage, barcodes: [], labels: [], marks: [], notes: [],
  };
}

// -------------------------------------------------------------------------------------------------
// Computation: values the page implies but does not print
// -------------------------------------------------------------------------------------------------
function setPath(gt, path, v) {
  const parts = path.split('.');
  let o = gt;
  for (let i = 0; i < parts.length - 1; i++) o = o[/^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i]];
  o[parts.at(-1)] = v;
}
function getPath(gt, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[/^\d+$/.test(k) && Array.isArray(o) ? Number(k) : k]), gt);
}
export { getPath };

function applyDerivations(d, c, gt) {
  const { rc } = d;
  const ct = d.content;
  const M = metaPaths(d.slug, gt);
  const noDec = c.loc.noDecimals;
  // a credit note prints its line amounts with a credit's sign, which quantity times price does not give, so none of its
  // line amounts is left to be computed
  const kinds = [...(c.negate ? [] : ['line-amount']), 'grand-total', 'due-date', 'net', ...(gt['Invoice Details'] && c.taxRows.length === 1 && 'Total Tax' in gt['Invoice Details'] ? ['tax-total'] : [])];
  const first = rc.pick(kinds);
  const picked = [first];
  if (rc.chance(0.4)) {
    const second = rc.pick(kinds.filter((k) => k !== first && !(['net', 'grand-total'].includes(k) && ['net', 'grand-total'].includes(first))));
    if (second) picked.push(second);
  }
  for (const kind of picked) {
    if (kind === 'line-amount') {
      const k = rc.int(0, c.items.length - 1);
      const path = `Items.${k}.Net Amount`;
      ct.rows[k].net = cell('', []);
      setPath(gt, path, '');
      d.cap.derivations.push({ path, value: gtNum(c.items[k].net, noDec), method: 'quantity times unit price', inputs: [`Items.${k}.Quantity`, `Items.${k}.Unit Price`] });
    } else if (kind === 'grand-total') {
      ct.totalsRows = ct.totalsRows.filter((x) => x.key !== 'total');
      setPath(gt, M.total, '');
      d.cap.derivations.push({ path: M.total, value: gtNum(c.total, noDec), method: 'net plus tax', inputs: [M.net] });
    } else if (kind === 'net') {
      ct.totalsRows = ct.totalsRows.filter((x) => x.key !== 'net');
      setPath(gt, M.net, '');
      d.cap.derivations.push({ path: M.net, value: gtNum(c.net, noDec), method: 'sum of the line amounts', inputs: ['Items[].Net Amount'] });
    } else if (kind === 'due-date') {
      ct.metaRows = ct.metaRows.filter((x) => x.key !== 'due');
      const path = `${M.sec}.${M.due}`;
      setPath(gt, path, '');
      d.cap.derivations.push({ path, value: gtDate(c.due), method: 'document date plus the 30 days of the printed payment terms', inputs: [`${M.sec}.${M.date}`, `${M.sec}.${M.terms}`] });
    } else if (kind === 'tax-total') {
      // the tax line keeps its label and rate, and prints no amount
      const row = ct.totalsRows.find((x) => x.key === 'tax0');
      row.value = cell('', []);
      setPath(gt, 'Invoice Details.Total Tax', '');
      if (Array.isArray(gt['Payment Details']?.Tax) && gt['Payment Details'].Tax[0]) gt['Payment Details'].Tax[0].tax_total = '';
      d.cap.derivations.push({ path: 'Invoice Details.Total Tax', value: gtNum(c.tax, noDec), method: 'net times the printed tax rate', inputs: [M.net, 'Payment Details.Tax Rate'] });
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Decoding: labels on consignment lines
// -------------------------------------------------------------------------------------------------
function applyLabels(d, c, gt) {
  const { rc } = d;
  const n = Math.min(c.items.length, rc.int(K.LABELS.rowsMin, K.LABELS.rowsMax));
  const rows = rc.shuffle(c.items.map((_, i) => i)).slice(0, n).sort((a, b) => a - b);
  for (const i of rows) {
    const it = c.items[i];
    const gtin = ean13(`0${rc.digits(11)}`);
    const expiry = `${rc.int(27, 29)}${String(rc.int(1, 12)).padStart(2, '0')}${String(rc.int(1, 28)).padStart(2, '0')}`;
    const lot = it.lot || `LOT${rc.digits(6)}`;
    const serial = it.serial || (rc.chance(0.6) ? `SN${rc.digits(8)}` : '');
    const symbology = rc.chance(K.LABELS.dataMatrix) ? 'gs1datamatrix' : 'gs1-128';
    const labelOnly = rc.chance(K.LABELS.labelOnly);
    const payload = gs1({ gtin, expiry, lot, serial: serial || undefined });
    const id = `L${d.cap.labels.length + 1}`;
    d.cap.labels.push({ id, row: i, symbology, payload, gtin, expiry, lot, serial, label_only: labelOnly });
    d.cap.barcodes.push({ id, symbology, payload, row: i });
    // the key holds what the page prints: the label prints the lot and serial, whether or not the line does
    setPath(gt, `Items.${i}.Lot Number`, lot);
    setPath(gt, `Items.${i}.Serial Number`, serial);
    const row = d.content.rows[i];
    if (labelOnly) { row.lot = cell('-', []); row.serial = cell('-', []); } else { row.lot = cell(lot, [`Items.${i}.Lot Number`]); row.serial = cell(serial, serial ? [`Items.${i}.Serial Number`] : []); }
    row.label = id;
    d.content.labels.push({ id, row: i, symbology, payload });
  }
}

function addBarcodes(d, c) {
  const { rc, slug } = d;
  // The EPC payment code asks for a euro credit transfer to an IBAN, so it is printed only on euro invoices (a credit
  // note asks nobody to pay, and a code carrying its amount would contradict its negative total), and never where the
  // grand total it would carry is left for the system to compute.
  const totalUnprinted = d.cap.derivations.some((x) => x.method === 'net plus tax');
  if (slug === 'invoice' && c.loc.currency === 'EUR' && c.pay.isIban && !totalUnprinted && rc.chance(0.5)) {
    const epc = `BCD\n002\n1\nSCT\n${c.pay.bic.replace(/\s/g, '')}\n${c.seller.name}\n${c.pay.iban.replace(/\s/g, '')}\n${c.loc.currency}${Math.abs(c.printedTotal).toFixed(2)}`;
    d.content.barcodes.push({ id: 'Q1', symbology: 'qrcode', payload: epc, place: 'payment' });
    d.cap.barcodes.push({ id: 'Q1', symbology: 'qrcode', payload: epc });
  }
  if (slug === 'purchase-order' && rc.chance(0.5)) {
    d.content.barcodes.push({ id: 'C1', symbology: 'code128', payload: c.number, place: 'header' });
    d.cap.barcodes.push({ id: 'C1', symbology: 'code128', payload: c.number });
  }
}

// -------------------------------------------------------------------------------------------------
// Legibility: values made unreadable, and controls left readable under a mark
// -------------------------------------------------------------------------------------------------
/** Every printed cell of the page, in reading order, with where it sits (for choosing a control beside a value). */
function allCells(d) {
  const ct = d.content;
  const out = [];
  const push = (x, where) => { for (const c of [].concat(x ?? [])) if (isCell(c) && c.v) out.push({ cell: c, where }); };
  for (const k of ['name', 'street', 'postal', 'city', 'country', 'vat']) push(ct.seller[k], 'head');
  for (const k of ['name', 'street', 'postal', 'city', 'country', 'vat']) push(ct.buyer[k], 'head');
  if (ct.kind === 'commercial') {
    for (const r of ct.metaRows) push(r.value, 'head');
    ct.rows.forEach((row, i) => { for (const col of ct.itemCols) push(row[col.k], `row:${i}`); });
    for (const r of ct.totalsRows) { push(r.label, 'foot'); push(r.value, 'foot'); }
    for (const r of ct.paymentRows) push(r.value, 'foot');
  } else {
    for (const sec of ct.sections) (sec.table?.rows ?? []).forEach((row, i) => { for (const x of row) push(x, sec.heading === 'Charges' ? `row:${i}` : 'head'); });
  }
  return out;
}

/**
 * The values that may be made unreadable: identifiers and names a page prints exactly once, which nothing else on the
 * page, in a barcode or in an attachment repeats, and which nothing printed lets a reader work out: the document number
 * (where no barcode carries it), the person named as the reference, the bank account (where no payment code carries it),
 * a line's article number, and on a freight invoice the bills of lading. A line's article name is not one: names repeat
 * across lines and follow from the line's other cells.
 */
function occlusionCandidates(d) {
  const ct = d.content;
  const cells = allCells(d);
  const flatText = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const markText = flatText((d.cap.marks ?? []).map((m) => m.text ?? '').join(' '));
  // printed once: neither the cell's text nor the value the key holds for it appears in any other cell or in a mark
  // (another cell that is only a digit of it, a line number or a quantity, repeats nothing)
  const once = (c) => {
    const forms = [c.v, ...c.paths.map((p) => getPath(d.gt, p))].map(flatText).filter((s) => s.length >= 2);
    return forms.length > 0 && forms.every((f) => !markText.includes(f) && !cells.some((x) => x.cell !== c && flatText(x.cell.v).includes(f)));
  };
  const out = [];
  if (ct.kind === 'commercial') {
    const num = ct.metaRows.find((x) => x.key === 'number');
    if (num && !d.cap.barcodes.some((b) => b.symbology === 'code128')) out.push({ where: 'head', cell: num.value });
    const ref = ct.metaRows.find((x) => x.key === 'ref');
    if (ref) out.push({ where: 'head', cell: ref.value });
    // the account, unless a payment code carries it or a bank case reads it from this document
    const acct = ct.paymentRows.find((x) => x.key === 'iban');
    if (acct && !d.cond.keepAccount && !d.cap.barcodes.some((b) => b.symbology === 'qrcode') && acct.value.paths.length) out.push({ where: 'foot', cell: acct.value });
    ct.rows.forEach((row, i) => { if (!row.label) out.push({ where: `row:${i}`, row: i, cell: row.id }); });
  } else {
    for (const sec of ct.sections) for (const row of sec.table?.rows ?? []) for (const x of row) if (isCell(x) && x.occlusible) out.push({ where: 'head', cell: x });
  }
  return out.filter((x) => x.cell.paths.length && x.cell.v && once(x.cell));
}

/**
 * One or two values hidden under an ink blot or a paper label, each with its own readable control: the nearest other
 * candidate, under a coffee ring that leaves it legible (the next line's article number beside a hidden one, another
 * header value beside a hidden header value).
 */
function applyOcclusions(d) {
  const { rc } = d;
  const cands = occlusionCandidates(d);
  const pool = rc.shuffle(cands);
  const taken = new Set();
  const pick = () => pool.find((x) => !taken.has(x.cell));
  const nHidden = rc.chance(0.5) ? 2 : 1;
  const rowOf = (x) => (x.row ?? (x.where.startsWith('row:') ? Number(x.where.slice(4)) : null));
  for (let k = 0; k < nHidden; k++) {
    const o = pick();
    if (!o) break;
    taken.add(o.cell);
    const near = cands.filter((x) => !taken.has(x.cell) && (rowOf(o) == null ? x.where === o.where : rowOf(x) != null))
      .sort((a, b) => (rowOf(o) == null ? 0 : Math.abs(rowOf(a) - rowOf(o)) - Math.abs(rowOf(b) - rowOf(o))))[0];
    if (!near) { taken.delete(o.cell); break; }
    taken.add(near.cell);
    const kind = rc.chance(0.6) ? 'blot' : 'label';
    const id = `O${k + 1}`;
    o.cell.occ = { id, kind, hidden: true };
    for (const p of o.cell.paths) d.cap.occlusions.push({ id, path: p, value: getPath(d.gt, p), kind, hidden: true });
    for (const p of o.cell.paths) setPath(d.gt, p, ''); // the page does not legibly carry it
    const cid = `C${k + 1}`;
    near.cell.occ = { id: cid, kind: 'ring', hidden: false };
    for (const p of near.cell.paths) d.cap.occlusions.push({ id: cid, path: p, value: getPath(d.gt, p), kind: 'ring', hidden: false, control_for: id });
  }
}

// -------------------------------------------------------------------------------------------------
// Handwriting and stamps
// -------------------------------------------------------------------------------------------------
/**
 * Handwritten notes: templates with numbers, days, initials and names drawn per note, so the wording of one note is
 * all but unique and cannot be recited from a list. {n} a count, {k} a line, {d} a day and month, {i} initials, {p} a
 * person's first name.
 */
const NOTES = {
  en: ['Received {d} - short {n} boxes', 'OK to pay - {i}', 'Checked against delivery {d}', 'Price agreed by phone with {p}', 'Goods returned {d}', 'Paid by card {d}', 'Call {p} re: price', 'Line {k} damaged', 'Partial delivery, {n} to follow', 'Approved {i} {d}', 'Qty {n} missing on line {k}', 'Credit owed for line {k}'],
  de: ['Erhalten {d} - {n} Kartons fehlen', 'Zur Zahlung freigegeben - {i}', 'Mit Lieferung geprüft {d}', 'Ware zurück {d}', 'Teillieferung, {n} folgen', 'Preis mit {p} vereinbart', 'Pos. {k} beschädigt', 'Menge {n} fehlt in Pos. {k}'],
  fr: ['Reçu {d} - manque {n} cartons', 'Bon pour paiement - {i}', 'Vérifié avec livraison {d}', 'Livraison partielle, {n} à suivre', 'Marchandise retournée {d}', 'Prix convenu avec {p}', 'Ligne {k} abîmée'],
  es: ['Recibido {d} - faltan {n} cajas', 'Conforme para pago - {i}', 'Entrega parcial, faltan {n}', 'Mercancía devuelta {d}', 'Precio acordado con {p}', 'Línea {k} dañada'],
  pt: ['Recebido {d} - faltam {n} caixas', 'Aprovado para pagamento - {i}', 'Entrega parcial, faltam {n}', 'Mercadoria devolvida {d}', 'Preço acordado com {p}', 'Linha {k} danificada'],
  nl: ['Ontvangen {d} - {n} dozen te weinig', 'Akkoord voor betaling - {i}', 'Gedeeltelijke levering, {n} volgen', 'Goederen retour {d}', 'Prijs afgesproken met {p}', 'Regel {k} beschadigd'],
  sv: ['Mottaget {d} - {n} kartonger saknas', 'Godkänd för betalning - {i}', 'Delleverans, {n} kommer', 'Varor returnerade {d}', 'Pris överenskommet med {p}', 'Rad {k} skadad'],
  ja: ['{d} 受領 {n}箱不足', '支払承認 {i}', '一部納品 残り{n}', '{d} 返品', '{k}行目 破損'],
  ar: ['تم الاستلام {d} - ينقص {n} صناديق', 'موافق للدفع - {i}', 'تسليم جزئي، المتبقي {n}', 'البند {k} تالف'],
};
function noteText(rc, d, lang) {
  const loc = d.dims.locale;
  const rows = d.content.rows?.length || d.content.sections?.find((s) => s.heading === 'Charges')?.table.rows.length || 3;
  const t = rc.pick(NOTES[lang] ?? NOTES.en);
  const dd = String(rc.int(1, 28)).padStart(2, '0'), mm = String(rc.int(1, 12)).padStart(2, '0');
  const initials = `${'ABCDEFGHJKLMNPRSTW'[rc.int(0, 17)]}${'ABCDEFGHJKLMNPRSTW'[rc.int(0, 17)]}`;
  return t.replace('{n}', String(rc.int(2, 24))).replace('{k}', String(rc.int(1, Math.max(1, rows))))
    .replace('{d}', lang === 'ja' ? `${Number(mm)}/${Number(dd)}` : loc.id === 'en-US' ? `${mm}/${dd}` : `${dd}.${mm}`)
    .replace('{i}', initials).replace('{p}', String(rc.pick(loc.people)).split(' ')[0]);
}
function stampWords(L) {
  return [['received', L.received ?? 'RECEIVED', true], ['paid', L.paid ?? 'PAID', true], ['approved', 'APPROVED', false], ['copy', L.copy ?? 'COPY', false]];
}
function planMarks(d) {
  const { rc } = d;
  if (!d.cond.marks) return;
  const loc = d.dims.locale;
  const L = loc.labels;
  const lang = loc.lang;
  const used = new Set();
  for (let k = 0; k < d.cond.marks; k++) {
    let kind = weighted(rc, K.MARK_KINDS);
    if ((kind === 'stamp' || kind === 'signature') && used.has(kind)) kind = 'note';
    used.add(kind);
    const id = `M${k + 1}`;
    if (kind === 'note') {
      let text = noteText(rc, d, lang);
      while (d.cap.marks.some((m) => m.text === text)) text = noteText(rc, d, lang);
      d.cap.marks.push({ id, kind, text, place: rc.chance(0.6) ? 'header' : 'end', font: rc.int(0, 1000), ink: rc.pick(['#1a3d8f', '#202020', '#0d47a1', '#7a1f1f']) });
    } else if (kind === 'stamp') {
      const [what, word, dated] = rc.pick(stampWords(L));
      const text = dated ? `${word} ${loc.date(addDays(dDate(d), rc.int(1, 9)))}` : what === 'approved' ? `${word} ${rc.pick(['JB', 'MK', 'AS', 'RT', 'LD'])}` : word;
      d.cap.marks.push({ id, kind, text, place: 'top', rot: rc.int(-6, 6), ink: rc.pick(['#b3261e', '#1a3d8f', '#5b2a86']) });
    } else if (kind === 'signature') {
      d.cap.marks.push({ id, kind, text: rc.pick(loc.people), place: 'end', font: rc.int(0, 1000), ink: rc.pick(['#1a3d8f', '#202020']) });
    } else {
      // one tick to a line: a line already ticked is not ticked again
      const free = (d.content.rows ?? []).map((_, i) => i).filter((i) => !d.cap.marks.some((m) => m.kind === 'tick' && m.row === i));
      if (!free.length) { d.cap.marks.push({ id, kind: 'note', text: noteText(rc, d, lang), place: 'end', font: rc.int(0, 1000), ink: '#202020' }); continue; }
      d.cap.marks.push({ id, kind: 'tick', row: rc.pick(free), place: 'row', ink: rc.pick(['#1a3d8f', '#202020', '#b3261e']) });
    }
  }
  d.content.marks = d.cap.marks;
}
const dDate = (d) => {
  if (d.core.kind === 'commercial') return d.core.c.d0;
  const m = String(d.gt?.['Invoice Details']?.['Invoice Date'] ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? { y: Number(m[3]), m: Number(m[2]), d: Number(m[1]) } : { y: 2026, m: 3, d: 1 };
};

// -------------------------------------------------------------------------------------------------
// Intake: files that arrive with the document
// -------------------------------------------------------------------------------------------------
function planAttachments(d) {
  const { rc } = d;
  d.attachments = [];
  for (let k = 0; k < d.cond.attachments; k++) {
    const kind = d.core.kind === 'freight' ? rc.pick(['letter', 'packing-list']) : rc.pick(['letter', 'delivery-note', 'packing-list']);
    d.attachments.push({ id: `${d.id}-att-${'ABC'[k]}`, kind, scanned: kind === 'letter' ? true : rc.chance(0.3), seed: rc.int(0, 1e9) });
  }
}

// -------------------------------------------------------------------------------------------------
// Parsing: values printed together that the contract keeps apart
// -------------------------------------------------------------------------------------------------
function parsingGroups(d) {
  const ct = d.content;
  const groups = [];
  const nonEmpty = (paths) => paths.filter((p) => { const v = getPath(d.gt, p); return v !== undefined && v !== null && String(v).trim() !== ''; });
  if (ct.kind === 'commercial') {
    // the seller's address on one line in the header: street, postal code and city, country
    groups.push({ compound: 'seller-address-line', parts: nonEmpty([ct.seller.street.paths[0], ct.seller.postal.paths[0], ct.seller.city.paths[0], 'Seller.Country'].filter(Boolean)) });
    // the buyer's postal code and city on one line
    groups.push({ compound: 'buyer-postal-city', parts: nonEmpty([ct.buyer.postal.paths[0], ct.buyer.city.paths[0]].filter(Boolean)) });
    const bl = ct.paymentRows.find((x) => x.compound === 'bank-line');
    if (bl) groups.push({ compound: 'bank-line', parts: nonEmpty(bl.value.flatMap((x) => x.paths.slice(0, 1))) });
  } else {
    for (const g of ct.compounds ?? []) groups.push({ compound: g.compound, parts: nonEmpty(g.parts) });
  }
  return groups.filter((g) => g.parts.length >= 2);
}

// -------------------------------------------------------------------------------------------------
// freight invoices: the AIDP-2K page, its values made cells
// -------------------------------------------------------------------------------------------------
function materializeFreight(d, plan) {
  const { cond } = d;
  const x = d.core.x;
  const s = d.supplier;
  const gt = x.gt;
  const content = x.content;
  // the seller is the supplier (freight prints the seller in the header and in its own block)
  Object.assign(content.seller, { name: d.printedSellerName, street: s.street, city: s.city, postal: s.postal, country: s.country, cc: s.cc, countryDisp: s.country, vat: cond.vatPrinted ? s.vat : '', reg: '' });
  Object.assign(gt.Seller, { Name: d.printedSellerName, Address: s.street, City: s.city, 'Postal Code': s.postal, Country: s.country, 'Country Code': s.cc, 'VAT No': cond.vatPrinted ? s.vat : '', 'Registration No': '' });
  // the freight page prints no payment terms (AIDP-2K's key held them all the same; FINDINGS.md, B3): this key does not
  if (gt['Invoice Details'] && 'Payment Terms' in gt['Invoice Details']) gt['Invoice Details']['Payment Terms'] = '';
  d.gt = gt;
  d.cap.bank = null;
  const L = content.locale.labels;
  const P = (...paths) => paths.filter((p) => has(gt, p));
  const seller = { name: cell(content.seller.name, P('Seller.Name')), street: cell(s.street, P('Seller.Address')), postal: cell(s.postal, P('Seller.Postal Code')), city: cell(s.city, P('Seller.City')), country: cell(s.country, P('Seller.Country', 'Seller.Country Code')), vat: cond.vatPrinted ? cell(s.vat, P('Seller.VAT No')) : null };
  const b = content.buyer;
  const buyer = { name: cell(b.name, P('Buyer.Name')), street: cell(b.street, P('Buyer.Address')), postal: cell(b.postal, P('Buyer.Postal Code')), city: cell(b.city, P('Buyer.City')), country: cell(b.country, P('Buyer.Country', 'Buyer.Country Code')), vat: null };
  const kvPaths = {
    [L.invoiceNo]: ['Invoice Details.Invoice Number'], [L.invoiceDate]: ['Invoice Details.Invoice Date'], [L.dueDate]: ['Invoice Details.Due Date'], [L.currency]: ['Invoice Details.Currency Code'],
    'Shipment Reference': ['Freight Shipments.0.Shipment Reference'], 'Master Bill of Lading': ['Freight Shipments.0.Master Bill Of Lading'], 'House Bill of Lading': ['Freight Shipments.0.House Bill Of Lading'],
    [L.subtotal]: ['Invoice Details.Net Amount'], [L.total]: ['Invoice Details.Total Amount'],
  };
  const occlusible = new Set([L.invoiceNo, 'Shipment Reference', 'Master Bill of Lading', 'House Bill of Lading']);
  const compounds = [];
  const sections = content.sections.map((sec) => {
    const t = sec.table;
    if (!t) return sec;
    const isKv = t.cols.every((col) => col === '');
    const rows = t.rows.map((row, ri) => {
      if (isKv) {
        const [k, v] = row;
        if (k === 'Vessel / Voyage') {
          const [vessel, voyage] = String(v).split(' / ');
          compounds.push({ compound: 'vessel-voyage', parts: ['Freight Shipments.0.Vessel Name', 'Freight Shipments.0.Voyage Number'] });
          return [k, [cell(vessel, P('Freight Shipments.0.Vessel Name')), cell(' / ', []), cell(voyage, P('Freight Shipments.0.Voyage Number'))]];
        }
        if (k === 'Origin' || k === 'Destination') {
          const [city, cc] = String(v).split(', ');
          const loc = k === 'Origin' ? 'Departure Location.0.City' : 'Arrival Location.0.City';
          const ccp = k === 'Origin' ? 'Freight Shipments.0.Origin Country Code' : 'Freight Shipments.0.Destination Country Code';
          const whole = k === 'Origin' ? 'Freight Shipments.0.Origin Location' : 'Freight Shipments.0.Destination Location';
          compounds.push({ compound: `${k.toLowerCase()}-city-country`, parts: [loc, ccp] });
          return [k, [cell(city, P(loc, whole)), cell(', ', [whole]), cell(cc, P(ccp, whole))]];
        }
        if (k === 'Containers') return [k, String(v).split(', ').flatMap((cn, ci, arr) => [cell(cn, P(`Line Containers.${ci}.Container ID`, `Invoice Containers.${ci}.Container ID`)), ...(ci < arr.length - 1 ? [cell(', ', [])] : [])])];
        if (/%$/.test(String(k)) || String(k).startsWith(content.locale.taxName)) {
          // the tax code and the rate are two printed values, each located where it is printed
          const at = String(k).lastIndexOf(' ');
          const label = at > 0 && /%$/.test(String(k)) ? [cell(String(k).slice(0, at), P('Tax.0.tax_code')), cell(' ', []), cell(String(k).slice(at + 1), P('Tax.0.rate'))] : cell(k, P('Tax.0.tax_code', 'Tax.0.rate'));
          return [label, cell(v, P('Tax.0.tax_total', 'Invoice Details.Total Tax'))];
        }
        const paths = kvPaths[k] ?? [];
        return [k, cell(v, P(...paths), occlusible.has(k) ? { occlusible: true } : {})];
      }
      if (sec.heading === 'Charges') return [cell(row[0], P(`Line Charges.${ri}.Description`, `Line Charges.${ri}.Charge Code`)), cell(row[1], []), cell(row[2], P(`Line Charges.${ri}.Amount`))];
      return row;
    });
    return { ...sec, table: { ...t, rows } };
  });
  compounds.push({ compound: 'buyer-postal-city', parts: ['Buyer.Postal Code', 'Buyer.City'] });
  compounds.push({ compound: 'seller-postal-city', parts: ['Seller.Postal Code', 'Seller.City'] });
  d.content = { kind: 'facty', slug: 'freight-invoice', locale: content.locale, dir: content.dir, seller, buyer, title: 'FREIGHT INVOICE', sections, compounds,
    noiseProfile: d.dims.noise, coverPage: d.dims.coverPage, footerNote: content.footerNote, barcodes: [], labels: [], marks: [] };
  if (cond.occlusions) applyOcclusions(d);
  planMarks(d);
  planAttachments(d);
  d.cap.parsing = parsingGroups(d);
  d.scanned = d.dims.noise === 'heavy' || cond.occlusions || cond.upsideDown;
}
