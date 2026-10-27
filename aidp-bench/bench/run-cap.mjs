/**
 * AIDP-Bench runner for AIDP-CAP, the capability set.
 *
 * Collects raw evidence and nothing else, exactly as run-das.mjs does for AIDP-2K: every answer is written to disk,
 * one file per document per lane, and scoring is a separate pass (score-cap.mjs). Transport failures are retried, a
 * lane still failing is re-queued round after round, and whatever fails after the last round is a permanent failure,
 * listed in run-meta.json and scored as a total failure. An answer that arrived is never retried for its content.
 *
 *   node bench/run-cap.mjs --mode main      --corpus <AIDP-CAP dir> --out <run dir> --platform-sha <sha> --flags <file>
 *   node bench/run-cap.mjs --mode split     ...   every file of manifest.bundles, to the document splitting endpoint
 *   node bench/run-cap.mjs --mode contract  ...   the contract sample, full lane, under the customer's contract
 *   node bench/run-cap.mjs --mode rules     ...   the instructions sample, text lane, once with no instruction and
 *                                                  once per applicable rule pack (rule-packs-cap.mjs)
 *
 * main      THE CUSTOMER'S ACCOUNT. One new account (external tenant aidpbench-<tag>-pipeline). Every extraction
 *           carries the customer's setup, as the platform's own customer configuration reaches it: the supplier list
 *           and the bank master as supporting files (catalogues), the rules that look a document's supplier up in
 *           them and check its bank account (transformation_rules), and the flag those rules may raise. The
 *           purchase-order matching policy is switched on for the account after its first extraction. Phase A
 *           runs first, then phase B (the documents that refer to earlier ones, and the copies sent twice). When
 *           every lane is in, the value locations (field-geometry) of every document and the matching verdicts of
 *           every phase-B document are collected; both are read-only and cost nothing.
 * split     one request per file to POST /v2/split, under its own account.
 * contract  the contract sample, as in main, under its own account, with the customer's output instructions.
 * rules     the instructions sample in the text lane (the document's correct text), extraction cache bypassed, under
 *           its own account with no customer setup: the no-instruction baseline twice, then each instruction.
 *
 * Options as run-das.mjs (--api, --tag, --conc, --retries, --rounds, --backoff-ms, --round-pause-ms, --timeout-ms,
 * --processing-wait-ms, --port, --env-file, --enabled-types), plus --only <id,id> to run some documents (a smoke
 * test; the run's record says so).
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { applicablePacks } from './rule-packs-cap.mjs';
import { CUSTOMER_RULES, CUSTOMER_FLAGS, CONTRACT_INSTRUCTIONS } from './cap-customer.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const MODE = opt('mode', 'main');
if (!['main', 'split', 'contract', 'rules'].includes(MODE)) { console.error(`unknown --mode ${MODE}`); process.exit(2); }
const API = opt('api', 'http://localhost:4100');
const CORPUS = path.resolve(opt('corpus', path.join(HERE, '..', 'corpus-cap')));
const OUT = path.resolve(opt('out'));
const TAG = opt('tag', path.basename(OUT));
const RAW = path.join(OUT, 'raw');
const META = path.join(OUT, 'run-meta.json');
const PLATFORM_SHA = opt('platform-sha', null);
const FLAGS = opt('flags', null) ? path.resolve(opt('flags')) : null;
const CONC = Number(opt('conc', '8'));
const RETRIES = Number(opt('retries', '6'));
const ROUNDS = Number(opt('rounds', '8'));
const BACKOFF = Number(opt('backoff-ms', '2000'));
const ROUND_PAUSE = Number(opt('round-pause-ms', '30000'));
const TIMEOUT = Number(opt('timeout-ms', String(20 * 60 * 1000)));
const PROCESSING_WAIT = Number(opt('processing-wait-ms', String(3 * 60 * 60 * 1000)));
const PORT = Number(opt('port', '8189'));
const ONLY = opt('only', '') ? new Set(opt('only').split(',')) : null;
const ET = `aidpbench-${TAG}`;
const LANE = { main: 'pipeline', split: 'split', contract: 'contract', rules: 'rules' }[MODE];
const ENABLED = (opt('enabled-types', '') || [
  'Invoice', 'Purchase Order', 'Credit Note', 'Customer-Specific Invoice', 'Legal Invoice', 'Freight Invoice', 'Consignment Invoice',
  'Argentine Invoice', 'Consignment Order', 'Quote', 'Receipt', 'Bank Statement', 'Medical Consumption Record', 'Form I-9',
  'General Contract', 'Partnership Agreement', 'Confidentiality Agreement (NDA)', 'E-Signature Platform Contract', 'Execution Record',
].join(',')).split(',').map((s) => s.trim()).filter(Boolean);

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const sha256 = (p) => { try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch { return null; } };
const manifest = readJson(path.join(CORPUS, 'manifest.json'));
if (!manifest || manifest.corpus !== 'AIDP-CAP') { console.error(`no AIDP-CAP manifest at ${CORPUS}`); process.exit(2); }
if (manifest.pilot != null && !ONLY) { console.error('this corpus was drawn with --pilot; a run needs the whole corpus'); process.exit(2); }
fs.mkdirSync(RAW, { recursive: true });
const byId = new Map(manifest.docs.map((d) => [d.id, d]));
const copyById = new Map(manifest.copies.map((c) => [c.id, c]));

// ---- the plan ------------------------------------------------------------------------------------
function plan() {
  const keep = (id) => !ONLY || ONLY.has(id);
  if (MODE === 'main') return { A: manifest.phases.A.filter(keep), B: manifest.phases.B.filter(keep) };
  if (MODE === 'split') return { A: manifest.bundles.map((b) => b.id).filter(keep), B: [] };
  if (MODE === 'contract') return { A: manifest.samples.contract.filter(keep), B: [] };
  return { A: manifest.samples.instructions.filter(keep), B: [] };
}
const PLAN = plan();

// ---- run metadata ---------------------------------------------------------------------------------
const t0 = Date.now();
const previous = readJson(META);
const meta = {
  tag: TAG, corpus: 'AIDP-CAP', mode: MODE, status: 'running', api: API,
  platform: { git_sha: PLATFORM_SHA, flags_file: FLAGS, flags_sha256: FLAGS ? sha256(FLAGS) : null },
  corpus_record: { dir: CORPUS, seed: manifest.seed, manifest_sha256: sha256(path.join(CORPUS, 'manifest.json')), documents: manifest.docs.length, copies: manifest.copies.length, bundles: manifest.bundles.length },
  account: { external_tenant: `${ET}-${LANE}`, customer_setup: ['main', 'contract'].includes(MODE) ? { catalogues: manifest.customer.catalogues.map(({ name, sha256: h, columns }) => ({ name, sha256: h, columns })), transformation_rules: CUSTOMER_RULES, flags: CUSTOMER_FLAGS, match_policy: MODE === 'main' ? 'switched on after the first extraction, default tolerances' : null, instructions: MODE === 'contract' ? CONTRACT_INSTRUCTIONS : null } : null },
  phases: PLAN, only: ONLY ? [...ONLY] : null,
  enabled_document_types: ENABLED,
  retry_policy: { retries_per_request: RETRIES, requeue_rounds: ROUNDS, first_backoff_ms: BACKOFF, max_backoff_ms: 60000, round_pause_ms: ROUND_PAUSE, request_timeout_ms: TIMEOUT, processing_wait_ms: PROCESSING_WAIT },
  concurrency: CONC,
  harness: { node: process.version, host: os.hostname(), argv: args },
  started_at: new Date(t0).toISOString(),
  sessions: [...(previous?.sessions ?? []), { started_at: new Date(t0).toISOString() }],
  finished_at: null, counts: null, permanent_failures: null,
};
if (previous?.started_at) meta.first_started_at = previous.first_started_at ?? previous.started_at;
const writeMeta = () => fs.writeFileSync(META, JSON.stringify(meta, null, 1));
writeMeta();

// ---- transport (as run-das.mjs) -------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const p = path.join(CORPUS, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(CORPUS) || !fs.existsSync(p) || !fs.statSync(p).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': p.endsWith('.csv') ? 'text/csv' : 'application/pdf' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));
const FILE_BASE = `http://localhost:${PORT}`;
function readEnv(name) {
  if (process.env[name]) return process.env[name];
  const envFile = opt('env-file', process.env.AIDP_ENV_FILE ?? '');
  if (envFile && fs.existsSync(path.resolve(envFile))) {
    const m = fs.readFileSync(path.resolve(envFile), 'utf8').match(new RegExp(`^${name}="?([^"\\n]+)"?`, 'm'));
    if (m) return m[1];
  }
  throw new Error(`${name} not found: set it in the environment or name a dotenv file with --env-file`);
}
let TOKEN = readEnv('ADMIN_API_TOKEN');
{
  const SYM = Symbol.for('undici.globalDispatcher.1');
  await fetch('http://127.0.0.1:9/').catch(() => {});
  const Agent = globalThis[SYM]?.constructor;
  if (typeof Agent === 'function') globalThis[SYM] = new Agent({ headersTimeout: TIMEOUT + 300000, bodyTimeout: TIMEOUT + 300000 });
}
const stats = { requests: 0, retries: 0, transport_failures: 0, processing_polls: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const retryable = (status) => status === 408 || status === 429 || status >= 500;
class RequestError extends Error { constructor(message, { status = null, transient = true } = {}) { super(message); this.status = status; this.transient = transient; } }
function retryAfterMs(header, body) {
  const h = header == null ? '' : String(header).trim();
  if (/^\d+(\.\d+)?$/.test(h)) return Number(h) * 1000;
  if (h) { const t = Date.parse(h); if (!Number.isNaN(t)) return Math.max(0, t - Date.now()); }
  const b = Number(body?.retry_after_seconds);
  return b > 0 ? b * 1000 : null;
}
async function api(method, pathname, body, headers = {}) {
  const started = Date.now();
  let failures = 0, last;
  for (;;) {
    let waitMs = null;
    stats.requests++;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT);
    try {
      const r = await fetch(`${API}${pathname}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...headers }, body: body ? JSON.stringify(body) : undefined, signal: ac.signal });
      const text = await r.text();
      let j; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 400) }; }
      if (r.status >= 200 && r.status < 300) return j; // the matching policy answers 201 Created
      const msg = `${pathname} ${r.status}: ${String(j.message || j.error || j.raw || '').slice(0, 200)}`;
      waitMs = retryAfterMs(r.headers.get('retry-after'), j);
      if (r.status === 503 && (j.error === 'processing_in_progress' || /still processing/i.test(String(j.message ?? '')))) {
        if (Date.now() - started > PROCESSING_WAIT) throw new RequestError(`${pathname} still processing after ${Math.round((Date.now() - started) / 60000)} min`, { status: 503 });
        stats.processing_polls++;
        await sleep(Math.min(waitMs ?? 30000, 600000));
        continue;
      }
      if (r.status === 401) { TOKEN = readEnv('ADMIN_API_TOKEN'); last = new RequestError(msg, { status: 401 }); }
      else if (!retryable(r.status)) throw new RequestError(msg, { status: r.status, transient: false });
      else last = new RequestError(msg, { status: r.status });
    } catch (e) {
      if (e instanceof RequestError && (!e.transient || /still processing after/.test(e.message))) throw e;
      last = e instanceof RequestError ? e : new RequestError(`${pathname} ${e?.name === 'AbortError' ? `timed out after ${TIMEOUT} ms` : String(e?.message ?? e)}`);
      stats.transport_failures++;
    } finally { clearTimeout(timer); }
    if (++failures > RETRIES) throw last;
    stats.retries++;
    await sleep(waitMs != null ? Math.min(waitMs, 600000) : Math.min(60000, BACKOFF * 2 ** (failures - 1)) * (0.75 + Math.random() * 0.5));
  }
}

// ---- the customer's setup, as each extraction carries it --------------------------------------------
const catalogues = manifest.customer.catalogues.map((c) => ({ name: c.name, source_url: `${FILE_BASE}/${c.file}`, content_hash: c.sha256, columns: c.columns }));
const customerFeed = () => ({ catalogues, transformation_rules: CUSTOMER_RULES, active_flags: CUSTOMER_FLAGS });

async function classify(et, id, file, attachments = []) {
  return api('POST', '/v2/classification', {
    external_tenant: et, external_id: id, pdf_url: `${FILE_BASE}/${file}`, enabled_document_types: ENABLED, include_ocr: true,
    ...(attachments.length ? { attachments: attachments.map((a) => ({ url: `${FILE_BASE}/${a.file}`, external_attachment_id: a.external_attachment_id })) } : {}),
  });
}
async function extract(et, id, { pagified, docType, summaryJson, instruction, noCache, feed, includeImpact = true }) {
  return api('POST', '/v2/extractions', {
    external_tenant: et, external_id: id, pagified_text: pagified, doc_type: docType,
    ...(summaryJson ? { summary_json: summaryJson } : {}),
    ...(instruction ? { custom_instructions: instruction } : {}),
    ...(noCache ? { no_cache: true } : {}),
    ...(feed ?? {}),
    include_impact: includeImpact,
    trading_parties: { primary: '', secondary: '' },
  });
}
/** What is kept of an answer: everything the scorer reads. */
const keepClassification = (c) => ({ category: c.document_category, cache_hit: c.cache_hit ?? null, duplicate: c.duplicate ?? null, annotations: c.annotations ?? null, page_count: c.page_count ?? null, ocr_engine: c.ocr_engine ?? null, files: c.files ?? null, doc_hash: c.doc_hash ?? null });
const keepExtraction = (ex) => ({
  extraction: ex.extraction ?? {}, enriched_extraction: ex.enriched_extraction ?? null, enrichment_report: ex.enrichment_report ?? null,
  derived_fields: ex.derived_fields ?? null, field_confidence: ex.field_confidence ?? null,
  field_report: ex.field_report?.document ? { document: ex.field_report.document } : null,
  rules_applied: ex.rules_applied ?? null, rejected: ex.rejected ?? null, duplicate: ex.duplicate ?? null, match_report: ex.match_report ?? null,
  impact: ex.custom_instruction_impact ?? null, token_usage: ex.token_usage ?? null, cache_hit: ex.cache_hit ?? null, doc_type: ex.doc_type ?? null,
  document_id: ex.document_id ?? null, request_id: ex.request_id ?? null,
});

