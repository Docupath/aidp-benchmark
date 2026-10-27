# The capability run on AIDP-CAP

The capability run tested Docupath release `5bd21304` on all 960 documents of AIDP-CAP on 27 October 2026 (IST), under
the rules registered in [`../../bench/samples/cap-v1.json`](../../bench/samples/cap-v1.json) before its documents
existed. Its record, and every decision made after it, is in Annex B of the specification
([`../../../spec/aidp-v1.0.md`](../../../spec/aidp-v1.0.md)).

- `scoreboard-cap.json`: the eighteen AIDP-CAP measures, by document and by document type, and the AIDP Score over all
  thirty-one measures, with AIDP-2K's thirteen taken from the reference run's board: 82.90 (95% range 79.57 to 84.67).
  `npm run rescore:cap` reproduces it from the evidence below.
- `as-registered/scoreboard-cap.json`: the same evidence scored by the scorer as registered (commit `fdb5583`), before
  the six corrections Annex B lists, with AIDP-2K's thirteen measures taken from the reference run's published board:
  an AIDP Score of 82.75 (95% range 79.43 to 84.53).
- `touched.txt`: the 202 documents a fault of the run's own setup touched, each with the lane where it happened: the 10
  whose barcode scan ran into its time limit on the overloaded benchmark machine, and the 192 with a model call refused
  while the run's account was out of credits. The sensitivity figure in the paper leaves them out.
- `machine-parity/`: the comparison of the two machines the run used, made before it continued on the second. Each
  machine's page reader read the same 57 pages of 25 documents, drawn once by the release's own renderer, and the
  comparison records every line's and word's text, each word's position and its confidence score; the second machine's
  barcode scanner read 24 documents whose complete scans the first machine had stored, compared payload by payload. The
  scripts that made them run against the release itself and its database, so only their outputs are published.

The raw answers are in the four lane folders beside this one: `../aidp-v1-cap-main/` (the full lane: 960 documents and
30 copies, with each document's page geometry and matching record), `../aidp-v1-cap-split/` (200 files sent to the
splitting step), `../aidp-v1-cap-rules/` (60 documents under seven written instructions) and
`../aidp-v1-cap-contract/` (120 documents under the customer's contract). Each lane's `run-meta.json` records its
sessions. They are published under the reference run's publication rules, with the name of the machine that ran each
lane given as "<host>", and with the platform's notes on how it recovered one instruction internally left out of two
records of the instruction lane (Annex B, "Publication").
