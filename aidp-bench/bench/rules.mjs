/**
 * The scoring rules of AIDP v1.0, fixed before the run.
 *
 * Every rule below is part of the standard and is on. Each one is a named switch, rather than code that
 * simply replaced what was there before, for one reason only: so that each can be turned on one at a time
 * over stored evidence, to show what it moves. Nothing else may turn a rule off,
 * and a board scored with any rule off is not an AIDP score.
 *
 *   exactNumbers            A numeric field passes only when the number it carries equals the answer
 *                           key's number exactly: same sign, same magnitude, after locale-aware parsing.
 *                           The digits-only comparison passes identifiers and codes only (see
 *                           base-score.mjs, isIdentifierField), never a quantity, a rate or an amount.
 *   keepMisclassified       A document assigned the wrong type is still scored on every measure. Its
 *                           output is compared with its own answer key and fails wherever it differs.
 *   failedLanesFail         A document whose request failed, or whose lane is missing, stays in every
 *                           denominator and scores as a total failure in every measure of that lane.
 *   normalisationByMeaning  Normalisation scores understanding: a date or number passes when it means
 *                           the same calendar date or the same number as the key, whatever its
 *                           punctuation. A swapped day and month, or a wrong number, fails.
 *   contractPooled          Contract is one measure, pooled over checks: the schema checks and the
 *                           format checks (dates as DD/MM/YYYY, numbers as plain numbers). A
 *                           punctuation-only date difference fails here and only here. A document with
 *                           no checks does not count.
 *   routedEscalation        The safety panel counts a document as caught when the platform routed it
 *                           to a person, not when any flag was raised anywhere.
 *
 * Added by the pre-run amendment, before the reference run:
 *
 *   conventionOnce          An error caused only by a convention is Normalisation's, and does not also
 *                           fail Fidelity: a date whose day, month and year are the key's in another
 *                           order, or a number whose significant digits and sign are the key's but whose
 *                           value is not (a decimal or thousands separator taken for the other). Such a
 *                           value leaves Fidelity's count; every other wrong value stays. A flipped sign
 *                           is not a convention error: it fails Fidelity and is not Normalisation's.
 *   restraintCountsDerived  A value returned for a field the answer key leaves empty is an invention
 *                           whether or not the system labels it as derived ("labelled or not, counted
 *                           once"). Only a value the key holds is not an invention.
 *   contractFromSchema      Contract is checked against the published output contract of the
 *                           document type (contract.json beside the answer keys), not against the
 *                           structure of the answer key: a section the contract defines under its own
 *                           name, or that the key does not carry, is not a break.
 *   criticalBudgetAmended   The critical error budget includes Total Tax, PO Date, Consignment Number and
 *                           Consignment Date (budgets.mjs).
 *
 * Three further rules, fixed on 22 October 2026, before the reference run:
 *
 *   numbersEndAtGap         Printed text, numbers compares numbers, and a number is digit groups joined
 *                           by ONE separator each, so a thousands separator stays inside it while the
 *                           gap between two table columns ends it. A pattern that let any run of
 *                           separators join digits would glue neighbouring cells of a table laid out in
 *                           space-aligned columns into one token that matches nothing (score-das.mjs,
 *                           tokens), making the measure depend on layout, which its definition forbids.
 *
 *   qrPayloadLines          Barcode recall reads a QR payload whole. A payment QR code carries one field per
 *                           line; the canonical text writes them under its "QR Code:" marker and a reading
 *                           may write them on one line with escaped line breaks. Reading only the marker's
 *                           own line would compare every payment QR code by its first field ("BCD"), so it
 *                           could never match (score-das.mjs, barcodePayloads). Barcode recall is reported
 *                           beside the score.
 *
 *   docNumberHeader         The REF- instruction targets the document's own number, never a field inside the
 *                           line items: on a purchase order the PO number, not the first line's "Order
 *                           Number" (rule-packs.mjs, docNumberPath). The target is rebuilt from the answer key
 *                           at scoring time. No score-bearing measure depends on it.
 */
export const RULES = Object.freeze({
  exactNumbers: true,
  keepMisclassified: true,
  failedLanesFail: true,
  normalisationByMeaning: true,
  contractPooled: true,
  routedEscalation: true,
  conventionOnce: true,
  restraintCountsDerived: true,
  contractFromSchema: true,
  criticalBudgetAmended: true,
  numbersEndAtGap: true,
  qrPayloadLines: true,
  docNumberHeader: true,
});

/** The rule set with some switches overridden. Used by the unit checks only. */
export const withRules = (over = {}) => Object.freeze({ ...RULES, ...over });

/** The six field-key document types. Every score-bearing measure except Read is computed over these. */
export const FIELD_KEY_TYPES = Object.freeze([
  'invoice', 'purchase-order', 'credit-note', 'freight-invoice', 'consignment-order', 'consignment-invoice',
]);

/** The four fact-key document types: scored by fact recall beside the score, and inside Read. */
export const FACT_KEY_TYPES = Object.freeze(['receipt', 'quote', 'bank-statement', 'general-contract']);
