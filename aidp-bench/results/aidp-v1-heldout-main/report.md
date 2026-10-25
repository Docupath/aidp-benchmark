# AIDP-Bench scoreboard: aidp-v1-heldout-main

Agentic IDP Accuracy Standard (AIDP) v1.0. Corpus seed `aidp-heldout-v1:a08a1442472d155862ddfcb7b2af089b3c4d5c78d2d82e5f260a37efbf1b273f`, 300 of 300 documents scored (population: plan, 300 planned).

## The AIDP Score

**99.00**

Equal-weight geometric mean of 16 score-bearing measures, each of the six field-key document types counting equally, as each does in the corpus. Layer scores recombine to the score exactly, weighted by their measure counts.

### Layers

- 1. Read (2 measures): 97.89
- 2. Capture (6 measures): 98.31
- 3. Understand (5 measures): 99.90
- 4. Reason (1 measure): 99.998
- 5. Trust (2 measures): 99.45

### Measures

- Printed text, words (documents): 98.39%
- Printed text, numbers (documents): 97.39%
- Identification, document type (documents): no failure observed
- Line items, recall (answer-key rows): 98.58%
- Line items, precision (returned rows): 98.79%
- Completeness (answer-key values): 98.80%
- Fidelity (captured values): 95.27%
- Restraint, non-invention (returned values): 98.48%
- Normalisation, dates (dates recovered): no failure observed
- Normalisation, numbers (numbers recovered): no failure observed
- Normalisation, country and currency codes (country and currency codes): no failure observed
- Decoding, payload syntax (delivered values): 99.998%
- Consistency, arithmetic (arithmetic checks): 99.49%
- Contract (schema and format checks): 99.998%
- Repeatability, field stability (documents, three runs each): 98.98%
- Traceability, provenance (delivered values): 99.92%

## Beside the score

- Barcode symbol recall, pooled over payloads: 88.61% (140 of 158)
- Fact recall, the four fact-key types: 94.63% (511 of 540)
  - bank-statement: 97.33% (146 of 150)
  - general-contract: 98.33% (59 of 60)
  - quote: 98.89% (178 of 180)
  - receipt: 85.33% (128 of 150)
- Identification over all ten types: no failure observed (300 of 300)
- Parsing check, fields not swallowed into a neighbouring field (diagnostic, not scored): 99.997%; documents with at least one recorded check or derivation (diagnostic, not scored): 74.44%
- Repeatability: 60 documents, 3 runs each with the extraction cache bypassed (each submission records in runs[].classification.cache_hit whether a stored page reading was reused), 39 byte identical, 0 with a failed run

## Lanes

- full lane (the rendered PDF): 300 documents, 0 failed
- text lane (the corpus text): not run, as the run's metadata records
