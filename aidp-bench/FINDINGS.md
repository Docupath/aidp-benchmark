# Findings

What AIDP-Bench 1.0 found, in the platform measured and in the benchmark itself. Publishing each finding with its
evidence is what lets every result be checked, argued with and improved on.

The findings below were recorded on the reference run of 23 and 24 October 2026 (IST):
`results/aidp-v1-main` (all 2,000 documents, both lanes), `results/aidp-v1-stability` (200 documents, three runs each)
and `results/aidp-v1-rules` (60 documents, three written instructions), with the held-out check in
`results/aidp-v1-heldout-main` and `results/aidp-v1-heldout-stability`. They use the layers and capabilities of
[`../spec/aidp-v1.0.md`](../spec/aidp-v1.0.md). Every count can be recomputed from the raw evidence with the scripts in
`bench/`.

---

## A. Findings about the platform

### A1. Values under barcode stickers on consignment documents

**Capability: Fidelity and Line items (Capture).**

Consignment documents are the hardest type in the dataset: their tables carry lot and serial columns, and barcode
stickers are placed over parts of the printed page. They have the lowest measures of the run: Fidelity, values correct
and in the right field, is 90.56 per cent on consignment orders and 93.22 per cent on consignment invoices, against
99.5 per cent or more on purchase orders, invoices, credit notes and freight invoices; line-item recall is 96.15 and
95.94 per cent. On the held-out documents, 30 of each type, Fidelity is 87.80 and 84.10 per cent.

Where a sticker covers part of a printed value, the platform's reading marks the covered part as not seen and the value
is returned as far as it was seen. On `consignment-order-006` the reading shows `MTR-2142 [obscured]`, and the first
row's article code is returned as `MTR-2142` where the key holds `MTR-21429`. The platform flagged that value as
uncertain (confidence 0.65, with `MTR-21429` as the other reading). Part of the measured loss on these types is the
scorer's own (B8).

### A2. A currency on every freight charge line

**Capability: Restraint (Capture).**

On freight invoices the platform returned a currency on 800 charge lines whose printed line carries none (the page
prints the currency once, for the whole document), a shipment total on 200 shipments, which the answer key leaves
empty, and a registration number for the seller on 15 documents. Under the restraint rule a value the key does not hold
counts as an invention, so Restraint on freight invoices is 92.85 per cent, against more than 99 per cent on every
other type. The values themselves are right: every one of the 800 currencies is the document's own, and every one of
the 200 shipment totals equals the sum of that shipment's charges (`bench/paper-checks.mjs`, check 5). Whether a
per-line copy is wanted is a question for the contract, and the rule records it either way.

### A3. Telling consignment documents from orders and invoices

**Capability: Identification (Capture).**

1,998 of the 2,000 documents were identified as their own type. The two exceptions are consignment documents:
`consignment-invoice-164` was identified as an invoice and `consignment-order-179` as a purchase order. A misidentified
document stays in every denominator and is scored against its own answer key, so the error carries into every measure
of that document.

### A4. Reading barcode contents

**Capability: Barcodes (beside the score).**

Of the 829 barcodes whose bars are printed whole on the page, the platform read 820 to their exact contents: 84 of the
86 barcodes on purchase orders, 129 of the 130 payment QR codes and 607 of the 613 stickers on consignment documents.
It also read 2 of the 121 stickers printed partly off the page (B12). Barcode symbol recall, the share of all 950
printed symbols read exactly, is 86.53 per cent (822 of 950).

### A5. Separating right values from wrong ones by confidence

**Capability: Calibration (beside the score).**

On 32,863 header values with a confidence, the expected calibration error is 0.032, so stated confidence matches
correctness on average, and discrimination (AUROC, the chance a right value is ranked above a wrong one) is 0.753. The
platform's top confidence tier holds 98.06 per cent of the values and contributes 0.026 of the 0.032. A further 1,368
returned header values carried no confidence and are counted, not scored. Whether confidence identifies the documents
that need a person is a question for a test at several confidence thresholds, which the next edition makes.

### A6. Written instructions

**Capability: Instructions (beside the score).**

All 60 documents in the date test had their dates written as YYYY-MM-DD, and all 60 in the capitals test had the seller
name written in capitals. Putting `REF-` before the document number was done on 38 of 40 documents (95.00 per cent).
Containment, other values left unchanged, is at least 99.8 per cent for each instruction (B9).

---

## B. Limits of this edition

### B1. Bank account numbers are generated at random

The generator prints a bank account number (an IBAN) on 1,400 of the 2,000 documents: every bank statement,
consignment invoice, consignment order, credit note, invoice, purchase order and quote. Its check digits are drawn at
random, so 1,389 of the 1,400 fail the check that shows whether a number is valid. No value in the score depends on
it: the key holds the printed number. The generator's `--valid-accounts` setting, off by default so the published seed
reproduces AIDP-2K exactly, prints numbers with valid check digits instead (`corpus-gen/data.mjs`, `GEN_OPTIONS`).

