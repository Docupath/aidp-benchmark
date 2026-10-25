# AIDP-Bench

An open benchmark, and the standard it implements, for software that processes business documents without a person
checking each one.

This repository holds five things:

- **The standard, AIDP v1.0** ([`spec/aidp-v1.0.md`](spec/aidp-v1.0.md)), the Agentic IDP Accuracy Standard. IDP means
  intelligent document processing: software that reads business documents, such as invoices and purchase orders, and
  turns them into data. Agentic means that data goes straight on to other software, with no person checking every
  document. The standard says what to count, how to count it, how to combine the counts into one score, and what must
  be published beside that score.
- **The benchmark, AIDP-Bench 1.0** ([`aidp-bench/`](aidp-bench/)): the scoring code, the runner, the generator and the
  methodology.
- **The dataset, AIDP-2K** ([`aidp-bench/CORPUS.md`](aidp-bench/CORPUS.md)): 2,000 generated documents with their
  answer keys. The keys and page texts are in this repository; the PDFs are a release asset.
- **The evidence** ([`aidp-bench/results/`](aidp-bench/results/)): every extraction the reference platform returned,
  document by document, and the scores computed from them, for the reference run and the held-out check.
- **Two studies** ([`aidp-bench/studies/`](aidp-bench/studies/)): what the answer keys of ten public benchmarks can and
  cannot measure, and whether a document's difficulty can be estimated after it was made.

The paper "Precision Beyond the Page", which presents the standard, the dataset and the results in plain language, is
published by Docupath alongside this repository.

## The reference result

AIDP-Bench 1.0 was run on all 2,000 documents of AIDP-2K against the Docupath platform
(release `5bd21304`), on 23 and 24 October 2026 (IST). Each document was processed twice: once from the page (the full
lane) and once from its correct text and document type (the text lane).

- **AIDP Score: 99.15** (95% range 99.03 to 99.27). The score combines sixteen measures: whether the values on the page
  were read, captured, understood and delivered correctly, whether the system gives the same answer again, and whether
  each value can be traced to its evidence. It is a geometric mean, so one weak measure pulls it down.
- **Held-out check: 99.00** (95% range 98.66 to 99.28). The same release, frozen on 23 October, was run on 300 documents
  generated on 24 October from a public random value, published by the drand network at 12:00:00 IST, so no one could
  choose or foresee the documents. The check's registration, which fixed that time and how the documents would be drawn,
  was committed to Docupath's private development repository at 11:31:47 IST and pushed at 11:31:51 IST, before the
  value existed
  ([`aidp-bench/bench/samples/heldout-v1.json`](aidp-bench/bench/samples/heldout-v1.json)). The range contains the AIDP-2K
  score ([`aidp-bench/results/aidp-v1-heldout-main/`](aidp-bench/results/aidp-v1-heldout-main/)).

The score summarises in one number how well a system reads, captures and interprets document content. Whether a
document can go through without a person is a different question, which the standard answers with the safety panel:
a result that claims documents can proceed without a person must publish it beside the score. This edition makes no
such claim, so it reports the score and the measurements beside it. The full board, by layer and by measure, is in
[`aidp-bench/results/aidp-v1-main/report.md`](aidp-bench/results/aidp-v1-main/report.md), and the findings are in
[`aidp-bench/FINDINGS.md`](aidp-bench/FINDINGS.md).

## The dataset

AIDP-2K is synthetic: 2,000 documents in ten types (invoices, purchase orders, credit notes, receipts, quotes,
freight invoices, consignment orders, consignment invoices, bank statements and general contracts), 200 of each, in
twelve locales, all generated from one seed (`docupath-corpus-v1`). Every person and amount in it is invented, and
so is every company name, with two exceptions: one Portuguese company is named after the publisher, Docupath, and
the freight invoices print a vessel name that carries a real shipping line's name, with real container-owner codes.
The generator writes each answer key first and draws the page from it, so a value a system returns that the key does
not hold was never printed: invention is measurable by construction.

- 1,200 documents (six types) have a full answer key, every value the page prints apart from the details the
  specification lists as unrecorded (Annex B); the other 800 have a fact key, a list of facts the output must contain.
- 12 documents carry a separate attached PDF that breaks two of their lines down into their parts. No file holds two
  documents.
- 302 documents are drawn to look like heavily degraded scans. They are image-only PDFs: there is no text layer, so
  the page must be read from its pixels. The answer keys do not declare this; the difficulty study found it.
- A minority carry planted problems, such as a printed total that disagrees with its lines, and the majority are clean
  controls that must not set off the same safeguards.

[`aidp-bench/CORPUS.md`](aidp-bench/CORPUS.md) has the full composition, and
[`aidp-bench/corpus-sample/`](aidp-bench/corpus-sample/) has sixteen documents to open in a browser, each beside its
answer key. The 300 documents of the held-out check, with their answer keys and page texts, are in
[`aidp-bench/corpus-heldout/`](aidp-bench/corpus-heldout/).

## Get the PDFs

The answer keys, page texts, manifest and contract are in [`aidp-bench/corpus/`](aidp-bench/corpus/). The 2,012 PDFs
(2,000 documents and 12 attachments) are published as the release asset `aidp-2k-v1.0-pdfs.tar.gz`, with
[`aidp-bench/corpus/PDF-SHA256SUMS`](aidp-bench/corpus/PDF-SHA256SUMS) holding the SHA-256 fingerprint of each file.
The 302 PDFs of the held-out check (300 documents and 2 attachments) are the release asset
`aidp-heldout-v1-pdfs.tar.gz`, fingerprinted in
[`aidp-bench/corpus-heldout/PDF-SHA256SUMS`](aidp-bench/corpus-heldout/PDF-SHA256SUMS). To put them beside their
answer keys and check every one:

