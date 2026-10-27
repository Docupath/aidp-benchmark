# The pre-registration pilot and review of AIDP-CAP

Before AIDP-CAP's seed existed, the frozen release ran on documents drawn from a throwaway seed, `pilot-seed-6`,
never the registered one, to show that every lane, every record the scorer reads and every measure works end to end;
then an independent reviewer read the scorer and the generator, with the pilot's evidence to test them on. This folder
holds everything the pilot produced. It is a record, not a result: it covers too few documents per measure for an
AIDP Score, and the generator changes listed below alter some pages, so drawing `pilot-seed-6` again does not give
exactly these documents.

## What ran

- **Where**: release `5bd21304`, unchanged, on a separate instance with its own database. Its environment files differ
  from the registered run's only in the database and the folder for stored documents.
- **Pilot 1**, 27 October 2026, 00:17 to 01:04 IST: 95 documents and one copy sent twice in the full lane
  (`lists/pilot-1-main.txt`), chosen so that between them they carry every condition, and one anomaly and one control of
  every case kind with the documents they refer to; 6 files to the splitting step; 6 documents in the instruction lane;
  6 documents under the customer's contract.
- **Pilot 2**, 27 October 2026, 01:10 to 01:36 IST: 20 more documents in the full lane (`lists/pilot-2-main.txt`), 16
  of them scanned, run after the time limits in item 1 below were raised, to show that no step was cut short any more.
- **Review**, 27 October 2026: an independent reader went through `score-cap.mjs`, the instructions, the customer's
  setup and the generator, and tested each suspected defect on this evidence and on full throwaway draws.

## What changed before registration

### Found by the pilot

Every failing check was examined against the release's own output. Most failures were the release's own. These were
the benchmark's:

1. **The benchmark machine's speed** (setup). The machine is shared with other work and is slower than production's,
   and the release's own time limits cut work short on it: 34 requests for a page's word positions timed out, so pages
   kept no positions and their values could not be located; 28 barcode scans did not finish, and a reading whose scan
   did not finish is served without being stored. Five limits on how long the release waits for its own steps and
   services were raised (`V2_LAYOUT_OCR_TIMEOUT_MS` 600000, `V2_LAYOUT_OCR_BUDGET_MS` 1800000,
   `V2_BARCODE_SCAN_BUDGET_MS` 600000, `V2_GUDID_TIMEOUT_MS` 30000, `PG_POOL_CONNECT_MS` 60000). A step that finishes
   within production's limit gives the same result. Pilot 2 ran with them and none was cut short: on its scanned
   documents the release located 84% of the values the page prints, against 21% on pilot 1's scanned documents (on
   digital documents, 97% and 96%).
2. **One process of the release stopped** (setup), with a fatal error inside Node's WebAssembly engine. The API now runs
   as three processes behind a round-robin proxy, as production runs several replicas, and a watchdog starts again any
   process that stops, as production's container service does. A request in flight when a process stops is sent again,
   like any transport failure.
3. **Intake** (scorer). A PDF hands back the words of an Arabic page in visual order and in pieces, so the page's own
   text was garbled and correct readings failed. Words in a right-to-left script are now left out of a page's own text,
   and such a page is judged by its numbers and other words.
4. **Barcodes** (scorer). The release returns a payment code's line breaks as spaces or as the two characters `\n`, and
   payloads were compared line by line. They are now compared as the reference run compares them: letters and digits
   only, case aside, an escaped line break read as one.
5. **Computation and Traceability** (scorer). The release keeps its own record of the values its model works out, with
   the reason ("Computed as subtotal plus VAT because no printed grand total is shown"), and the scorer read only the
   record of its computation engine. Every record of a computed value now counts.
6. **Traceability** (scorer and generator). A value the release located at the barcode that carries it now counts as
   located; a transmittal cover sheet's seller name, printed but not recorded in the page's map of values, is recorded.
7. **Handwriting and stamps** (scorer). A control page carried an ink blot and a coffee ring from the Legibility test,
   which the release described, fairly, as a scribble and a seal. A control page now carries no mark and nothing made
   unreadable.
8. **Consistency** (generator). Payment codes were printed on credit notes, where a code asking for a positive payment
   contradicts the note's negative total, and the release flagged that real contradiction on a clean control. Payment
   codes are now printed on invoices only.
9. **Harness**. Two lanes shared a file-server port; the proxy uses a port Node's `fetch` accepts; the runner waits up to
   60 minutes for an answer. The specification also states how Reading order counts a row with a misread cell, as the
   reference run's figure did.

### Found by the review