### B2. Values returned where the key is empty

On invoices and credit notes the answer key leaves the payment section's `Tax Amount` empty, because the same figure is
the document's `Total Tax`, which the key holds. The platform returns the tax total in that field too, on 371
documents, and on 359 of them it equals the key's own tax total. On the 33 documents printed without totals (22
invoices and 11 credit notes) the keys hold no net or total amount, and the platform returns the 66 amounts it
calculates, each net amount equal to the sum of the printed line amounts. Restraint counts all of these values as
returned where the key is empty. The critical error budget (`bench/budgets.mjs`) counts them too, which matters only
to a safety panel, and this edition reports none; the next edition's budget will not count a correct value in a
field the key leaves empty, whether repeated from another field or calculated, as a critical error.
`bench/paper-checks.mjs` prints these counts.

### B3. Due dates and payment terms

The generator draws each due date separately from the payment terms, so 659 of the 1,000 documents that print both
payment terms and a due date show a due date that does not match the terms. The key holds the printed due date, which
is what a system should return, so no scored value depends on it; a system that checks the date against the terms will
rightly notice the disagreement. The generator's `--due-dates-from-terms` setting, off by default, sets each due date
30 days after the document date instead, which matches the terms.

Freight invoices print no payment terms, but their answer keys hold the standard 30-day terms, so a system that rightly
returns nothing there is charged one missing value on every freight invoice: 200 on AIDP-2K, which are all 200 of the
full lane's missing values on freight invoices, and 30 on the held-out documents. The platform returned nothing there.
Without those terms in the keys, the AIDP Score would be 99.17 rather than 99.15, Completeness 99.01 per cent rather
than 98.76, and the held-out score 99.01 rather than 99.00. This edition publishes the scores as measured; the next
edition's generator keys only the terms a page prints.

### B4. Numbers in tables laid out with spaces

Printed text, numbers compares the numbers in a document's correct text with the numbers in the text the system read. A
reader that lays tables out in space-aligned columns puts a run of spaces between neighbouring cells, so the rule lets
only one separator sit between two digit groups: `SN66192301  12` is two numbers, not `6619230112`. The check behind
the rule needs only the corpus (`bench/layout-check.mjs`): each document's own correct text, with nothing changed but
its tables laid out as space-aligned columns, scores 100 per cent under the rule and 74.94 per cent under a pattern that
lets any run of separators join digits.

### B5. Payment QR codes are read whole

A payment QR code carries one field per line; the correct text writes them under its `QR Code:` marker, and a reading
may write them on one line with escaped line breaks. Barcode recall compares the whole payload (`rules.mjs`,
`qrPayloadLines`), not the marker's first line, which would compare every payment code by its first field alone.

### B6. The REF- instruction aims at the document's own number

The instruction pack rebuilds the document's own number from the answer key at scoring time (`rules.mjs`,
`docNumberHeader`), so on a purchase order it targets the PO number, not the first line's order number, and a change to
the real number is never counted as collateral.

### B7. Computation rests on a small checkable sample

A value filled by calculation can only be judged where the answer key holds that value. Where the key is empty, a
correct derivation cannot be told from an overreach: the 66 amounts calculated on documents printed without totals are
not checked, and Restraint counts them (B2). **For the next edition:** the generator
should mark, per field, whether an absent value is derivable.

### B8. Row matching: the field measures fall back to position

Two matchers pair returned rows with the answer key's rows. The line-item measures (`scoreStructure` in
`bench/score-das.mjs`) match on an identity key and then on a numeric fingerprint, the row's amounts and quantities; a
row neither can place counts as missed. The field measures (`alignItems` in `bench/base-score.mjs`) match on the
identity key and otherwise by position. When a row's identity is missing or read differently, the field measures
therefore compare it with whichever row sits at its position, so later rows can look wrong. This can understate the
field measures on documents with dropped or merged rows, most of all on consignment documents (A1). The fingerprint can
also pair a returned row with a different expected row that has the same amounts and quantities, which can flatter row
recall slightly. A sensitivity test with order-preserving matching is planned.

### B9. Instruction containment is measured against a drifting baseline

Containment compares an instructed extraction with a separate, uninstructed extraction of the same document, and
separate extractions are not identical: in the repeatability runs, on average 98.92 per cent of a document's values
matched across all three runs, each document type counting equally (98.01 per cent of all 130,432 values taken
together). Every containment figure therefore includes some ordinary run-to-run drift and is an upper bound on
damage. **For the next edition:** run the baseline and the instructed extraction under identical conditions, repeat
both, and subtract the measured drift floor.

### B10. Catch rates on planted defects rest on 91 documents

