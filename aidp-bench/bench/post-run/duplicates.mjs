/**
 * Post-run diagnostic 6. Duplicate detection: when the same document is submitted again, does the
 * system say so?
 *
 * Counts submissions. The repeatability run submitted each of its 200 documents three times through
 * the full lane, under three external ids (<id>--r0, --r1, --r2) of one tenant, each a resubmission of
 * the same PDF; the main run submitted every document once. The kept outputs (results/<run>/raw) do not
 * hold a duplicate verdict, so the verdicts come from the database fields export-db.mjs wrote out:
 *
 *   the matching engine   v2_match_runs, one row per submission holding its LATEST computation; a
 *                         "duplicate_invoice" exception (severity "blocker") names another document of
 *                         the same type, the same normalised number and the same seller. The engine runs
 *                         only for documents the system typed as an invoice-family "anchor"
 *                         (invoice, credit note, freight invoice, consignment invoice, and three types
 *                         absent from the corpus);
 *   the content flag      extraction_v2_runs.duplicate, set on an extraction whose read text (or every
 *                         file) was submitted before under a different external id of the tenant; a
 *                         resubmission under the SAME id is a reprocess and is never flagged.
 *
 * Order is counted two ways: by the runner's label (r0 first, as the runner sent them) and by the time
 * the platform first completed each submission's extraction, which differs where a submission failed
 * in transport and was sent again after its siblings.
 *
 * bench/run-das.mjs sends each repeat as its own submission, <id>--r<i>, classified and extracted under
 * that id. A runner that sent a document's repeats under the document's own external id would leave the
 * platform holding them as ONE submission reprocessed, and both checks above look only for ANOTHER external
 * id (the matching engine's lookup excludes the document's own id; the content flag needs content seen under
 * another id), so no repeat could be flagged or missed. Such a run (its export gives the submissions no
 * repeat label) is reported as not measured, with the main run's verdicts, which are measured as usual.
 */
import path from 'node:path';
import { context, dbExport, writeJsonl, rate, readJsonOr } from './lib.mjs';
import { FIELD_KEY_TYPES } from '../rules.mjs';

const ok200 = (runs) => (runs ?? []).filter((r) => r.status === 200);
const firstOk = (runs) => ok200(runs)[0]?.created_at_ist ?? null;
const lastOk = (runs) => { const o = ok200(runs); return o[o.length - 1] ?? null; };
const cnt = (xs, f) => xs.filter(f).length;

const CAPABILITY = 'Duplicate detection (Trust layer, Anomaly detection)';
const DEFINITION = 'Flagged: the matching engine\'s stored verdict for the submission (v2_match_runs, its latest computation, exported) carries a "duplicate_invoice" exception. Earlier copy: another submission of the same document whose extraction the platform had completed before that verdict was computed (extraction_v2_runs, exported). Numerator: submissions with an earlier copy that are flagged. Denominator: submissions the engine judged with an earlier copy. False alarms: submissions judged with no earlier copy that are flagged. The same counts by submission order (the runner\'s, and the platform\'s) are in the breakdown.';
const FIRST_CAVEAT = 'Computed after the run from database fields exported to db-export/ (the kept outputs hold no duplicate verdict); not part of the AIDP Score; a diagnostic under spec section 7.6.';

/**
 * Why the matching engine judges fewer documents than the repeatability sample holds, worded from the run's own
 * counts: the sample's documents of the four anchor types the corpus holds, the documents
 * of other types the system typed as an anchor (judged too), and anchor documents it typed as something else.
 */
