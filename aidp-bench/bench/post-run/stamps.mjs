/**
 * Post-run diagnostic 2. Stamps: was the "PAID" stamp on a page noticed?
 *
 * Counts documents. Which documents carry the stamp is not judged from the output: it is the
 * generator's own seeded draw, reproduced with the generator's code (lib.mjs, generated(): buildDoc
 * and the theme stream "<seed>:theme:<slug>:<index>", exactly as corpus-gen/generate.mjs lines 39 to 42)
 * and then confirmed on every PDF two independent ways:
 *   text layer  the stamp is HTML text, so in every PDF that keeps a text layer it is a line whose
 *               letters are the stamp's word, rotated about -11 degrees (render.mjs: rotate(-12deg));
 *   pixels      the stamp's border and letters are solid areas of one colour, the theme accent at 55%
 *               opacity over white (passed through the heavy profile's contrast and brightness filter
 *               where it applies), which nothing else on a page is painted in; found by rendering
 *               the page and counting pixels whose whole 3x3 neighbourhood is that colour. This is what
 *               confirms the stamp on the 302 heavy-noise PDFs, which are rasterised and keep no text.
 *
 * What the system noted comes from the stored reading's visual annotations (classification_v2_ocr,
 * exported to db-export/annotations.jsonl): a document is "stamp noted" when any annotated page lists
 * at least one entry under "stamps".
 */
import path from 'node:path';
import {
  context, generated, pipelineRaw, splitReading, withPdf, pageLayer, renderRgb, dbExport, writeJsonl,
  sha256, rate, THEME_ACCENTS,
} from './lib.mjs';

const ANGLE = [-16, -6];          // the stamp's rotation as printed: -12deg, plus the page's own skew
const CORE_MIN = 500;            // solid stamp-colour pixels at 216 dpi; a stamp gives 2,300+, a page without one 0 or 1
const SCALE = 3;

const hex = (h) => { const s = h.replace('#', ''); const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s; return [0, 2, 4].map((k) => parseInt(f.slice(k, k + 2), 16)); };
/** The stamp's colour: the accent at opacity .55 over white; through contrast(.82) brightness(1.04) on heavy pages. */
function stampColour(themeIdx, heavy) {
  return hex(THEME_ACCENTS[themeIdx]).map((c) => {
    let v = (c * 0.55 + 255 * 0.45) / 255;
    if (heavy) v = ((v - 0.5) * 0.82 + 0.5) * 1.04;
    return Math.max(0, Math.min(255, v * 255));
  });
}
/** Pixels of a page whose whole 3x3 neighbourhood is the stamp's colour (within 28 per channel). */
function stampCore(page, mupdf, colour) {
  const { w, h, n, px } = renderRgb(page, mupdf, SCALE);
  const ok = new Uint8Array(w * h);
  for (let i = 0, o = 0; i < w * h; i++, o += n) {
    if (Math.abs(px[o] - colour[0]) <= 28 && Math.abs(px[o + 1] - colour[1]) <= 28 && Math.abs(px[o + 2] - colour[2]) <= 28) ok[i] = 1;
  }
  let core = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (!ok[i] || !ok[i - 1] || !ok[i + 1] || !ok[i - w] || !ok[i + w] || !ok[i - w - 1] || !ok[i - w + 1] || !ok[i + w - 1] || !ok[i + w + 1]) continue;
    core++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return { core, bbox_pt: core ? [x0, y0, x1, y1].map((v) => Math.round(v / SCALE)) : null };
}
/** The letters of a string, order-free (a PDF can hand back right-to-left text in visual order). */
const letters = (s) => [...String(s ?? '').normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]+/gu, '')].sort().join('');