const rawPath = (id, lane) => path.join(RAW, `${id}.${lane}.json`);
const writeRaw = (id, lane, obj) => { const p = rawPath(id, lane); fs.writeFileSync(p + '.tmp', JSON.stringify(obj)); fs.renameSync(p + '.tmp', p); };
const errText = (e) => String(e?.message ?? e).slice(0, 300);

// ---- one item ---------------------------------------------------------------------------------------
async function fullLane(id, lane, { instruction = null, includeImpact = true } = {}) {
  const prev = readJson(rawPath(id, lane));
  if (prev?.ok) return 'skipped';
  const rec = { id, lane, ts: new Date().toISOString(), attempts: (prev?.attempts ?? 0) + 1 };
  try {
    const doc = byId.get(id) ?? null;
    const copy = copyById.get(id) ?? null;
    const file = doc ? doc.file : copy.file;
    const attachments = doc ? doc.attachments : [];
    const et = `${ET}-${lane}`;
    const c0 = Date.now();
    const c = await classify(et, id, file, attachments);
    rec.classification = { ...keepClassification(c), ms: Date.now() - c0 };
    rec.ocr_text = c.pagified_text ?? '';
    const e0 = Date.now();
    const ex = await extract(et, id, { pagified: c.pagified_text ?? '', docType: c.document_category, summaryJson: c.summary?.DocumentSummary ?? c.summary ?? undefined, instruction, feed: customerFeed(), includeImpact });
    Object.assign(rec, { ms: Date.now() - e0, ...keepExtraction(ex) });
    rec.ok = true;
  } catch (e) { rec.ok = false; rec.error = errText(e); rec.status = e?.status ?? null; }
  writeRaw(id, lane, rec);
  return rec.ok ? 'ok' : 'failed';
}
async function splitItem(id) {
  const prev = readJson(rawPath(id, 'split'));
  if (prev?.ok) return 'skipped';
  const b = manifest.bundles.find((x) => x.id === id);
  const rec = { id, lane: 'split', ts: new Date().toISOString(), attempts: (prev?.attempts ?? 0) + 1 };
  try {
    const t = Date.now();
    const j = await api('POST', '/v2/split', { external_tenant: `${ET}-split`, external_id: id, pdf_url: `${FILE_BASE}/${b.file}`, return_pdfs: false });
    Object.assign(rec, { ms: Date.now() - t, documents: (j.documents ?? []).map(({ index, page_start, page_end, pages, doc_type, external_id }) => ({ index, page_start, page_end, pages, doc_type, external_id })), pages: j.pages ?? null, boundary_warnings: j.boundary_warnings ?? null, split_by: j.split_by ?? null, deterministic: j.deterministic ?? null });
    rec.ok = true;
  } catch (e) { rec.ok = false; rec.error = errText(e); rec.status = e?.status ?? null; }
  writeRaw(id, 'split', rec);
  return rec.ok ? 'ok' : 'failed';
}
/** rules: one document, two extractions with no instruction (the baseline, twice, so containment can tell an
 *  instruction's effect from run-to-run variation), then every applicable instruction, the cache bypassed. */
