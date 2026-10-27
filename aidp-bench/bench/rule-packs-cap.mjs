/**
 * The written instructions of AIDP-CAP's Instructions measure: seven plain instructions of the kind customers write.
 *
 * Each instruction names its targets from the answer key (the fields it applies to), and what each target must then
 * hold is computed from the system's own answer to the same document with no instruction: the instruction is judged
 * on whether it transformed what the system read, not on whether the system read it, which the rest of the standard
 * counts. A target passes only as the exact text instructed (surrounding spaces aside): a format instruction is a
 * promise about characters. Each instruction also has a scope, the fields it may legitimately change (every date, for
 * "every date"), which containment leaves out.
 */

const filled = (v) => typeof v === 'string' && v.trim() !== '';
const isKeyDate = (v) => typeof v === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(v.trim());
const outside = (p) => !p.startsWith('Barcodes');

/** Every leaf path of an object, with its value. */
export function leaves(obj, pre = '', out = []) {
  if (obj == null || typeof obj !== 'object') { out.push([pre, obj]); return out; }
  if (Array.isArray(obj)) { obj.forEach((v, i) => leaves(v, `${pre}.${i}`, out)); return out; }
  for (const k of Object.keys(obj)) leaves(obj[k], pre ? `${pre}.${k}` : k, out);
  return out;
}
const DOC_NUMBER = /^(Invoice Number|PO Number|Consignment Number)$/;
const docNumberPath = (gt) => leaves(gt).find(([p, v]) => filled(v) && outside(p) && DOC_NUMBER.test(p.split('.').pop()) && /Details$/.test(p.split('.')[0]))?.[0] ?? null;
/** A date as the system writes it by default (day first) or in any common form, as year, month, day; null if none. */
export function parseDate(v) {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) return [Number(m[3]), Number(m[2]), Number(m[1])];
  m = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}
const iso = ([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const ACCOUNT = /(account_no|Account Number)$/;

export const CAP_RULE_PACKS = [
  {
    id: 'iso-dates', instruction: 'Write every date in the format YYYY-MM-DD.',
    targets: (gt) => leaves(gt).filter(([p, v]) => isKeyDate(v) && outside(p)).map(([p]) => p),
    min: 2,
    expect: (v) => { const d = parseDate(v); return d ? iso(d) : null; },
    scope: (p, v) => !!parseDate(v),
  },
  {
    id: 'upper-seller-name', instruction: "Write the Seller's name in capital letters.",
    targets: (gt) => (filled(gt?.Seller?.Name) && gt.Seller.Name !== gt.Seller.Name.toUpperCase() ? ['Seller.Name'] : []),
    expect: (v) => String(v).toUpperCase(),
    scope: (p) => p === 'Seller.Name',
  },
  {
    id: 'prefix-document-number', instruction: 'Put the prefix REF- in front of the document number.',
    targets: (gt) => { const p = docNumberPath(gt); return p ? [p] : []; },
    expect: (v) => `REF-${String(v).trim()}`,
    scope: (p) => DOC_NUMBER.test(p.split('.').pop()) && /Details$/.test(p.split('.')[0]),
  },
  {
    id: 'account-no-spaces', instruction: 'Write bank account numbers without spaces.',
    targets: (gt) => leaves(gt).filter(([p, v]) => ACCOUNT.test(p) && filled(v) && /\s/.test(v)).map(([p]) => p),
    expect: (v) => String(v).replace(/\s+/g, ''),
    scope: (p) => ACCOUNT.test(p),
  },
  {
    id: 'article-ids-no-hyphens', instruction: 'Write article IDs without hyphens.',
    targets: (gt) => leaves(gt).filter(([p, v]) => /^Items\.\d+\.Article ID$/.test(p) && filled(v) && v.includes('-')).map(([p]) => p),
    expect: (v) => String(v).replace(/-/g, ''),
    scope: (p) => /^Items\.\d+\.Article ID$/.test(p),
  },
  {
    id: 'country-codes', instruction: 'Write country names as two-letter ISO country codes.',
    targets: (gt) => Object.entries(gt ?? {}).filter(([, o]) => o && typeof o === 'object' && !Array.isArray(o) && filled(o.Country) && filled(o['Country Code'])).map(([sec]) => `${sec}.Country`),
    // the code is the country's, which the key knows: the instruction is judged on writing it, the reading is not
    expect: (v, gt, p) => gt[p.split('.')[0]]?.['Country Code'] ?? null,
    scope: (p) => /\.Country$/.test(p),
  },
  {
    id: 'quantities-two-decimals', instruction: 'Write quantities with exactly two decimal places.',
    targets: (gt) => leaves(gt).filter(([p, v]) => /^Items\.\d+\.Quantity$/.test(p) && filled(v) && Number.isFinite(Number(v))).map(([p]) => p),
    expect: (v) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n.toFixed(2) : null; },
    scope: (p) => /^Items\.\d+\.Quantity$/.test(p),
  },
];
/** The instructions that apply to a document: those with at least one target in its answer key (two for dates). */
export const applicablePacks = (gtj) => CAP_RULE_PACKS.filter((p) => p.targets(gtj.gt ?? {}).length >= (p.min ?? 1));

/** A target holds when the delivered value is exactly the expected text, surrounding spaces aside. */
export const adheres = (want, got) => String(got ?? '').trim() === String(want ?? '').trim();
