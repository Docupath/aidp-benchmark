# Adding a system to AIDP-Bench

AIDP-Bench is intended to score more than one system. This document describes the output a system's results must
take to be scored, and the conditions under which a result is comparable with the published ones.

## The output format

For each document and lane, a system's result is one JSON file holding two things, text and structured output,
with the optional fields below. No harness for calling other systems ships with v1.0: a system is run by its own
authors, its results are written in this format, and `bench/score-run.mjs` scores them.

```js
// <id>.pipeline.json (full lane) or <id>.prompt.json (text lane)
  {
    ok: true,            // required: a lane file without ok: true is scored as a total failure in every measure.
    ocr_text:   '...',   // required for the full lane, scored by the Read measures. Omit for the text lane.
    extraction: { },     // required. The structured output, in whatever schema the system emits.
    classification: { category: 'Invoice' },  // required for the full lane: the document type the system chose,
                         // written exactly as the answer key's `category` (for example 'Purchase Order'), scored
                         // by Identification. Without it, or spelled any other way, the document counts as
                         // misclassified; with no category at all, Identification and the AIDP Score are zero.
    derived_fields: {    // optional. Omitting it scores Computation as zero, which is correct: a system
      derivations: [     // that cannot say which values it derived cannot be credited for deriving
        { kind: 'derived' | 'mismatch' | 'corrected' | 'recovered',
          field_path: 'Invoice Details.Net Amount',
          before: '', after: '2250',
          method: 'sum(Items[].Net Amount)',
          inputs: ['2000', '250'],
          reason: 'Net Amount was blank; summed the 2 line-item Net Amount values.' },
      ],
    },
    impact: { changed_fields: 0, changes: [] },  // optional, scored by Instructions when the instruction runs are made
    field_confidence: {  // optional: one entry per returned value, keyed by its path, a table row by its number
      fields: {          // ('Items.0.Net Amount'). Calibration reads c, the confidence from 0 to 1, and tier;
                         // Traceability reads source, which names the evidence behind the value ('none' counts
                         // against it). Without it Calibration and Traceability have nothing to count.
        'Invoice Details.Total Amount': { c: 0.95, tier: 'high', source: 'exact' },
      },
    },
    field_report: { document: { auto_accept: false } },  // optional: the system's own decision to let the document
                         // through (true) or send it to a person (false), read by the safety panel. Evidence that
                         // carries confidence but no decision has no safety panel; evidence with neither counts every
                         // document as sent to a person. Either way the result can claim no automation.
  }
```

Repeatability, one of AIDP-2K's measures in the score, needs its own files: for each document of the declared sample
(`bench/samples/stability-v1.json`), `<id>.stability.json` holding `runs`, the three submissions, each
`{ ok: true, extraction: { } }`, in `results/<system>-<date>-stability/raw/` beside the main run's folder. Without
them the AIDP Score cannot be computed.

Two lanes make a full result. In the **full lane** (`pipeline` in the result files) the system reads the PDF
itself. In the **text lane** (`prompt`) it receives the page's correct text and must not read the PDF. A system that
cannot accept pre-extracted text can publish a pipeline-lane-only result, but loses the ability to
separate reading errors from comprehension errors.

## Scoring mode

**This is the most important decision and it determines whether a result is comparable.**

AIDP-2K's answer keys follow one published output contract (`corpus-contract.json`), so a system can be asked to return
its field layout and then be scored field by field. A system emitting a different schema must be scored in **facts
mode**, where each rendered fact must appear somewhere in the output, located by deep value search with locale-aware
normalisation. Facts mode measures recall and cannot measure invention, so a facts-mode result has no Restraint figure
and no safety panel.

Scoring a differently-shaped system in field mode produces a meaninglessly low score and is not a
valid comparison. Any published cross-system comparison must state the mode used for each system.

This is a real limitation of the benchmark rather than a formality. It is recorded in
`FINDINGS.md` under B14.

## What a comparable result requires

A result published as comparable with the reference implementation's must state:

1. The specification version and the corpus seed.
2. The scoring mode per system, field or facts.
3. The error budget, which must be one of the three declared budgets, unmodified.
4. Every layer's figures, or an explicit statement that a layer was not measured. A layer a system
   does not implement is scored zero, not omitted: a system with no derivation reporting genuinely
   does score zero on Computation, because a value it cannot account for cannot be distinguished from an
   invention.
5. The raw per-document evidence, published, so the score can be recomputed.

## Submitting a result

Open a pull request against `Docupath/aidp-benchmark` adding `aidp-bench/results/<system>-<date>/` containing the raw evidence and the scoreboard,
plus a short note stating configuration, versions and date. Results are considered for publication,
including results better than the reference implementation's.

Docupath does not publish results it produced for another vendor's document-processing product: a product
configured by a competitor is not that vendor's product. Comparisons with other vendors' products are run by an
independent party, which tests each product as its vendor configures it, or by the product's own authors.

A general-purpose model, or a page-reading engine with its standard settings, used through its public interface is
different: nothing about it is configured except the instructions it receives, and those can be published in full.
Docupath will publish results for such systems only with the instructions, the form in which each received the
page, the date and every raw output, so that anyone can repeat the run with any model, improve the instructions and
publish their own result. It will not name the models, so that no result reads as a claim about any vendor's
product.

## What ships today

No adapter for another system ships with v1.0. The runner, `bench/run-das.mjs`, drives the reference
implementation's API. To score another system, write its outputs for each document and lane in the same
per-document format as `results/aidp-v1-main/raw/` (`<id>.pipeline.json` for the full lane, `<id>.prompt.json` for
the text lane), then run `bench/score-run.mjs` on that folder. The output format above lists the fields the scorer
reads.
