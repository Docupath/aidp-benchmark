# AIDP-Bench methodology

Everything a reader needs to reproduce, dispute or re-score a result. Written to the conformance list
in section 12 of the specification. Where this page and the code differ, the code in `bench/` is what
ran, and the difference is a defect to report.

---

## 1. Standard

Agentic IDP Accuracy Standard (AIDP) v1.0, [`../spec/aidp-v1.0.md`](../spec/aidp-v1.0.md). The scoring
rules and the samples were committed before the run they govern, and so was every amendment, including the
one withdrawing a weighting that would have used production counts (section 5 of this page, and the spec's
Annex B). The decisions made after the run, none of which changes a score, are listed in the same annex under
"Decided after the run".

## 2. Corpus

**Construction:** generated, answer key first. The generator builds the answer key before anything is rendered, in
the published output contract, with field names read from `corpus-gen/schema-snapshot.json` rather than copied by
hand. The renderer then draws the document from that key, and every value the page prints is held by the key in the
field the output contract defines for it (specification, section 8.3). So a value the system returns in a field the
key leaves empty is an **invention**, and a key value the system does not return is a **miss**, by construction,
with one exception recorded in `FINDINGS.md`, B3. The printed values the contract has no field for are listed in
Annex B of the specification.

**Size:** 2,000 documents, 200 of each of ten types: invoice, purchase order, credit note, receipt,
quote, freight invoice, consignment order, consignment invoice, bank statement and general contract.
Six are **field-key** types, whose keys list every field value; four (receipt, quote, bank statement,
general contract) are **fact-key** types, whose schemas are too open to enumerate, so their keys list
facts that must appear somewhere in the output.

