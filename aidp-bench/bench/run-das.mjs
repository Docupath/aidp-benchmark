/**
 * AIDP-Bench runner.
 *
 * Collects raw evidence and nothing else. Every API response is written to disk, one file per document
 * per lane, and scoring happens in a separate pass (score-run.mjs). A scoring change therefore costs
 * nothing to re-apply, and the raw evidence stays available for a third party to re-score.
 *
 *   node bench/run-das.mjs --mode main      --corpus <dir> --out <run dir> --platform-sha <sha> --flags <file>
 *   node bench/run-das.mjs --mode stability --corpus <dir> --out <run dir> --platform-sha <sha> --flags <file>
 *   node bench/run-das.mjs --mode rules     --corpus <dir> --out <run dir> --platform-sha <sha> --flags <file>
 *
 * main       every document of the corpus (or --types, or a pilot --sample N per type), in both lanes:
 *              pipeline (the full lane): the rendered PDF served over HTTP and submitted as a customer
 *                submits it, classification with OCR and then extraction;
 *              prompt (the text lane): the corpus's own correct text, extracted with the correct type.
 * stability  the pre-declared sample samples/stability-v1.json, full lane, three runs per document with
 *            the extraction cache bypassed (no_cache: true on /v2/extractions).
 * rules      the pre-declared sample samples/rules-v1.json, text lane, one extraction per applicable rule
 *            pack, cache bypassed.
 *
 * NOTHING IS DROPPED. A request that fails at the transport level (no connection, a timeout, 408, 429
 * or 5xx) is retried with exponential backoff up to --retries times. A lane still failing after that
 * is written with ok:false and re-queued after the queue drains, round after round with a growing
 * pause, up to --rounds rounds. Whatever still fails then is a permanent failure: it is listed in
 * run-meta.json and the scorer charges it as a total failure in every measure. A response that
 * arrived is never retried because of what it contains: a transport failure is retried, a bad answer
 * never is.
 *
 * RESUMABLE. A lane whose raw file already holds ok:true is skipped; one holding ok:false is retried.
 * run-meta.json is written when the run starts, with the full list of documents planned, and updated
 * when it ends (or is interrupted) with the counts and every permanent failure.
 *
 * Options
 *   --api <url>             the platform API (default http://localhost:4100)
 *   --corpus <dir>          the corpus (manifest.json, PDFs, answer keys, canonical text)
 *   --out <dir>             the run directory; raw/ and run-meta.json are written inside it
 *   --tag <tag>             names the run's external tenant (default: the --out folder name)
 *   --platform-sha <sha>    the platform's git commit, recorded in run-meta.json
 *   --flags <file>          the platform's configuration flag file the API was started with, recorded
 *   --env-file <file>       a dotenv file to read ADMIN_API_TOKEN (and BENCH_VISION_KEY) from when they are not in the
 *                           environment; AIDP_ENV_FILE names one too. There is no default file
 *   --types a,b             restrict to these document types
 *   --sample <n>            main mode only: the first n documents of each type, by id. Omitted, every
 *                           document runs; --sample 200 is the same full run of AIDP-2K
 *   --sample-file <file>    stability or rules mode: override the pre-declared sample
 *   --repeats <n>           stability runs per document (default 3)
 *   --conc <n>              documents in flight (default 6)
 *   --retries <n>           retries per request (default 6)
 *   --rounds <n>            re-queue rounds after the queue drains (default 8), the hard limit of last resort
 *   --backoff-ms <n>        first retry pause (default 2000), doubling, capped at 60 s
 *   --round-pause-ms <n>    pause before re-queue round r is r times this (default 30000, capped at 10 min)
 *   --timeout-ms <n>        one request (default 1,200,000: twenty minutes)
 *   --processing-wait-ms <n>  how long to keep collecting a document the API reports as still
 *                           processing (HTTP 503 processing_in_progress), honouring Retry-After (default
 *                           10,800,000: three hours); polling never spends a retry
 *   --lanes a,b             main mode only: which lanes to run (default pipeline,prompt). The AIDP Score uses
 *                           the full lane only, so --lanes pipeline collects everything the score needs
 *   --port <n>              the local file server for the PDFs (default 8199)
 *
 * Environment (nothing is read from any other place)
 *   ADMIN_API_TOKEN         the platform API's admin token; or put it in the dotenv file named below
 *   AIDP_ENV_FILE           a dotenv file holding ADMIN_API_TOKEN, and BENCH_VISION_KEY for --mode engine; --env-file
 *                           names one too, and wins
 *   BENCH_VISION_URL        --mode engine only: a chat-completions endpoint of the vision model that transcribes
 *                           the pages; BENCH_VISION_KEY its key and BENCH_VISION_MODEL the model. No default
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { RULE_PACKS, buildExpectation } from './rule-packs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.resolve(HERE, '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };

const MODE = opt('mode', 'main');
const API = opt('api', 'http://localhost:4100');
const CORPUS = path.resolve(opt('corpus', path.join(BENCH, 'corpus')));
const OUT = path.resolve(opt('out', path.join(BENCH, 'results', opt('tag', `run-${MODE}`))));
const TAG = opt('tag', path.basename(OUT));
const RAW = path.join(OUT, 'raw');
const META = path.join(OUT, 'run-meta.json');
const PLATFORM_SHA = opt('platform-sha', null);
const FLAGS = opt('flags', null) ? path.resolve(opt('flags')) : null;
const TYPES = opt('types', '') ? opt('types').split(',').map((s) => s.trim()).filter(Boolean) : null;
const PILOT = opt('sample', null) != null ? Number(opt('sample')) : null;
const REPEATS = Number(opt('repeats', '3'));
const CONC = Number(opt('conc', '6'));
const RETRIES = Number(opt('retries', '6'));
const ROUNDS = Number(opt('rounds', '8'));
const BACKOFF = Number(opt('backoff-ms', '2000'));
const ROUND_PAUSE = Number(opt('round-pause-ms', '30000'));
const TIMEOUT = Number(opt('timeout-ms', String(20 * 60 * 1000)));
const PROCESSING_WAIT = Number(opt('processing-wait-ms', String(3 * 60 * 60 * 1000)));
const PORT = Number(opt('port', '8199'));
const LANES = (opt('lanes', '') || 'pipeline,prompt').split(',').map((s) => s.trim()).filter(Boolean);
if (!LANES.length || LANES.some((l) => !['pipeline', 'prompt'].includes(l))) { console.error(`--lanes takes pipeline and/or prompt, got ${opt('lanes')}`); process.exit(2); }
const ET = `aidpbench-${TAG}`;

if (!['main', 'stability', 'rules', 'engine'].includes(MODE)) { console.error(`unknown --mode ${MODE}`); process.exit(2); }
if (!fs.existsSync(path.join(CORPUS, 'manifest.json'))) { console.error(`no corpus manifest at ${CORPUS}`); process.exit(2); }
fs.mkdirSync(RAW, { recursive: true });

/** The document types the classifier may choose between. The platform's catalogue names two of them after a customer
 *  and a contracting platform; the published runner carries neutral labels in their place (specification, Annex B), so
 *  a run against the platform passes the platform's own names with --enabled-types. */