36 printed totals that contradict their lines, 33 omitted totals and 22 barcode stickers that contradict their printed
line, across 2,000 documents: enough to show that a mechanism fires, too few for a tight estimate. False alarms are
measured against 1,909 clean controls and are on firmer ground.

### B11. A safety panel can cover six of the ten document types

Quotes, receipts, bank statements and general contracts carry fact keys rather than full field keys, so no error count
can be formed for them. A safety panel leaves them out rather than counting them as clean.

### B12. 121 stickers printed partly off the page or covered

The generator places some long GS1-128 stickers past the page's printable margin, where the renderer clips them (120
stickers), and one sticker is covered by the next. By the page's geometry no complete scan line crosses these 121
stickers, so a barcode reader can rarely decode them, and on this corpus sticker recall can pass 613 of 734 (83.5 per
cent) only by decoding one of them; the platform decoded 2 of them.
[`corpus/sticker-visibility.json`](corpus/sticker-visibility.json) lists every printed sticker with its page, its
angle, the share of its scan lines that lie whole on the page and under no later sticker, and its class: upright (a
straight row crosses every bar), rotated (whole, but tilted past the angle at which a straight row can cross every
bar), clipped or covered (no complete scan line exists). A later version of the generator keeps stickers inside the
margin.

### B13. Document boundaries have thin coverage

Twelve attachment files ship with the corpus, and no file holds two documents. Segmentation, splitting several
documents that arrive in one file, is not yet measured and is marked so in the register.

### B14. One published output contract

AIDP-2K's answer keys follow one published output contract (`corpus/contract.json`), with its conventions: where a
document prints no shipping address, the key repeats the buyer's address in the shipping fields (specification,
Annex B). The contract is published with the dataset, so any system can be asked to return its field layout and then
be scored field by field; a system that returns its own layout is scored on fact recall instead, and the two are not
equivalent.

### B15. How the runner submits and waits

Each document is classified and extracted under the same account and document id, as in production, so the extraction
step receives the page evidence the classification stored. Node's built-in fetch abandons a request after five minutes
without response headers, while the platform answers "still processing" after 4 minutes 45 seconds plus any work done
before the wait; the runner raises the client's wait above its own 20-minute timeout, and a request answered "still
processing" is collected again after the wait the platform names, without counting as a failure.

The reference run was paused twice, at 22:21 and 23:24 IST on 23 October, and resumed. After each pause only the
document runs without a stored answer were sent again, and no answer already received was replaced; 875 of the 4,000
document runs were sent a second or third time because an earlier attempt, made before a pause, returned no result.
Most of those attempts were in progress between 14:54 and 18:07 IST on 23 October, when the test machine's own
database stopped accepting connections and the platform returned no answers; the one failed request that recorded the
database's error carries the text "no result returned", like the other failed requests.

### B16. The reference platform processed AIDP-2K's documents while the benchmark was being developed

The reference platform processed AIDP-2K's documents while the benchmark was being developed, before the release
under test was frozen. The held-out check (section C) tests the same release on 300 documents generated after it was
frozen. Within its uncertainty it found no sign that the result depends on having processed particular documents;
because its documents share the generator's templates, it tests new documents rather than new kinds of document.

### B17. Ranges by document type are not yet published

The specification asks for each measure by document type with its 95 per cent range (section 12, item 4). This
edition publishes the ranges of the score, the layers and each measure overall, and the measures by document type
without ranges, apart from the two held-out consignment ranges in `corpus-heldout/README.md`, from
`bench/paper-checks.mjs`. The next edition publishes the ranges by document type.

### B18. Traceability counts only values that carry an evidence entry

Traceability is scored from the platform's own evidence record, in which each confidence entry names the evidence
behind one value; an entry whose source is `none` counts against the measure (specification, Traceability). The scorer
counts the values that carry an entry. 10,648 of the 507,923 values returned on field-key documents outside the
barcode fields (2.1 per cent) carry none: 7,548 in payment and tax tables and 3,100 in freight shipment, charge,
container and location tables, which on freight invoices is 4,900 of 16,006 values (30.6 per cent). They fall outside
the measure's count of 498,311 entries, which also covers 1,036 barcode values. Counted as untraceable, they would
make Traceability 93.90 per cent and bring the AIDP Score to 98.77; the score without the three proxy measures, 98.97,
does not use Traceability. `bench/paper-checks.mjs` prints these figures. **For the next edition:** count a returned
value with no evidence entry as evidence `none`.

---

## C. The held-out check

The same release on 300 newly generated documents scored 99.00 (95% range 98.66 to 99.28), a range that contains its
AIDP-2K score of 99.15. No measure's 95% range lies below its AIDP-2K range; three lie above it, the normalisation of
numbers and of country and currency codes, and Contract, where every or almost every held-out value was correct.
Consignment Fidelity is the lowest held-out measure, as on AIDP-2K (A1): 84.10 per cent on consignment invoices and
87.80 per cent on consignment orders, over 30 documents each.
