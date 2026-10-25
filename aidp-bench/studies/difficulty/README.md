# Can a document's difficulty be read from its image? The study behind section 6 of the white paper

Run on 22 October 2026 (all times IST). Everything here can be re-run from the saved code and data.

## 1. Why this exists

Section 6 of the white paper "Precision Beyond the Page" asks whether a document's difficulty can be
worked out from what can be observed once the document exists (its pixels, its page count, its text),
instead of being declared by the corpus generator when it makes the document. This folder holds that
study: an "estimator" built from six measurements under weights fixed in advance, run on all 2,000
AIDP-2K documents and on samples of nine public corpora, with every input, setting and output saved.

## 2. The questions

- Does an estimate made from the page follow the noise grade the generator declared?
- Does its skew measurement read the rotation the generator applied, on the pages that carry it?
- Do documents carrying planted traps look different from matched clean documents?
- How does the estimate behave on public corpora, and can its scores be compared across them?

## 3. What was done, in plain words

### 3.1 The documents

- AIDP-2K, all 2,000 documents (10 document types, 200 each), read from
  the generated corpus (seed docupath-corpus-v1) and never modified. Its manifest records, for
  every document, the noise grade the generator applied (none, light, medium or heavy) and whether a
  trap was planted. The generator's code (aidp-bench/corpus-gen/render.mjs) shows what each grade does
  to the page: it tilts the whole page clockwise by 0.4 degrees (light), 1.1 (medium) or 2.2 (heavy),
  adds a crease and a stain from medium up, a fax band and a contrast filter at heavy, and a "PAID"
  style stamp on about 30% of noisy documents. So for every AIDP document the true rotation is known.
- Planted traps in AIDP (each one is a deliberate defect that a good system should catch):
  - mismatch: the printed total disagrees with its own line items (36 documents);
  - missingTotals: the totals block is left off the page entirely (33);
  - stickerMismatch: a barcode sticker's lot number contradicts the printed lot number (22).
  Two structural extras were tested the same way: coverPage, a cover sheet before the document (130),
  and bundle, the attachment condition (41 documents drawn for it, of which the 12 with 3 to 8
  lines carry an attached PDF breaking two lines down into their parts).
- Public corpora: up to 50 documents each from 9 of the paper's 10 public corpora (450 documents in
  all): SROIE, CORD, FUNSD, VRDU, DocVQA, OmniDocBench, Kleister NDA, Kleister Charity and
  RD-TableBench. DocILE could not be sampled (see section 6). No full dataset was downloaded; the exact
  documents and their sources are listed in public-samples.csv.

### 3.2 The six measurements

For each document the estimator measures six things. PDFs are turned into images at 100 dots per inch
(greyscale, first 3 pages at most). Images larger than about one megapixel are shrunk to that size;
smaller ones are never enlarged.

- Blur: the "variance of the Laplacian". The Laplacian is a filter that reacts to sudden changes from
  light to dark. Crisp letter edges produce large, varied reactions, so a high variance means sharp and
  a low variance means soft. (Known weakness: a page with little ink also scores low, because there
  are few edges at all.)
- Contrast: how far the darkest ink is from the paper, measured as the spread between the 99th and the
  0.5th percentile of grey levels, divided by 255. 1.0 is pure black on pure white.
- Skew: how far the text lines are tilted, in degrees, positive meaning clockwise (the same sign the
  generator uses). Method: the page's ink is projected onto a tilted axis for every candidate angle
  from -10 to +10 degrees; at the right angle, the pixels of each text line pile up into one sharp
  row, so the angle with the sharpest pile-up wins (0.25 degree search, then 0.02 degree refinement).
  The page with the most ink among the first three is used.
- Page count: the number of pages (for AIDP, including any attachment's pages).
- Token density: words per page, counted from each corpus's OWN text (the AIDP answer-key text, or the
  OCR or annotation text the public corpus ships). Each Chinese or Japanese character counts as one
  token, because those scripts do not put spaces between words.