export const ENABLED = (opt('enabled-types', '') || [
  'Invoice', 'Purchase Order', 'Credit Note', 'Customer-Specific Invoice', 'Legal Invoice', 'Freight Invoice', 'Consignment Invoice',
  'Argentine Invoice', 'Consignment Order', 'Quote', 'Receipt', 'Bank Statement', 'Medical Consumption Record', 'Form I-9',
  'General Contract', 'Partnership Agreement', 'Confidentiality Agreement (NDA)', 'E-Signature Platform Contract', 'Execution Record',
].join(',')).split(',').map((s) => s.trim()).filter(Boolean);

// -------------------------------------------------------------------------------------------------
// the plan: which documents, fixed before anything runs
// -------------------------------------------------------------------------------------------------
const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8'));
const byId = new Map(manifest.docs.map((d) => [d.id, d]));
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

function planDocuments() {
  const keep = (d) => !TYPES || TYPES.includes(d.slug);
  if (MODE === 'stability' || MODE === 'rules') {
    const file = path.resolve(opt('sample-file', path.join(HERE, 'samples', MODE === 'stability' ? 'stability-v1.json' : 'rules-v1.json')));
    const s = readJson(file);
    if (!s?.documents) throw new Error(`no sample at ${file}`);
    const missing = s.documents.filter((id) => !byId.has(id));
    if (missing.length) throw new Error(`${missing.length} sampled documents are not in the corpus, first ${missing[0]}`);
    return { docs: s.documents.map((id) => byId.get(id)).filter(keep), sample: { file: path.relative(BENCH, file), seed: s.seed, count: s.count } };
  }
  const byType = {};
  for (const d of manifest.docs) if (keep(d)) (byType[d.slug] ??= []).push(d);
  for (const t of Object.keys(byType)) byType[t].sort((a, b) => a.id.localeCompare(b.id));
  // Emitted ROUND ROBIN across types, so any prefix of an interrupted run is a balanced sample of every
  // type rather than a complete sample of the first few alphabetically.
  const pools = Object.keys(byType).sort().map((t) => (PILOT != null ? byType[t].slice(0, PILOT) : byType[t]));
  const docs = [];
  for (let i = 0; i < Math.max(0, ...pools.map((p) => p.length)); i++) for (const p of pools) if (p[i]) docs.push(p[i]);
  return { docs, sample: PILOT != null ? { pilot_per_type: PILOT } : null };
}
const plan = planDocuments();
const DOCS = plan.docs;

