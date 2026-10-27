# AIDP-CAP, the capability set

AIDP-2K measures thirteen of the capabilities in the AIDP register. AIDP-CAP measures the other eleven that enter the
AIDP Score, and three more (Decoding, Contract and Traceability) in full, on documents that did not exist when the
measures, the documents' recipe, the customer's setup and the scoring were fixed.

## How it is made

1. **Registered first.** [`../bench/samples/cap-v1.json`](../bench/samples/cap-v1.json) fixes every choice before the
   seed exists: the release under test (the reference run's, unchanged), the seed rule, the generator, the customer's
   setup, the lanes, the eighteen measures (specification, section 5.8) and the AIDP Score over all thirty-one measures.
   It is pushed to this public repository, and GitHub records the time.
2. **A seed no one could choose.** The seed is the text `aidp-cap-v1:` followed by the randomness of the drand round
   the registration names, published after the push.
3. **The same builders as AIDP-2K.** [`../corpus-gen/cap/`](../corpus-gen/cap/) draws each document with AIDP-2K's own
   builders (the same twelve locales, layouts, line items and four noise levels), then adds the conditions of the
   capabilities it measures. Every value the page prints is held by the answer key in the field the output contract
   defines for it, and every expected result (a value a mark hides, a value the page implies, a supplier's code, a
   flag a case should raise) is written down before the page is drawn.

4. **Tested first, on other seeds.** A pilot ran the release on documents of a throwaway seed, and an independent
   reviewer read the scorer and the generator against its evidence, before the registration; what they found and what
   changed are in [`../results/aidp-cap-pilot/README.md`](../results/aidp-cap-pilot/README.md).

## What is in it

- 960 documents: invoices, purchase orders, credit notes, freight invoices, consignment orders and consignment
  invoices, 160 of each.
- Each capability's condition, in a minority of documents so the rest are its controls (shares in
  [`../corpus-gen/cap/composition.mjs`](../corpus-gen/cap/composition.mjs)):
  - **Intake**: further files arriving with a document (a delivery note, a packing list, a scanned letter), and a page
    scanned upside down;
  - **Handwriting and stamps**: handwritten notes, rubber stamps, signatures and ticks, drawn as pictures, on the first
    page and on later ones;
  - **Barcodes**: payment QR codes, purchase-order numbers in Code 128, and GS1 labels on consignment lines, as
    GS1-128 and GS1 DataMatrix symbols;
  - **Legibility**: values hidden under an ink blot or a label stuck over them, each beside a readable control under a
    coffee ring;
  - **Segmentation**: files holding two to four documents, scanned or not, and single-document files as controls;
  - **Parsing**: addresses on one line, postal codes with their cities, bank accounts with their bank codes, vessels
    with their voyages;
  - **Decoding**: labels on consignment lines, half of them the only place the lot and serial number are printed;
  - **Computation**: line amounts, net amounts, tax totals, grand totals and due dates the page implies but does not
    print;
  - **Consistency**: totals, subtotals, tax lines and line amounts that do not add up;
  - **Resolution**: suppliers written as listed, without their legal form, in capitals, by a trading name or with
    their legal form spelled another way, most with their VAT number and some without; one in ten not on the list;
  - **Anomaly detection**: copies sent twice, bank accounts other than the approved one, invoices priced above their
    purchase order, and a supplier's later invoice with a new account or an amount far above its usual, each with as
    many clean controls;
  - **Instructions** and **Contract**: registered samples run again under written instructions and under the
    customer's contract;
  - **Traceability**, **Calibration** and **Reading order** on every document.
- A case document of Anomaly detection (the document a case is judged on, and the purchase order or original it
  refers to) carries no hidden value, implied value, contradiction or upside-down page, so that no case is decided for
  another capability's reason; the earlier documents a case relies on keep theirs, except a page fed upside down and
  what the case reads from them. Most cases fall on invoices and credit notes, so those carry fewer of these
  conditions than the shares in `composition.mjs`. The manifest records the counts actually drawn (`realized`).
- The customer's supplier list and bank master (`customer/`), the map of where every value, mark and label is printed
  on every page (`<type>/<id>.map.json`), each document's correct text (`<type>/<id>.gt.txt`) and answer key
  (`<type>/<id>.gt.json`, with the capability expectations under `cap`).

## Regenerating it

```bash
npm ci && npx playwright install chromium
node aidp-bench/bench/make-cap.mjs --round <the registered drand round, saved as JSON> --out <folder>
```

Pages, marks and labels are drawn only with the openly licensed typefaces in `../corpus-gen/cap/fonts/` (SIL Open Font
License), and the manifest records the browser that drew them (its Playwright and Chromium versions) and the SHA-256 of
every font. Drawn twice on one machine with that browser, a seed gives the same answer keys, page texts, maps,
customer files and contract byte for byte, and the same PDFs apart from the creation and modification dates the browser
stamps in them. A different browser version can lay a page out differently, which moves the positions in the maps and
the page a mark falls on, so a check of the published files uses the recorded browser. The handwriting typefaces vary
less than a real hand does.
