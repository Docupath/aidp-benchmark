# AIDP-Field totals

These are the only figures in this repository that were derived from real documents, processed on a commercially
available IDP platform whose name is withheld: the all-account totals of AIDP-Field quoted in section 1 of the paper
"Precision Beyond the Page", counts and shares taken over every account of that platform, all together. No customer
document, no customer name and no value from any document is published, here or anywhere else in this repository.
The same figures are in machine-readable form in [`results/field-snapshot.json`](results/field-snapshot.json).

They come from one snapshot of the platform's records, taken on 28 August 2026 (IST). The documents behind them were
chosen for review by the platform's users, which favours difficult cases, so they are not an accuracy claim for any
platform. What they show is the gap between two ways of counting the same documents.

## The figures, and how each was computed

1. **107,328 extraction runs.** Every extraction the platform had recorded at the snapshot, counted once per run. A
   document processed more than once counts once for each run.
2. **2,530 documents reviewed.** The documents, each counted once, for which the platform held a record of a person's
   review of its delivered values.
3. **1,490 documents with their delivered values stored.** The reviewed documents for which the platform also held
   the values it had delivered for review, taken from the document's latest extraction. Only these can be compared
   value by value, so every figure below is over these 1,490.
4. **117,354 values.** Every non-empty value in those 1,490 deliveries, fields and table cells alike, each counted
   once.
5. **2,114 corrections.** Every delivered value a reviewer changed in those documents.
6. **Field accuracy, 98.20 per cent.** One minus the corrections divided by the values: 1 - 2,114 / 117,354.
7. **995 of the 1,490 documents needed at least one correction.** The documents with at least one correction of any
   kind recorded against them.
8. **495 of the 1,490 (33.2 per cent) needed none.** 1,490 minus 995. This share of documents a person did not have to
   touch is the document-level accuracy.
9. **23.9 per cent predicted if errors were independent.** If every value were wrong on its own, at the observed rate
   of 1.80 per cent, a document of the average size (117,354 / 1,490, about 78.8 values) would need no correction with
   a probability of 0.9820 to the power of 78.8, which is 23.9 per cent. The observed 33.2 per cent is higher. Part of
   the difference is that documents vary in length and short ones are more often fully correct; the rest suggests that
   errors gather in some documents and leave others untouched.
10. **72.8 per cent of the corrections were names and addresses, and 2.0 per cent were money outside the line
    items.** Each corrected value was put into one of six groups by the name of its field, using one fixed set of
    name patterns, applied in this order: line items; names and addresses of the parties to the document; money
    (amounts, prices, totals, tax and currency); dates; identifiers and contact details; everything else. Of the
    2,114 corrections, 72.8 per cent fell in names and addresses and 2.0 per cent in money outside the line items.
11. **Identity information was corrected 10.2 times as often as money outside the line items, relative to the
    values delivered.** The same grouping was applied to the 117,354 delivered values. The share of delivered name
    and address values that were corrected, divided by the share of delivered money values that were corrected, is
    10.2.

Every figure was computed once, over all accounts together, and none was filtered by account.