// -------------------------------------------------------------------------------------------------
// run metadata: written at the start, updated at the end
// -------------------------------------------------------------------------------------------------
const sha256 = (p) => { try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch { return null; } };
const t0 = Date.now();
const previous = readJson(META);
const meta = {
  tag: TAG, mode: MODE, status: 'running',
  api: API,
  platform: { git_sha: PLATFORM_SHA, flags_file: FLAGS, flags_sha256: FLAGS ? sha256(FLAGS) : null },
  corpus: { dir: CORPUS, seed: manifest.seed, documents_in_corpus: manifest.docs.length, manifest_sha256: sha256(path.join(CORPUS, 'manifest.json')) },
  lanes: MODE === 'main' ? LANES : MODE === 'stability' ? ['pipeline'] : MODE === 'rules' ? ['prompt'] : ['engine'],
  repeats: MODE === 'stability' ? REPEATS : null,
  sample: plan.sample,
  types: TYPES,
  enabled_document_types: ENABLED,
  retry_policy: { retries_per_request: RETRIES, requeue_rounds: ROUNDS, first_backoff_ms: BACKOFF, max_backoff_ms: 60000, round_pause_ms: ROUND_PAUSE, request_timeout_ms: TIMEOUT, processing_wait_ms: PROCESSING_WAIT, retried_on: 'network error, timeout, HTTP 408, 429 and 5xx, after Retry-After when given; HTTP 503 processing_in_progress is polled after Retry-After without spending a retry; a response that arrived is never retried for its content' },
  concurrency: CONC,
  harness: { node: process.version, host: os.hostname(), argv: args },
  started_at: new Date(t0).toISOString(),
  sessions: [...(previous?.sessions ?? []), { started_at: new Date(t0).toISOString() }],
  finished_at: null,
  documents: DOCS.map((d) => d.id),
  counts: null,
  permanent_failures: null,
};
if (previous?.started_at) meta.first_started_at = previous.first_started_at ?? previous.started_at;
const writeMeta = () => fs.writeFileSync(META, JSON.stringify(meta, null, 1));
writeMeta();

// -------------------------------------------------------------------------------------------------
// transport
// -------------------------------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const p = path.join(CORPUS, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(CORPUS) || !fs.existsSync(p) || !fs.statSync(p).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'application/pdf' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));
const FILE_BASE = `http://localhost:${PORT}`;

