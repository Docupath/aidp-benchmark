/**
 * Shared helpers for the post-run diagnostics (spec section 7.6). Nothing here calls a model, an API or
 * a service: it reads the corpus, the run's kept outputs and, for the figures that need them, the
 * evidence files export-db.mjs wrote from the database. The database itself is read only by
 * export-db.mjs, so every figure can be recomputed by someone who holds the published files alone.
 *
 * Which run, and paths (all overridable, by option or environment; every default is the AIDP v1.0
 * reference run, so that with no option the figures are its published ones):
 *   --corpus <dir>            AIDP-2K: manifest.json, PDFs, answer keys, correct texts (AIDP_CORPUS)
 *   --main-tag <tag>          the main run's tag (AIDP_MAIN_TAG; default aidp-v1-main): its kept outputs are
 *                             results/<tag>, its external tenants aidpbench-<tag>-pipeline and -prompt
 *   --stability-tag <tag>     the repeatability run's tag (AIDP_STABILITY_TAG; default the main tag with its
 *                             "-main" ending replaced by "-stability", so aidp-v1-stability)
 *   --cls-tenant lane|cls     where the runner classified each document (AIDP_CLS_TENANT; default lane):
 *                               lane  under the lane's own tenant (-pipeline, -stability) and the same external
 *                                     id as its extraction: <id>, or <id>--r<i> for a repeat, as bench/run-das.mjs
 *                                     sends them
 *                               cls   under a separate tenant, aidpbench-<tag>-cls, by the document's own id
 *   --stability-ids suffixed|shared   the repeatability lane's external ids (AIDP_STABILITY_IDS; default
 *                             suffixed): suffixed is <id>--r0, --r1, --r2, one submission per repeat, as
 *                             bench/run-das.mjs sends them; shared is the document's own id on every repeat
 *   --db <name>               the run's database, read only by export-db.mjs (AIDP_DB; default aidp_v1)
 *   --run <dir>               the main run's folder (default results/<main tag>)
 *   --stability <dir>         the repeatability run's folder (default results/<stability tag>)
 *   --out <dir>               where the post-run figures are written (AIDP_OUT; default <run>/post-run)
 *   --allow-incomplete        compute from a run that has not finished, as a preview (requireFinished)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from '../scoring.mjs';
import { buildDoc } from '../../corpus-gen/data.mjs';
import { Rng } from '../../corpus-gen/rng.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BENCH = path.resolve(HERE, '..', '..');
export const args = process.argv.slice(2);
export const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };

export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const readJsonOr = (p, d = null) => { try { return readJson(p); } catch { return d; } };
export function readJsonl(p) {
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}
export function writeJsonl(p, rows) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}
export function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 1) + '\n');
}
export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
export const sha256File = (p) => sha256(fs.readFileSync(p));
export const rate = (p, n) => (n ? p / n : null);
export const pct = (p, n, d = 2) => (n ? `${((p / n) * 100).toFixed(d)}%` : 'n/a');

/** A wall-clock instant as IST (GMT+05:30), labelled, the form every time in these files takes. */
export function toIST(t) {
  const d = t instanceof Date ? t : new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  const ist = new Date(d.getTime() + 330 * 60000);
  return ist.toISOString().replace('Z', '+05:30');
}

/** The AIDP v1.0 reference run: what every run-selection option defaults to. */
export const REFERENCE = { mainTag: 'aidp-v1-main', stabilityTag: 'aidp-v1-stability', clsTenant: 'lane', db: 'aidp_v1' };
const pick = (name, env, d) => opt(name, process.env[env] ?? d);
const oneOf = (name, v, allowed) => {
  if (!allowed.includes(v)) throw new Error(`--${name} must be ${allowed.join(' or ')}, not "${v}"`);
  return v;
};

