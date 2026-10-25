/**
 * The standard composition of AIDP-2K.
 *
 * Ten document types, every one of them a shape any accounts payable, procurement or legal team
 * would recognise on sight, so a reader can look at the list and know exactly what was tested. Two
 * hundred documents of each gives the corpus its name.
 *
 * The order below is narrative rather than alphabetical: the transactional core first, then the
 * logistics and consignment shapes that carry the hard sticker cases, then the two non-transactional
 * shapes that keep the standard honest about being document agnostic.
 */
export const TYPES = [
  'invoice',
  'purchase-order',
  'credit-note',
  'receipt',
  'quote',
  'freight-invoice',
  'consignment-order',
  'consignment-invoice',
  'bank-statement',
  'general-contract',
];
export const PER_TYPE = 200;
export const SEED = 'docupath-corpus-v1';
