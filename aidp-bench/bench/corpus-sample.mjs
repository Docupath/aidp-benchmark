/**
 * Builds the browsable sample of AIDP-2K: sixteen documents a reader can open without downloading the 2,012 PDFs.
 *
 * Two selections, both deterministic and both recorded in the index it writes: the first document of every type,
 * which shows the ordinary case, and the first document carrying each hard condition, which shows the cases the
 * benchmark turns on. Every page ships beside its answer key and its page text, so the claim that the corpus is
 * written answer key first can be checked by opening two files.
 *
 * Where the files come from:
 *
 *   --corpus <dir>   copy the PDFs from an AIDP-2K corpus folder: the v1.0 release asset unpacked into
 *                    aidp-bench/corpus/ (the default when its PDFs are there), or any folder named by --corpus or by
 *                    the environment variable AIDP_CORPUS_DIR. Every copied PDF is checked against
 *                    aidp-bench/corpus/PDF-SHA256SUMS, so the sample holds exactly the files of the v1.0 release.
 *   (no PDFs found)  draw them with the generator instead (needs: npx playwright install chromium). A drawn PDF
 *                    has the same pages and text as the release file, almost always the same pixels (CORPUS.md),
 *                    and never the same bytes, because it carries the date it was drawn.
 *
 * Either way the answer keys and page texts are written by the generator itself, and where a corpus folder is
 * given they are checked byte for byte against its files. The first-page previews (PNG) are drawn with mupdf
 * (GNU AGPL-3.0-or-later), which is needed by this tool only for them.
 *
 *   node aidp-bench/bench/corpus-sample.mjs [--corpus <dir>] [--out <dir>] [--seed docupath-corpus-v1] [--scan 200]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { TYPES, PER_TYPE, SEED as COMP_SEED } from '../corpus-gen/composition.mjs';
import { DOC_TYPES } from '../corpus-gen/schema.mjs';
import { buildDoc } from '../corpus-gen/data.mjs';
import { gtText, attachmentGtText, combine } from '../corpus-gen/gttext.mjs';
import { Rng } from '../corpus-gen/rng.mjs';

const BENCH = path.resolve(new URL('..', import.meta.url).pathname);
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.lastIndexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const SEED = opt('seed', COMP_SEED);
const SCAN = Number(opt('scan', String(PER_TYPE)));
const OUT = path.resolve(opt('out', path.join(BENCH, 'corpus-sample')));
const SUMS = path.join(BENCH, 'corpus', 'PDF-SHA256SUMS');
const hasPdfs = (dir) => !!dir && fs.existsSync(path.join(dir, 'invoice', 'invoice-000.pdf'));
const CORPUS = [opt('corpus', null), process.env.AIDP_CORPUS_DIR, path.join(BENCH, 'corpus')].find(hasPdfs) ?? null;
if (opt('corpus', null) && !hasPdfs(opt('corpus'))) { console.error(`no AIDP-2K PDFs in ${opt('corpus')}`); process.exit(2); }

const display = (slug) => DOC_TYPES.find((t) => t.slug === slug)?.display ?? slug;
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** The conditions that make a document hard, in the order the sample presents them. */
const HARD = [
  ['attachment', (d) => !!d.attachment, 'a separate attached file that breaks two of its lines down into their parts'],
  ['mismatch', (d) => d.dims.mismatch, 'a printed total that disagrees with the lines beneath it'],
  ['missingTotals', (d) => d.dims.missingTotals, 'no printed total at all, so nothing confirms the line sum'],
  ['stickerMismatch', (d) => d.dims.stickerMismatch, 'a barcode sticker that contradicts the printed line it sits on'],
  ['coverPage', (d) => d.dims.coverPage, 'a cover page in front of the document proper'],
  ['scale=xl', (d) => d.dims.scale === 'xl', 'a line-item table long enough to run over many pages'],
  ['noise=heavy', (d) => d.dims.noise === 'heavy', 'a heavily degraded scan, which is an image-only PDF with no text layer'],
];
const dimKeys = (d) => Object.entries(d.dims ?? {})
  .filter(([, v]) => v !== false && v != null)
  .map(([k, v]) => (v === true ? k : `${k}=${v}`));

