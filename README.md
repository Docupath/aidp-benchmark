# AIDP-2K and AIDP-CAP

The two synthetic document datasets of AIDP v1.0, the Agentic IDP Accuracy Standard, described in the white paper
"Precision Beyond the Page" (Docupath Research, 28 October 2026).

Intelligent document processing (IDP) turns business documents such as invoices and purchase orders into data. These
datasets test how accurately a system does that, from reading the page to returning values a business can use
without checking them.

## What is here

- [`AIDP-2K/`](AIDP-2K/): 2,000 business documents, 200 of each of ten types (invoices, purchase orders, credit notes,
  freight invoices, consignment orders, consignment invoices, receipts, quotes, bank statements and general
  contracts), in twelve locales, generated from one published seed, `docupath-corpus-v1`. Twelve of them arrive with
  a further file. The folder also holds the 300 held-out documents, 30 of each type, generated later from a public
  random value. 2,314 PDFs in all.
- [`AIDP-CAP/`](AIDP-CAP/): 960 documents of six types, 160 of each, with the further files that arrive with some of
  them; [`files-to-split/`](AIDP-CAP/files-to-split/), 200 files that each hold one to four documents; and
  [`repeated-copies/`](AIDP-CAP/repeated-copies/), 30 documents sent a second time. 1,485 PDFs in all.
- [`SHA256SUMS`](SHA256SUMS): a fingerprint for every PDF.

## What the documents test

**AIDP-2K** varies what makes business documents hard to read and capture: twelve locales, each with its own labels,
date order, number format and taxes (including right-to-left Arabic); four noise levels, from a clean page to a
tilted, stained fax copy with no text layer; tables from one line to 500; and conditions planted in some documents
only, so the others serve as clean comparisons: a cover page, a further file that breaks lines down into their parts,
a printed total that disagrees with its lines, no printed totals, and a barcode sticker whose lot number contradicts
its printed line.

**AIDP-CAP** tests what AIDP-2K cannot: further files arriving with a document and pages scanned upside down;
handwritten notes, stamps, signatures and ticks; payment QR codes, Code 128 and GS1 barcodes; values hidden under an
ink blot or a label; files holding several documents to split; addresses, accounts and codes printed together;
totals that do not add up; and suppliers written in several forms, to be matched to a customer's supplier list.

## How the files are named

- `AIDP-2K/<type>/<type>-NNN.pdf`: a document, numbered 000 to 199 within its type, such as
  `AIDP-2K/invoice/invoice-001.pdf`.
- `<document>-attachment-A.pdf` (then `B`, `C`): a further file sent with that document.
- `AIDP-2K/<type>/<type>-heldout-NNN.pdf`: a held-out document.
- `AIDP-CAP/<type>/cap-<type>-NNN.pdf`: an AIDP-CAP document.
- `AIDP-CAP/files-to-split/cap-bundle-NNN.pdf` and `AIDP-CAP/repeated-copies/<document>--copy.pdf`.

## The public random values

The held-out documents and AIDP-CAP were generated from random values that nobody could know in advance, published
by the drand network: round 6579746, at 12:00:00 IST on 24 October 2026, for the held-out documents, and round
6588206, at 10:30:00 IST on 27 October 2026, for AIDP-CAP. Anyone can read them at https://api.drand.sh/public/6579746
and https://api.drand.sh/public/6588206.

## Checking the files

Every PDF's SHA-256 fingerprint is in `SHA256SUMS`, a calculated code that changes if a single byte of the file
changes. From the repository's root folder:

```bash
shasum -a 256 -c SHA256SUMS     # macOS
sha256sum -c SHA256SUMS         # Linux
```

## How Docupath was benchmarked

Docupath's document-processing platform processed every document of both datasets in the ways AIDP v1.0 defines: the
PDF as a customer submits it, and for some measures the page's correct text, a written instruction or a customer's
contract. Its answers were scored under AIDP v1.0, which describes 25 capabilities in five layers (Read, Capture,
Understand, Reason and Trust) and combines 26 measures into the AIDP Score, their equal-weight geometric mean, so that
no strength can hide a missing capability.

Docupath scored 97.66 on the AIDP Score (95% range 97.35 to 97.95). On the held-out documents, which did not exist
until after the release under test was frozen, it scored 98.77 on AIDP-2K's thirteen measures, against 98.97 on AIDP-2K
itself. The white paper describes the method and the results in full.

## Privacy

Every document is synthetic. Every person, address, account number, article and amount was invented by the generator,
and so was every company name, with two exceptions: one Portuguese company is named after the publisher, Docupath,
and the freight invoices print a vessel name that carries a real shipping line's name, with real container-owner
codes. No customer document, customer name or value from a customer's document appears in this repository.

## Licence

Creative Commons Attribution 4.0 International (CC BY 4.0): see [`LICENSE`](LICENSE). To cite: Docupath Research,
"Precision Beyond the Page", 2026; AIDP-2K and AIDP-CAP, https://github.com/Docupath/aidp-benchmark.
