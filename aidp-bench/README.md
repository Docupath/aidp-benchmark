# AIDP-Bench

The open benchmark of the **Agentic IDP Accuracy Standard (AIDP) v1.0**: twenty-five capabilities in five layers, one
score built from thirty-one measures, and a safety panel that any claim of processing without review publishes beside
the score.

Most published accuracy figures in document processing measure one thing: whether the values a system attempted to
read came out right. AIDP-Bench also reports what is rarely published: whether a system invents values, whether it
understands the values it reads, whether it delivers them in the agreed form, whether it gives the same answer twice,
whether every value can be traced to its evidence, and, for any result that claims documents can proceed without a
person, how many documents arrive wrong with nobody warned.

- **Specification:** [`../spec/aidp-v1.0.md`](../spec/aidp-v1.0.md)
- **Methodology:** [`METHODOLOGY.md`](METHODOLOGY.md)
- **The datasets:** [`CORPUS.md`](CORPUS.md), and [`corpus-sample/`](corpus-sample/) for sixteen documents beside their answer keys; AIDP-CAP in [`corpus-cap/README.md`](corpus-cap/README.md)
- **Findings and limits:** [`FINDINGS.md`](FINDINGS.md)
- **Adding your own system:** [`ADAPTERS.md`](ADAPTERS.md)

## The v1.0 runs

The reference run processed all 2,000 documents of AIDP-2K, each in both lanes, against the Docupath platform at
release `5bd21304`, on 23 and 24 October 2026 (IST). The full lane submits the PDF as a customer would; the text lane
submits the document's correct text and type, which takes reading out of the measurement. The capability run
processed all 960 documents of AIDP-CAP against the same release on 27 October 2026 (IST), under a customer's setup,
registered in this public repository before its documents existed ([`corpus-cap/README.md`](corpus-cap/README.md)).

**AIDP Score: 82.90** (95% range 79.57 to 84.67), over thirty-one measures: thirteen from the reference run and
eighteen from the capability run.

| Layer | Measures | Score | 95% range |
|---|---|---|---|
| 1. Read | 7 | 97.01 | 96.41 to 97.55 |
| 2. Capture | 7 | 97.56 | 96.81 to 98.20 |
| 3. Understand | 8 | 55.93 | 47.56 to 60.66 |
| 4. Reason | 4 | 95.73 | 95.40 to 95.99 |
| 5. Trust | 5 | 88.57 | 87.34 to 89.67 |

After the capability run, six places where the scoring code did not do what the specification says were corrected;
the specification's Annex B lists each with what it moves, and the board as registered, an AIDP Score of 82.75 (95%
range 79.43 to 84.53), is published beside the corrected one in [`results/aidp-v1-cap/`](results/aidp-v1-cap/).

The same release, frozen on 23 October, was also run on 300 documents generated on 24 October from a public random
value that did not exist when it was frozen: the held-out check, registered in
[`bench/samples/heldout-v1.json`](bench/samples/heldout-v1.json) and committed to Docupath's private development
repository before its seed existed, with its documents in [`corpus-heldout/`](corpus-heldout/) and its evidence in
[`results/aidp-v1-heldout-main/`](results/aidp-v1-heldout-main/). On the thirteen AIDP-2K measures in the score it
scored 98.77 (95% range 98.30 to 99.13), against 98.97 on AIDP-2K.

The reference run's own board counts sixteen AIDP-2K measures, among them Decoding, Contract and Traceability, which
test their capabilities only in part there and are reported beside the AIDP Score; it reads 99.15 (95% range 99.03 to
99.27), and the held-out check's 99.00 (95% range 98.66 to 99.28). Every AIDP-2K measure, by layer, is in
[`results/aidp-v1-main/report.md`](results/aidp-v1-main/report.md), and by document type, difficulty, table size and
locale in its `scoreboard.json`; every AIDP-CAP measure, by document type and by document, is in
[`results/aidp-v1-cap/scoreboard-cap.json`](results/aidp-v1-cap/scoreboard-cap.json); what failed, and why, is in
[`FINDINGS.md`](FINDINGS.md).

## The five layers

A **layer is a stage of work, defined by the knowledge the system needs beyond the page in order to do it.** Because
the knowledge required only increases, the layers fall into a fixed order, and any new measurement can be placed in
that order by inspection.