10. **The value comparison shared with AIDP-2K** (`base-score.mjs`) did not do what section 5.1 of the specification
    says: it compared any two values by their digits alone, as numbers, so an Arabic street passed against its building
    number alone and an account number lost its country code and every digit past the sixteenth. The comparison of
    digits alone now applies only to an identifier the key writes in digits, digit by digit. Re-scoring the reference
    run moves 7 of its 494,386 captured values from right to wrong (specification, Annex B, "Decided after the run").
11. **Intake** scored a page against the best of all reading pages, so a dropped page could pass on a page that resembled
    it. Pages are now matched one to one with the pages of the reading.
12. **Handwriting and stamps** could read a stamp from words the page itself prints ("APPROVED JB" from "Approved by"
    under a signature line). A mark's words now count only beyond the page's own printed words, and its short words
    (initials, a count) must be there exactly. Controls could run out on invoices; a control now comes from any type
    where its own has none left, each document serving once for each kind of mark.
13. **Contract** checked formats only on values the answer returned, so an empty answer passed. Every value the key holds
    is now checked, and one left out does not meet the customer's format.
14. **Calibration** judged a nested tax or payment block as one value with no confidence. Each value in it is now judged
    with the release's own confidence, in the fields the answer key defines. Invented values stay in, as wrong values at
    their own confidence (inventing them is Restraint's to count); the two figures over the values the key holds alone
    are published beside the score.
15. **Anomaly detection** let a control pass without its matching verdict; a case now needs both the document's answer
    and its matching verdict. **Instructions** containment now checks an instruction's scope on either answer.
16. **The generator**: a freight invoice's charges repeated a hidden shipment reference in plain text (the column is now a
    recorded value, so such a reference is never hidden); the freight totals ran on as rows of the charges table (a
    table without a heading now starts on a line of its own); a tax label printed code and rate as one value (they are
    two); a credit note printed with negative amounts left a line amount to be computed as quantity times price (none
    is left); an invoice against an order drew its own tax rows (it takes its order's). The specification names the four
    kinds of printed contradiction, which pages are left out of Traceability, and that a barcode may be read from the
    text printed beneath it.

**Nothing was changed because the release failed it.** These failures of the release all stay in the registered set:
lot and serial numbers printed only on a line's label (pilot 1: 4 of 59 carried to the line); quantities written with
exactly two decimals (0 of 90); handwriting in Arabic; tax amounts that disagree with the printed rate; signatures on
pages after the first; a label's own text read as the number it hides ("BIN 07"); implied values left empty or with the
wrong sign; and the two kinds of anomaly that need a supplier's history.

## The pilots under the registered rules

| Measure | Pilot 1 | Pilot 2 |
|---|---|---|
| Intake, pages read | 100.00% (168/168) | 97.83% (45/46) |
| Handwriting and stamps, marks read | 90.41% (132/146) | 100.00% (28/28) |
| Barcodes, symbols decoded | 100.00% (79/79) | 100.00% (33/33) |
| Reading order, rows read in order | 96.05% (2532/2636) | 95.55% (880/921) |
| Legibility, unreadable values declared | 93.55% (29/31) | 93.33% (28/30) |
| Segmentation, documents cut out exactly | 100.00% (14/14) | not run |
| Parsing, parts in their own field | 98.24% (668/680) | 96.38% (133/138) |
| Decoding, label fields on the right line | 6.78% (4/59) | 0.00% (0/35) |
| Computation, implied values computed and shown | 61.54% (8/13) | 16.67% (1/6) |
| Consistency, contradictions flagged | 85.00% (17/20) | 90.00% (9/10) |
| Resolution, supplier identified | 100.00% (69/69) | 100.00% (9/9) |
| Instructions, adherence | 85.71% | not run |
| Instructions, containment | 99.95% | not run |
| Contract, customer contract | 100.00% (527/527) | not run |
| Traceability, value located on the page | 75.14% (17196/22885) | 87.10% (6776/7780) |
| Calibration, one minus calibration error | 96.50% (2,992 values) | 93.94% (620 values) |
| Calibration, discrimination | 75.27% | 66.99% |
| Anomaly detection, cases handled right | 80.00% (8/10) | not run |

Pilot 1's Traceability is low because of item 1: it ran before the time limits were raised. Pilot 2's page 6 of a
consignment order, the only page it did not read, held only the line "Thank you for your business."

## Files

- `runs/`: the raw record of every lane, scrubbed as the reference run's evidence is (review decisions, token counts and
  local paths removed). Scoring the scrubbed record gives the same figures as before scrubbing.
- `scoreboards/pilot-1.json`, `scoreboards/pilot-2.json`: both pilots scored by the registered scorer.
- `lists/`: the documents each lane sent, and the filtered manifests the pilots were scored with.
