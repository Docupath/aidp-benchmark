/**
 * Post-run diagnostic 4. Legibility: did the system say what it could not read, rather than guess?
 *
 * Counts marks, the capability's unit: the tags the platform's page reading writes where it cannot
 * read a value. Three of the reading's tags say that text could not be read, "[obscured]"
 * (covered by a stamp or a blot), "[illegible]" (written in place of a value that cannot be read) and
 * "[cut off]" (at the page edge); the others record pen marks ("[struck]", "[ticked]", "[circled]",
 * "[highlighted]", "[x]", "[ ]").
 *
 * Per document of the full lane (2,000): the tags in its page-lane reading, whether it carries barcode
 * stickers (the consignment orders and invoices, from the generator's content model), and whether any
 * tag text reached any field value of its extraction. The same leak check runs over the 600
 * extractions of the repeatability run.
 *
 * Secondary, from reading-order.jsonl: for the table rows whose visible cells all stand on one line in
 * order and that a sticker partly hides, what the reading wrote where the hidden cells sit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { context, generated, pipelineRaw, readJsonl, writeJsonl, rate, TAG_RE, LEGIBILITY_TAGS, MARK_TAGS } from './lib.mjs';

/** Every leaf value of an extraction, with its path. */
function leaves(o, p = '', out = []) {
  if (o == null) return out;
  if (Array.isArray(o)) { o.forEach((v, i) => leaves(v, `${p}.${i}`, out)); return out; }
  if (typeof o === 'object') { for (const [k, v] of Object.entries(o)) leaves(v, p ? `${p}.${k}` : k, out); return out; }
  out.push([p, String(o)]);
  return out;
}
const LEAK = /\[(?:struck|ticked|circled|highlighted|cut off|obscured|illegible)\]/i;