| Layer | The work it does | What it needs beyond the page |
|---|---|---|
| 1 Read | Gets everything off the page as content | Nothing. The page is enough |
| 2 Capture | Turns that content into a faithful record of this document | Knowledge of what business documents look like |
| 3 Understand | Turns that record into clean, standard, complete data | The world's conventions: date and number formats, country and currency codes, arithmetic, barcode standards |
| 4 Reason | Makes that data fit one particular customer's business | That customer's own records, output contract and written instructions |
| 5 Trust | *Not a stage of work.* A property of the system that did the other four | Evidence about itself: repeat runs, an evidence trail, a record of what reached a person |

| Layer | Capabilities |
|---|---|
| Read | Intake, Printed text, Handwriting and stamps, Barcodes, Reading order, Legibility |
| Capture | Identification, Segmentation, Line items, Completeness, Fidelity, Restraint |
| Understand | Normalisation, Parsing, Decoding, Computation, Consistency |
| Reason | Resolution, Instructions, Contract |
| Trust | Repeatability, Traceability, Calibration, Anomaly detection, Escalation |

Each capability is one question with one thing it counts. Twenty-four carry score-bearing measures, measured on
AIDP-2K, on AIDP-CAP or, for Consistency, on both; Escalation is the safety panel, published beside the score only for
a result that claims documents can proceed without a person. The register in the specification says which dataset
measures each.

## One score, pinned

The standard defines exactly one number, the AIDP Score: the equal-weight geometric mean of thirty-one score-bearing
measures (Read 7, Capture 7, Understand 8, Reason 4, Trust 5), each capped at one, nothing excluded. The geometric
mean is deliberate: a collapse in any one measure drags the score down in a way an arithmetic mean would hide. The
five layer scores recombine to the score exactly, weighted by their measure counts. `bench/score-cap.mjs` computes
it, taking AIDP-2K's thirteen measures from the reference run's board, which `bench/aidp-score.mjs` computes.

The score has one weighting, read from the dataset itself: each of the six document types with full answer keys counts
equally, exactly as each does in AIDP-2K (200 documents of every type). Nothing outside the published dataset enters
the score, so anyone can recompute it from the answer keys and the raw evidence. The two Read measures are averaged over
every document of all ten types.

Beside the score of any result that claims documents can proceed without a person sits the **safety panel**: the share
of documents that carried a critical error and were not sent to a person, the catch rate and the false-alarm rate, by
document type. Its complement, the **safe-handling rate**, is quoted with the score in every such result. This edition
makes no such claim, so it reports no safety panel. Calibration, barcode recall, fact recall and compliance with
written instructions are reported beside the score too. Every measure in the score carries a 95 per cent bootstrap
range; the figures beside it are counts and rates without ranges, and ranges by document type are not yet published
(`FINDINGS.md`, B17).

## The dataset, and the collected corpus

**AIDP-2K** is generated: 2,000 synthetic documents, ten types with 200 of each, twelve locales, one seed. See
[CORPUS.md](CORPUS.md) for the composition and [corpus-sample/](corpus-sample/) for documents beside their answer keys.

Completeness, Restraint and Computation need to tell a value the document contains from one it does not. A
hand-labelled corpus cannot establish that: a labeller records what they found, and cannot certify that a value is
absent from a page they may have read incompletely. AIDP-2K is generated answer key first. The generator writes the
correct answer, then draws the document from it, and every value the page prints is held by the key in the field the
output contract defines for it (checked, and corrected before the run where it was not; see section 8.3 of the
specification). A value a system returns in a field the key leaves empty is therefore an invention by construction
rather than by judgement. The same ordering makes the Understand layer measurable: the key holds `7761.00` and the page
prints `7.761,00`; the key holds `DE` and the page prints "Germany". The difference is exactly the conversion the system
is asked to perform.

The standard pairs AIDP-2K with **AIDP-Field**, a collected corpus of documents that people reviewed on a
commercially available IDP platform, whose name is withheld, because a generated corpus cannot show how a system
behaves on what real customers send. Those documents are never published. The only figures from them in this
repository are the all-account totals quoted in section 1 of the paper, listed with how each was computed in
[`../analysis/README.md`](../analysis/README.md).

## Regenerating the dataset

From the repository root, with Node.js 24 or later:

```bash
npm ci
npm run keys -- --out <folder>     # answer keys, page texts, manifest.json and contract.json: byte for byte corpus/
npx playwright install chromium    # once, for drawing pages
npm run render -- --out <folder>   # the 2,012 PDFs, about a minute with six browser workers
```

The published PDFs are a release asset, fingerprinted in [`corpus/PDF-SHA256SUMS`](corpus/PDF-SHA256SUMS). Regenerated
PDFs have the same pages and text, and 1,975 of the 2,012 are identical pixel for pixel, but none is byte for byte the
release file, because each carries the date it was drawn. [CORPUS.md](CORPUS.md) has the measured figures.

