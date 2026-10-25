/**
 * Error budgets.
 *
 * The specification requires that E, the tolerance under which a captured value counts as correct,
 * is declared before a run and never changed afterwards. It does not require a single E, and a
 * single E turns out to be a bad idea, for a reason that is itself an argument of the paper.
 *
 * Under the strictest possible budget, every populated value in the answer key must be exactly
 * right. On a 200-line invoice carrying 900 values, essentially no system passes, and a
 * straight-through rate near zero conveys nothing a buyer can act on. Under the loosest, only the
 * grand total must match, and almost everything passes. Both are defensible. Neither is informative
 * alone.
 *
 * AIDP-Bench therefore declares three budgets and publishes all three. The spread between them is
 * more informative than any one of them, and it demonstrates the paper's central claim directly: an
 * accuracy figure quoted without its budget is not a measurement, because the budget moves the
 * number further than the system does.
 */

const isEmpty = (v) => v == null || (typeof v === 'string' && v.trim() === '');

/** Leaf field names that carry the commercial substance of a transaction document. */
const HEADER_CRITICAL_PUBLISHED = /^(Invoice Number|Credit Note Number|Order Number|PO Number|Purchase Order Number|Document Number|Quote Number|Receipt Number|Invoice Date|Order Date|Due Date|Document Date|Issue Date|Currency Code|Net Amount|Tax Amount|Gross Amount|Total Amount|Total|Subtotal)$/;
// The pre-run amendments add Total Tax (the tax total of every type whose header carries it), PO Date
// (the purchase order's own date), and Consignment Number and Consignment Date (the consignment order's
// and consignment invoice's own number and date). rules.criticalBudgetAmended switches them, so
// their effect can be measured on stored evidence.
const HEADER_CRITICAL = /^(Invoice Number|Credit Note Number|Order Number|PO Number|Purchase Order Number|Consignment Number|Document Number|Quote Number|Receipt Number|Invoice Date|Order Date|PO Date|Consignment Date|Due Date|Document Date|Issue Date|Currency Code|Net Amount|Tax Amount|Total Tax|Gross Amount|Total Amount|Total|Subtotal)$/;
const LINE_CRITICAL = /^(Quantity|Unit Price|Net Amount|Article ID)$/;
const MONEY_LEAF = /^(Net Amount|Tax Amount|Gross Amount|Total Amount|Total|Subtotal|Unit Price|Quantity|Amount|Line Amount|Discount Amount)$/;

const leafOf = (path) => String(path).split('.').pop();
const isLineItemPath = (path) => /^[^.]+\.\d+\./.test(path);

/**
 * Which paths does a budget care about? Returns a predicate over a verdict path.
 * `null` means every path counts.
 */
export const BUDGETS = {
  /**
   * strict: every populated answer-key value must be right, nothing may be invented, the row count
   * must be exact and the document type must be correct. This is the budget a regression gate wants
   * and it is far stricter than any operational definition of a usable document.
   */
  strict: {
    id: 'strict',
    label: 'Every populated value exact',
    counts: () => true,
    requireRowCount: true,
    requireClassification: true,
  },
  /**
   * critical: the fields a finance system needs in order to post the document. Party names,
   * document identifiers, dates, currency, the document totals, and every line's quantity, unit
   * price, net amount and article identifier. A wrong description or a missing postal code does not
   * stop a payment; a wrong line quantity does.
   */
  critical: {
    id: 'critical',
    label: 'Business-critical fields exact',
    counts: (path, amended = true) => {
      if (/^(Buyer|Seller|Supplier|Customer|Vendor)\.Name$/.test(path)) return true;
      const leaf = leafOf(path);
      if (isLineItemPath(path)) return LINE_CRITICAL.test(leaf);
      return (amended ? HEADER_CRITICAL : HEADER_CRITICAL_PUBLISHED).test(leaf);
    },
    requireRowCount: true,
    requireClassification: true,
  },
  /**
   * money: every monetary and quantity value must be right, everywhere in the document. This is the
   * narrowest defensible budget and it is the one closest to what most published accuracy claims
   * are implicitly measuring when they demonstrate a system reading an invoice.
   */
  money: {
    id: 'money',
    label: 'All monetary and quantity values exact',
    counts: (path) => MONEY_LEAF.test(leafOf(path)),
    requireRowCount: false,
    requireClassification: true,
  },
};

/**
 * Count the errors a document contains under one budget.
 * An error is a verdict of wrong, missing or spurious on a path the budget counts, plus optionally
 * an inexact row count and an incorrect document type.
 */
export function countErrors({ verdicts, structure, budget, amended = true }) {
  const B = BUDGETS[budget] ?? BUDGETS.strict;
  const detail = { wrong: 0, missing: 0, spurious: 0, row_count: 0, misclassified: 0 };
  for (const v of verdicts ?? []) {
    if (v.verdict !== 'wrong' && v.verdict !== 'missing' && v.verdict !== 'spurious') continue;
    if (!B.counts(v.path, amended)) continue;
    detail[v.verdict]++;
  }
  if (B.requireRowCount && structure && structure.gt_rows > 0 && !structure.count_exact) detail.row_count = 1;
  if (B.requireClassification && structure && structure.category_ok === false) detail.misclassified = 1;
  const count = Object.values(detail).reduce((a, b) => a + b, 0);
  return { count, detail };
}

/** How many answer-key values does a budget actually look at? Published so the budget is auditable. */
export function budgetCoverage(verdicts, budget, amended = true) {
  const B = BUDGETS[budget] ?? BUDGETS.strict;
  const counted = (verdicts ?? []).filter((v) => B.counts(v.path, amended));
  return { counted: counted.length, total: (verdicts ?? []).length };
}