console.log(`scanning ${TYPES.length} types x ${SCAN} for the sample selection (seed ${SEED})...`);
const ordinary = [], hard = new Map(), takenHard = new Set();
let bundleDrawn = 0, withAttachment = 0;
for (const slug of TYPES) {
  for (let i = 0; i < SCAN; i++) {
    const d = buildDoc(slug, i, SEED);
    if (d.dims.bundle) bundleDrawn++;
    if (d.attachment) withAttachment++;
    if (i === 0) ordinary.push({ doc: d, index: i, why: `first ${display(slug)}` });
    for (const [key, has, why] of HARD) {
      if (takenHard.has(key) || !has(d)) continue;
      takenHard.add(key);
      // One document can be the first example of several conditions, so the reasons accumulate onto one entry
      // rather than listing the same document twice.
      const prev = hard.get(d.id);
      if (prev) prev.why += `; ${key}: ${why}`;
      else hard.set(d.id, { doc: d, index: i, why: `${key}: ${why}` });
    }
  }
}
const picks = [...ordinary, ...hard.values()];
console.log(`selected ${picks.length} documents (${ordinary.length} ordinary, ${hard.size} hard cases)`);

// The answer key and page text exactly as materialize-gt.mjs and generate.mjs write them.
const keyJson = (doc) => JSON.stringify({
  id: doc.id, slug: doc.slug, category: doc.category, category_alt: doc.category_alt ?? [], mode: doc.mode, locale: doc.locale, dims: doc.dims,
  gt: doc.gt, facts: doc.facts, expected_flags: doc.expectedFlags, expected_derived: doc.expectedDerived,
  expected_flags_future: doc.expectedFuture,
}, null, 1);
const pageText = (doc) => {
  const text = gtText(doc.content);
  return doc.attachment ? combine(text, [attachmentGtText(doc.attachment)]) : text;
};

const expected = new Map();
if (fs.existsSync(SUMS)) for (const line of fs.readFileSync(SUMS, 'utf8').split('\n')) {
  const m = line.match(/^([0-9a-f]{64})  (.+)$/);
  if (m) expected.set(m[2], m[1]);
}

let render = null;
if (!CORPUS) {
  const { chromium } = await import('playwright');
  const { toHtml, attachmentHtml, renderPdf } = await import('../corpus-gen/render.mjs');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  render = {
    async main(doc, index) {
      // Theme and stamp come from the same seeded stream generate.mjs uses, keyed by the document's numeric index,
      // so the drawn page is the page of the full corpus, not a fresh roll of the dice.
      const r = new Rng(`${SEED}:theme:${doc.slug}:${index}`);
      const themeIdx = r.int(0, 3);
      const stamp = doc.content.noiseProfile !== 'none' && r.chance(0.3) ? doc.content.locale.labels.paid : null;
      return renderPdf(page, await toHtml(doc.content, themeIdx, stamp));
    },
    attachment: async (doc) => renderPdf(page, await attachmentHtml(doc.attachment)),
    close: () => browser.close(),
  };
}