- Script class: the writing system of the text. The commonest non-Latin script wins if it makes up at
  least 15% of the letters; otherwise the document counts as Latin.

### 3.3 Turning six measurements into one score, with everything fixed in advance

Each measurement becomes a "difficulty component" between 0 (no difficulty from this source) and 1
(as hard as this source can make it), using these fixed rules:

- Blur: Laplacian variance of 1,000 or more gives 0, 100 or less gives 1 (100 is the conventional
  blur threshold), on a log scale in between.
- Contrast: a spread of 0.80 or more gives 0, 0.30 or less gives 1, straight line in between.
- Skew: the tilt's size divided by 5 degrees, capped at 1.
- Page count: 1 page gives 0, 2 pages 0.2, 4 pages 0.4, 8 pages 0.6, 16 pages 0.8, 32 or more 1.
- Token density: 50 tokens per page or fewer gives 0, 1,000 or more gives 1, log scale in between.
- Script: Latin 0; Greek or Cyrillic 0.5; Chinese/Japanese/Korean, Arabic, Hebrew, Indic, Thai and
  other scripts 1.

The components are then averaged with fixed weights. Two estimators were declared before any result
was seen, and both are reported:

- Primary (the six-part estimator the paper describes): equal weights, one sixth each for blur,
  contrast, skew, page count, token density and script.
- Visual (a declared secondary): one third each for blur, contrast and skew only.

If a component cannot be observed for a document, it drops out and the remaining weights are scaled up
to sum to one.

These rules and weights live in the FROZEN block of estimator.py. The block was written and hashed at
2026-10-22 01:42:18 IST, before a single feature had been computed on any document; the hash
(4d3c1851...f7bd2c, in frozen-config.json) is checked by analyze.py, which refuses to run if the block
changes. Nothing in it was tuned afterwards. The analysis plan (2,000 bootstrap resamples, 2,000
permutations, 10,000 draws of 16 documents, matching rules, the "near-constant" and "single component"
thresholds) is in the same frozen block.

### 3.4 The tests

- Tracking the noise grade: the Spearman rank correlation between the estimate and the declared grade
  (none 0, light 1, medium 2, heavy 3). In plain words: sort the documents by the estimate and,
  separately, by the declared grade; the rank correlation says how well the two orderings agree (+1
  identical, 0 unrelated). The 95% interval comes from a bootstrap: the 2,000 documents are re-drawn
  with replacement 2,000 times and the correlation recomputed; the middle 95% of those values is the
  interval, which shows how much the number could move by chance.
- Small samples: 10,000 random draws of 16 documents show how much a correlation measured on 16
  documents can vary.
- Skew recovery: the measured tilt compared with the tilt the generator applied.
- Traps against matched controls: each trap document is compared with clean documents of the same
  type, the same noise grade and the same size class (so a difference cannot come from those). Only
  trap documents carrying no other generator dimension are used. The statistic is the AUROC: pick a
  trap document and a matched clean one at random; AUROC is the chance the trap document has the
  higher value. 0.5 means the measurement cannot tell them apart; 1.0 or 0.0 means it always can. The
  p-value comes from shuffling the trap/clean labels 2,000 times inside each matched group, and is then
  adjusted for testing nine measurements at once (Holm adjustment). The declared verdict rule:
  "indistinguishable" means the 95% interval contains 0.5 AND the adjusted p-value is at least 0.05.
- Public corpora: the estimate's middle value (median) and spread per corpus, which components actually
  vary, and the declared collapse checks: "near-constant" if the estimate's standard deviation is below
  0.02 on the 0 to 1 scale, "single component" if one component alone explains at least 90% of the
  estimate's variation.

## 4. Results

### 4.1 Does the estimate follow the declared noise grade? (AIDP-2K, n = 2,000)

- Primary six-part estimate: rank correlation 0.404, 95% interval 0.365 to 0.444. Average estimate by
  grade: none 0.120, light 0.134, medium 0.158, heavy 0.212. Per document type it ranges from 0.270
  (quote) to 0.766 (general contract), 200 documents each.
