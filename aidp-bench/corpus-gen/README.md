# The AIDP-2K generator

This folder generates AIDP-2K, the dataset AIDP-Bench scores against: 2,000 documents, ten document types with 200 of
each, twelve locales, deterministic from one seed (`docupath-corpus-v1`). Everything it writes is synthetic.
[`../CORPUS.md`](../CORPUS.md) describes what comes out.

## Answer key first

Each document's answer key is built first, and the page is drawn only from the values in it. So a value a system
returns that the key does not hold was never printed (an invention), and a key value the system does not return is a
miss (one exception, the payment terms on freight invoices, is recorded in [`../FINDINGS.md`](../FINDINGS.md), B3).
Nobody labels a page after the fact.

## Commands

Run from the repository root, after `npm ci`:

```bash
npm run keys -- --out <folder>     # answer keys, page texts, manifest.json and contract.json, in seconds
npx playwright install chromium    # once, for drawing pages
npm run render -- --out <folder>   # the 2,012 PDFs as well, about a minute with six browser workers
```

Both write to `aidp-bench/corpus-regenerated/` when no `--out` is given. The answer keys, page texts, manifest and
contract come out byte for byte the files in [`../corpus/`](../corpus/). The PDFs come out with the same pages and text
as the published v1.0 files, 1,975 of the 2,012 identical pixel for pixel, but never byte for byte, because each carries
the date it was drawn; [`../CORPUS.md`](../CORPUS.md) gives the figures. That is why the published files ship with their
fingerprints in [`../corpus/PDF-SHA256SUMS`](../corpus/PDF-SHA256SUMS). The pages use fonts that come with macOS
(Helvetica Neue, Georgia, Courier New, Verdana, Hiragino Sans and Geeza Pro): on a system without them the browser
substitutes others, so pages can break and look differently, while the answer keys and page texts stay the same.

## The files

- `composition.mjs`: the ten types, 200 of each, and the seed.
- `data.mjs`: the document builders. Each one draws a document's dimensions, writes its answer key and lays out its
  content. The file also holds builders for document types outside AIDP-2K, which the corpus never calls.
- `lex.mjs`: the twelve locales (labels, date order, number format, currency, tax, script and direction) and the word
  banks the builders draw from.
- `render.mjs`: turns a document's content into HTML, adds the degradation of its noise level, and prints it to PDF in
  headless Chromium.
- `barcode.mjs`: real, scannable barcodes (GS1-128 with application identifiers, EAN-13, QR codes including the EPC
  payment format, Code 128), drawn with bwip-js.
- `gttext.mjs`: each document's correct page text, the text lane's input.
- `schema.mjs`, `contract.mjs`, `fields-snapshot.mjs` and `schema-snapshot.json`: the field names and the contracted
  output schema the answer keys are written in, frozen for the ten AIDP-2K types. It is data only: field listings and
  structure views.
- Two settings, both off by default so the published seed reproduces AIDP-2K exactly: `--valid-accounts` prints bank
  account numbers with valid check digits, and `--due-dates-from-terms` sets each due date 30 days after the document
  date, matching the payment terms (`data.mjs`, `GEN_OPTIONS`). A corpus made with either says so in its manifest.
- `materialize-gt.mjs`: writes the answer keys, page texts, manifest and contract without drawing a page.
- `generate.mjs`: draws the PDFs, and writes the same keys, texts and manifest beside them.
- `rng.mjs`: the seeded random number generator every choice is drawn from.

## What varies, document by document

- **Locale**: twelve locales (en-US, en-GB, de-DE, de-CH, ja-JP, fr-FR, es-ES, sv-SE, ar-AE, pt-PT, nl-NL, en-IN), each
  with its own labels, dates and numbers (`1.234,56`, `1'234.56`, no decimals in yen), taxes (one VAT line; IVA with a
  recargo de equivalencia line in Spain; CGST and SGST in India) and, for Arabic, right-to-left text.
- **Noise**: none, light, medium or heavy. Light tilts the page; medium adds a fold shadow and a stain; heavy adds a fax
  band and lowered contrast, and is drawn as a picture of the page, so those PDFs carry no text layer. Some degraded
  pages also carry a "paid" stamp.
- **Scale**: one to four line items, 18 to 45, 120 to 220, or 500 (invoices and purchase orders only).
- **Structure**: a cover page; an attachment that breaks two lines down into their parts (the answer key then holds the
  parts in place of the two lines); a printed total that disagrees with its lines (a flag is expected); no printed
  totals (the net and total amounts are expected to be derived); a barcode sticker whose lot number contradicts its
  printed line.

To change the corpus, edit the builders (`data.mjs`), the locales (`lex.mjs`) or the degradation (`render.mjs`), and
publish the result under a new seed or version: AIDP-2K v1.0 is the output of this folder as committed.

## AIDP-CAP, the capability set

[`cap/`](cap/) draws AIDP-CAP with the builders above: each document is drawn by AIDP-2K's own builders from its own
seeded stream, then carries the conditions of the capabilities AIDP-2K does not measure (`cap/composition.mjs`). The
page is drawn twice: once as the system receives it, and once as a map in which every value, mark and label is
coloured by itself, so its position on the page can be read back exactly (with mupdf, which also turns, rescans and
joins the PDFs). Pages and handwriting are drawn only with the openly licensed typefaces in `cap/fonts/`, never with the
drawing machine's own fonts. [`../corpus-cap/README.md`](../corpus-cap/README.md) describes the set and how it was
registered before its seed existed.