export async function stamps() {
  const ctx = context();
  const ann = new Map(dbExport(ctx, 'annotations.jsonl').filter((a) => a.role === 'main').map((a) => [a.id, a]));
  const rows = [];
  for (const doc of ctx.manifest.docs) {
    const gen = generated(doc, ctx.seed);
    const heavy = doc.dims?.noise === 'heavy';
    const colour = stampColour(gen.themeIdx, heavy);
    const want = letters(gen.label);
    // ---- the PDF: where is a stamp, by its text and by its colour?
    const pdf = await withPdf(path.join(ctx.corpusDir, doc.file), async (docu, mupdf) => {
      const n = docu.countPages();
      const textPages = [], pixelPages = [];
      let hasText = false, pixelScanned = [];
      for (let p = 0; p < n; p++) {
        const page = docu.loadPage(p);
        try {
          const { lines } = pageLayer(page);
          if (lines.some((l) => l.text.trim())) hasText = true;
          for (const l of lines) {
            const ang = (Math.atan2(l.dir[1], l.dir[0]) * 180) / Math.PI;
            if (ang > ANGLE[0] && ang < ANGLE[1] && letters(l.text) === want) textPages.push({ page: p + 1, angle: +ang.toFixed(1), text: l.text });
          }
          // Pixels: every page of a rasterised PDF; otherwise page 1 and any page the text layer puts a stamp on.
          if (heavy || p === 0 || textPages.some((t) => t.page === p + 1)) {
            const c = stampCore(page, mupdf, colour);
            pixelScanned.push(p + 1);
            if (c.core >= CORE_MIN) pixelPages.push({ page: p + 1, core_px: c.core, bbox_pt: c.bbox_pt });
            else if (p === 0) pixelPages.push({ page: 1, core_px: c.core, below_threshold: true });
          }
        } finally { page.destroy?.(); }
      }
      return { pages: n, text_layer: hasText, text_hits: textPages, pixel_hits: pixelPages.filter((x) => !x.below_threshold), page1_core_px: pixelPages.find((x) => x.page === 1)?.core_px ?? 0, pixel_pages_scanned: pixelScanned };
    });
    const pdfStamped = pdf.text_layer ? pdf.text_hits.length > 0 : pdf.pixel_hits.length > 0;
    const stampPage = (pdf.text_hits[0]?.page ?? pdf.pixel_hits[0]?.page) ?? null;
    // ---- what the system noted
    const a = ann.get(doc.id);
    const pagesAnn = Array.isArray(a?.annotations) ? a.annotations : [];
    const stampsNoted = pagesAnn.flatMap((x) => (x.stamps ?? []).map((s) => ({ page: x.page, text: s })));
    const seals = pagesAnn.flatMap((x) => (x.seals ?? []).map((s) => ({ page: x.page, text: s })));
    const notes = pagesAnn.flatMap((x) => (x.handwritten_notes ?? []).map((s) => ({ page: x.page, text: s })));
    const sigs = pagesAnn.flatMap((x) => (x.signatures ?? []).map((s) => ({ page: x.page, text: s })));
    const raw = pipelineRaw(ctx, doc.id);
    const word = gen.label;
    const wordRe = new RegExp(`(^|[^\\p{L}])${word}([^\\p{L}]|$)`, 'u');
    rows.push({
      id: doc.id, slug: doc.slug, locale: doc.locale, noise: doc.dims?.noise ?? null, theme: gen.themeIdx,
      stamp_drawn: !!gen.stamp, stamp_word: gen.label,
      pdf: { ...pdf, stamped: pdfStamped, stamp_page: stampPage },
      draw_matches_pdf: !!gen.stamp === pdfStamped,
      annotated_pages: pagesAnn.map((x) => x.page),
      stamp_noted: stampsNoted.length > 0,
      stamps_noted: stampsNoted,
      seals_noted: seals,
      handwritten_notes_noted: notes,
      signatures_noted: sigs,
      stamp_word_in_description: stampsNoted.some((s) => s.text.toUpperCase().includes(word.toUpperCase())),
      stamp_word_in_reading: wordRe.test(splitReading(raw?.ocr_text ?? '').main),
      stored_reading_is_the_kept_reading: a?.pagified_sha256 ? a.pagified_sha256 === sha256(Buffer.from((raw?.attachments?.length || doc.attachments?.length) ? splitReading(raw?.ocr_text ?? '').main.trim() : (raw?.ocr_text ?? ''), 'utf8')) : null,
    });
  }

  const S = rows.filter((r) => r.stamp_drawn), U = rows.filter((r) => !r.stamp_drawn);
  const c = (xs, f) => xs.filter(f).length;
  const sP1 = S.filter((r) => r.pdf.stamp_page === 1);
  const heavyRows = rows.filter((r) => r.noise === 'heavy');
  const figure = {
    id: 'stamps',
    capability: 'Handwriting and stamps (Read layer), the stamp only',
    unit: 'documents',
    numerator: c(S, (r) => r.stamp_noted),
    denominator: S.length,
    rate: rate(c(S, (r) => r.stamp_noted), S.length),
    false_alarms: { numerator: c(U, (r) => r.stamp_noted), denominator: U.length, rate: rate(c(U, (r) => r.stamp_noted), U.length) },
    breakdown: {
      stamped_documents: S.length,
      unstamped_documents: U.length,
      generator_draw_agrees_with_pdf: { documents: c(rows, (r) => r.draw_matches_pdf), of: rows.length },
      confirmed_by_text_layer: { documents: c(rows, (r) => r.pdf.text_layer), stamped: c(S, (r) => r.pdf.text_layer && r.pdf.text_hits.length > 0), unstamped_with_a_stamp_line: c(U, (r) => r.pdf.text_hits.length > 0) },
      confirmed_by_pixels_on_rasterised_pdfs: { documents: heavyRows.length, stamped: c(heavyRows, (r) => r.stamp_drawn && r.pdf.pixel_hits.length > 0), of_stamped: c(heavyRows, (r) => r.stamp_drawn), unstamped_with_stamp_pixels: c(heavyRows, (r) => !r.stamp_drawn && r.pdf.pixel_hits.length > 0) },
      pixel_detector_agrees_with_text_layer_on_page_1: { documents: c(rows.filter((r) => r.pdf.text_layer), (r) => (r.pdf.page1_core_px >= CORE_MIN) === r.pdf.text_hits.some((t) => t.page === 1)), of: c(rows, (r) => r.pdf.text_layer) },
      stamp_on_page_1: sP1.length,
      stamp_on_a_later_page: S.filter((r) => r.pdf.stamp_page > 1).map((r) => ({ id: r.id, page: r.pdf.stamp_page, pages: r.pdf.pages })),
      noted_among_page_1_stamps: { numerator: c(sP1, (r) => r.stamp_noted), denominator: sP1.length },
      stamp_reported_as_a_seal_instead: S.filter((r) => !r.stamp_noted && r.seals_noted.length).map((r) => ({ id: r.id, seals: r.seals_noted.map((x) => x.text) })),
      noted_as_stamp_or_seal: { numerator: c(S, (r) => r.stamp_noted || r.seals_noted.length > 0), denominator: S.length },
      not_noted: S.filter((r) => !r.stamp_noted).map((r) => ({ id: r.id, noise: r.noise, locale: r.locale, stamp_page: r.pdf.stamp_page, annotations: r.annotated_pages.length ? { seals: r.seals_noted.map((x) => x.text), handwritten_notes: r.handwritten_notes_noted.map((x) => x.text) } : null })),
      noted_with_the_stamp_word_in_the_description: { numerator: c(S, (r) => r.stamp_noted && r.stamp_word_in_description), denominator: c(S, (r) => r.stamp_noted) },
      unstamped_with_any_annotation: U.filter((r) => r.annotated_pages.length).map((r) => ({ id: r.id, seals: r.seals_noted.map((x) => x.text), handwritten_notes: r.handwritten_notes_noted.map((x) => x.text), signatures: r.signatures_noted.map((x) => x.text) })),
      stamp_word_transcribed_in_the_reading: { stamped: c(S, (r) => r.stamp_word_in_reading), of_stamped: S.length, unstamped: c(U, (r) => r.stamp_word_in_reading), of_unstamped: U.length },
      stored_reading_equals_the_kept_reading: { documents: c(rows, (r) => r.stored_reading_is_the_kept_reading === true), of: rows.length },
    },
    definition: 'Stamp noted: the stored reading of the document\'s main file (classification_v2_ocr.annotations, exported) lists at least one entry under "stamps" on any annotated page. Stamped: the generator\'s seeded draw (generate.mjs lines 39 to 42) gives the document a stamp, confirmed on its PDF. Numerator: stamped documents with a stamp noted. Denominator: stamped documents. The false-alarm line counts unstamped documents with a stamp noted.',
    caveats: [
      'Computed after the run from kept outputs and exported database fields; not part of the AIDP Score; a diagnostic under spec section 7.6.',
      `The platform describes stamps on page 1 only, its default, which the run's configuration left unchanged, and no stored description covers any later page (${rows.filter((r) => r.annotated_pages.some((pg) => pg > 1)).length} documents have one). Because the stamp is positioned against the whole (transformed) document body, ${S.filter((r) => r.pdf.stamp_page > 1).length} long documents print it on page 2, where it could not be seen.`,
      `${S.filter((r) => !r.stamp_noted && r.seals_noted.some((x) => x.text === '[object Object]')).length} stamps were reported as a "seal" whose stored text is "[object Object]": the platform stored an object instead of its description, so what it said is lost.`,
      'Only the stamp is measured. The corpus prints no handwriting, ticks or signatures, so the rest of the capability has no positives to find here.',
      'This is the classification step\'s side output; the stamp has no field in any contract, so it cannot affect the AIDP Score whichever way it goes.',
    ],
  };
  return { figure, rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ctx = context();
  const { figure, rows } = await stamps();
  writeJsonl(path.join(ctx.outDir, 'stamps.jsonl'), rows);
  console.log(JSON.stringify(figure, null, 1));
}