- Visual estimate: 0.747, 95% interval 0.717 to 0.775. Average by grade: none 0.037, light 0.069,
  medium 0.117, heavy 0.213. Per type from 0.561 (quote) to 0.936 (general contract).
- Each component on its own (diagnostic, nothing fitted):
  - skew 0.967 (0.962 to 0.970);
  - contrast 0.261 (0.218 to 0.304), which reflects only the heavy grade's contrast filter (median
    spread 0.80 none, 0.78 light, 0.78 medium, 0.72 heavy);
  - blur 0.022 (-0.026 to 0.070): the generator never blurs, so there is nothing to find;
  - page count -0.005, token density 0.016, script 0.019, all with intervals spanning zero: these are
    unrelated to noise by construction, so in the six-part estimate they add variation that has
    nothing to do with the grade and pull the correlation down from the skew component's 0.97 to 0.40.
- What a 16-document sample can show (10,000 random draws of 16):
  - primary: median 0.408, and 95% of draws fall between -0.101 and 0.784. Drawing 4 per grade instead:
    median 0.473, range -0.024 to 0.825;
  - visual: median 0.764, 95% of draws between 0.320 and 0.956. Four per grade: median 0.825, range
    0.388 to 0.973.

In plain words: with only 16 documents a rank correlation can land almost anywhere, so a figure from so
few documents cannot tell a weak estimator from a strong one. Measured on all 2,000 documents, the six-part
estimator tracks the grade at 0.40 and the visual-only one at 0.75; and almost all of that tracking
comes from one component, skew, because AIDP's noise grade is, mechanically, mostly a page rotation.

### 4.2 Does the skew measurement read the generator's rotation? (n = 2,000, skew measured on all)

- Heavy (2.2 degrees applied, n = 302): median reading 2.21 degrees (95% interval 2.19 to 2.21);
  average error 0.037 degrees; 99.7% of documents within 0.1 degrees; the direction (clockwise) right
  on all 302.
- Medium (1.1, n = 517): median 1.10; average error 0.038; 99.6% within 0.1 degrees.
- Light (0.4, n = 694): median 0.40; average error 0.033; 99.7% within 0.1 degrees.
- None (0, n = 487): median -0.04 (a constant 0.04 degree offset of the method, also seen on synthetic
  test pages); every document within 0.1 degrees.
- Overall: correlation between applied and measured tilt 0.948, slope 1.015 (1.0 would be perfect),
  average error 0.037 degrees. Assigning each document the grade whose angle is nearest its measured
  tilt gets 99.8% right; heavy pages are found with recall 100% (302 of 302) and precision 98.7% (4
  false heavy calls).
- The few misses (5 of 2,000, off by more than 0.25 degrees) are pages where a barcode sticker, which
  the generator tilts by up to 8 degrees, outweighed the text lines; four of the five also had a cover
  sheet.

### 4.3 Do trapped documents look different from matched clean ones? (AIDP-2K)

Nine measurements were compared each time: blur, contrast, tilt size, signed tilt, page count, tokens
per page, script, and both estimates.

- Arithmetic contradiction (mismatch; 29 trap documents against 215 matched clean ones, in 16 matched
  groups): indistinguishable on all nine. Every AUROC lies between 0.44 and 0.55 and every adjusted
  p-value is 1.0. Example: the six-part estimate, AUROC 0.517 (0.426 to 0.603).
- Sticker contradicting the print (stickerMismatch; 22 against 120, 8 groups): indistinguishable on 8
  of 9. Page count crossed the interval rule (AUROC 0.583, interval 0.534 to 0.627) but not the
  adjusted test (p = 0.44). The cause is a chance imbalance, not the trap: these 22 documents happen to
  carry more line items than their matched controls (42.2 against 35.1 on average), and the item count
  is drawn independently of the trap. A sticker's printed payload cannot add a page.