**Locales:** 12. Locale governs number format (1.234,56 against 1,234.56 against 1'234.56), date
format, tax regime and label language.

**Rendering:** HTML and CSS to PDF through headless Chromium, with real, scannable barcodes and
deterministic degradation (skew, creases, stains, stamps, fax banding, low contrast). The 302 documents at the
heaviest noise level are drawn as a picture of the page, so they are image-only PDFs with no text layer. The answer
keys do not declare this; the difficulty study found it (`studies/difficulty/README.md`, section 4.5).

**Reproducibility:** deterministic from the seed `docupath-corpus-v1`. The keys a run was scored
against are published with its evidence, so a regenerated corpus can be compared with them: the answer keys, page
texts, manifest and contract regenerate byte for byte, and the PDFs page for page and in their text, 1,975
of the 2,012 pixel for pixel (`CORPUS.md`).

**The collected companion.** AIDP-Field: 1,490 documents that people reviewed on a commercially available IDP
platform, whose name is withheld, with every correction recorded, from one dated snapshot (28 August 2026). The
documents cannot be published. The only figures from them in this repository are the all-account totals quoted in
section 1 of the paper, listed in `analysis/README.md` with a plain description of how each was computed.

## 3. How values are compared

Applied identically to every value of every field-key document (`bench/base-score.mjs`).

| The key holds | The returned value passes when |
|---|---|
| a number, in a numeric field (quantity, rate, amount) | it parses, locale-aware, to exactly the key's number: same sign, same magnitude. Thousands separators of every convention, currency symbols and codes, a trailing minus and an accounting negative in parentheses are understood. Nothing is rounded, and no comparison of digits alone applies |
| a date | it is the same calendar date, in any of DD/MM/YYYY, DD.MM.YYYY, DD-MM-YYYY, YYYY-MM-DD and the Japanese year-month-day form |
| an identifier written in digits (a field named with number, no., ID, code, reference, account, postal, VAT and similar words) | it matches as text, including on letters and digits alone, because 4006-381-333931 and 4006381333931 name the same article |
| text | it matches after case, whitespace and trailing punctuation are smoothed away, or on letters and digits alone |

A value whose key holds letters of any script is text, even when it contains digits.

A value matching only after this comparison is a pass for Capture: a system that returns `1,234.56`
where the key holds `1234.56` read the document correctly. Whether it then delivered the value in the
contracted format is a separate question, answered once, by Contract.

**Exclusions, stated in full.** The `Barcodes` section is scored under Barcodes, not as fields.
`Payment Details Description` is a free-text catch-all legitimately filled from surrounding content,
so neither its presence nor its absence carries signal. An answer-key section that is entirely empty
and that the system also left empty is skipped rather than counted as correct. A value returned for a
field the key leaves empty is an invention whether or not the system labels it as derived ("labelled or
not, counted once"); a derivation is still audited under Computation, beside the score.

## 4. Lanes

Each document is processed twice.

**Full lane** (`pipeline` in the evidence). The corpus PDF is served over local HTTP and submitted to
the platform's API exactly as a customer document would be: classification with reading, then
extraction with the classification's handoff. This is the system as a customer experiences it, and the
score is computed on it.

**Text lane** (`prompt` in the evidence). The corpus's own correct text for the same document is
submitted directly to extraction, with the correct document type. This removes reading from the
measurement. The difference between the lanes is the cost of reading the page, published as a
diagnostic beside the score.

## 5. The measures

The thirty-one score-bearing measures, their units and denominators, are defined in section 5 of the
specification. AIDP-2K's are computed in `bench/scoring.mjs` (per document) and `bench/aidp-score.mjs` (combined),
and AIDP-CAP's eighteen in `bench/score-cap.mjs`, which combines them with AIDP-2K's thirteen into the AIDP Score.
Points a reader is most likely to ask about:

- **Read** compares the text the system read from the page with the corpus's correct text, as word
  and numeric token recall per document, averaged over every document of all ten types. Character
  error rate is computed as a diagnostic only, because it penalises correct content emitted in a
  different reading order.
- **Line items** are matched one to one, first on an identity key built from the row's identifier and
  description, then, for rows that key cannot place, on a numeric fingerprint of the absolute values of
  its numbers, so a row whose description was reformatted is still the same row. The field measures (Completeness,
  Fidelity, Restraint) pair rows on an identity key and otherwise by position, so a row whose identity is missing or
  read differently is compared with the row at its position (FINDINGS.md, B8).
- **Normalisation** scores understanding: a date or number passes when it means the key's value,
  whatever its punctuation. A swapped day and month, or the right digits as the wrong number through a
  separator confusion, fails. Its denominator is the values whose content the system recovered; plain
  misreads belong to Fidelity.
- **Fidelity** leaves out convention-only errors, which are Normalisation's: a date whose day, month and
  year are the key's in another order, and a number with the key's sign and significant digits (at
  least two) but another value. A flipped sign is Fidelity's, not Normalisation's.
- **Contract** is one measure pooled over every schema check and every format check (dates as
  DD/MM/YYYY, numbers as plain numbers, on values the system returned). The schema checks are made
  against the contracted output schema of the type, `contract.json` beside the answer keys, never the
  answer key's structure: every contracted section present under the name and in the shape the
  response gives it, every contracted field emitted unless the key holds a value there, and no section
  the published format does not allow. A document with no checks does not count.
- **Repeatability** is field stability over three submissions of each document of the declared sample,
  with the extraction cache bypassed; the reference run reused its stored page reading after the first submission,
  so the measure mostly excludes reading variation.
- **Traceability** is the share of delivered values whose evidence record names identifiable evidence.

Every measure except Read is computed per field-key document type and then combined with each of the
six types counting equally, exactly as each does in the corpus (200 documents of every type). Nothing
outside the published corpus enters the score, so anyone holding the corpus and the raw evidence
recomputes it to the last decimal. No production data is used: a weighting by one vendor's production
traffic could be checked by no one else and would move with that traffic. The per-type values of every
measure are published, so a reader can recombine them for their own mix of documents.

**One event, one count.** A date delivered as `22.02.2026` where the key holds `22/02/2026` was read
correctly (Fidelity passes), understood correctly (Normalisation passes) and delivered in the wrong
format: Contract, and only Contract, charges it.

## 6. Beside the score

- **The safety panel** (`bench/scoring.mjs`, `safetyPanel`), required beside the score of any result that claims
  documents can proceed without a person: on the field-key documents of the full
  lane, under the critical error budget (`bench/budgets.mjs`), the escaped critical errors, the catch
  rate and the false-alarm rate, by document type. **Caught means routed to a person**: the platform's
  own document decision (`field_report.document.auto_accept` in the extraction response; not accepted
  means routed). Evidence collected before that decision was recorded is read from the per-field
  decisions it holds, and the panel publishes which signal it used. Evidence that carries confidence but no decision at
  all, such as this edition's published outputs, has no safety panel.
- **Calibration** (`bench/calibration.mjs`): expected calibration error over ten equal-width bins,
  discrimination as the area under the ROC curve, and the share of values in the high confidence tier,
  all on the same set: every returned header value of the field-key documents in the full lane that
  carries a confidence and that the key can judge.
- **Barcode symbol recall**, pooled over payloads, and **fact recall** for the four fact-key types.
- **Written instructions**: three rule packs whose correct outcome can be computed from the answer key,
  on the declared sample.

| Pack | Instruction | Why this one |
|---|---|---|
| `iso-dates` | Write every date in the format YYYY-MM-DD | Touches many fields; tests consistency rather than first match |
| `upper-seller-name` | Write the Seller's name in capital letters | Has an obvious neighbour that must not move |
| `prefix-document-number` | Put the prefix REF- in front of the document number | Identifiers are the fields most likely to be protected verbatim, so this tests whether the customer really is the highest authority |

**Containment** compares the instructed extraction with the same document's text-lane extraction from
the main run, and counts every field that moved and was not a declared target. Two paths that drift on
essentially every document, the barcode section and a free-text payment description, are left out,
for the same reasons they are left out of field verdicts. What remains still includes some ordinary
run-to-run drift, so containment is an upper bound on damage.

## 7. Failures, retries and samples

**Nothing is dropped.** A request that fails before an answer arrives (no connection, a timeout, HTTP
408, 429 or 5xx) is retried with exponential backoff. A lane still failing is written with `ok: false`
and re-queued after the queue drains, round after round with a growing pause. Whatever still fails
after the last round is listed in `run-meta.json` as a permanent failure and scored as a total failure
in every measure: it passes nothing and is charged every check a complete answer would have produced.
A misclassified document is scored on every measure against its own answer key.

**A transport failure is retried; an answer never is.** A response that arrived is scored exactly as
it arrived, once. No output is corrected after the run.

**Samples fixed before the run.** `bench/samples/stability-v1.json` (20 documents of each type, seed
`aidp-v1.0-stability`) and `bench/samples/rules-v1.json` (10 of each field-key type, seed
`aidp-v1.0-rules`), written by `bench/make-samples.mjs`, which regenerates them byte for byte
(`--check`). The repeatability runs bypass the extraction cache with `no_cache: true` on
`/v2/extractions`, which the platform defines as "bypass the determinism cache and force a fresh
extraction"; each response's `cache_hit` is kept in the evidence so the bypass can be checked.

**Run record.** `run-meta.json` is written when a run starts, with the platform's API base, its git
commit, the configuration flag file it ran with (path and SHA-256), the corpus seed and manifest hash,
the retry policy and every document planned; it is updated when the run ends with the counts, the
timings and every permanent failure.

## 8. Statistics

`bench/bootstrap.mjs`: 2,000 resamples, seed `aidp-v1.0-bootstrap`, documents resampled with
replacement within their document type, the repeatability documents likewise from their own sample.
Each resample is scored by the same functions as the score. The 95 per cent range is the 2.5th to
97.5th percentile, for the score, every layer and every measure.

## 9. Reproducing a result

```bash
cd aidp-bench
node bench/run-das.mjs     --mode main      --corpus <corpus> --out results/<tag>           --platform-sha <sha> --flags <file>
node bench/run-das.mjs     --mode stability --corpus <corpus> --out results/<tag>-stability --platform-sha <sha> --flags <file>
node bench/run-das.mjs     --mode rules     --corpus <corpus> --out results/<tag>-rules     --platform-sha <sha> --flags <file>
node bench/score-run.mjs   --corpus <corpus> --tag <tag>
node bench/bootstrap.mjs   --board results/<tag>/scoreboard.json
node bench/calibration.mjs --corpus <corpus> --run results/<tag>
```

Raw per-document evidence is published under `results/<tag>/raw/`. Every figure is recomputable from
it, including by someone who disagrees with a scoring choice and edits the scorer.

## 10. Threats to validity

Stated plainly, because a benchmark that does not list these is asking to be taken on trust.

1. **The corpus is synthetic.** Generated documents come from a finite set of templates and cannot
   contain the failure modes nobody thought to generate. The collected corpus is the answer to this,
   and results cite both.
2. **The corpus renders into one published output contract.** A system that returns a different layout
   should be compared on fact recall, or through an adapter that maps its layout to the contract, never on
   field verdicts against a layout it never saw.
3. **Planted defects are few** beside the clean controls, so catch rates on them carry wide ranges;
   the counts are published in `CORPUS.md`.
4. **Fact recall cannot measure invention.** For the four fact-key types only recall is measured.
5. **Row matching is a heuristic.** Two rows that share both identity and numbers can be confused.
6. **AIDP-2K's documents are public, and the reference platform processed them while the benchmark was being
   developed.** The held-out check (`corpus-heldout/`) tests the same release on documents generated after it was
   frozen; because those documents share the generator's templates, it tests new documents rather than new kinds of
   document.
7. **One machine, one time window.** Model providers change behaviour. Results carry a date and the
   platform's commit, and should not be assumed to hold later.
