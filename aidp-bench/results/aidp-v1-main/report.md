# AIDP-Bench scoreboard: aidp-v1-main

Agentic IDP Accuracy Standard (AIDP) v1.0. Corpus seed `docupath-corpus-v1`, 2,000 of 2,000 documents scored (population: plan, 2,000 planned).

## The AIDP-2K board

**99.15**

Equal-weight geometric mean of the 16 AIDP-2K measures this board counts, each of the six field-key document types counting equally, as each does in the corpus. Layer scores recombine to the board's figure exactly, weighted by their measure counts. The AIDP Score keeps thirteen of these measures, reports Decoding, Contract and Traceability beside the score, and adds AIDP-CAP's eighteen (`bench/score-cap.mjs`).

### Layers

- 1. Read (2 measures): 98.16
- 2. Capture (6 measures): 98.61
- 3. Understand (5 measures): 99.94
- 4. Reason (1 measure): 99.97
- 5. Trust (2 measures): 99.43

### Measures

- Printed text, words (documents): 98.59%
- Printed text, numbers (documents): 97.74%
- Identification, document type (documents): 99.83%
- Line items, recall (answer-key rows): 98.65%
- Line items, precision (returned rows): 98.73%
- Completeness (answer-key values): 98.76%
- Fidelity (captured values): 97.13%
- Restraint, non-invention (returned values): 98.57%
- Normalisation, dates (dates recovered): 99.95%
- Normalisation, numbers (numbers recovered): 99.99%
- Normalisation, country and currency codes (country and currency codes): 99.83%
- Decoding, payload syntax (delivered values): 99.997%
- Consistency, arithmetic (arithmetic checks): 99.92%
- Contract (schema and format checks): 99.97%
- Repeatability, field stability (documents, three runs each): 98.92%
- Traceability, provenance (delivered values): 99.94%

## Beside the score

- Barcode symbol recall, pooled over payloads: 86.53% (822 of 950)
- Fact recall, the four fact-key types: 94.86% (3,415 of 3,600)
  - bank-statement: 99.00% (990 of 1,000)
  - general-contract: 97.00% (388 of 400)
  - quote: 98.58% (1,183 of 1,200)
  - receipt: 85.40% (854 of 1,000)
- Identification over all ten types: 99.90% (1,998 of 2,000)
- Parsing check, fields not swallowed into a neighbouring field (diagnostic, not scored): 99.98%; documents with at least one recorded check or derivation (diagnostic, not scored): 72.58%
- Instructions, iso-dates: 60 documents, adherence no failure observed, zero collateral on 42, failed 0
- Instructions, upper-seller-name: 60 documents, adherence no failure observed, zero collateral on 39, failed 0
- Instructions, prefix-document-number: 40 documents, adherence 95.00%, zero collateral on 26, failed 0
- Repeatability: 200 documents, 3 runs each with the extraction cache bypassed (each submission records in runs[].classification.cache_hit whether a stored page reading was reused), 113 byte identical, 0 with a failed run

## Lanes

- full lane (the rendered PDF): 2,000 documents, 0 failed
- text lane (the corpus text): 2,000 documents, 0 failed

Measures, full lane against text lane:

- Line items, recall: 98.65% against 99.97%
- Line items, precision: 98.73% against 99.95%
- Completeness: 98.76% against 99.67%
- Fidelity: 97.13% against 99.99%
- Restraint, non-invention: 98.57% against 98.67%
- Normalisation, dates: 99.95% against 99.96%
- Normalisation, numbers: 99.99% against 99.996%
- Normalisation, country and currency codes: 99.83% against 99.76%
- Decoding, payload syntax: 99.997% against no failure observed
- Consistency, arithmetic: 99.92% against 99.99%
- Contract: 99.97% against 99.98%
- Traceability, provenance: 99.94% against 99.99%