- Omitted totals (missingTotals; 30 against 201, 12 groups): NOT indistinguishable. Leaving the totals
  block off the page leaves a footprint: fewer tokens per page (172 against 188; AUROC 0.340, 0.243 to
  0.439), less dark ink and fewer sharp edges (Laplacian variance AUROC 0.323, 0.237 to 0.404, adjusted
  p = 0.036; contrast AUROC 0.354, 0.269 to 0.446). Note the "blur" signal here is really an
  amount-of-ink signal, the known weakness of the Laplacian measure. The combined six-part estimate
  still does not separate them (AUROC 0.510, 0.408 to 0.611), because the effects point in different
  directions and cancel. The signal is weak and only visible across a group: it says "this page has a
  little less on it", which a short document also says, and it says nothing about whether the missing
  value can be worked out from the rest of the page.
- Cover sheet (coverPage; 120 against 1,391, 68 groups): plainly visible, as it should be. Page count
  AUROC 0.902, tokens per page 0.065, blur 0.147, contrast 0.250, six-part estimate 0.708. This is the
  positive control: it shows the test is able to detect a real difference when there is one.
- Bundle with attachment (bundle; 29 against 293): visible through the page count (AUROC 0.665,
  0.601 to 0.727, adjusted p = 0.0045), because the attachment's pages are counted.
- Any trap against clean (any of the three answer-key traps, no cover sheet or bundle; 81 against 443):
  the six-part estimate cannot tell them apart (AUROC 0.512, 0.451 to 0.573). Blur, contrast and
  density lean the omitted-totals way (AUROCs 0.43 to 0.44, intervals ending just below 0.5, adjusted p
  0.42 to 0.44) and the visual estimate sits at 0.575 (0.514 to 0.633, adjusted p 0.31), both driven by the
  omitted-totals documents inside the group.

### 4.4 Public corpora (50 documents each; AIDP-2K shown for reference)

The middle value (median) of the six-part estimate, easiest first, with 95% intervals:

- RD-TableBench 0.054 (0.038 to 0.086)
- FUNSD 0.076 (0.056 to 0.087)
- DocVQA 0.080 (0.063 to 0.109)
- SROIE 0.085 (0.069 to 0.102)
- AIDP-2K 0.119 (0.113 to 0.126), n = 2,000
- VRDU 0.153 (0.145 to 0.165)
- OmniDocBench 0.166 (0.154 to 0.277)
- CORD 0.171 (0.135 to 0.206)
- Kleister NDA 0.206 (0.196 to 0.217)
- Kleister Charity 0.234 (0.220 to 0.251)

The visual-only estimate, easiest first:

- Kleister NDA 0.0013 (0.0013 to 0.0013)
- RD-TableBench 0.0013 (0.0013 to 0.0027)
- VRDU 0.0027 (0.0027 to 0.0093)
- OmniDocBench 0.0059 (0.0027 to 0.0109)
- Kleister Charity 0.0077 (0.0027 to 0.030)
- DocVQA 0.0080 (0.0027 to 0.0153)
- FUNSD 0.0080 (0.0040 to 0.0193)
- SROIE 0.066 (0.024 to 0.096)
- AIDP-2K 0.072 (0.070 to 0.073)
- CORD 0.341 (0.263 to 0.413)

Two different pictures. The six-part estimator puts the table crops easiest but puts the born-digital
Kleister contracts and reports HARDEST, because they are long (median 5.5 and 16 pages) and dense, while
the visual estimator puts born-digital Kleister NDA and the table crops easiest and the photographed
CORD receipts by far hardest.

Which part drives the estimate differs from corpus to corpus (share of the six-part estimate's variation
explained by its strongest single component): RD-TableBench script 57%, FUNSD token density 86%, DocVQA
token density 51%, SROIE blur 52%, AIDP-2K page count 37%, VRDU page count 74%, OmniDocBench script 72%,
CORD blur 70%, Kleister NDA page count 78%, Kleister Charity contrast 56%. The same score therefore means
different things in different corpora.

Collapse checks (declared thresholds):

- Six-part estimate: no corpus meets either threshold. The nearest are FUNSD (one component, token
  density, explains 86% against the 90% threshold) and Kleister NDA (spread 0.029 against the 0.02
  threshold; only page count and density vary).
