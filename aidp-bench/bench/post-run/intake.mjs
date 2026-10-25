/**
 * Post-run diagnostic 1. Intake: did every page and every attachment that arrived get read?
 *
 * Counts pages, the capability's own unit. The pages are the real PDF pages of every file the full
 * lane submitted (each document's main file and its attachments), counted by mupdf. A page counts as
 * read when the platform's page-lane reading (the `ocr_text` the runner kept) carries that page's
 * marker, "# --- | Page N | --- #", in the part for that file, followed by any content. The reading
 * holds the main file first and each attachment after an "##Attachments" separator, each numbered from
 * page 1.
 *
 * For every page not read, the page itself is examined: its text layer (mupdf), or, where the page was
 * rasterised (the heavy-noise profile renders the whole page as one image and leaves no text layer),
 * where its ink lies; and every answer-key value of the document is looked for on it.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  context, generated, pipelineRaw, splitReading, pagesOf, withPdf, pageLayer, renderCropPng, renderRgb,
  writeJsonl, readJsonOr, squash, rate,
} from './lib.mjs';
import { normDate, parseNumber } from '../base-score.mjs';

/** Every value the answer key holds for a document, as [path, value] (the Barcodes section excluded). */
function keyValues(gtj) {
  const out = [];
  const walk = (o, p) => {
    if (o == null) return;
    if (Array.isArray(o)) { o.forEach((v, i) => walk(v, `${p}.${i}`)); return; }
    if (typeof o === 'object') { for (const [k, v] of Object.entries(o)) if (k !== 'Barcodes') walk(v, p ? `${p}.${k}` : k); return; }
    const s = String(o).trim();
    if (s) out.push([p, s]);
  };
  if (gtj.gt) walk(gtj.gt, '');
  for (const f of gtj.facts ?? []) out.push([`facts.${f.label}`, String(f.value)]);
  return out;
}

/** The forms a key value can take on the page: as keyed, and in the document's printed locale. */
function printedForms(value, loc) {
  const forms = new Set([value]);
  const d = normDate(value);
  if (d) { const [dd, mm, yy] = d.split('/').map(Number); forms.add(loc.date({ d: dd, m: mm, y: yy })); }
  const n = /\p{L}/u.test(value) ? null : parseNumber(value);
  if (n != null) forms.add(loc.num(n));
  return [...forms];
}

/**
 * The letters and digits of a line, punctuation, spacing and Arabic diacritics removed, as a sorted
 * multiset. Order-free on purpose: a PDF text layer can hand back right-to-left text in visual order
 * and with a space inside a word (".شكر ًا لتعاملكم معنا" for "شكراً لتعاملكم معنا."), and the question
 * here is only whether the page holds that line and nothing else.
 */