const ANCHOR_SLUGS = ['invoice', 'credit-note', 'freight-invoice', 'consignment-invoice'];
const word = (n) => ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'][n] ?? String(n);
const typeName = (slug, n) => { const s = String(slug ?? 'unknown').replace(/[-_]+/g, ' ').toLowerCase(); return n === 1 ? s : `${s}s`; };
const aType = (s) => `${/^[aeiou]/.test(s) ? 'an' : 'a'} ${s}`;
function whyNotAll(byDoc, withMatch, matchedDocs) {
  const slugOf = (id) => byDoc.get(id)[0].slug;
  const docs = [...byDoc.keys()];
  const perAnchor = ANCHOR_SLUGS.map((s) => docs.filter((id) => slugOf(id) === s).length);
  const anchors = perAnchor.reduce((a, n) => a + n, 0);
  const others = docs.length - anchors;
  const otherTypes = new Set(docs.map(slugOf).filter((s) => !ANCHOR_SLUGS.includes(s))).size;
  const held = perAnchor.every((n) => n === perAnchor[0])
    ? `${perAnchor[0]} of each of those four types (${anchors})`
    : `${perAnchor.map((n, k) => `${n} ${typeName(ANCHOR_SLUGS[k], n)}`).join(', ').replace(/, ([^,]*)$/, ' and $1')} (${anchors})`;
  const extra = new Map();
  for (const id of matchedDocs) {
    if (ANCHOR_SLUGS.includes(slugOf(id))) continue;
    const k = `${slugOf(id)}\t${withMatch.find((x) => x.id === id).matching.anchor_type}`;
    extra.set(k, (extra.get(k) ?? 0) + 1);
  }
  const parts = [...extra.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => {
    const [slug, typed] = k.split('\t');
    const were = n === 1 ? 'was' : 'were';
    return `${word(n)} ${typeName(slug, n)} ${were} typed ${n === 1 ? aType(typeName(typed, 1)) : typeName(typed, n)} and ${were} judged too`;
  });
  const missed = anchors - matchedDocs.filter((id) => ANCHOR_SLUGS.includes(slugOf(id))).length;
  if (missed) parts.push(`${word(missed)} of the ${anchors} ${missed === 1 ? 'was' : 'were'} typed as another kind of document and not judged`);
  if (!parts.length) parts.push('no document of another type was judged');
  return `The matching engine judges only documents the system typed as a matching anchor (invoice, credit note, freight invoice, consignment invoice). The repeatability sample holds ${held} and ${others} document${others === 1 ? '' : 's'} of ${word(otherTypes)} other type${otherTypes === 1 ? '' : 's'}; ${parts.join('; ')}, making ${matchedDocs.length}. The other ${docs.length - matchedDocs.length} documents get no matching verdict at all.`;
}