- Visual estimate: Kleister NDA degenerates to a near-constant estimate (spread 0.0007; all 50
  documents at the floor), and FUNSD to a single component (blur and contrast are constant, so tilt
  explains 100% of the variation). In six other corpora more than half of the documents sit at the
  floor (estimate 0.01 or less): RD-TableBench 76%, VRDU 64%, OmniDocBench 60%, DocVQA 56%, FUNSD
  54%, Kleister Charity 54%.

Script detection: of the 23 OmniDocBench pages its own annotation labels Simplified Chinese, 20 were
classed Chinese/Japanese/Korean (2 Latin, 1 with no text), both mixed Chinese/English pages were classed
CJK, and none of the 25 English pages was. The estimator never saw those labels. In AIDP, 85 of 123
Japanese-locale and 116 of 142 Arabic-locale documents were classed Japanese or Arabic; the rest have
under 15% non-Latin letters (1.8% to 14.9%), being long item tables of English product names under a
localized header.

### 4.5 A side finding: heavy-grade pages have no text layer

Every heavy-grade AIDP PDF (302 of 302) is image-only, with no text layer, while all 1,698 other
documents keep their text layer. The heavy grade's CSS contrast filter made the browser that printed the
PDFs turn each page into a 300 dpi picture. So "heavy" differs from the other grades in a second,
undeclared way: a system under test must run OCR on heavy documents and can read the text directly on
the others. Any comparison of accuracy by noise grade mixes the two effects. (This observable was
recorded but is NOT part of the estimator.)

## 5. What the study shows

- On all 2,000 AIDP-2K documents the six-part estimator follows the declared noise grade at a rank
  correlation of 0.404 (0.365 to 0.444) and the visual-only one at 0.747 (0.717 to 0.775). Almost all of
  that tracking comes from the skew component (0.967 on its own), because the generator's noise grade is
  mostly a rotation.
- The skew component reads the heavy-noise rotation: median 2.21 degrees (2.19 to 2.21) on the 302 heavy
  documents, all in the right direction, heavy recall 100% and precision 98.7%.
- The estimate finds OmniDocBench's Chinese pages without being told (20 of 23, no false alarms on 25
  English pages).
- The visual estimator ranks table crops and born-digital PDFs easiest and real receipt scans hardest.
  The six-part estimator ranks born-digital Kleister documents hardest, because of their length and
  density.
- Planted traps: the arithmetic contradiction is invisible on all nine measures, and so, after
  accounting for a chance imbalance, is the sticker contradiction. Omitted totals leave a small,
  group-level footprint (fewer tokens, less ink), detectable already at 30 documents, although the
  combined estimate does not see it and nothing in it says whether the blank is derivable. Cover sheets
  and bundles change the page count. A trap stays invisible only where there is no physical mechanism by
  which it could change the page.
- Where a corpus varies in few measurements, the estimate degenerates: under the visual estimator
  Kleister NDA is near-constant and FUNSD rests on one component, while the six-part estimator stays
  inside the declared thresholds (nearest: FUNSD 86%). In most corpora only two to four of the six
  components vary, and a different component drives the score in each, so scores are not comparable
  across corpora.

## 6. What could not be done, and why

- DocILE was not sampled: its download needs a registration token from the organisers.
- "A derivable blank looks exactly like an underivable one" cannot be tested on AIDP: every
  omitted-totals document has both kinds (net amount and total can be worked out from the lines, tax
  cannot), so there is no contrast to measure.
- Public samples are small (50 per corpus, Kleister NDA from an 83-document split) and come from
  particular splits and mirrors: SROIE from rth/sroie-2019-v2 (test), DocVQA from
  nielsr/docvqa_1200_examples (a 200-question validation subset with OCR words), CORD and FUNSD test
  splits, OmniDocBench page images, Kleister dev-0 splits, VRDU 25 registration forms and 25 ad-buy
  forms. Corpus medians carry the intervals shown and should not be over-read.