## Scoring the stored evidence

The raw evidence of the reference run is committed under `results/`, and the answer keys it was scored against under
`corpus/`, so it can be re-scored offline, at no cost. From the repository root:

```bash
npm run rescore
# the same, by hand, from aidp-bench/:
node bench/score-run.mjs   --corpus corpus --tag aidp-v1-main --stability-tag aidp-v1-stability --rules-tag aidp-v1-rules --out results/rescore
node bench/bootstrap.mjs   --board results/aidp-v1-main/scoreboard.json     # 95% ranges
node bench/calibration.mjs --corpus corpus --run results/aidp-v1-main         # calibration error, discrimination, high-tier share
```

The re-score reproduces the reference run's published board, 99.15 over its sixteen measures, and
`npm run rescore:heldout` the held-out check's, 99.00. `npm run rescore:cap` re-scores the capability run from its
evidence in `results/aidp-v1-cap-*/`, the corpus in `corpus-cap/` and the reference run's board, and reproduces the
AIDP Score of 82.90 with its 95% range; it needs no PDF. `npm run thirteen` prints AIDP-2K's thirteen measures in the
score on the reference run (98.97) and on the held-out check (98.77, 95% range 98.30 to 99.13). Change a scoring rule
in `bench/` and run it again to see what the rule moves.

**Checks.** `npm run test:cap` runs the checks of AIDP-CAP's scoring rules, on hand-made cases and on a perfect and a
failed answer for every document of `corpus-cap/`. `node bench/test-scoring.mjs` runs the unit checks of every scoring rule on hand-made cases;
`node bench/test-runner.mjs` drives the runner against a stand-in API to check retries, re-queueing, resumption and the
cache bypass; `node bench/test-generator.mjs` checks the generator's two settings over all 2,000 documents, bank
account numbers with valid check digits (`--valid-accounts`) and due dates that follow the payment terms
(`--due-dates-from-terms`), both off by default so the published seed reproduces AIDP-2K exactly.

## Running the benchmark

The runner collects raw evidence and nothing else; scoring is a separate pass over that evidence, so a scoring
definition can be argued with and re-applied without anyone paying for another run. `bench/run-das.mjs` drives the
reference platform's API; another system needs an adapter, as [ADAPTERS.md](ADAPTERS.md) describes. The PDFs must sit
in the corpus folder (unpack the release asset into `corpus/`).

```bash
cd aidp-bench
export ADMIN_API_TOKEN=...   # or AIDP_ENV_FILE=<a dotenv file holding it>; nothing is read from anywhere else
# every document, both lanes; retried until it succeeds, never dropped
node bench/run-das.mjs --mode main      --api <url> --corpus corpus --out results/<tag>           --platform-sha <sha> --flags <flag file>
# the held-out check: the full lane only, on corpus-heldout/ with the PDFs unpacked into it
node bench/run-das.mjs --mode main --lanes pipeline --api <url> --corpus corpus-heldout --out results/<tag>-heldout --platform-sha <sha> --flags <flag file>
# the pre-declared samples (bench/samples/), written before any run by bench/make-samples.mjs
node bench/run-das.mjs --mode stability --api <url> --corpus corpus --out results/<tag>-stability --platform-sha <sha> --flags <flag file>
node bench/run-das.mjs --mode rules     --api <url> --corpus corpus --out results/<tag>-rules     --platform-sha <sha> --flags <flag file>

node bench/score-run.mjs   --corpus corpus --tag <tag>          # scoreboard.json and report.md
node bench/bootstrap.mjs   --board results/<tag>/scoreboard.json
node bench/calibration.mjs --corpus corpus --run results/<tag>
```

**Nothing is dropped.** A request that fails before an answer arrives is retried with backoff; a lane still failing is
re-queued, round after round; whatever still fails is listed in `run-meta.json` and scored as a total failure in every
measure. A response that arrived is never retried for its content. Runs are resumable: a lane already on disk with
`ok: true` is skipped. `run-meta.json` is written when a run starts, with every document it plans to run, and updated
when it ends.

## What is in this folder

