# The held-out documents

The 300 documents of the held-out check: the reference run's frozen release, run on documents that did not exist when
it was frozen, so its result cannot come from having seen them.

## How they were made

1. **Registered first.** [`../bench/samples/heldout-v1.json`](../bench/samples/heldout-v1.json) fixed every choice
   before the seed existed: the release under test, the seed rule, the generator, the sampling rule, the repeat sample,
   the lanes, a new account and the scoring. It was committed (a6e7cbe, 11:31:47 IST) and pushed (11:31:51 IST) to
   Docupath's private development repository on 24 October 2026, after the reference run had ended.
2. **A seed no one could choose.** The seed is the text `aidp-heldout-v1:` followed by the randomness of round 6579746
   of the drand network's mainnet chain, the round published at 12:00:00 IST on 24 October 2026. The round, as read at
   12:00:02 IST from two drand endpoints, is
   [`../bench/samples/heldout-v1-evidence/drand-round-6579746.json`](../bench/samples/heldout-v1-evidence/drand-round-6579746.json);
   anyone can read it again at `https://api.drand.sh/public/6579746` and check its signature against the chain's
   public key with any drand client. Its randomness is the SHA-256 of that signature, which `make-heldout.mjs` checks.
3. **The same generator.** `corpus-gen/generate.mjs`, the generator that reproduces AIDP-2K byte for byte from its own
   seed, made 2,000 documents (200 of each of the ten types) from the new seed.
4. **The registered draw.** `bench/make-heldout.mjs` sorted each type's 200 ids by the SHA-256 of the seed, a colon and
   the id, and kept the first 30: 300 documents
   ([`../bench/samples/heldout-v1-sample.json`](../bench/samples/heldout-v1-sample.json)). The repeat sample is the
   first 10 of each of the six field-key types in the same order, 60 documents
   ([`../bench/samples/heldout-v1-repeats.json`](../bench/samples/heldout-v1-repeats.json)).

Two public records confirm the order. The 302 published PDFs carry creation times between 12:00:04 and 12:01:09 IST
on 24 October 2026, after round 6579746 was published. The generator renders all 2,000 documents with six browser
workers in about a minute, so the 300 drawn from across the whole set were all made within those 65 seconds; the run
record
([`../results/aidp-v1-heldout-main/run-meta.json`](../results/aidp-v1-heldout-main/run-meta.json)) shows the check
began at 12:01:15 IST.

## What is here

The answer keys (`<type>/<id>.gt.json`), page texts (`<type>/<id>.gt.txt`) and `manifest.json` of the 300 documents,
`contract.json`, the output contract of each document type, the same file as AIDP-2K's, against which Contract is checked,
and `PDF-SHA256SUMS`, the SHA-256 fingerprint of each of the 302 PDFs (300 documents and 2 attachments). The PDFs are
the release asset `aidp-heldout-v1-pdfs.tar.gz`. Unpacked into this folder, they sit beside their answer keys, and
every one can be checked against its fingerprint:

```bash
tar -xzf aidp-heldout-v1-pdfs.tar.gz -C aidp-bench/corpus-heldout
cd aidp-bench/corpus-heldout && shasum -a 256 -c PDF-SHA256SUMS
```

## Regenerating them

The seed is `aidp-heldout-v1:a08a1442472d155862ddfcb7b2af089b3c4d5c78d2d82e5f260a37efbf1b273f`.

```bash
# the answer keys, page texts and manifest of all 2,000 generated documents, in seconds
npm run keys -- --seed "aidp-heldout-v1:a08a1442472d155862ddfcb7b2af089b3c4d5c78d2d82e5f260a37efbf1b273f" --out <generated folder>
# or the PDFs as well, about a minute with six browser workers (npx playwright install chromium, once)
npm run render -- --seed "aidp-heldout-v1:a08a1442472d155862ddfcb7b2af089b3c4d5c78d2d82e5f260a37efbf1b273f" --out <generated folder>
# the registered draw of 300
node aidp-bench/bench/make-heldout.mjs --round aidp-bench/bench/samples/heldout-v1-evidence/drand-round-6579746.json \
  --corpus <generated folder> --out <held-out folder>
```

The answer keys and page texts come out byte for byte the files here, and the PDFs as AIDP-2K's do, with the same pages
and text (see `../CORPUS.md`).

The generator and the scorer published here have changed since the registration: in their comments and file names, in
two generator settings that are off by default, and in how evidence without review decisions is read (specification,
Annex B, "Decided after the run"). Their outputs have not: these answer keys and page texts regenerate byte for byte,
and the held-out evidence re-scores to its published AIDP Score of 99.00.

## The results

The same release ran under a new, clean account with the same settings, every document in the full lane and the 60
repeat documents three times each, and was scored by the same rules: an AIDP Score of 99.00 (95% range 98.66 to 99.28),
against 99.15 on AIDP-2K. The evidence is in [`../results/aidp-v1-heldout-main/`](../results/aidp-v1-heldout-main/)
and [`../results/aidp-v1-heldout-stability/`](../results/aidp-v1-heldout-stability/).

Consignment documents scored lowest on Fidelity here, as on AIDP-2K: 84.10% for consignment invoices and 87.80% for
consignment orders, against 93.22% and 90.56% on AIDP-2K. Each figure rests on 30 documents, and five documents of each
type hold most of the wrong values: 1,378 of the 1,492 for consignment invoices and 1,441 of the 1,710 for consignment
orders. Nine of those ten have a table row merged with another or not matched to the answer key, after which the rows
below it are compared by position (`../FINDINGS.md`, B8). The median document scored 96.57% for consignment invoices
and 97.16% for consignment orders. Resampling each type's 30 documents 2,000 times, as `../bench/paper-checks.mjs` does,
gives 95% ranges of 63.5% to 97.4% and 72.2% to 97.4%, and both contain the AIDP-2K figures. The counts
behind every figure here are in `../results/aidp-v1-heldout-main/scoreboard.json`, per document under
`docs[].lanes.pipeline.L2` (Fidelity is `correct` plus `normalized` over those plus `wrong`).