/** C. The main run: its verdicts, and whether the corpus holds a true duplicate at all. */
function mainRunVerdicts(ctx, mainPipe, mainPrompt) {
  const mainVerdicts = (subs) => ({
    submissions: subs.length,
    with_a_match_run: cnt(subs, (s) => s.match_run),
    duplicate_exceptions: cnt(subs, (s) => (s.match_run?.duplicate_exceptions ?? []).length > 0),
    kept_runs_with_content_duplicate_flag: cnt(subs, (s) => lastOk(s.extraction_runs)?.duplicate === true),
  });
  const keyOf = (gtj) => {
    const g = gtj.gt ?? {};
    const num = g['Invoice Details']?.['Invoice Number'] || g['Order Details']?.['PO Number'] || g['Consignment Details']?.['Consignment Number'] || '';
    return { num, seller: g.Seller?.Name ?? '' };
  };
  const groups = new Map();
  for (const d of ctx.manifest.docs.filter((x) => FIELD_KEY_TYPES.includes(x.slug))) {
    const { num, seller } = keyOf(ctx.corpus.gt(d));
    if (!num) continue;
    const k = `${d.slug}\t${num}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ id: d.id, seller });
  }
  const sharedNumbers = [...groups.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => ({ type: k.split('\t')[0], number: k.split('\t')[1], documents: v }));
  const trueDuplicates = sharedNumbers.filter((g) => new Set(g.documents.map((x) => x.seller)).size < g.documents.length);
  return {
    full_lane: mainVerdicts(mainPipe),
    text_lane: mainVerdicts(mainPrompt),
    corpus_true_duplicates: trueDuplicates.length,
    corpus_numbers_shared_by_two_documents_of_one_type: sharedNumbers,
    note: 'No two documents of the same type in AIDP-2K share both a document number and a seller, so a correct system flags nothing in the main run; the one shared number belongs to two different sellers.',
  };
}

/**
 * A repeatability run whose repeats share the document's external id: one row per
 * document, holding what the database has for it, and the figure reported as not measured.
 */
function repeatsUnderOneId({ stab, stabRaw, mainRun }) {
  const rows = stab.map((s) => {
    const kept = lastOk(s.extraction_runs);
    const m = s.match_run;
    const flaggedIds = (m?.duplicate_exceptions ?? []).map((e) => e.ref_external_id);
    return {
      id: s.id, slug: s.slug, repeat: null, external_id: s.external_id,
      classified_as: (stabRaw(s.id)?.runs ?? []).map((r) => r?.classification?.category ?? null),
      extraction: { runs: s.extraction_runs.length, successful: ok200(s.extraction_runs).length, first_success_ist: firstOk(s.extraction_runs), kept_run_ist: kept?.created_at_ist ?? null, kept_run_content_duplicate: kept?.duplicate ?? null },
      matching: m ? {
        status: m.status, computed_at_ist: m.computed_at_ist, anchor_type: m.anchor?.doc_type ?? null, number: m.anchor?.number ?? '',
        seller_compared: s.match_index?.seller_norm ?? null, number_compared: s.match_index?.doc_number_norm ?? null,
        duplicate_of: flaggedIds, flagged: flaggedIds.length > 0,
      } : null,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const figure = {
    id: 'duplicates',
    capability: CAPABILITY,
    unit: 'submissions',
    numerator: null,
    denominator: null,
    rate: null,
    false_alarms: null,
    not_measured: 'Not measured in this run. Its repeatability lane sent each document\'s repeats under the document\'s own external id, so to the platform every repeat after the first is a reprocess of the same submission, not a second one. Both duplicate checks look only for a different external id (the matching engine\'s lookup excludes the document\'s own id; the content flag needs the content seen under another id), so no repeat can be flagged and none can be missed. The figure needs the same document submitted again under a new id (<id>--r0, --r1, --r2), as bench/run-das.mjs sends it, and this run does not.',
    breakdown: {
      repeatability_lane: {
        documents: rows.length,
        extraction_runs: rows.reduce((a, r) => a + r.extraction.runs, 0),
        successful_extraction_runs: rows.reduce((a, r) => a + r.extraction.successful, 0),
        judged_by_the_matching_engine: cnt(rows, (r) => r.matching),
        judged_with_a_duplicate_exception: cnt(rows, (r) => r.matching?.flagged),
        extraction_runs_with_the_content_duplicate_flag: stab.reduce((a, s) => a + cnt(s.extraction_runs ?? [], (x) => x.duplicate === true), 0),
        note: 'One submission per document, its repeats sharing the document\'s external id; recorded for completeness. A flag here could only be a false alarm on a reprocess.',
      },
      main_run: mainRun,
    },
    definition: DEFINITION,
    caveats: [
      FIRST_CAVEAT,
      'The main run\'s verdicts (main_run) are measured as usual: every document was submitted once under its own id, so a duplicate exception there is a false alarm.',
    ],
  };
  return { figure, rows };
}

export async function duplicates() {
  const ctx = context();
  const stab = dbExport(ctx, 'stability-submissions.jsonl');
  const mainPipe = dbExport(ctx, 'main-pipeline-submissions.jsonl');
  const mainPrompt = dbExport(ctx, 'main-prompt-submissions.jsonl');
  const stabRaw = (id) => readJsonOr(path.join(ctx.stabDir, 'raw', `${id}.stability.json`));
  if (stab.length && stab.every((s) => s.repeat == null)) return repeatsUnderOneId({ stab, stabRaw, mainRun: mainRunVerdicts(ctx, mainPipe, mainPrompt) });

  // ---- the repeatability run, one row per submission
  const byDoc = new Map();
  for (const s of stab) { if (!byDoc.has(s.id)) byDoc.set(s.id, []); byDoc.get(s.id).push(s); }
  const rows = [];
  for (const [id, subs] of byDoc) {
    const raw = stabRaw(id);
    const firsts = subs.map((s) => firstOk(s.extraction_runs));
    const rankOf = (t) => (t ? 1 + firsts.filter((x) => x && x < t).length : null);
    for (const s of subs) {
      const i = Number(String(s.repeat).slice(1));
      const kept = lastOk(s.extraction_runs);
      const m = s.match_run;
      const flaggedIds = (m?.duplicate_exceptions ?? []).map((e) => e.ref_external_id);
      // siblings whose extraction had completed before this verdict was computed
      const earlier = m ? subs.filter((o) => o !== s && firstOk(o.extraction_runs) && firstOk(o.extraction_runs) < m.computed_at_ist).map((o) => o.external_id) : [];
      rows.push({
        id, slug: s.slug, repeat: s.repeat, external_id: s.external_id,
        classified_as: raw?.runs?.find((r) => r?.i === i)?.classification?.category ?? null,
        extraction: { runs: s.extraction_runs.length, successful: ok200(s.extraction_runs).length, first_success_ist: firstOk(s.extraction_runs), kept_run_ist: kept?.created_at_ist ?? null, kept_run_content_duplicate: kept?.duplicate ?? null },
        order_by_label: i + 1,
        order_by_platform: rankOf(firstOk(s.extraction_runs)),
        matching: m ? {
          status: m.status, computed_at_ist: m.computed_at_ist, anchor_type: m.anchor?.doc_type ?? null, number: m.anchor?.number ?? '',
          seller_compared: s.match_index?.seller_norm ?? null, number_compared: s.match_index?.doc_number_norm ?? null,
          duplicate_of: flaggedIds, flagged: flaggedIds.length > 0,
          siblings_processed_before_this_verdict: earlier,
        } : null,
      });
    }
  }
  rows.sort((a, b) => a.id.localeCompare(b.id) || a.repeat.localeCompare(b.repeat));

  // ---- A. the matching engine's verdict
  const withMatch = rows.filter((r) => r.matching);
  const matchedDocs = [...new Set(withMatch.map((r) => r.id))];
  const allThree = matchedDocs.filter((id) => withMatch.filter((r) => r.id === id).length === 3);
  const per = (key) =>Object.fromEntries([1, 2, 3].map((k) => { const xs = withMatch.filter((r) => r[key] === k); return [k === 1 ? 'first' : k === 2 ? 'second' : 'third', { flagged: cnt(xs, (r) => r.matching.flagged), of: xs.length }]; }));
  const typesWith = {};
  for (const id of matchedDocs) { const r = withMatch.find((x) => x.id === id); const k = `${r.slug} typed ${r.matching.anchor_type}`; typesWith[k] = (typesWith[k] ?? 0) + 1; }
  const expected = withMatch.filter((r) => r.matching.siblings_processed_before_this_verdict.length > 0);
  const notExpected = withMatch.filter((r) => r.matching.siblings_processed_before_this_verdict.length === 0);
  const unflaggedDocs = (xs) => xs.filter((r) => !r.matching.flagged).map((r) => ({ submission: r.external_id, number_captured: r.matching.number, verdict_computed_ist: r.matching.computed_at_ist, siblings_processed_before: r.matching.siblings_processed_before_this_verdict }));

  // ---- B. the content-duplicate flag, every document
  const perFlag = (key) => Object.fromEntries([1, 2, 3].map((k) => { const xs = rows.filter((r) => r[key] === k); return [k === 1 ? 'first' : k === 2 ? 'second' : 'third', { flagged: cnt(xs, (r) => r.extraction.kept_run_content_duplicate === true), of: xs.length }]; }));

  const figure = {
    id: 'duplicates',
    capability: CAPABILITY,
    unit: 'submissions',
    numerator: cnt(expected, (r) => r.matching.flagged),
    denominator: expected.length,
    rate: rate(cnt(expected, (r) => r.matching.flagged), expected.length),
    false_alarms: { numerator: cnt(notExpected, (r) => r.matching.flagged), denominator: notExpected.length, rate: rate(cnt(notExpected, (r) => r.matching.flagged), notExpected.length) },
    headline: 'Submissions of the repeatability run that the matching engine judged when an earlier copy of the same document had already been processed, flagged by its duplicate exception; beside it, those judged when no earlier copy had been processed (false alarms).',
    breakdown: {
      matching_engine: {
        documents_judged: matchedDocs.length, of_documents: byDoc.size, documents_with_all_three_submissions_judged: allThree.length,
        why_not_200: whyNotAll(byDoc, withMatch, matchedDocs),
        documents_judged_by_type: typesWith,
        by_runner_order: per('order_by_label'),
        by_platform_order: per('order_by_platform'),
        flagged_when_an_earlier_copy_had_been_processed: { flagged: cnt(expected, (r) => r.matching.flagged), of: expected.length, not_flagged: unflaggedDocs(expected) },
        flagged_when_no_earlier_copy_had_been_processed: { flagged: cnt(notExpected, (r) => r.matching.flagged), of: notExpected.length },
        first_submissions_flagged: withMatch.filter((r) => r.order_by_label === 1 && r.matching.flagged).map((r) => ({ submission: r.external_id, verdict_computed_ist: r.matching.computed_at_ist, first_success_ist: r.extraction.first_success_ist, siblings_processed_before_verdict: r.matching.siblings_processed_before_this_verdict, duplicate_of: r.matching.duplicate_of })),
        repeat_submissions_not_flagged: withMatch.filter((r) => r.order_by_label > 1 && !r.matching.flagged).map((r) => ({ submission: r.external_id, number_captured: r.matching.number, siblings_processed_before_verdict: r.matching.siblings_processed_before_this_verdict })),
      },
      content_flag: {
        submissions: rows.length,
        by_runner_order: perFlag('order_by_label'),
        by_platform_order: perFlag('order_by_platform'),
        note: 'extraction_v2_runs.duplicate on the submission\'s kept run (its last successful extraction). A submission whose request was retried under the same external id is a reprocess to the platform, so a retried repeat loses the flag.',
      },
      main_run: mainRunVerdicts(ctx, mainPipe, mainPrompt),
    },
    definition: DEFINITION,
    caveats: [
      FIRST_CAVEAT,
      'v2_match_runs keeps one row per submission, its latest computation; a verdict is computed when that submission is indexed and again when it is re-run, not when a later copy arrives. A first copy whose extraction was re-run after its siblings were indexed is therefore stored as a duplicate of them.',
      'The duplicate check needs the document number the system captured and compares the seller it captured; a submission with no number captured is never checked.',
      'The repeatability run resubmits the identical PDF, so this measures exact resubmission, not a re-scanned or re-issued copy.',
    ],
  };
  return { figure, rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ctx = context();
  const { figure, rows } = await duplicates();
  writeJsonl(path.join(ctx.outDir, 'duplicates.jsonl'), rows);
  console.log(JSON.stringify(figure, null, 1));
}
