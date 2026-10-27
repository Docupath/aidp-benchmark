/**
 * AIDP-CAP, the capability set: its composition, fixed before its seed existed.
 *
 * AIDP-2K measures thirteen of the capabilities in the AIDP register. AIDP-CAP measures the other eleven that enter
 * the AIDP Score, and the full forms of Decoding, Contract and Traceability, on documents drawn by the same builders
 * as AIDP-2K: the six field-key types, the same twelve locales, the same four noise levels. Each capability has its
 * condition, present in a minority of documents so the rest are its controls, exactly as AIDP-2K's hard cases are.
 *
 * Every probability below is a share of documents, drawn independently per document from the document's own seeded
 * random stream (cap/build.mjs), so a document can carry several conditions at once, as a real one can. The
 * generator never lets one condition destroy the evidence another needs: an occlusion never hides a value a
 * derivation, a contradiction, a label or a supplier check reads, and no mark is drawn over a printed value.
 */
export const CAP_TYPES = ['invoice', 'purchase-order', 'credit-note', 'freight-invoice', 'consignment-order', 'consignment-invoice'];
export const CAP_PER_TYPE = 160;
export const CAP_SEED_PREFIX = 'aidp-cap-v1:';

/** Line items per document: no 500-line documents, which AIDP-2K covers; the capabilities here do not need them. */
export const SCALE = { small: 0.55, medium: 0.35, large: 0.10 };

/** Noise levels, as AIDP-2K draws them: the heavy level is a scan with no text layer. */
export const NOISE = { none: 0.25, light: 0.35, medium: 0.25, heavy: 0.15 };

export const CONDITIONS = {
  // Read
  attachments: 0.15,       // 1 to 3 further files arrive with the document: a delivery note, a packing list, a scanned letter
  upsideDown: 0.05,        // the document arrives as a scan with one page fed upside down
  marks: 0.30,             // 1 to 3 marks: a handwritten note, a rubber stamp, a signature, a tick beside a line
  occlusions: 0.20,        // 1 or 2 values made unreadable (an ink blot or a paper label stuck over them), and 1 readable control
  // Understand
  derivations: 0.20,       // invoices, credit notes, purchase orders, consignment documents: 1 or 2 values left unprinted that
                           // the page implies (a line amount, the grand total, the tax total, the due date)
  contradictions: 0.25,    // the same types: one printed contradiction, of one of four kinds: a line amount that is not its
                           // quantity times its price, a subtotal that is not the sum of the lines, a total that is not the
                           // subtotal plus tax, a tax amount that is not the printed rate times the subtotal
  bankLine: 0.5,           // documents with a payment block print the IBAN and BIC on one line instead of two rows
  // Reason
  unlistedSupplier: 0.10,  // the seller is not on the customer's supplier list: the right answer is "no match"
  vatPrinted: 0.85,        // the seller's VAT or registration number is printed
};

/** How the seller's name is printed (cap/suppliers.mjs, printedName). */
export const NAME_KINDS = { legal: 0.40, 'no-form': 0.20, upper: 0.10, short: 0.15, punct: 0.15 };

/** Mark kinds and where they go. */
export const MARK_KINDS = { note: 0.45, stamp: 0.30, signature: 0.15, tick: 0.10 };

/** Consignment documents: rows that carry a label, and the share of those whose lot and serial are printed only on the label. */
export const LABELS = { rowsMin: 1, rowsMax: 4, labelOnly: 0.5, dataMatrix: 0.3 };

/** Segmentation: files that hold several documents, and single-document files of three pages or more as controls. */
export const BUNDLES = { files: 150, docsMin: 2, docsMax: 4, scanned: 0.3, controls: 50 };

/** Anomaly detection: the cases submitted after the documents they refer to, and as many clean controls. */
export const ANOMALIES = { duplicate: 30, approvedBankMismatch: 20, historyBankChange: 15, historyAmountJump: 10, poVariance: 25 };

/** Instructions: documents per type in the text-lane sample, drawn by the registered rule (bench/make-cap.mjs). */
export const INSTRUCTIONS_PER_TYPE = 10;