```
bench/
  aidp-score.mjs       the score: measures, layers, the weighting, exact recombination
  rules.mjs            the scoring rules, fixed before the run
  scoring.mjs          raw evidence to per-document units, the safety panel, what sits beside the score
  score-das.mjs        the stage scorer
  base-score.mjs       field verdicts: exact numbers, dates, identifiers, text
  score-understand.mjs Normalisation, Parsing, Decoding, Consistency
  score-run.mjs        the scoring pass: scoreboard.json and report.md
  bootstrap.mjs        95% bootstrap ranges, within document type
  calibration.mjs      calibration error, discrimination, high-tier share
  budgets.mjs          the error budgets
  rule-packs.mjs       written-instruction packs with mechanically checkable outcomes
  layout-check.mjs     the check behind the numbers measure's column-gap rule
  paper-checks.mjs     the figures the white paper quotes that no scoreboard prints
  cell-counts.mjs      the count behind every cell of the paper's results tables, in the form each is printed
  make-heldout.mjs     draws the held-out check's 300 documents from its registered seed
  make-cap.mjs         draws AIDP-CAP from its registered seed, with the generator in corpus-gen/cap/
  run-cap.mjs          the capability run's runner: its lanes and phases
  cap-customer.mjs     the customer's setup and contract for the capability run
  rule-packs-cap.mjs   AIDP-CAP's seven written instructions
  score-cap.mjs        AIDP-CAP's eighteen measures, and the AIDP Score over all thirty-one
  thirteen.mjs         AIDP-2K's thirteen measures in the score, on the reference run and the held-out check
  test-score-cap.mjs   checks of AIDP-CAP's scoring rules
  run-das.mjs          the runner
  make-samples.mjs     writes the pre-declared samples
  samples/             the repeatability, instruction and held-out samples, each fixed before its run
  corpus-profile.mjs   writes CORPUS.md
  corpus-sample.mjs    writes corpus-sample/
  rebuild-manifest.mjs rebuilds a corpus manifest from the files on disk
  post-run/            the diagnostics beside the score, computed after the run from its stored outputs
  test-scoring.mjs     unit checks of the scoring rules
  test-runner.mjs      checks of the runner against a stand-in API
  test-generator.mjs   checks of the generator's settings
corpus/                the answer keys, page texts, manifest, contract and PDF fingerprints of AIDP-2K
corpus-heldout/        the 300 documents of the held-out check, with their keys and PDF fingerprints
corpus-cap/            AIDP-CAP: answer keys, page texts, maps, the customer's lists, PDF fingerprints
corpus-gen/            the generator: answer key first, then the drawn page
corpus-sample/         sixteen documents beside their answer keys
corpus-contract.json   each type's contracted output schema, which Contract is checked against (also corpus/contract.json)
corpus-key-corrections.json  every answer-key value corrected before the run (specification 8.3), counted
corpus-profile.json    the composition of the dataset, as CORPUS.md shows it
results/
  aidp-v1-main/        the reference run, both lanes: raw/ (one file per document per lane), run-meta.json,
                       scoreboard.json, report.md, bootstrap.json, calibration.json, and post-run/: the
                       diagnostics beside the score with the stored fields they read
  aidp-v1-stability/   the repeatability runs: 200 documents, three runs each
  aidp-v1-rules/       the written-instruction runs: 60 documents
  aidp-v1-heldout-main/       the held-out check: 300 newly generated documents, full lane
  aidp-v1-heldout-stability/  its repeatability runs: 60 documents, three runs each
  aidp-cap-pilot/      the capability run's pilot and pre-registration review, on a throwaway seed
  aidp-v1-cap-main/    the capability run's full lane: 960 documents and 30 copies
  aidp-v1-cap-split/   its 200 files sent to the splitting step
  aidp-v1-cap-rules/   its 60 documents under seven written instructions
  aidp-v1-cap-contract/  its 120 documents under the customer's contract
  aidp-v1-cap/         its scoreboard as corrected and as registered, the documents its own setup touched, and the
                       two machines' readings compared
studies/
  public-benchmark-audit/  what the answer keys of ten public benchmarks hold, property by property
  difficulty/              whether a document's difficulty can be read from its image, and what a frontier model
                           finds when asked directly (model-check/)
```

## Where this lives

`github.com/Docupath/aidp-benchmark`. The benchmark is the `aidp-bench/` folder of that repository, beside the
specification it implements.

## Licence

The software is MIT. The specification, the dataset, the results and the documentation are CC BY 4.0. See
[`../LICENSE`](../LICENSE).

## A note on who wrote this

AIDP-Bench was written by Docupath, which sells a document processing platform and therefore has an obvious interest
in how accuracy is measured. Four things are offered in mitigation, and readers should weigh them rather than take
them on trust. The dataset is reproducible from a published seed, so its documents cannot have been chosen after the
results were seen. The scoring rules and samples were committed before the runs they govern, and the specification
lists every decision made after the run, none of which changes a score. The held-out documents were drawn from a
public random value that did not exist when the release was frozen. And every extraction the platform returned is
published, document by document, so any figure can be recomputed or disputed, including by someone who edits the
scorer first.
