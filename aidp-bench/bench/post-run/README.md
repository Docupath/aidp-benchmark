# Post-run diagnostics: running them

These scripts work out the six post-run diagnostics (intake, stamps, reading order, legibility,
parsing, duplicate detection) after a benchmark run, from what the run kept: its raw outputs, the
corpus, and five files of fields exported from the platform's database (`db-export/`). Nothing here calls a
model, an API or a service. What each figure means, with the reference run's figures, is in
`results/aidp-v1-main/post-run/README.md`.

## Reproducing the reference run's figures

```
npm install                                                          # once, at the repository root
node aidp-bench/bench/post-run/index.mjs --corpus <AIDP-2K folder>
```

The corpus folder must hold the PDFs as well as the answer keys and page texts: unpack the release
asset `aidp-2k-v1.0-pdfs.tar.gz` into a copy of `aidp-bench/corpus/`. Intake counts each file's pages
and reading order locates the barcode stickers from the PDFs, with the `mupdf` package that
`npm install` brings.

With no other option the scripts read the reference run (`results/aidp-v1-main` with
`results/aidp-v1-stability`) and its exported database fields (`results/aidp-v1-main/post-run/db-export/`),
and write `summary.json`, the six evidence files and the intake crops beside them. The evidence files
and the crops come out byte for byte as published. `summary.json` differs only in the times it records
(`computed_at_ist`, `elapsed_s`).

## Another run

Each option can also be set by the environment variable named beside it.

- `--main-tag <tag>` (`AIDP_MAIN_TAG`): the main run, read from `results/<tag>`. Its database rows are
  found under the external tenants `aidpbench-<tag>-pipeline` (full lane) and `aidpbench-<tag>-prompt`
  (text lane).
- `--stability-tag <tag>` (`AIDP_STABILITY_TAG`): the repeatability run, read from `results/<tag>`. By
  default it is the main tag with `-main` replaced by `-stability`.
- `--cls-tenant lane` or `cls` (`AIDP_CLS_TENANT`): where the runner classified each document. `lane`,
  the default and what `bench/run-das.mjs` does, is under the lane's own tenant with the same id as the
  extraction: `<id>`, or `<id>--r<i>` for a repeat. `cls` is under a separate tenant,
  `aidpbench-<tag>-cls`, by the document's own id.
- `--stability-ids suffixed` or `shared` (`AIDP_STABILITY_IDS`): how the repeatability lane named its
  three repeats. `suffixed`, the default and what `bench/run-das.mjs` does, makes each repeat its own
  submission, `<id>--r0`, `--r1` and `--r2`. Under `shared` all three carry the document's own id, so
  the platform treats the second and third as reprocessing the first, and duplicate detection is
  reported as not measured, with the reason.
- `--db <name>` (`AIDP_DB`): the local Postgres database the run wrote to. Only `export-db.mjs` reads
  it, and every query runs in a read-only transaction.
- `--out <dir>` (`AIDP_OUT`): where the figures are written. By default `results/<main tag>/post-run`.

A new run's database fields are exported first, then the chain runs:

```
node aidp-bench/bench/post-run/export-db.mjs --check --corpus <AIDP-2K folder> --main-tag <tag> --db <database>
node aidp-bench/bench/post-run/index.mjs --corpus <AIDP-2K folder> --main-tag <tag> --db <database> --export-db
```

`--check` writes nothing. It prints how many rows each export query finds, so the selection can be
checked while a run is still going, and exits with 1, on a line starting `MISMATCH`, if the rows do not
fit the options. The `reproduce` lines of the `summary.json` it writes carry the same options, so the
published file says how to recompute it.

Three guards stop a wrong selection from turning into wrong figures. A run folder whose `run-meta.json`
records a different tag from the one given is refused, so two runs cannot be mixed. A run whose
`run-meta.json` still says `running` or `interrupted` is refused, because its outputs and database rows
are partial (`--allow-incomplete` overrides this, for a preview only; `complete-with-failures` counts as
finished). And the export stops with a message if the database holds no rows for the chosen tenants or
external ids.

## The by-eye record

`by-eye/verdicts.json` is written by hand after looking at the pages it names, and the scripts carry it
into `summary.json`. For the reference run it records the three unread pages that have no text layer
and the sticker geometry checked on three pages (`by-eye/check-*.png`). Both look at the corpus PDFs
themselves, so they hold for any run on AIDP-2K. `by-eye.mjs`, with the same options, prints a seeded
sample of the reading-order verdicts, each row beside the reading's lines, for anyone who wants to check
those by eye as well.