```bash
tar -xzf aidp-2k-v1.0-pdfs.tar.gz -C aidp-bench/corpus
(cd aidp-bench/corpus && shasum -a 256 -c PDF-SHA256SUMS)     # on Linux: sha256sum -c PDF-SHA256SUMS
tar -xzf aidp-heldout-v1-pdfs.tar.gz -C aidp-bench/corpus-heldout
(cd aidp-bench/corpus-heldout && shasum -a 256 -c PDF-SHA256SUMS)
```

## Regenerate the dataset

Everything regenerates from this repository, with Node.js 24 or later:

```bash
npm ci
npm run keys -- --out <folder>     # the 2,000 answer keys, page texts, manifest.json and contract.json, in seconds
npx playwright install chromium    # once, for drawing pages
npm run render -- --out <folder>   # the 2,012 PDFs, about a minute with six browser workers
```

The answer keys, page texts, `manifest.json` and `contract.json` come out byte for byte the files in
`aidp-bench/corpus/`. The PDFs come out with the same pages and the same text as the release files, and 1,975 of
the 2,012 identical pixel for pixel; the other 37 are heavily degraded documents of two or more pages, which the
browser draws slightly differently from one run to the next. No regenerated PDF is byte for byte its release file,
because each carries the date and time it was drawn. That is why the files that were run are published as they are,
with their fingerprints. [`aidp-bench/CORPUS.md`](aidp-bench/CORPUS.md) gives the measured figures and says what the
drawing depends on.

The held-out documents regenerate the same way, from the seed the registration in
[`aidp-bench/bench/samples/heldout-v1.json`](aidp-bench/bench/samples/heldout-v1.json) defines, and
`aidp-bench/bench/make-heldout.mjs` draws the 300 from them exactly as registered
([`aidp-bench/corpus-heldout/README.md`](aidp-bench/corpus-heldout/README.md)).

## Score

Scoring runs offline: no model is called and nothing is downloaded. To re-score the published evidence:

```bash
npm run rescore           # the reference run: aidp-bench/results/rescore/scoreboard.json and report.md
npm run rescore:heldout   # the held-out check: aidp-bench/results/rescore-heldout/
```

The results are the published boards: an AIDP Score of 99.15 on AIDP-2K and 99.00 on the held-out documents. The
scoring code, the 95% ranges (`bench/bootstrap.mjs`) and the calibration figures (`bench/calibration.mjs`) are
described in [`aidp-bench/README.md`](aidp-bench/README.md) and
[`aidp-bench/METHODOLOGY.md`](aidp-bench/METHODOLOGY.md). `npm test` runs the unit checks of the scoring rules, of
the runner and of the generator's settings, and `npm run verify` runs this repository's checks.

## Add a system

AIDP-Bench is meant to score more than one system. [`aidp-bench/ADAPTERS.md`](aidp-bench/ADAPTERS.md) says what an
adapter must do, when a result is comparable with the published one, and how to submit it.

## The collected corpus

A generated dataset cannot show how a system behaves on the documents real customers send, so the standard pairs
AIDP-2K with a collected corpus of documents that people reviewed on a commercially available IDP platform, whose
name is withheld. Those documents are never published. The only figures from them in this repository are the
all-account totals quoted in section 1 of the paper "Precision Beyond the Page", for example a field accuracy of
98.20 per cent across 1,490 reviewed documents in which 995 still needed at least one correction.
[`analysis/README.md`](analysis/README.md) lists them all, with how each was computed.

## What is where

```
spec/aidp-v1.0.md            the standard
aidp-bench/README.md         the benchmark: layers, the score, how to run it
aidp-bench/METHODOLOGY.md    everything needed to reproduce or dispute a result
aidp-bench/FINDINGS.md       findings about the platform tested and limits of this edition
aidp-bench/ADAPTERS.md       adding a system
aidp-bench/CORPUS.md         the dataset
aidp-bench/corpus/           answer keys, page texts, manifest, contract, PDF fingerprints
aidp-bench/corpus-heldout/   the 300 documents of the held-out check, with their keys and fingerprints
aidp-bench/corpus-sample/    sixteen documents to browse
aidp-bench/corpus-gen/       the generator
aidp-bench/bench/            scoring, runner, statistics and their checks
aidp-bench/results/          the reference run and the held-out check: raw answers, scoreboards, reports
aidp-bench/studies/          an audit of ten public benchmarks' answer keys, and a difficulty study
analysis/                    the AIDP-Field totals quoted in the paper
verify-repo.mjs              checks across every published file
```

## Licence

The software is MIT. The specification, the dataset (answer keys, page texts and the PDFs), the results and the
documentation are CC BY 4.0. See [`LICENSE`](LICENSE). One dependency, mupdf, is licensed GNU AGPL-3.0-or-later; it is
needed only by three benchmark tools (the post-run diagnostics, the sample's page previews and the runner's optional
second-reader lane), not to regenerate the dataset or to score.

## Who wrote this

AIDP-Bench was written by Docupath, which sells the document processing platform the reference run tested, and so has
an obvious interest in how accuracy is measured. Four things are offered so readers do not have to take that on trust:
the dataset regenerates from a published seed, so its documents cannot have been chosen after the results were seen;
the scoring rules and samples were fixed before the runs they govern, as the commit times in Docupath's private
development repository record (the next edition places such records with an independent party), and the
specification lists every decision made after the run, none of which changes a score; the held-out documents were
drawn from a public random value that did not exist when the release was frozen; and every extraction the reference
platform returned is published, so any figure can be recomputed or disputed, including by someone who changes the
scorer first. The reference platform also processed AIDP-2K's documents while the benchmark was being developed,
which is why the held-out check exists.
