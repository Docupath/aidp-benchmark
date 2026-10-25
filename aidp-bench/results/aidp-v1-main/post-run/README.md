# Post-run diagnostics

Six figures about the AIDP v1.0 reference run, worked out **after the run** from what the run had
already kept: the platform's reading of each page, the fields it extracted, the fields from its own database
that `db-export/` holds, the corpus documents themselves and their answer keys (the correct values each
document carries).

- **They were computed after the run.** Nothing was run again. No model, no API and no service was
  called. No output of the run was changed.
- **They are not part of the AIDP Score.** None of them enters any of the sixteen score-bearing
  measures, and the score does not move because of them.
- **They are diagnostics under spec section 7.6:** figures the harness publishes beside the result to
  show where errors are, not to grade.

Every figure can be recomputed by anyone who holds the published files. The few values that were kept
only in the platform's database are exported to `db-export/`, so the database is not needed.

```
node aidp-bench/bench/post-run/index.mjs --corpus <AIDP-2K folder>
```

## The six figures

### 1. Intake: was every page read?

**Unit: pages.** For each document we count the real pages of every file the system was sent (the
main PDF and any attachment). A page counts as read when the system's reading has that page's marker
("Page N") with some text under it.

**3,468 of 3,490 pages were read (99.37%).** That is 3,456 of 3,478 pages of the main files, and all
12 attachment pages (12 of 12). 1,978 of the 2,000 documents had every page read. The 22 pages that
were not read are all the last page of their file, and each holds one thing only: the document's
closing line, such as "Thank you for your business." No answer-key field holds that line, so no
expected value was lost. For 19 of the pages this was read from the PDF's text. The other 3 pages are
pictures with no text inside (heavily degraded scans), so they were checked by eye: crops are in
`by-eye/`.

### 2. Stamps: was the "PAID" stamp noticed?

