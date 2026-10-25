# Can a frontier model, asked directly, find the planted problems?

A follow-up to the difficulty study in this folder. The study found that measurements of the page image follow the
noise a document was given but cannot tell a document with a planted problem from a clean one. This check asks whether
a frontier multimodal model, an AI model that reads images and text, can, once it is told what to look for.

## What was asked

Every one of the 524 documents in the study's comparisons (the 81 with a planted problem and the 443 matched clean
documents) went to the model as its PDF, with any attached PDF, under one fixed instruction, the same for every
document ([`INSTRUCTIONS.txt`](INSTRUCTIONS.txt)): rate how hard the document is to extract, from 1 to 10, and give the
probability that its printed totals disagree with its lines, that its totals block is missing, and that a sticker's lot
disagrees with the printed lot. The model ran with high reasoning effort. It is not named: the question is what a
frontier model can see when asked, not which one.

## What it found

`analysis.json`, computed by [`analyze.py`](analyze.py) with the study's own statistic (the stratified AUROC against
matched controls, with its bootstrap range and permutation test, under the study's frozen settings and seed):

- The model's answers separated the planted documents from their matched clean controls with an AUROC of 0.985, at
  least 0.964 at 95% confidence. For contradictory totals it was 0.954, and it ranked every document with a missing
  total and every sticker contradiction above its matched controls.
- Its own rating of how hard each document was separated the groups at only 0.573, and followed the declared noise
  grade with a rank correlation of 0.144, against 0.781 for the study's visual-only estimate on the same documents.

Reading the numbers recovers the planted problems once they are named; measuring the image recovers the noise. Neither
recovers what only the document's maker knows, such as which documents serve as controls, which is why AIDP-2K
declares difficulty when each document is built.

## The files

```
INSTRUCTIONS.txt    the instruction, exactly as sent
answers/<id>.json   every answer: the document, when it was answered, and the model's JSON answer (token counts are not published)
analysis.json       the statistics above
analyze.py          the analysis, run with the study's own code: python3 analyze.py <study folder> <this folder> <out>
```
