/**
 * The customer's setup for AIDP-CAP: the account every AIDP-CAP document passes through, configured as a customer
 * configures one, through the platform's own customer configuration. Fixed before the seed existed.
 *
 *   reference data   two supporting files: the supplier list (code, name, VAT number, address, approved bank
 *                    account) and the bank master (the approved account of every supplier that has one, an IBAN or
 *                    a domestic account number, written without spaces as a ledger keeps it). Both are drawn with
 *                    the corpus (corpus-gen/cap/).
 *   lookup rules     the document's supplier is looked up in the list by its VAT number, or its registration
 *                    number where the locale prints one in its place, or else by its name exactly as listed, or
 *                    else by its street (every listed supplier has an address of its own), and the list's code is
 *                    written to the field "Supplier Code". The platform compares a code by its
 *                    characters (case, spaces and thousands separators aside) and a name as it reads, ignoring case.
 *   bank check       a document whose supplier has an approved account on the bank master, paid to any other
 *                    account, raises the flag BANK_ACCOUNT_CHANGED.
 *   matching         the platform's purchase-order matching, switched on for the account (run-cap.mjs).
 *   output contract  the published output contract of each type, with the customer's own field "Supplier Code"
 *                    allowed beside it (Resolution counts whether it is filled right), and the customer's formats:
 *                    every date as YYYY-MM-DD, bank account numbers without spaces, and numbers as plain numbers.
 *                    The formats are given as the written instructions below.
 *
 * Everything here is data the platform's customer configuration already takes. Nothing in it is a setting of the
 * service: the service runs with the production configuration flags, as the reference run did.
 */
export const CUSTOMER_FLAGS = [{ id: 1, name: 'BANK_ACCOUNT_CHANGED' }];

const setCode = [{ field: 'Supplier Code', op: 'set', from_column: 'Supplier Code' }];
const notByNumber = [
  { field: 'Seller.VAT No', op: 'ne', column: 'VAT Number' },
  { field: 'Seller.Registration No', op: 'ne', column: 'VAT Number' },
];
const notByName = { field: 'Seller.Name', op: 'ne', column: 'Supplier Name' };
export const CUSTOMER_RULES = [
  { id: 'supplier-by-vat', scope: 'organization', catalogue: 'suppliers', match_join: 'all', conditions: [{ field: 'Seller.VAT No', op: 'eq', column: 'VAT Number' }], actions: setCode },
  { id: 'supplier-by-registration', scope: 'organization', catalogue: 'suppliers', match_join: 'all', conditions: [{ field: 'Seller.Registration No', op: 'eq', column: 'VAT Number' }], actions: setCode },
  { id: 'supplier-by-name', scope: 'organization', catalogue: 'suppliers', match_join: 'all', conditions: [{ field: 'Seller.Name', op: 'eq', column: 'Supplier Name' }, ...notByNumber], actions: setCode },
  // every listed supplier has an address of its own, so its street finds it where neither number nor name does
  { id: 'supplier-by-street', scope: 'organization', catalogue: 'suppliers', match_join: 'all', conditions: [{ field: 'Seller.Address', op: 'eq', column: 'Street' }, ...notByNumber, notByName], actions: setCode },
  { id: 'supplier-by-street-1', scope: 'organization', catalogue: 'suppliers', match_join: 'all', conditions: [{ field: 'Seller.Street 1', op: 'eq', column: 'Street' }, ...notByNumber, notByName], actions: setCode },
  { id: 'bank-by-vat', scope: 'organization', catalogue: 'bank_master', match_join: 'all',
    conditions: [{ field: 'Seller.VAT No', op: 'eq', column: 'VAT Number' }, { field: 'Payment Details.Payment Methods.0.account_no', op: 'ne', value: 'ONE OF {Approved Account}' }],
    actions: [], flags: [{ id: 1, name: 'BANK_ACCOUNT_CHANGED' }] },
  { id: 'bank-by-registration', scope: 'organization', catalogue: 'bank_master', match_join: 'all',
    conditions: [{ field: 'Seller.Registration No', op: 'eq', column: 'VAT Number' }, { field: 'Payment Details.Payment Methods.0.account_no', op: 'ne', value: 'ONE OF {Approved Account}' }],
    actions: [], flags: [{ id: 1, name: 'BANK_ACCOUNT_CHANGED' }] },
];

export const CONTRACT_INSTRUCTIONS = 'Write every date in the format YYYY-MM-DD.\nWrite bank account numbers without spaces.';
export const CUSTOMER_CONTRACT = {
  added_fields: ['Supplier Code'],
  date: { pattern: '^\\d{4}-\\d{2}-\\d{2}$', label: 'YYYY-MM-DD' },
  account: { pattern: '^[A-Z0-9]+$', label: 'no spaces' },
  numbers: 'plain: digits, an optional minus sign and an optional decimal point',
};