// Local harnesses authenticate with the admin token, which runs under the console-internal principal
// and takes external_tenant per call.
function readToken() {
  if (process.env.ADMIN_API_TOKEN) return process.env.ADMIN_API_TOKEN;
  const envFile = opt('env-file', process.env.AIDP_ENV_FILE ?? '');
  if (envFile && fs.existsSync(path.resolve(envFile))) {
    const m = fs.readFileSync(path.resolve(envFile), 'utf8').match(/^ADMIN_API_TOKEN="?([^"\n]+)"?/m);
    if (m) return m[1];
  }
  throw new Error('ADMIN_API_TOKEN not found: set it in the environment, or name a dotenv file holding it with --env-file or AIDP_ENV_FILE');
}
let TOKEN = readToken();

const stats = { requests: 0, retries: 0, transport_failures: 0, processing_polls: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Node's built-in fetch abandons a request whose response headers take longer than 5 minutes. The platform
// holds a slow request for up to 4 min 45 s before answering "still processing", and work done before that
// wait (an instruction, for one) can push the answer past 5 minutes, so the client gave up on answers that
// were on their way. Raise the client's own waits above TIMEOUT, so this runner's timeout and the platform's
// polling decide. Found on the two longest purchase orders of the AIDP v1.0 instruction run.
{
  const SYM = Symbol.for('undici.globalDispatcher.1');
  await fetch('http://127.0.0.1:9/').catch(() => {});
  const Agent = globalThis[SYM]?.constructor;
  if (typeof Agent === 'function') globalThis[SYM] = new Agent({ headersTimeout: TIMEOUT + 300000, bodyTimeout: TIMEOUT + 300000 });
}
const retryable = (status) => status === 408 || status === 429 || status >= 500;

class RequestError extends Error {
  constructor(message, { status = null, transient = true } = {}) { super(message); this.status = status; this.transient = transient; }
}

/** Retry-After as milliseconds: delta-seconds or an HTTP date; null when absent or unreadable. */
function retryAfterMs(header, body) {
  const h = header == null ? '' : String(header).trim();
  if (/^\d+(\.\d+)?$/.test(h)) return Number(h) * 1000;
  if (h) { const t = Date.parse(h); if (!Number.isNaN(t)) return Math.max(0, t - Date.now()); }
  const b = Number(body?.retry_after_seconds);
  return b > 0 ? b * 1000 : null;
}

/**
 * One POST. Three kinds of answer that is not a result:
 *
 *   still processing  HTTP 503 with error "processing_in_progress": the platform ends a long wait while
 *                     the job runs on in the background, and resubmitting the same request collects the
 *                     result. This is polling, not failure: the runner waits for Retry-After (30 s if the
 *                     API names none) and resubmits, for up to --processing-wait-ms, without spending a
 *                     retry.
 *   transient         no connection, a timeout, 408, 429 or any other 5xx: retried with exponential
 *                     backoff, or after Retry-After when the API names one, up to --retries times.
 *   rejected          any other status: not retried here; the lane fails this round and is re-queued.
 */
async function api(pathname, body) {
  const started = Date.now();
  let failures = 0, last;
  for (;;) {
    let waitMs = null;
    stats.requests++;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT);
    try {
      const r = await fetch(`${API}${pathname}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      const text = await r.text();
      let j; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 400) }; }
      if (r.status === 200) return j;
      const msg = `${pathname} ${r.status}: ${String(j.message || j.error || j.raw || '').slice(0, 200)}`;
      waitMs = retryAfterMs(r.headers.get('retry-after'), j);
      if (r.status === 503 && (j.error === 'processing_in_progress' || /still processing/i.test(String(j.message ?? '')))) {
        if (Date.now() - started > PROCESSING_WAIT) throw new RequestError(`${pathname} still processing after ${Math.round((Date.now() - started) / 60000)} min`, { status: 503 });
        stats.processing_polls++;
        await sleep(Math.min(waitMs ?? 30000, 600000));
        continue;
      }
      if (r.status === 401) { TOKEN = readToken(); last = new RequestError(msg, { status: 401 }); }
      else if (!retryable(r.status)) throw new RequestError(msg, { status: r.status, transient: false });
      else last = new RequestError(msg, { status: r.status });
    } catch (e) {
      if (e instanceof RequestError && (!e.transient || /still processing after/.test(e.message))) throw e;
      last = e instanceof RequestError ? e : new RequestError(`${pathname} ${e?.name === 'AbortError' ? `timed out after ${TIMEOUT} ms` : String(e?.message ?? e)}`);
      stats.transport_failures++;
    } finally {
      clearTimeout(timer);
    }
    if (++failures > RETRIES) throw last;
    stats.retries++;
    await sleep(waitMs != null ? Math.min(waitMs, 600000) : Math.min(60000, BACKOFF * 2 ** (failures - 1)) * (0.75 + Math.random() * 0.5));
  }
}

// A document is classified and extracted under the SAME external tenant and external id, as in production, so the
// extraction finds the reading the classification stored (page evidence: OCR words, text layer, layout).
async function classify(doc, et, idSuffix = '') {
  return api('/v2/classification', {
    external_tenant: et,
    external_id: doc.id + idSuffix,
    pdf_url: `${FILE_BASE}/${doc.file}`,
    enabled_document_types: ENABLED,
    include_ocr: true,
    ...(doc.attachments?.length
      ? { attachments: doc.attachments.map((a) => ({ url: `${FILE_BASE}/${a.file}`, external_attachment_id: a.external_attachment_id })) }
      : {}),
  });
}

async function extract({ doc, lane, pagified, docType, summaryJson, instruction, noCache, suffix = '' }) {
  return api('/v2/extractions', {
    external_tenant: `${ET}-${lane}`,
    external_id: doc.id + suffix,
    pagified_text: pagified,
    doc_type: docType,
    ...(summaryJson ? { summary_json: summaryJson } : {}),
    ...(instruction ? { custom_instructions: instruction } : {}),
    ...(noCache ? { no_cache: true } : {}),
    include_impact: true,
    trading_parties: { primary: '', secondary: '' },
  });
}

/** What is kept of an extraction response: everything the scorer reads, and the platform's own
 *  document decision (field_report.document), which is what "routed to a person" is read from. */
const keepExtraction = (ex) => ({
  extraction: ex.extraction ?? {},
  derived_fields: ex.derived_fields ?? null,
  field_confidence: ex.field_confidence ?? null,
  field_report: ex.field_report?.document ? { document: ex.field_report.document } : null,
  impact: ex.custom_instruction_impact ?? null,
  token_usage: ex.token_usage ?? null,
  cache_hit: ex.cache_hit ?? null,
  doc_type: ex.doc_type ?? null,
  document_id: ex.document_id ?? null,
  request_id: ex.request_id ?? null,
});

// -------------------------------------------------------------------------------------------------
// one item of work
// -------------------------------------------------------------------------------------------------
const rawPath = (id, lane) => path.join(RAW, `${id}.${lane}.json`);
const writeRaw = (id, lane, obj) => {
  const p = rawPath(id, lane);
  fs.writeFileSync(p + '.tmp', JSON.stringify(obj));
  fs.renameSync(p + '.tmp', p);
};
const gtOf = (doc) => JSON.parse(fs.readFileSync(path.join(CORPUS, doc.gt), 'utf8'));
const textOf = (doc) => fs.readFileSync(path.join(CORPUS, doc.text), 'utf8');
const errText = (e) => String(e?.message ?? e).slice(0, 300);

async function fullLane(doc) {
  const c0 = Date.now();
  const c = await classify(doc, `${ET}-pipeline`);
  const cls = { category: c.document_category, ms: Date.now() - c0, tokens: c.token_usage?.total ?? null, cache_hit: c.cache_hit ?? null };
  const e0 = Date.now();
  const ex = await extract({ doc, lane: 'pipeline', pagified: c.pagified_text ?? '', docType: c.document_category, summaryJson: c.summary?.DocumentSummary ?? c.summary ?? undefined });
  return { classification: cls, ocr_text: c.pagified_text ?? '', ms: Date.now() - e0, ...keepExtraction(ex) };
}

/** main: one document, one lane. Returns true on success. */
async function runMainItem({ doc, lane }) {
  const prev = readJson(rawPath(doc.id, lane));
  if (prev?.ok) return 'skipped';
  const attempts = (prev?.attempts ?? 0) + 1;
  const rec = { id: doc.id, slug: doc.slug, lane, ts: new Date().toISOString(), attempts };
  try {
    if (lane === 'pipeline') Object.assign(rec, await fullLane(doc));
    else {
      const e0 = Date.now();
      const ex = await extract({ doc, lane, pagified: textOf(doc), docType: gtOf(doc).category });
      Object.assign(rec, { ms: Date.now() - e0, ...keepExtraction(ex) });
    }
    rec.ok = true;
  } catch (e) {
    rec.ok = false; rec.error = errText(e); rec.status = e?.status ?? null;
  }
  writeRaw(doc.id, lane, rec);
  return rec.ok ? 'ok' : 'failed';
}

/** stability: one document, REPEATS full-lane runs with the extraction cache bypassed. Runs that
 *  already succeeded are kept; only the missing or failed ones are run again. */
async function runStabilityItem({ doc }) {
  const prev = readJson(rawPath(doc.id, 'stability'));
  const runs = Array.from({ length: REPEATS }, (_, i) => prev?.runs?.find((r) => r?.i === i) ?? null);
  if (runs.every((r) => r?.ok)) return 'skipped';
  const rec = { id: doc.id, slug: doc.slug, lane: 'stability', ts: new Date().toISOString(), attempts: (prev?.attempts ?? 0) + 1, runs };
  for (let i = 0; i < REPEATS; i++) {
    if (runs[i]?.ok) continue;
    try {
      // Each repeat is its own submission (external id `<doc>--r<i>`, so the platform's duplicate checks see later copies
      // of an earlier document), classified and extracted under that same id, so each repeat finds its own reading.
      const c = await classify(doc, `${ET}-stability`, `--r${i}`);
      const ex = await extract({ doc, lane: 'stability', pagified: c.pagified_text ?? '', docType: c.document_category, summaryJson: c.summary?.DocumentSummary ?? c.summary ?? undefined, noCache: true, suffix: `--r${i}` });
      const kept = keepExtraction(ex);
      runs[i] = { i, ok: true, classification: { category: c.document_category, cache_hit: c.cache_hit ?? null }, extraction: kept.extraction, field_report: kept.field_report, cache_hit: kept.cache_hit, output_hash: ex.output_hash ?? null };
    } catch (e) {
      runs[i] = { i, ok: false, error: errText(e) };
    }
    writeRaw(doc.id, 'stability', rec);
  }
  rec.ok = runs.every((r) => r?.ok);
  writeRaw(doc.id, 'stability', rec);
  return rec.ok ? 'ok' : 'failed';
}

/** rules: one document, every applicable rule pack in the text lane, cache bypassed. */
async function runRulesItem({ doc }) {
  const gtj = gtOf(doc);
  const packs = RULE_PACKS.filter((p) => p.applies(gtj));
  const prev = readJson(rawPath(doc.id, 'rules'));
  const done = new Map((prev?.packs ?? []).filter((p) => p.ok).map((p) => [p.id, p]));
  if (packs.every((p) => done.has(p.id)) && prev) return 'skipped';
  const rec = { id: doc.id, slug: doc.slug, lane: 'rules', ts: new Date().toISOString(), attempts: (prev?.attempts ?? 0) + 1, packs: [] };
  const pagified = textOf(doc);
  for (const pack of packs) {
    if (done.has(pack.id)) { rec.packs.push(done.get(pack.id)); continue; }
    const entry = { id: pack.id, instruction: pack.instruction };
    try {
      const ex = await extract({ doc, lane: 'rules', pagified, docType: gtj.category, instruction: pack.instruction, noCache: true, suffix: `--${pack.id}` });
      entry.extraction = ex.extraction ?? {};
      entry.impact = ex.custom_instruction_impact ?? null;
      entry.expect = buildExpectation(pack, gtj);
      entry.cache_hit = ex.cache_hit ?? null;
      entry.ok = true;
    } catch (e) { entry.ok = false; entry.error = errText(e); }
    rec.packs.push(entry);
  }
  rec.ok = rec.packs.every((p) => p.ok);
  writeRaw(doc.id, 'rules', rec);
  return rec.ok ? 'ok' : 'failed';
}

// ---- Cross-engine lane (diagnostic only): a second, independent reader over the same pages -------
// It rasterises the PDF and has a vision model transcribe it, then runs the identical extraction, so
// a disagreement says whether a miss was a reading problem or a comprehension problem.
// mupdf (GNU AGPL-3.0-or-later) rasterises the pages; it is loaded only by this optional lane.
let mupdfP = null;
const loadMupdf = () => (mupdfP ??= import('mupdf'));
async function rasterize(pdfPath, maxPages = 3, maxEdge = 1400) {
  const mupdf = await loadMupdf();
  const docu = mupdf.Document.openDocument(new Uint8Array(fs.readFileSync(pdfPath)), 'application/pdf');
  const n = Math.min(docu.countPages(), maxPages);
  const out = [];
  for (let i = 0; i < n; i++) {
    const page = docu.loadPage(i);
    const [x0, y0, x1, y1] = page.getBounds();
    const scale = maxEdge / Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
    out.push(`data:image/png;base64,${Buffer.from(pix.asPNG()).toString('base64')}`);
    pix.destroy?.(); page.destroy?.();
  }
  const total = docu.countPages();
  docu.destroy?.();
  return { images: out, totalPages: total };
}
async function runEngineItem({ doc }) {
  if (readJson(rawPath(doc.id, 'engine'))?.ok) return 'skipped';
  const rec = { id: doc.id, slug: doc.slug, lane: 'engine', engine: 'vision', ts: new Date().toISOString() };
  try {
    const { images, totalPages } = await rasterize(path.join(CORPUS, doc.file));
    const envFile = opt('env-file', process.env.AIDP_ENV_FILE ?? '');
    const key = process.env.BENCH_VISION_KEY || (envFile && fs.existsSync(path.resolve(envFile))
      ? fs.readFileSync(path.resolve(envFile), 'utf8').match(/^BENCH_VISION_KEY="?([^"\n]+)"?/m)?.[1] ?? '' : '');
    if (!key || !process.env.BENCH_VISION_URL || !process.env.BENCH_VISION_MODEL) throw new Error('--mode engine needs BENCH_VISION_URL, BENCH_VISION_MODEL and BENCH_VISION_KEY (environment, or the key in the dotenv file named by --env-file or AIDP_ENV_FILE)');
    const pages = [];
    for (const img of images) {
      const r = await fetch(process.env.BENCH_VISION_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: process.env.BENCH_VISION_MODEL, messages: [{ role: 'user', content: [
          { type: 'text', text: 'Transcribe this document page to plain text. Preserve reading order. Render every table as pipe-separated markdown rows like | a | b | c |. Transcribe verbatim, do not translate, do not summarise, output only the transcription.' },
          { type: 'image_url', image_url: { url: img, detail: 'high' } },
        ] }] }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(`vision ${r.status}: ${String(j?.error?.message ?? '').slice(0, 140)}`);
      pages.push(j.choices?.[0]?.message?.content ?? '');
    }
    rec.ocr_text = pages.map((p, i) => `# --- | Page ${i + 1} | --- #\n\n${p.trim()}`).join('\n\n');
    rec.pages_read = images.length; rec.total_pages = totalPages;
    const ex = await extract({ doc, lane: 'engine', pagified: rec.ocr_text, docType: gtOf(doc).category, suffix: '--eng' });
    Object.assign(rec, keepExtraction(ex));
    rec.ok = true;
  } catch (e) { rec.ok = false; rec.error = errText(e); }
  writeRaw(doc.id, 'engine', rec);
  return rec.ok ? 'ok' : 'failed';
}

// -------------------------------------------------------------------------------------------------
// the queue, the re-queue rounds, and the end of the run
// -------------------------------------------------------------------------------------------------
const RUNNER = { main: runMainItem, stability: runStabilityItem, rules: runRulesItem, engine: runEngineItem }[MODE];
const items = MODE === 'main' ? DOCS.flatMap((doc) => LANES.map((lane) => ({ doc, lane }))) : DOCS.map((doc) => ({ doc, lane: MODE }));
const tally = { ok: 0, skipped: 0, failed_attempts: 0 };

function finish(status, failures) {
  meta.status = status;
  meta.finished_at = new Date().toISOString();
  meta.sessions[meta.sessions.length - 1].finished_at = meta.finished_at;
  meta.sessions[meta.sessions.length - 1].status = status;
  meta.elapsed_s = Math.round((Date.now() - t0) / 1000);
  // Counted from what is on disk, so a resumed run reports the whole run and not only this session.
  let okOnDisk = 0;
  for (const it of items) { const r = readJson(rawPath(it.doc.id, it.lane)); if (r?.ok) okOnDisk++; }
  meta.counts = {
    documents: DOCS.length, items_planned: items.length, items_ok: okOnDisk, items_failed: items.length - okOnDisk,
    this_session: { ran_ok: tally.ok, already_done: tally.skipped, failed_attempts: tally.failed_attempts, ...stats },
  };
  meta.permanent_failures = failures;
  writeMeta();
}
let interrupted = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    console.log(`\n${sig}: recording progress in run-meta.json; run the same command again to resume`);
    finish('interrupted', null);
    server.close();
    process.exit(130);
  });
}