async function rulesItem(id) {
  const doc = byId.get(id);
  const gtj = readJson(path.join(CORPUS, doc.gt));
  const packs = applicablePacks(gtj);
  const prev = readJson(rawPath(id, 'rules'));
  const done = new Map((prev?.packs ?? []).filter((p) => p.ok).map((p) => [p.id, p]));
  const prevBase = prev?.baselines ?? [];
  if (prevBase.length === 2 && prevBase.every((b) => b?.ok) && packs.every((p) => done.has(p.id))) return 'skipped';
  const rec = { id, lane: 'rules', ts: new Date().toISOString(), attempts: (prev?.attempts ?? 0) + 1, baselines: [prevBase[0]?.ok ? prevBase[0] : null, prevBase[1]?.ok ? prevBase[1] : null], packs: [] };
  const pagified = fs.readFileSync(path.join(CORPUS, doc.text), 'utf8');
  const et = `${ET}-rules`;
  for (let i = 0; i < 2; i++) {
    if (rec.baselines[i]) continue;
    try { const ex = await extract(et, `${id}--baseline-${i + 1}`, { pagified, docType: gtj.category, noCache: true }); rec.baselines[i] = { ok: true, extraction: ex.extraction ?? {}, cache_hit: ex.cache_hit ?? null }; }
    catch (e) { rec.baselines[i] = { ok: false, error: errText(e) }; }
  }
  for (const pack of packs) {
    if (done.has(pack.id)) { rec.packs.push(done.get(pack.id)); continue; }
    const entry = { id: pack.id, instruction: pack.instruction };
    try {
      const ex = await extract(et, `${id}--${pack.id}`, { pagified, docType: gtj.category, instruction: pack.instruction, noCache: true });
      Object.assign(entry, { extraction: ex.extraction ?? {}, impact: ex.custom_instruction_impact ?? null, cache_hit: ex.cache_hit ?? null, ok: true });
    } catch (e) { entry.ok = false; entry.error = errText(e); }
    rec.packs.push(entry);
  }
  rec.ok = rec.baselines.every((b) => b?.ok) && rec.packs.every((p) => p.ok);
  writeRaw(id, 'rules', rec);
  return rec.ok ? 'ok' : 'failed';
}
const RUNNER = MODE === 'main' ? (id) => fullLane(id, 'pipeline') : MODE === 'contract' ? (id) => fullLane(id, 'contract', { instruction: CONTRACT_INSTRUCTIONS, includeImpact: false }) : MODE === 'split' ? splitItem : rulesItem;

