/**
 * AIDP-CAP: what is done to drawn PDFs. Reading the map back (where every value, mark and label landed), turning one
 * page of a scan upside down, scanning a document again, and putting several documents into one file.
 *
 * mupdf (GNU AGPL-3.0-or-later) does the reading and the writing; it is the same package the post-run diagnostics
 * use, and it is needed only to draw AIDP-CAP, never to score it.
 */
import { createRequire } from 'node:module';

let mupdfP = null;
const lib = () => (mupdfP ??= import('mupdf'));
const SCAN_DPI = 150;

/**
 * Reads a map PDF (render.mjs, map mode): the box of every colour on every page, and each page's own text.
 * Returns { pages: [{ page, width, height, text }], cells: { i: [{ page, x, y, w, h }] }, marks: { i: { page, x, y } } },
 * boxes normalised to the page (0 to 1, from the top left), as the systems report theirs.
 */
export async function readMap(bytes) {
  const mupdf = await lib();
  const doc = mupdf.Document.openDocument(new Uint8Array(bytes), 'application/pdf');
  const pages = [];
  const cells = {};
  const marks = {};
  for (let p = 0; p < doc.countPages(); p++) {
    const page = doc.loadPage(p);
    const [x0, y0, x1, y1] = page.getBounds();
    const W = x1 - x0, H = y1 - y0;
    const st = page.toStructuredText('preserve-whitespace');
    const boxes = new Map(); // key -> {x0,y0,x1,y1, line}
    let lineNo = 0;
    st.walk({
      beginLine() { lineNo++; },
      onChar(c, origin, font, size, quad, color) {
        const [r, g, b] = (color ?? [0, 0, 0]).map((v) => Math.round(v * 255));
        if (r !== 1 && r !== 2) return;
        const key = `${r}:${(g << 8) | b}:${lineNo}`;
        const xs = [quad[0], quad[2], quad[4], quad[6]], ys = [quad[1], quad[3], quad[5], quad[7]];
        const bx = boxes.get(key) ?? { r, i: (g << 8) | b, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        bx.x0 = Math.min(bx.x0, ...xs); bx.y0 = Math.min(bx.y0, ...ys); bx.x1 = Math.max(bx.x1, ...xs); bx.y1 = Math.max(bx.y1, ...ys);
        boxes.set(key, bx);
      },
    });
    for (const bx of boxes.values()) {
      const norm = { page: p + 1, x: (bx.x0 - x0) / W, y: (bx.y0 - y0) / H, w: (bx.x1 - bx.x0) / W, h: (bx.y1 - bx.y0) / H };
      if (bx.r === 1) (cells[bx.i] ??= []).push(norm);
      else marks[bx.i] = { page: p + 1, x: norm.x, y: norm.y };
    }
    pages.push({ page: p + 1, width: W, height: H, text: st.asText() });
    st.destroy?.(); page.destroy?.();
  }
  doc.destroy?.();
  return { pages, cells, marks };
}

export async function pageCount(bytes) {
  const mupdf = await lib();
  const doc = mupdf.Document.openDocument(new Uint8Array(bytes), 'application/pdf');
  const n = doc.countPages();
  doc.destroy?.();
  return n;
}

/** One page drawn as a picture into `out`, optionally rotated by `deg` about its centre (180 for a page fed upside down). */
function imagePage(mupdf, out, page, deg = 0) {
  const [x0, y0, x1, y1] = page.getBounds();
  const W = x1 - x0, H = y1 - y0;
  const s = SCAN_DPI / 72;
  const pix = page.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceRGB, false);
  const image = new mupdf.Image(pix);
  const img = out.addImage(image);
  image.destroy?.(); pix.destroy?.(); page.destroy?.();
  const res = out.newDictionary();
  const xo = out.newDictionary();
  xo.put('Im0', img);
  res.put('XObject', xo);
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad), sn = Math.sin(rad);
  // the image fills the page, turned about the page centre
  const a = W * c, b = W * sn, cc = -H * sn, dd = H * c;
  const e = W / 2 - (a + cc) / 2, f = H / 2 - (b + dd) / 2;
  const contents = `q 1 1 1 rg 0 0 ${W.toFixed(3)} ${H.toFixed(3)} re f ${[a, b, cc, dd, e, f].map((v) => v.toFixed(4)).join(' ')} cm /Im0 Do Q`;
  out.insertPage(-1, out.addPage([0, 0, W, H], 0, res, contents));
}

/** The same PDF with page `index` (0-based) drawn as a picture turned upside down, the way a scanner feeds a page wrongly. */
export async function turnPage(bytes, index) {
  const mupdf = await lib();
  const src = mupdf.Document.openDocument(new Uint8Array(bytes), 'application/pdf');
  const out = new mupdf.PDFDocument();
  for (let p = 0; p < src.countPages(); p++) {
    if (p === index) imagePage(mupdf, out, src.loadPage(p), 180);
    else out.graftPage(-1, src, p);
  }
  return save(out, [src]);
}

/** A new scan of a document: every page drawn as a picture, turned slightly as a hand-fed page is. */
export async function rescan(bytes, deg = 0.6) {
  const mupdf = await lib();
  const src = mupdf.Document.openDocument(new Uint8Array(bytes), 'application/pdf');
  const out = new mupdf.PDFDocument();
  for (let p = 0; p < src.countPages(); p++) imagePage(mupdf, out, src.loadPage(p), deg);
  return save(out, [src]);
}

/** Several documents in one file, in order; scanned, each page drawn as a picture. */
export async function concat(parts, { scanned = false } = {}) {
  const mupdf = await lib();
  const out = new mupdf.PDFDocument();
  const srcs = [];
  for (const bytes of parts) {
    const src = mupdf.Document.openDocument(new Uint8Array(bytes), 'application/pdf');
    srcs.push(src);
    for (let p = 0; p < src.countPages(); p++) {
      if (scanned) imagePage(mupdf, out, src.loadPage(p), 0);
      else out.graftPage(-1, src, p);
    }
  }
  return save(out, srcs);
}

/** The written file, with every document freed: the library's memory is not collected on its own. */
function save(out, srcs) {
  const buf = out.saveToBuffer('compress');
  const bytes = Buffer.from(buf.asUint8Array());
  buf.destroy?.(); out.destroy?.();
  for (const s of srcs) s.destroy?.();
  return bytes;
}

/** Whether every page of a PDF is free of text (a scan): Intake and the reading checks need to know. */
export async function hasTextLayer(bytes) {
  const mupdf = await lib();
  const doc = mupdf.Document.openDocument(new Uint8Array(bytes), 'application/pdf');
  const out = [];
  for (let p = 0; p < doc.countPages(); p++) out.push(doc.loadPage(p).toStructuredText().asText().trim().length > 0);
  return out;
}
export const _require = createRequire(import.meta.url);