const wordBag = (s) => [...String(s ?? '').normalize('NFKC').replace(/[\u064B-\u065F\u0670]/g, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')].sort().join('');

/** Where the ink of a page lies, for a page without a text layer: horizontal bands of dark pixels. */
function inkBands(page, mupdf, scale = 4) {
  const { w, h, n, px } = renderRgb(page, mupdf, scale);
  const rows = [];
  for (let y = 0; y < h; y++) {
    let c = 0;
    for (let x = 0; x < w; x++) { const o = (y * w + x) * n; if ((px[o] + px[o + 1] + px[o + 2]) / 3 < 140) c++; }
    if (c) rows.push([y, c]);
  }
  const bands = [];
  for (const [y, c] of rows) {
    const b = bands[bands.length - 1];
    if (b && y - b.y1 <= 2) { b.y1 = y; b.dark_px += c; } else bands.push({ y0: y, y1: y, dark_px: c });
  }
  return bands.map((b) => ({ top_pt: +(b.y0 / scale).toFixed(1), bottom_pt: +(b.y1 / scale).toFixed(1), height_pt: +((b.y1 - b.y0 + 1) / scale).toFixed(1), dark_px_at_288dpi: b.dark_px }));
}

export async function intake({ byEyeDir = null } = {}) {
  const ctx = context();
  const rows = [];
  const unread = [];
  const tot = { files: 0, main_files: 0, attachment_files: 0, pages: 0, pages_read: 0, main_pages: 0, main_pages_read: 0, attachment_pages: 0, attachment_pages_read: 0, attachments_fully_read: 0, documents_fully_read: 0, extra_markers: 0, closing_line_keyed: 0 };
  for (const doc of ctx.manifest.docs) {
    const raw = pipelineRaw(ctx, doc.id);
    const reading = splitReading(raw?.ocr_text ?? '');
    const parts = [reading.main, ...reading.attachments];
    const files = [{ file: doc.file, role: 'main' }, ...(doc.attachments ?? []).map((a) => ({ file: a.file, role: 'attachment', attachment_id: a.external_attachment_id }))];
    const gen = generated(doc, ctx.seed);
    const gtj = ctx.corpus.gt(doc);
    const footerSq = squash(gen.content.footerNote ?? '');
    const closingLineKeyed = !!footerSq && keyValues(gtj).some(([, v]) => squash(v) === footerSq);
    if (closingLineKeyed) tot.closing_line_keyed++;
    const docRow = { id: doc.id, slug: doc.slug, locale: doc.locale, noise: doc.dims?.noise ?? null, reading_ok: !!raw?.ok, closing_line_is_an_answer_key_value: closingLineKeyed, files: [] };
    for (const [k, f] of files.entries()) {
      const pages = pagesOf(parts[k] ?? '');
      const fileRow = await withPdf(path.join(ctx.corpusDir, f.file), async (docu, mupdf) => {
        const n = docu.countPages();
        const read = [], notRead = [];
        for (let p = 1; p <= n; p++) {
          const pg = pages.find((x) => x.n === p);
          if (pg && pg.body.trim()) { read.push(p); continue; }
          // ---- a page the reading does not carry: what is printed on it?
          const page = docu.loadPage(p - 1);
          try {
            const { lines, images } = pageLayer(page);
            const text = lines.map((l) => l.text).join('\n');
            const values = keyValues(gtj);
            const pageSq = squash(text);
            const found = [];
            let checkable = 0;
            if (text.trim()) {
              for (const [vp, v] of values) {
                const forms = printedForms(v, gen.content.locale).map(squash).filter((s) => s.length >= 3);
                if (!forms.length) continue;
                checkable++;
                if (forms.some((s) => pageSq.includes(s))) found.push({ path: vp, value: v });
              }
            }
            const footer = gen.content.footerNote ?? '';
            const prevBody = (pages.find((x) => x.n === p - 1)?.body ?? '').trim().split('\n').filter((l) => l.trim());
            const entry = {
              page: p, of: n, marker_present: !!pg,
              text_layer: text.trim() ? 'present' : 'none (the page is one raster image: heavy-noise profile)',
              text: text.trim() ? lines.map((l) => l.text) : null,
              images: images.length,
              closing_line: footer,
              holds_only_closing_line: text.trim() ? wordBag(text) === wordBag(footer) : null,
              ink_bands: text.trim() ? null : inkBands(page, mupdf),
              key_values_checked: text.trim() ? checkable : null,
              key_values_on_page: text.trim() ? found : null,
              reading_previous_page_ends: prevBody.slice(-2).map((l) => l.trim()),
              reading_contains_closing_line: wordBag(raw?.ocr_text ?? '').includes(wordBag(footer)),
            };
            if (!text.trim() && byEyeDir) {
              const b = entry.ink_bands?.[0];
              const [, , pw] = page.getBounds();
              const top = b ? Math.max(0, b.top_pt - 8) : 30, bottom = b ? b.bottom_pt + 8 : 80;
              const png = renderCropPng(page, mupdf, [20, top, pw - 20, bottom], 3);
              const name = `intake-${doc.id}-page-${p}.png`;
              fs.mkdirSync(byEyeDir, { recursive: true });
              fs.writeFileSync(path.join(byEyeDir, name), png);
              entry.by_eye_crop = `by-eye/${name}`;
            }
            notRead.push(entry);
          } finally { page.destroy?.(); }
        }
        const extra = pages.filter((x) => x.n > n).map((x) => x.n);
        return { ...f, pdf_pages: n, pages_read: read.length, read_pages: read, unread: notRead, reading_markers: pages.map((x) => x.n), markers_beyond_pdf: extra };
      });
      docRow.files.push(fileRow);
      tot.files++; tot.pages += fileRow.pdf_pages; tot.pages_read += fileRow.pages_read; tot.extra_markers += fileRow.markers_beyond_pdf.length;
      if (f.role === 'main') { tot.main_files++; tot.main_pages += fileRow.pdf_pages; tot.main_pages_read += fileRow.pages_read; }
      else { tot.attachment_files++; tot.attachment_pages += fileRow.pdf_pages; tot.attachment_pages_read += fileRow.pages_read; if (fileRow.pages_read === fileRow.pdf_pages) tot.attachments_fully_read++; }
      for (const u of fileRow.unread) unread.push({ id: doc.id, file: f.file, role: f.role, ...u });
    }
    if (docRow.files.every((f) => f.pages_read === f.pdf_pages)) tot.documents_fully_read++;
    rows.push(docRow);
  }

  // ---- what the unread pages hold ----
  const withText = unread.filter((u) => u.text);
  const onlyClosing = withText.filter((u) => u.holds_only_closing_line);
  const raster = unread.filter((u) => !u.text);
  const oneBand = raster.filter((u) => u.ink_bands?.length === 1 && u.ink_bands[0].height_pt <= 12);
  const keyFound = withText.reduce((a, u) => a + u.key_values_on_page.length, 0);
  const byEye = readJsonOr(path.join(ctx.outDir, 'by-eye', 'verdicts.json'))?.intake ?? null;

  const figure = {
    id: 'intake',
    capability: 'Intake (Read layer)',
    unit: 'pages, attachments',
    numerator: tot.pages_read,
    denominator: tot.pages,
    rate: rate(tot.pages_read, tot.pages),
    breakdown: {
      main_file_pages: { read: tot.main_pages_read, of: tot.main_pages, rate: rate(tot.main_pages_read, tot.main_pages) },
      attachment_pages: { read: tot.attachment_pages_read, of: tot.attachment_pages, rate: rate(tot.attachment_pages_read, tot.attachment_pages) },
      attachments_read_in_full: { read: tot.attachments_fully_read, of: tot.attachment_files },
      documents_with_every_page_read: { count: tot.documents_fully_read, of: rows.length },
      unread_pages: unread.length,
      unread_pages_that_are_the_last_page_of_their_file: unread.filter((u) => u.page === u.of).length,
      unread_pages_with_a_text_layer_holding_only_the_closing_line: onlyClosing.length,
      unread_pages_with_a_text_layer_holding_anything_else: withText.length - onlyClosing.length,
      unread_pages_without_a_text_layer: raster.length,
      unread_pages_without_a_text_layer_whose_ink_is_one_short_line_at_the_top: oneBand.length,
      answer_key_values_found_on_unread_pages: keyFound,
      documents_whose_closing_line_is_an_answer_key_value: tot.closing_line_keyed,
      reading_markers_beyond_the_pdf_page_count: tot.extra_markers,
    },
    unread_pages: unread.map((u) => ({ id: u.id, page: u.page, of: u.of, text: u.text, ink_bands: u.ink_bands, holds_only_closing_line: u.holds_only_closing_line, closing_line: u.closing_line, reading_contains_closing_line: u.reading_contains_closing_line, by_eye_crop: u.by_eye_crop ?? null })),
    by_eye: byEye,
    definition: 'Pages read: real PDF pages (mupdf page count of every file the full lane submitted: each main file and each attachment) whose page marker ("# --- | Page N | --- #", numbered per file) is present in the platform\'s page-lane reading, in that file\'s part, followed by any content. Pages: every page of those files.',
    caveats: [
      'Computed after the run from kept outputs; not part of the AIDP Score; a diagnostic under spec section 7.6.',
      'A page counts as read when the reading carries content under its marker; whether that content is right is Printed text\'s question, not this one.',
      'The 302 heavy-noise PDFs are rasterised (the whole page is one image, no text layer), so for an unread page among them what it holds is established from where its ink lies and by eye, not from text.',
      `${unread.filter((u) => u.page === u.of).length} of the ${unread.length} unread pages are the last page of their file, where the PDF renderer put the document's closing line (the footer note) alone on an extra page; ${tot.closing_line_keyed} documents' answer keys hold their closing line as a value.`,
    ],
  };
  return { figure, rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ctx = context();
  const { figure, rows } = await intake({ byEyeDir: path.join(ctx.outDir, 'by-eye') });
  writeJsonl(path.join(ctx.outDir, 'intake.jsonl'), rows);
  console.log(JSON.stringify({ ...figure, unread_pages: figure.unread_pages.length }, null, 1));
}