// ---- the queue -------------------------------------------------------------------------------------
const tally = { ok: 0, skipped: 0, failed_attempts: 0 };
async function runQueue(ids, label) {
  let queue = [...ids];
  for (let round = 0; round <= ROUNDS && queue.length; round++) {
    if (round) { const pause = Math.min(10 * 60000, ROUND_PAUSE * round); console.log(`  [${label}] round ${round}: ${queue.length} still failing, re-queued after ${Math.round(pause / 1000)} s`); await sleep(pause); }
    const next = []; const work = [...queue]; let done = 0;
    await Promise.all(Array.from({ length: CONC }, async () => {
      for (;;) {
        const id = work.shift();
        if (!id) return;
        const res = await RUNNER(id);
        if (res === 'ok') tally.ok++; else if (res === 'skipped') tally.skipped++; else { tally.failed_attempts++; next.push(id); }
        if (++done % 20 === 0 || done === queue.length) console.log(`  [${label} round ${round}] ${done}/${queue.length} ok=${tally.ok} done-before=${tally.skipped} failing=${next.length} ${Math.round((Date.now() - t0) / 1000)}s`);
      }
    }));
    queue = next;
  }
  return queue;
}

let interrupted = false;
function finish(status, failures) {
  meta.status = status;
  meta.finished_at = new Date().toISOString();
  meta.sessions[meta.sessions.length - 1].finished_at = meta.finished_at;
  meta.sessions[meta.sessions.length - 1].status = status;
  meta.elapsed_s = Math.round((Date.now() - t0) / 1000);
  const all = [...PLAN.A, ...PLAN.B];
  const lane = LANE === 'split' ? 'split' : LANE;
  const okOnDisk = all.filter((id) => readJson(rawPath(id, lane))?.ok).length;
  meta.counts = { items_planned: all.length, items_ok: okOnDisk, items_failed: all.length - okOnDisk, this_session: { ran_ok: tally.ok, already_done: tally.skipped, failed_attempts: tally.failed_attempts, ...stats } };
  meta.permanent_failures = failures;
  writeMeta();
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { if (interrupted) process.exit(130); interrupted = true; console.log(`\n${sig}: recording progress`); finish('interrupted', null); server.close(); process.exit(130); });