const mupdf = await import('mupdf');
function firstPagePng(pdf, maxEdge = 1300) {
  const docu = mupdf.Document.openDocument(new Uint8Array(pdf), 'application/pdf');
  const pages = docu.countPages();
  const page = docu.loadPage(0);
  const [x0, y0, x1, y1] = page.getBounds();
  const scale = maxEdge / Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
  const png = Buffer.from(pix.asPNG());
  pix.destroy?.(); page.destroy?.(); docu.destroy?.();
  return { png, pages };
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const index = [];
let copied = 0, drawn = 0, checked = 0;
for (const { doc, index: i, why } of picks) {
  const files = [{ name: `${doc.id}.pdf`, rel: `${doc.slug}/${doc.id}.pdf`, main: true }];
  if (doc.attachment) files.push({ name: `${doc.id}-att-A.pdf`, rel: `${doc.slug}/${doc.id}-att-A.pdf` });
  let pages = 0;
  for (const f of files) {
    let pdf;
    if (CORPUS) {
      pdf = fs.readFileSync(path.join(CORPUS, f.rel));
      const want = expected.get(f.rel);
      if (want && sha256(pdf) !== want) throw new Error(`${f.rel} does not match PDF-SHA256SUMS`);
      if (want) checked++;
      copied++;
    } else {
      pdf = f.main ? await render.main(doc, i) : await render.attachment(doc);
      drawn++;
    }
    fs.writeFileSync(path.join(OUT, f.name), pdf);
    if (f.main) {
      const shot = firstPagePng(pdf);
      pages = shot.pages;
      fs.writeFileSync(path.join(OUT, `${doc.id}.png`), shot.png);
    }
  }
  const key = keyJson(doc), text = pageText(doc);
  if (CORPUS) {
    for (const [ext, mine] of [['gt.json', key], ['gt.txt', text]]) {
      const theirs = fs.readFileSync(path.join(CORPUS, doc.slug, `${doc.id}.${ext}`), 'utf8');
      if (theirs !== mine) throw new Error(`${doc.id}.${ext}: the generator no longer reproduces the corpus file`);
    }
  }
  fs.writeFileSync(path.join(OUT, `${doc.id}.gt.json`), key);
  fs.writeFileSync(path.join(OUT, `${doc.id}.gt.txt`), text);
  index.push({ id: doc.id, slug: doc.slug, display: display(doc.slug), locale: doc.locale, pages,
    attachment: doc.attachment ? `${doc.id}-att-A.pdf` : null, dims: dimKeys(doc), why });
  process.stdout.write('.');
}
await render?.close();
console.log('');

fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ seed: SEED, source: CORPUS ? 'copied from the AIDP-2K v1.0 files' : 'drawn by the generator', documents: index }, null, 2) + '\n');

const rows = index.map((d) =>
  `| [\`${d.id}\`](${d.id}.png) | ${d.display} | ${d.locale} | ${d.pages} | ${d.dims.join(', ') || 'none'} | [PDF](${d.id}.pdf)${d.attachment ? ` &middot; [attachment](${d.attachment})` : ''} &middot; [answer key](${d.id}.gt.json) &middot; [page text](${d.id}.gt.txt) |`).join('\n');
const reasons = index.slice(ordinary.length).map((d) => `- \`${d.id}\`: ${d.why}.`).join('\n');
fs.writeFileSync(path.join(OUT, 'README.md'), `# Corpus sample

${picks.length === 16 ? 'Sixteen' : picks.length} documents of AIDP-2K, the 2,000-document dataset of AIDP-Bench, so a reader can look at the documents
without downloading all of them. ${CORPUS
    ? 'The PDFs here are the published v1.0 files themselves: each one matches its line in\n[PDF-SHA256SUMS](../corpus/PDF-SHA256SUMS).'
    : 'The PDFs here were drawn by the generator: each has the same pages and text as the published v1.0 file, almost\nalways the same pixels too (see CORPUS.md), and never the same bytes, because it carries the date it was drawn.'}

Each document sits beside its answer key (\`.gt.json\`) and its page text (\`.gt.txt\`). The corpus is written answer key
first: the generator writes the answers, then draws the page from them. So a value a system returns that the answer
key does not hold was never printed, and that is what makes an invented value identifiable rather than arguable.
The \`.png\` file is a preview of the first page.

The first ten are the first document of each type, the ordinary case. The other six are the first document carrying
each hard condition:

${reasons}

In the dimensions column, \`bundle\` means the generator drew the attachment condition for that document. Of the
${bundleDrawn} documents of the corpus drawn for it, the ${withAttachment} with 3 to 8 lines carry an attachment: a second PDF that breaks two
of their lines down into their parts. No file holds two documents. Composition, locales and every hard condition: [CORPUS.md](../CORPUS.md).

| Preview | Type | Locale | Pages | Dimensions | Files |
|---|---|---|---|---|---|
${rows}

To rebuild this folder exactly (with the v1.0 PDFs unpacked into \`aidp-bench/corpus/\`):

\`\`\`bash
node aidp-bench/bench/corpus-sample.mjs
\`\`\`

Without the PDFs it draws them with the generator instead (after \`npx playwright install chromium\`); a drawn PDF
has the same pages and text as the release file, almost always the same pixels (see [CORPUS.md](../CORPUS.md)), and
never the same bytes, because it carries the date it was drawn.
`);
console.log(`sample -> ${OUT}: ${picks.length} documents, ${copied} PDFs copied${checked ? ` (${checked} checked against PDF-SHA256SUMS)` : ''}, ${drawn} drawn`);