/** The run and the corpus, resolved once. */
let CTX = null;
export function context() {
  if (CTX) return CTX;
  const corpusDir = path.resolve(opt('corpus', process.env.AIDP_CORPUS ?? path.join(BENCH, 'corpus')));
  if (!fs.existsSync(path.join(corpusDir, 'manifest.json'))) {
    throw new Error(`no corpus at ${corpusDir}: pass --corpus <AIDP-2K dir> (manifest.json, PDFs, answer keys)`);
  }
  // ---- which run: its tags, folders, external tenants and database
  const tagArg = pick('main-tag', 'AIDP_MAIN_TAG', null);
  const runDir = path.resolve(opt('run', path.join(BENCH, 'results', tagArg ?? REFERENCE.mainTag)));
  const runMeta = readJsonOr(path.join(runDir, 'run-meta.json'));
  const tag = tagArg ?? runMeta?.tag ?? path.basename(runDir);
  const stabTagArg = pick('stability-tag', 'AIDP_STABILITY_TAG', null);
  const stabDir = path.resolve(opt('stability', path.join(BENCH, 'results', stabTagArg ?? `${tag.replace(/-main$/, '')}-stability`)));
  const stabMeta = readJsonOr(path.join(stabDir, 'run-meta.json'));
  const stabTag = stabTagArg ?? stabMeta?.tag ?? path.basename(stabDir);
  // The runner names its tenants after the tag it records in run-meta.json: a folder holding another run would mix two runs.
  for (const [t, m, d] of [[tag, runMeta, runDir], [stabTag, stabMeta, stabDir]]) {
    if (m?.tag && m.tag !== t) throw new Error(`${d} holds the run tagged "${m.tag}", not "${t}": pass the matching --main-tag and --stability-tag (or --run and --stability)`);
  }
  const clsTenant = oneOf('cls-tenant', pick('cls-tenant', 'AIDP_CLS_TENANT', REFERENCE.clsTenant), ['cls', 'lane']);
  const idsDefault = 'suffixed';
  const stabilityIds = oneOf('stability-ids', pick('stability-ids', 'AIDP_STABILITY_IDS', idsDefault), ['suffixed', 'shared']);
  const db = pick('db', 'AIDP_DB', REFERENCE.db);
  // run-das.mjs: ET = aidpbench-<tag>; a lane extracts under <ET>-<lane>; classification under the lane's own tenant, or under <ET>-cls (--cls-tenant cls).
  const et = `aidpbench-${tag}`, es = `aidpbench-${stabTag}`;
  const tenants = {
    mainCls: clsTenant === 'cls' ? `${et}-cls` : `${et}-pipeline`,
    mainPipeline: `${et}-pipeline`,
    mainPrompt: `${et}-prompt`,
    stabCls: clsTenant === 'cls' ? `${es}-cls` : `${es}-stability`,
    stab: `${es}-stability`,
  };
  // The options that select this run, for the reproduce lines of summary.json: none for the reference run.
  const selectionArgs = [
    ...(tag !== REFERENCE.mainTag || stabTag !== REFERENCE.stabilityTag ? ['--main-tag', tag, '--stability-tag', stabTag] : []),
    ...(clsTenant !== REFERENCE.clsTenant ? ['--cls-tenant', clsTenant] : []),
    ...(stabilityIds !== idsDefault ? ['--stability-ids', stabilityIds] : []),
  ].join(' ');
  const outDir = path.resolve(opt('out', process.env.AIDP_OUT ?? path.join(runDir, 'post-run')));
  const corpus = loadCorpus(corpusDir);
  CTX = {
    corpusDir, runDir, rawDir: path.join(runDir, 'raw'), stabDir, outDir,
    dbDir: path.join(outDir, 'db-export'),
    corpus, manifest: corpus.manifest, seed: corpus.manifest.seed,
    manifestSha256: sha256File(path.join(corpusDir, 'manifest.json')),
    runMeta,
    stabMeta,
    tag, stabTag, clsTenant, stabilityIds, db, tenants, selectionArgs,
  };
  return CTX;
}

/**
 * Refuse a run that has not finished (run-meta.json says "running" or "interrupted"): its kept outputs and its
 * database rows are partial, and figures computed from them would read as the run's. A run that finished with
 * permanent failures ("complete-with-failures") is a finished run. --allow-incomplete overrides, for a preview.
 */
export function requireFinished(ctx) {
  if (args.includes('--allow-incomplete')) return;
  for (const [what, m, dir] of [['main run', ctx.runMeta, ctx.runDir], ['repeatability run', ctx.stabMeta, ctx.stabDir]]) {
    if (m && !String(m.status).startsWith('complete')) {
      throw new Error(`the ${what} in ${dir} is "${m.status}", not finished: run the post-run diagnostics once it completes (or pass --allow-incomplete for a preview from what exists so far)`);
    }
  }
}

/** The page-lane (full-lane) evidence the runner kept for one document. */
export const pipelineRaw = (ctx, id) => readJsonOr(path.join(ctx.rawDir, `${id}.pipeline.json`));

// -------------------------------------------------------------------------------------------------
// the generator, reproduced exactly
// -------------------------------------------------------------------------------------------------
/**
 * The document as corpus-gen/generate.mjs built and rendered it, from the generator's own code: the
 * content model (buildDoc), and the theme and stamp drawn from the theme stream exactly as generate.mjs
 * lines 39 to 42 draw them, seeded "<seed>:theme:<slug>:<index>" with the NUMERIC index (0, not "000").
 */
export function generated(doc, seed) {
  const index = Number(doc.id.slice(doc.slug.length + 1));
  const g = buildDoc(doc.slug, index, seed);
  if (g.id !== doc.id) throw new Error(`generator id ${g.id} is not ${doc.id}`);
  const r = new Rng(`${seed}:theme:${doc.slug}:${index}`);
  const themeIdx = r.int(0, 3);
  const stamp = g.content.noiseProfile !== 'none' && r.chance(0.3) ? g.content.locale.labels.paid : null;
  return { g, content: g.content, attachment: g.attachment ?? null, themeIdx, stamp, label: g.content.locale.labels.paid };
}

/** render.mjs THEMES[i].accent, the colour of the stamp's border and text. */
export const THEME_ACCENTS = ['#1a3c6e', '#5b2120', '#222', '#0b5e4f'];