console.log(`AIDP-CAP run "${TAG}": mode=${MODE} phase A=${PLAN.A.length} phase B=${PLAN.B.length} conc=${CONC} api=${API}`);
let failures = [];
if (MODE === 'main') {
  // the first document alone, so the account exists before the matching policy is switched on for it
  const [first, ...restA] = PLAN.A;
  if (first) {
    await runQueue([first], 'A-first');
    try {
      const pol = await api('POST', '/v1/admin/recent-docs/match-policy', { external_tenant: `${ET}-pipeline`, include_in_response: true }, { 'x-admin-token': TOKEN });
      meta.account.match_policy_set = { at: new Date().toISOString(), answer: pol };
    } catch (e) { meta.account.match_policy_set = { at: new Date().toISOString(), error: errText(e) }; }
    writeMeta();
  }
  failures.push(...await runQueue(restA, 'A'));
  console.log(`  phase A done: ${PLAN.A.length - failures.length} ok, ${failures.length} failing`);
  failures.push(...await runQueue(PLAN.B, 'B'));
  // read-only collection: value locations for every document, matching verdicts for the second phase and what it refers to
  const collect = async (id, kind, url, headers = {}) => {
    const p = path.join(RAW, `${id}.${kind}.json`);
    if (readJson(p)?.ok) return;
    try { const j = await api('GET', url, null, headers); fs.writeFileSync(p, JSON.stringify({ id, kind, ok: true, ts: new Date().toISOString(), answer: j })); }
    catch (e) { fs.writeFileSync(p, JSON.stringify({ id, kind, ok: false, error: errText(e) })); }
  };
  const et = encodeURIComponent(`${ET}-pipeline`);
  const ids = [...PLAN.A, ...PLAN.B];
  const work = [...ids];
  await Promise.all(Array.from({ length: CONC }, async () => { for (;;) { const id = work.shift(); if (!id) return; await collect(id, 'geometry', `/v2/documents/field-geometry?external_tenant=${et}&external_id=${encodeURIComponent(id)}`); } }));
  const refs = new Set([...PLAN.B, ...manifest.cases.links.map((l) => l.po), ...manifest.copies.map((c) => c.of)]);
  for (const id of refs) await collect(id, 'matching', `/v1/admin/recent-docs/matching?external_tenant=${et}&external_id=${encodeURIComponent(id)}`, { 'x-admin-token': TOKEN });
} else {
  failures.push(...await runQueue(PLAN.A, MODE));
}
server.close();
const perm = failures.map((id) => ({ id, error: readJson(rawPath(id, LANE))?.error ?? 'unknown' }));
finish(perm.length ? 'complete-with-failures' : 'complete', perm);
console.log(`done in ${meta.elapsed_s}s: ${meta.counts.items_ok}/${meta.counts.items_planned} ok, ${perm.length} permanent failure(s)`);