- In every sampled corpus both pixels and text were available, so "few observables" shows up as few
  VARYING components (single-page corpora never vary in page count, Latin-only corpora never vary in
  script, clean born-digital pages sit at the blur and contrast floor), not as missing data.

## 7. Disclosures: what was decided when

- The generator's code was read before the weights were frozen (so it was known that noise means
  rotation plus, at heavy, a contrast filter). To avoid exploiting that, the primary weights are equal
  and the anchors are generic rules of thumb. The self-test that checks the skew sign uses synthetic
  pages drawn by the script, not corpus pages.
- Frozen at 01:42:18 IST, before any feature was computed. After freezing, estimator.py was not
  edited.
- Decided while writing analyze.py, before any trap result was computed: trap documents carrying a
  second generator dimension are left out of that trap's comparison.
- Added after the first results were seen, reported as such: applying the declared collapse thresholds
  to the visual estimator as well as the six-part one; the per-corpus ranking under the visual
  estimator; the by-grade summary of raw measurements; and the item-count check that explains the
  sticker page-count imbalance. None of these changed a weight, an anchor or a threshold.

## 8. Files and how to re-run

- estimator.py: the estimator (measurements, frozen rules and weights, scoring, self-test).
- frozen-config.json: the frozen block, its SHA-256 and the time it was written.
- analyze.py: every statistic; refuses to run if the frozen block has changed.
- results.json: all numbers, each with its n and interval.
- per-document.csv: one row per document (2,000 AIDP plus 450 public): raw measurements, the six
  components, both estimates, and for AIDP the declared grade, applied tilt, trap flags and whether
  the PDF has a text layer.
- outputs/aidp-features.jsonl, outputs/public-features.jsonl: raw per-page measurements. For
  publication, the OmniDocBench records of public-features.jsonl and the language_label column of
  public-samples.csv carry no page labels: those labels (language, layout, source, subset and special
  issues) are OmniDocBench's own annotation. fetch_public.py fetches them again from
  OmniDocBench.json, and analyze.py then recomputes the script check of section 4.4, whose stored
  result is in results.json.
- fetch_public.py, public-samples/ (the 450 sampled files; not published, because they belong to their datasets'
  authors: fetch_public.py downloads them again) and public-samples.csv (every sampled document with its source).
- requirements.txt: numpy 2.5.4, opencv-python-headless 5.0.0.93, pillow 13.0.0 (Python 3.13);
  poppler's pdftoppm 25.03 rasterises PDFs.

To re-run (from this folder, at low priority, one process), with a Python virtual environment in ./venv holding
requirements.txt, poppler's pdftoppm on the PATH, the AIDP-2K PDFs unpacked into ../../corpus (the release asset
aidp-2k-v1.0-pdfs.tar.gz) and the public samples fetched with fetch_public.py:

    nice -n 19 ./venv/bin/python -I estimator.py selftest
    nice -n 19 ./venv/bin/python -I estimator.py aidp ../../corpus outputs/aidp-features.jsonl
    nice -n 19 ./venv/bin/python -I estimator.py items public-samples/<corpus>/items.jsonl outputs/public-features.jsonl
    nice -n 19 ./venv/bin/python -I estimator.py score per-document.csv outputs/aidp-features.jsonl outputs/public-features.jsonl
    nice -n 19 ./venv/bin/python -I analyze.py per-document.csv frozen-config.json estimator.py results.json outputs/public-features.jsonl

## 9. Resources used

AIDP measurements took 12 minutes (0.36 seconds per document) at the lowest CPU priority in one
process; the public measurements a few minutes; the analysis about 20 seconds. No paid service was
used. Disk: 399 MB in the study's working folder (Python environment 179 MB, public samples 218 MB, everything else
about 3 MB); the environment can be deleted and rebuilt from requirements.txt.

## A follow-up: asking a frontier model directly

[`model-check/`](model-check/) asks whether a frontier multimodal model, told what to look for, can find the planted
problems the image measurements here cannot: it separated them from their matched clean documents with an AUROC of
0.985, while its own difficulty rating followed the noise grade far less than the visual estimate.