console.log(`AIDP-Bench run "${TAG}": mode=${MODE} documents=${DOCS.length} items=${items.length} conc=${CONC} api=${API}`);
console.log(`  raw evidence -> ${RAW}`);
let queue = items;
let failures = [];
for (let round = 0; round <= ROUNDS && queue.length; round++) {
  if (round) {
    const pause = Math.min(10 * 60000, ROUND_PAUSE * round);
    console.log(`  round ${round}: ${queue.length} item(s) still failing, re-queued after ${Math.round(pause / 1000)} s`);
    await sleep(pause);
  }
  const next = [];
  const work = [...queue];
  let done = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    for (;;) {
      const it = work.shift();
      if (!it) return;
      const res = await RUNNER(it);
      if (res === 'ok') tally.ok++;
      else if (res === 'skipped') tally.skipped++;
      else { tally.failed_attempts++; next.push(it); }
      done++;
      if (done % 20 === 0 || done === queue.length) {
        const el = (Date.now() - t0) / 1000;
        console.log(`  [${MODE} round ${round}] ${done}/${queue.length}  ok=${tally.ok} done-before=${tally.skipped} failing=${next.length}  ${Math.round(el)}s`);
      }
    }
  }));
  queue = next;
}
failures = queue.map((it) => {
  const r = readJson(rawPath(it.doc.id, it.lane));
  return { id: it.doc.id, slug: it.doc.slug, lane: it.lane, error: r?.error ?? r?.runs?.find((x) => !x?.ok)?.error ?? r?.packs?.find((x) => !x.ok)?.error ?? 'unknown', attempts: r?.attempts ?? null };
});
server.close();
finish(failures.length ? 'complete-with-failures' : 'complete', failures);
console.log(`done in ${meta.elapsed_s}s: ${meta.counts.items_ok}/${meta.counts.items_planned} items ok, ${failures.length} permanent failure(s)`);
if (failures.length) console.log('  permanent failures are listed in run-meta.json and score as total failures');
