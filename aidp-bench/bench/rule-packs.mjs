/**
 * Layer 4 rule packs.
 *
 * Each pack is one plain-English instruction of the kind a real customer writes, chosen so that its
 * correct outcome can be computed mechanically from the answer key. That is the whole trick: an
 * instruction like "use our internal supplier codes" cannot be scored without the customer's code
 * list, but "write every date as YYYY-MM-DD" has exactly one correct answer for every date in the
 * document, and it is derivable from the ground truth.
 *
 * Every pack declares the fields it is allowed to change. Any other field that moves against the
 * no-instruction baseline is collateral damage, and collateral damage is scored as harshly as
 * failure to comply. A rule that fixes one field and quietly rewrites its neighbour has not helped.
 */

const isDate = (v) => typeof v === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(v.trim());

/** Every leaf path in an object, with its value. */
export function leaves(obj, pre = '', out = []) {
  if (obj == null || typeof obj !== 'object') { out.push([pre, obj]); return out; }
  if (Array.isArray(obj)) { obj.forEach((v, i) => leaves(v, `${pre}.${i}`, out)); return out; }
  for (const k of Object.keys(obj)) leaves(obj[k], pre ? `${pre}.${k}` : k, out);
  return out;
}

const datePaths = (gt) => leaves(gt).filter(([p, v]) => isDate(v) && !p.startsWith('Barcodes')).map(([p, v]) => [p, v]);

/** DD/MM/YYYY -> YYYY-MM-DD */
const toIso = (v) => { const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : v; };

/** First path whose last segment matches, searching the answer key. */
function findPath(gt, test) {
  for (const [p, v] of leaves(gt)) {
    if (p.startsWith('Barcodes')) continue;
    if (typeof v !== 'string' || !v.trim()) continue;
    if (test(p.split('.').pop(), p)) return [p, v];
  }
  return null;
}

/**
 * The document's own number: a header field named like "Invoice Number" or, on a purchase order, "PO Number".
 * A field inside a list of rows is never the document's number: on a purchase order the instruction aims at the PO
 * number, not the first line's "Order Number" (the line position, "1").
 */
const DOC_NUMBER = /^(Invoice|Order|Document|Credit Note|Quote|Receipt|PO|Purchase Order)?\s*Number$/i;
const docNumberPath = (gt) => findPath(gt, (seg, path) => DOC_NUMBER.test(seg) && !path.split('.').some((x) => /^\d+$/.test(x)));

export const RULE_PACKS = [
  {
    id: 'iso-dates',
    instruction: 'Write every date in the format YYYY-MM-DD.',
    what: 'A format rule that touches many fields at once. Tests whether an instruction can be applied consistently across a document rather than to the first field that matches.',
    applies: (gtj) => datePaths(gtj.gt ?? {}).length >= 2,
    expect: (gtj) => Object.fromEntries(datePaths(gtj.gt ?? {}).map(([p, v]) => [p, toIso(v)])),
  },
  {
    id: 'upper-seller-name',
    instruction: "Write the Seller's name in capital letters.",
    what: 'A single-field rule with an obvious neighbour that must not move. The same organisation name often appears in a Remit To or payment block; changing it there is collateral damage.',
    applies: (gtj) => !!(gtj.gt?.Seller?.Name || '').trim(),
    expect: (gtj) => ({ 'Seller.Name': String(gtj.gt.Seller.Name).toUpperCase() }),
  },
  {
    id: 'prefix-document-number',
    instruction: 'Put the prefix REF- in front of the document number.',
    what: 'A rewrite rule on an identifier. Identifiers are the fields most likely to be normalised or verbatim-protected by the engine, so this tests whether the customer really is the highest authority.',
    applies: (gtj) => !!docNumberPath(gtj.gt ?? {}),
    expect: (gtj) => {
      const hit = docNumberPath(gtj.gt ?? {});
      return hit ? { [hit[0]]: 'REF-' + hit[1] } : {};
    },
  },
];

export function buildExpectation(pack, gtj) {
  let expect = {};
  try { expect = pack.expect(gtj) ?? {}; } catch { expect = {}; }
  return { id: pack.id, expect, may_also_change: pack.may_also_change ?? [] };
}