// -------------------------------------------------------------------------------------------------
// the system's page-lane reading
// -------------------------------------------------------------------------------------------------
export const ATTACHMENTS_HEAD = '##Attachments----------------------------';
export const PAGE_MARKER = /# --- \| Page (\d+) \| --- #/g;

/** The reading split into the main file's part and one part per attachment, in submission order. */
export function splitReading(text) {
  const t = String(text ?? '');
  const i = t.indexOf(ATTACHMENTS_HEAD);
  if (i < 0) return { main: t, attachments: [] };
  const rest = t.slice(i + ATTACHMENTS_HEAD.length);
  return { main: t.slice(0, i), attachments: rest.split(/\n-{28}\n/).map((s) => s.trim()).filter(Boolean) };
}

/** The pages of one part: [{ n, body }] for every page marker, the body running to the next marker. */
export function pagesOf(part) {
  const marks = [...String(part ?? '').matchAll(PAGE_MARKER)].map((m) => ({ n: Number(m[1]), at: m.index, end: m.index + m[0].length }));
  return marks.map((k, j) => ({ n: k.n, body: part.slice(k.end, j + 1 < marks.length ? marks[j + 1].at : part.length) }));
}

/**
 * The tags the platform's page reading writes for marks and for what it could not read.
 */
export const LEGIBILITY_TAGS = ['obscured', 'illegible', 'cut off'];
export const MARK_TAGS = ['struck', 'ticked', 'circled', 'highlighted', 'x', ' '];
export const TAG_RE = /\[(struck|ticked|circled|highlighted|cut off|obscured|illegible|x| )\]/g;

// -------------------------------------------------------------------------------------------------
// PDFs (mupdf, the same library the bench already uses in corpus-sample.mjs and run-das.mjs)
// -------------------------------------------------------------------------------------------------
let mupdfP = null;
export function loadMupdf() {
  mupdfP ??= (async () => {
    try { return await import('mupdf'); } catch {
      throw new Error('the mupdf package reads the PDFs: run npm install at the repository root first');
    }
  })();
  return mupdfP;
}

/** Open a PDF, hand it to fn, and always free it (mupdf objects live in WebAssembly memory). */
export async function withPdf(file, fn) {
  const mupdf = await loadMupdf();
  const docu = mupdf.Document.openDocument(new Uint8Array(fs.readFileSync(file)), 'application/pdf');
  try { return await fn(docu, mupdf); } finally { docu.destroy?.(); }
}

/**
 * One page's text layer and images: lines with their characters (quads) and every image block.
 *
 * The walker hands each callback a Font or Image wrapper that holds its own reference (mupdf.js keeps
 * it on construction) and lets it go only when the garbage collector finalises the wrapper. Over a
 * corpus that keeps every page image of a rasterised PDF alive and exhausts the WebAssembly heap, so
 * each wrapper is released as soon as it has been read.
 */
export function pageLayer(page) {
  const st = page.toStructuredText('preserve-images');
  const lines = [], images = [];
  let cur = null;
  try {
    st.walk({
      beginLine(bbox, wmode, dir) { cur = { bbox: [...bbox], dir: [...dir], text: '', chars: [] }; },
      onChar(c, origin, font, size, quad) { font?.destroy?.(); if (cur) { cur.text += c; cur.chars.push({ c, quad: [...quad], size }); } },
      endLine() { if (cur) lines.push(cur); cur = null; },
      onImageBlock(bbox, tm, image) { images.push({ bbox: [...bbox], tm: [...tm], w: image.getWidth(), h: image.getHeight() }); image?.destroy?.(); },
    });
  } finally { st.destroy?.(); }
  return { lines, images };
}

/** A PNG of one region of a page (rect in PDF points), for the by-eye evidence. */
export function renderCropPng(page, mupdf, rect, scale = 3) {
  const [x0, y0, x1, y1] = rect.map((v) => Math.round(v * scale));
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [x0, y0, x1, y1], false);
  try {
    pix.clear(255);
    const dev = new mupdf.DrawDevice(mupdf.Matrix.identity, pix);
    page.run(dev, mupdf.Matrix.scale(scale, scale));
    dev.close();
    dev.destroy?.();
    return Buffer.from(pix.asPNG());
  } finally { pix.destroy?.(); }
}

/** Render a page to an RGB pixmap at `scale` and hand back the raw pixels (the pixmap is freed). */
export function renderRgb(page, mupdf, scale) {
  const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
  try {
    return { w: pix.getWidth(), h: pix.getHeight(), n: pix.getNumberOfComponents(), px: Uint8Array.from(pix.getPixels()) };
  } finally { pix.destroy?.(); }
}

// -------------------------------------------------------------------------------------------------
// the database evidence (written by export-db.mjs, read by the figures)
// -------------------------------------------------------------------------------------------------
export function dbExport(ctx, name) {
  const p = path.join(ctx.dbDir, name);
  const rows = readJsonl(p);
  if (!rows) throw new Error(`missing ${p}: run "node bench/post-run/export-db.mjs" against the run's database first`);
  return rows;
}

/** Squashed text: lower case, letters and digits of any script only. */
export const squash = (v) => String(v ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