**Unit: documents.** Which documents carry the stamp is not guessed from the output. It is the
corpus generator's own random draw, repeated with the generator's own code and the same seed, and then
confirmed on every PDF in two independent ways (the stamp's tilted text, and its colour). The draw and
the PDFs agree on all 2,000 documents: 448 carry the stamp and 1,552 do not. "Noticed" means the
system's stored description of the page lists a stamp.

**The system noted the stamp on 437 of the 448 stamped documents (97.54%), and on none of the 1,552
unstamped ones (0 false alarms).** Things to know:

- The system describes page 1 only. On 3 long documents the stamp is printed on page 2, so it could
  not be seen. Counting page-1 stamps only: 437 of 445.
- 1 more stamp was reported as a "seal" instead ("triangular outline seal/stamp near top right, text
  partly legible: PAID"). Counting either: 438 of 448.
- The stamp has no field in any contract, so this cannot change any score.

### 3. Reading order: was each table row read as one row, in order?

**Unit: rows.** Every row of every repeating table the corpus prints (line items, bank transactions,
freight charges, attachment breakdowns): 69,930 rows, each checked against the document's correct text.
A row passes when one line of the system's reading holds all of the row's cells, in the order a reader
of that script reads them. Fair allowances, each explained in `summary.json`:

- A cell the page itself wraps onto two lines may continue on the next line, under its own column.
- On right-to-left (Arabic) pages the system writes rows in either direction: first column first (the
  way an Arabic reader reads), or first column last (the way the page looks from left to right). Of the
  right-to-left rows that pass, 945 are written the first way and 4,016 the second, so either passes as
  long as the whole row keeps one direction.
- Cells hidden under a barcode sticker are left out (5,252 cells). Their position is worked out from
  each PDF. The 69 heavily degraded consignment documents have no text inside their PDFs, so the hidden
  cells cannot be located there, and those documents (3,314 rows) are left out whole.

**65,731 of 66,616 judged rows pass (98.67%).** If a row may also spread over the line below it (the
system sometimes writes a row's numbers one line lower, under their columns), 65,926 pass (98.96%).
Most failures are misread or missing cells rather than cells out of place: counting only rows whose
cells were all on their line, 65,731 of 65,809 are in the right order (99.88%). On Arabic pages 4,961
of 5,081 rows pass (97.64%). On documents with stickers 96.08% pass, on documents without 99.48%.

### 4. Legibility: did the system say what it could not read?

**Unit: marks.** The system's reading writes a tag where it cannot read something: "[obscured]",
"[illegible]" or "[cut off]". We count those tags. This is a count, not a percentage, because the
corpus does not record which spots are unreadable.

**1,746 tags in 244 documents.** 1,714 of them are in 221 of the 400 documents that carry barcode
stickers; 32 are in 23 of the 1,600 documents without stickers. **No tag text reached any extracted
value** (about 1.48 million values in the main run and 0.5 million in the repeatability run checked).

Worth knowing beside it:

- The reading also wrote 177 pen-mark tags, such as "[circled]", in 164 documents, on a corpus that
  prints no pen marks; 171 of them are on documents with the PAID stamp, whose rectangular border the
  reading took for a circle, a strike or a highlight ("PAID [circled]").
- Where a sticker hides part of a table row, the system often writes a value instead of a tag. In
  1,334 rows we could see what it wrote in the hidden cell's place: 2,207 hidden cells got a tag, 230
  were left empty, 853 got the printed value or part of it (318 whole, 535 in part, where the cell was
  only partly hidden), 333 got the sticker's own lot, serial or product number, and 994 got some other
  value. This is an estimate, explained in `summary.json`.

### 5. Parsing: were values printed together split into their own fields?

**Unit: parts.** Two things are printed as one run of text on every invoice-like document: the
seller's whole address on one line ("street, postal code city, country") and the buyer's postal code
with city. Their 6 parts, on 1,200 documents, make 7,200 parts.

**7,155 of 7,200 parts came back right in their own field (99.38%)**, judged by the benchmark's own
comparison. 1 was left stuck inside a neighbouring field (a postal code inside an Arabic address), 1
came back whole but under another field's name (a street in the address field), and 43 were wrong or
missing for other reasons (21 with something else in their own field, 19 with it empty, 3 with the part
and other text together), which the score already counts.

### 6. Duplicate detection: when the same document is sent again, does the system say so?

**Unit: submissions.** The repeatability run sent each of its 200 documents three times, each time as
its own submission. The system's matching step marks a document "possible duplicate submission" when
another document of the same type, number and seller already exists. That step only runs for
invoices, credit notes, freight invoices and consignment invoices: the 80 documents of the sample of
those four types, so **80 documents (240 submissions) get a verdict at all**. The other 120 documents
are never checked for business duplicates.

**158 of the 160 submissions that arrived after a copy had already been processed were flagged
(98.75%), and none of the 80 that arrived first.** The 2 misses are the second and third copies of one
document whose number the system did not capture, so it could not compare. A second check, on the
content itself, flagged 396 of the 400 later copies of all 200 documents and none of the first copies.
In the main run nothing was flagged, which is right: no two documents in the corpus share a type,
number and seller (one credit-note number is shared by two different sellers).

## Files

- `summary.json`: every figure with its count, its total, its rate, its exact definition and its
  caveats, plus fingerprints (sha256) of the scripts and evidence files.
- `intake.jsonl`, `stamps.jsonl`, `reading-order.jsonl`, `legibility.jsonl`, `parsing.jsonl`,
  `duplicates.jsonl`: the evidence per document (per submission for duplicates), one JSON line each.
- `db-export/`: every database value the figures rely on (page descriptions for stamps; duplicate
  verdicts, extraction runs and match index entries; classification runs), with `export-meta.json`.
- `by-eye/`: crops of the pages checked by eye and `verdicts.json`, the record of that check.

The scripts are in `aidp-bench/bench/post-run/`. All times in these files are IST (GMT+05:30).