export async function legibility() {
  const ctx = context();
  const rows = [];
  const tot = { docs: 0, docs_with_mark: 0, marks: 0, by_tag: {}, values_checked: 0, leaks: [] };
  const split = { with_stickers: { docs: 0, docs_with_mark: 0, marks: 0 }, without_stickers: { docs: 0, docs_with_mark: 0, marks: 0 } };
  const pen = { docs: 0, marks: 0, by_tag: {}, on_stamped_documents: 0, on_unstamped_documents: 0, unstamped_by_tag: {} };
  for (const doc of ctx.manifest.docs) {
    const gen = generated(doc, ctx.seed);
    const stickers = gen.content.stickers?.length ?? 0;
    const raw = pipelineRaw(ctx, doc.id);
    const text = String(raw?.ocr_text ?? '');
    const byTag = {};
    for (const m of text.matchAll(TAG_RE)) byTag[m[1]] = (byTag[m[1]] ?? 0) + 1;
    const marks = LEGIBILITY_TAGS.reduce((a, t) => a + (byTag[t] ?? 0), 0);
    const penMarks = MARK_TAGS.reduce((a, t) => a + (byTag[t] ?? 0), 0);
    const vals = leaves(raw?.extraction ?? {});
    const leaked = vals.filter(([, v]) => LEAK.test(v));
    tot.values_checked += vals.length;
    for (const [p, v] of leaked) tot.leaks.push({ run: 'main', id: doc.id, path: p, value: v.slice(0, 120) });
    tot.docs++; tot.marks += marks; if (marks) tot.docs_with_mark++;
    for (const t of LEGIBILITY_TAGS) tot.by_tag[t] = (tot.by_tag[t] ?? 0) + (byTag[t] ?? 0);
    for (const t of MARK_TAGS) if (byTag[t]) pen.by_tag[t] = (pen.by_tag[t] ?? 0) + byTag[t];
    pen.marks += penMarks; if (penMarks) pen.docs++;
    if (gen.stamp) pen.on_stamped_documents += penMarks;
    else { pen.on_unstamped_documents += penMarks; for (const t of MARK_TAGS) if (byTag[t]) pen.unstamped_by_tag[t] = (pen.unstamped_by_tag[t] ?? 0) + byTag[t]; }
    const g = stickers ? split.with_stickers : split.without_stickers;
    g.docs++; g.marks += marks; if (marks) g.docs_with_mark++;
    rows.push({
      id: doc.id, slug: doc.slug, locale: doc.locale, noise: doc.dims?.noise ?? null, stickers,
      legibility_tags: Object.fromEntries(LEGIBILITY_TAGS.map((t) => [t, byTag[t] ?? 0])), legibility_tags_total: marks,
      pen_mark_tags: Object.fromEntries(MARK_TAGS.filter((t) => byTag[t]).map((t) => [t === ' ' ? '[ ]' : t, byTag[t]])),
      extraction_values_checked: vals.length, tag_text_in_extracted_values: leaked.map(([p, v]) => ({ path: p, value: v.slice(0, 120) })),
    });
  }
  // the same leak check over the repeatability run's extractions (full lane, three per document)
  let stabValues = 0, stabRuns = 0;
  const stabRaw = path.join(ctx.stabDir, 'raw');
  for (const f of fs.existsSync(stabRaw) ? fs.readdirSync(stabRaw).filter((x) => x.endsWith('.stability.json')) : []) {
    const r = JSON.parse(fs.readFileSync(path.join(stabRaw, f), 'utf8'));
    for (const run of r.runs ?? []) {
      if (!run?.ok) continue;
      stabRuns++;
      for (const [p, v] of leaves(run.extraction ?? {})) { stabValues++; if (LEAK.test(v)) tot.leaks.push({ run: 'stability', id: `${r.id}--r${run.i}`, path: p, value: v.slice(0, 120) }); }
    }
  }

  // ---- secondary: what the reading wrote where a sticker hides cells (from reading-order.jsonl)
  const ro = readJsonl(path.join(ctx.outDir, 'reading-order.jsonl'));
  let hidden = null;
  if (ro) {
    const h = { rows: 0, rows_with_a_legibility_tag: 0, cells: 0, by_what: {} };
    for (const d of ro) for (const v of d.verdicts ?? []) {
      if (!v.hidden) continue;
      h.rows++;
      if (v.hidden.row_tagged) h.rows_with_a_legibility_tag++;
      for (const gp of v.hidden.gaps) { h.cells += gp.cells.length; h.by_what[gp.wrote] = (h.by_what[gp.wrote] ?? 0) + gp.cells.length; }
    }
    hidden = {
      ...h,
      note: 'Rows of the reading-order measure that pass it (every visible cell on one line, in order) and in which a sticker hides at least one cell (any of nine sample points of a character\'s ink under the sticker). The hidden cells between two visible ones sit in the gap between those cells on the line, so what the reading wrote there can be read off: a legibility tag (reported), nothing, the printed value or part of it (the cell is only partly hidden, so this can be a correct reading), the sticker\'s own printed lot, serial or GTIN taken for the hidden value, or another value (a guess or a misreading). The reading writes " [obscured]" at the END of a partly covered row, so a row can be reported while the gap itself holds a guess; rows_with_a_legibility_tag counts rows tagged anywhere on the line. An estimate on the rows where the gap can be located, not a score.',
    };
  }

  const figure = {
    id: 'legibility',
    capability: 'Legibility (Read layer)',
    unit: 'marks (tags written into the reading)',
    numerator: tot.marks,
    denominator: null,
    rate: null,
    documents_with_a_legibility_tag: { numerator: tot.docs_with_mark, denominator: tot.docs, rate: rate(tot.docs_with_mark, tot.docs) },
    breakdown: {
      legibility_tags: tot.by_tag,
      documents_with_stickers: { documents: split.with_stickers.docs, with_a_tag: split.with_stickers.docs_with_mark, tags: split.with_stickers.marks },
      documents_without_stickers: { documents: split.without_stickers.docs, with_a_tag: split.without_stickers.docs_with_mark, tags: split.without_stickers.marks },
      tag_text_in_extracted_values: { main_run_values_checked: tot.values_checked, main_run_documents: tot.docs, repeatability_runs: stabRuns, repeatability_values_checked: stabValues, leaks: tot.leaks.length, examples: tot.leaks.slice(0, 10) },
      pen_mark_tags_on_a_corpus_without_pen_marks: { tags: pen.marks, documents: pen.docs, by_tag: Object.fromEntries(Object.entries(pen.by_tag).map(([k, v]) => [k === ' ' ? '[ ]' : k, v])), on_documents_with_the_paid_stamp: pen.on_stamped_documents, on_documents_without_it: pen.on_unstamped_documents, without_stamp_by_tag: pen.unstamped_by_tag, note: 'The reading writes the stamp\'s word with a pen-mark tag after it ("PAID [circled]", "BEZAHLT [circled]"): the stamp\'s rectangular border read as a circle, a strike or a highlight.' },
      hidden_cells_secondary: hidden,
    },
    definition: 'Marks: occurrences of "[obscured]", "[illegible]" or "[cut off]" in the page-lane reading of each of the 2,000 documents (the platform\'s reading-tag vocabulary). Split by whether the document carries barcode stickers (the 400 consignment orders and invoices). Leak check: no tag text inside any value of the extraction returned for the same document (and for the 600 repeatability extractions).',
    caveats: [
      'Computed after the run from kept outputs; not part of the AIDP Score; a diagnostic under spec section 7.6.',
      'A count of marks, not a rate: the corpus has no answer key for what is unreadable, so the count cannot say how many of the marks were warranted or how many unreadable spots went unmarked. The secondary hidden-cell estimate is the closest the corpus gets to that question.',
      'The corpus prints no pen marks (no strikes, ticks, circles, highlights or checkboxes), so every pen-mark tag is unfounded; almost all sit on the PAID stamp, whose border the reading takes for a circle, a strike or a highlight (see pen_mark_tags_on_a_corpus_without_pen_marks).',
    ],
  };
  return { figure, rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ctx = context();
  const { figure, rows } = await legibility();
  writeJsonl(path.join(ctx.outDir, 'legibility.jsonl'), rows);
  console.log(JSON.stringify(figure, null, 1));
}
