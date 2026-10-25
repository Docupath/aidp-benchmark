/**
 * Checks the runner against a stand-in API, with no platform, no model and no network beyond this
 * machine. The stand-in fails some requests on purpose, so the checks cover what the runner promises:
 * transport failures are retried, lanes still failing are re-queued, nothing is dropped, permanent
 * failures are listed, run-meta.json is written at the start and at the end, a second invocation
 * resumes, and the stability runs bypass the extraction cache.
 *
 *   node bench/test-runner.mjs [--corpus corpus]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.resolve(HERE, '..');
const args = process.argv.slice(2);
const CORPUS = path.resolve(args.includes('--corpus') ? args[args.indexOf('--corpus') + 1] : path.join(BENCH, 'corpus'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aidp-runner-test-'));
const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8'));
const category = new Map(manifest.docs.map((d) => [d.id, d.category]));

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); } };

// ---- the stand-in API ----------------------------------------------------------------------------
const seen = new Map();          // request key -> times seen
const log = [];                  // every request body
let mode = 'first';              // 'first': inject failures; 'second': everything succeeds
const count = (k) => { seen.set(k, (seen.get(k) ?? 0) + 1); return seen.get(k); };
const api = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const j = JSON.parse(body || '{}');
    log.push({ url: req.url, body: j });
    const id = String(j.external_id ?? '').replace(/--.*$/, '');
    const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.headers.authorization !== 'Bearer test-token') return send(401, { message: 'bad token' });
    if (req.url === '/v2/classification') {
      // Two transport failures, then success: retried within the request.
      if (id === 'invoice-001' && count(`cls:${id}`) <= 2) return send(503, { message: 'busy' });
      return send(200, { document_category: category.get(id), pagified_text: `text of ${id}`, token_usage: { total: 1 }, cache_hit: false });
    }
    if (req.url === '/v2/extractions') {
      const lane = String(j.external_tenant).split('-').pop();
      // Always failing in the first invocation: re-queued every round, then a permanent failure.
      if (mode === 'first' && id === 'receipt-001' && lane === 'prompt') return send(500, { message: 'boom' });
      // A document still processing at the attempt-window edge: polled after Retry-After, four times,
      // which is more than --retries, so the lane only succeeds if polling spends no retry.
      if (mode === 'first' && id === 'receipt-000' && lane === 'prompt' && count(`proc:${id}`) <= 4) {
        res.setHeader('Retry-After', '0');
        return send(503, { statusCode: 503, error: 'processing_in_progress', message: 'the document is still processing; it will complete in the background - resubmit the same request to collect the result', retry_after_seconds: 0 });
      }
      // A request the API rejects as invalid: not retried per request, but re-queued.
      if (mode === 'first' && id === 'invoice-000' && lane === 'prompt' && count(`bad:${id}`) === 1) return send(400, { message: 'invalid' });
      // One stability run fails throughout the first invocation.
      if (mode === 'first' && lane === 'stability' && String(j.external_id).endsWith('--r1') && id === 'invoice-001') return send(500, { message: 'boom' });
      return send(200, {
        extraction: { 'Invoice Details': { 'Invoice Number': id } }, derived_fields: null, field_confidence: null,
        field_report: { document: { auto_accept: false, score: 0.5 }, fields: [{ field: 'x' }] },
        custom_instruction_impact: null, token_usage: { total: 1 }, cache_hit: !j.no_cache, doc_type: j.doc_type,
      });
    }
    send(404, {});
  });
});
await new Promise((r) => api.listen(0, '127.0.0.1', r));
const API = `http://127.0.0.1:${api.address().port}`;
const freePort = () => new Promise((r) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

const flags = path.join(TMP, 'flags.env');
fs.writeFileSync(flags, 'V2_EXAMPLE_FLAG=1\n');
const run = async (extra) => new Promise((resolve) => {
  freePort().then((port) => {
    execFile(process.execPath, [path.join(HERE, 'run-das.mjs'), '--api', API, '--corpus', CORPUS, '--port', String(port),
      '--retries', '2', '--rounds', '2', '--backoff-ms', '5', '--round-pause-ms', '10', '--conc', '2',
      '--platform-sha', 'abc1234', '--flags', flags, ...extra],
    { env: { ...process.env, ADMIN_API_TOKEN: 'test-token' }, timeout: 120000 }, (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr }));
  });
});
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

// ---- main mode -----------------------------------------------------------------------------------
console.log('=== main mode: both lanes, retries, re-queue rounds, permanent failures ===');
const MAIN = path.join(TMP, 'main');
let r = await run(['--mode', 'main', '--out', MAIN, '--types', 'invoice,receipt', '--sample', '2']);
let meta = readJson(path.join(MAIN, 'run-meta.json'));
ok('the run finished', r.code === 0, r.stderr.slice(0, 400));
ok('run-meta.json lists the planned documents, round robin across types', JSON.stringify(meta.documents) === JSON.stringify(['invoice-000', 'receipt-000', 'invoice-001', 'receipt-001']), JSON.stringify(meta.documents));
ok('run-meta.json records the API, the platform SHA and the flag file', meta.api === API && meta.platform.git_sha === 'abc1234' && meta.platform.flags_file === flags && /^[0-9a-f]{64}$/.test(meta.platform.flags_sha256));
ok('run-meta.json records start and end', !!meta.started_at && !!meta.finished_at && meta.sessions.length === 1);
ok('every document ran in both lanes', meta.counts.items_planned === 8);
ok('a lane failing on every round is a permanent failure, listed', meta.status === 'complete-with-failures' && meta.permanent_failures.length === 1
  && meta.permanent_failures[0].id === 'receipt-001' && meta.permanent_failures[0].lane === 'prompt', JSON.stringify(meta.permanent_failures));
const failedRaw = readJson(path.join(MAIN, 'raw', 'receipt-001.prompt.json'));
ok('its lane is on disk with ok:false and every attempt counted (first pass plus two rounds)', failedRaw.ok === false && failedRaw.attempts === 3, JSON.stringify({ ok: failedRaw.ok, attempts: failedRaw.attempts }));
ok('two transport failures on classification were retried inside the request', readJson(path.join(MAIN, 'raw', 'invoice-001.pipeline.json')).ok === true
  && log.filter((x) => x.url === '/v2/classification' && x.body.external_id === 'invoice-001').length === 3);
ok('an invalid-request answer was not retried in the request, but the lane was re-queued and succeeded', readJson(path.join(MAIN, 'raw', 'invoice-000.prompt.json')).attempts === 2
  && readJson(path.join(MAIN, 'raw', 'invoice-000.prompt.json')).ok === true);
ok('the platform\'s document decision is kept in the raw evidence', readJson(path.join(MAIN, 'raw', 'invoice-000.pipeline.json')).field_report?.document?.auto_accept === false
  && !('fields' in readJson(path.join(MAIN, 'raw', 'invoice-000.pipeline.json')).field_report));
ok('the main run does not bypass the cache', log.filter((x) => x.url === '/v2/extractions' && x.body.no_cache).length === 0);
ok('a document still processing is polled after Retry-After without spending a retry, and succeeds first time',
  readJson(path.join(MAIN, 'raw', 'receipt-000.prompt.json')).ok === true && readJson(path.join(MAIN, 'raw', 'receipt-000.prompt.json')).attempts === 1
  && meta.counts.this_session.processing_polls === 4, JSON.stringify(meta.counts.this_session));

console.log('\n=== resume: a second invocation finishes what failed and skips what succeeded ===');
mode = 'second';
const before = log.length;
r = await run(['--mode', 'main', '--out', MAIN, '--types', 'invoice,receipt', '--sample', '2']);
meta = readJson(path.join(MAIN, 'run-meta.json'));
ok('the resumed run completed with no permanent failure', meta.status === 'complete' && meta.permanent_failures.length === 0, JSON.stringify(meta.permanent_failures));
ok('only the failed lane was requested again', log.length - before === 1 && log[log.length - 1].body.external_id === 'receipt-001');
ok('run-meta.json keeps both sessions and the first start', meta.sessions.length === 2 && !!meta.first_started_at);
ok('every planned lane is ok on disk', meta.counts.items_ok === 8);

console.log('\n=== stability mode: the declared sample, full lane, three runs, cache bypassed ===');
mode = 'first';
const STAB = path.join(TMP, 'stability');
const sampleFile = path.join(TMP, 'stability-sample.json');
fs.writeFileSync(sampleFile, JSON.stringify({ seed: 'test', count: 2, documents: ['invoice-001', 'receipt-000'] }));
const s0 = log.length;
r = await run(['--mode', 'stability', '--out', STAB, '--sample-file', sampleFile]);
meta = readJson(path.join(STAB, 'run-meta.json'));
const stabEx = log.slice(s0).filter((x) => x.url === '/v2/extractions');
ok('every stability extraction bypassed the cache (no_cache: true)', stabEx.length > 0 && stabEx.every((x) => x.body.no_cache === true));
ok('each run went through classification first (the full lane)', log.slice(s0).filter((x) => x.url === '/v2/classification').length >= 6);
ok('run-meta.json records the sample and the repeats', meta.sample.file.endsWith('stability-sample.json') && meta.repeats === 3 && meta.documents.length === 2);
const st = readJson(path.join(STAB, 'raw', 'invoice-001.stability.json'));
ok('a run that kept failing leaves the document incomplete and listed', st.ok === false && st.runs.filter((x) => x.ok).length === 2 && meta.permanent_failures.length === 1);
mode = 'second';
const s1 = log.length;
r = await run(['--mode', 'stability', '--out', STAB, '--sample-file', sampleFile]);
const st2 = readJson(path.join(STAB, 'raw', 'invoice-001.stability.json'));
ok('resuming re-runs only the missing run, and keeps the two that succeeded', st2.ok === true && st2.runs.length === 3
  && log.slice(s1).filter((x) => x.url === '/v2/extractions').map((x) => x.body.external_id).join() === 'invoice-001--r1');

console.log('\n=== rules mode: the declared sample, every applicable pack, cache bypassed ===');
const RUL = path.join(TMP, 'rules');
const rulesSample = path.join(TMP, 'rules-sample.json');
fs.writeFileSync(rulesSample, JSON.stringify({ seed: 'test', count: 1, documents: ['invoice-000'] }));
const q0 = log.length;
r = await run(['--mode', 'rules', '--out', RUL, '--sample-file', rulesSample]);
const rr = readJson(path.join(RUL, 'raw', 'invoice-000.rules.json'));
ok('every applicable pack ran once, with its instruction and the cache bypassed', rr.ok === true && rr.packs.length >= 1
  && log.slice(q0).every((x) => x.body.no_cache === true && typeof x.body.custom_instructions === 'string'), JSON.stringify(rr.packs.map((p) => p.id)));

api.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
