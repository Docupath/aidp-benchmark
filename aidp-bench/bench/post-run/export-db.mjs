/**
 * Export every database-only field the post-run figures rely on, so that a third party without the
 * database can recompute every figure from the published files.
 *
 * The run's kept outputs (results/<run>/raw) hold the reading and the extraction.
 * Three things the figures need were kept only in the platform's database:
 *   - the visual annotations of each stored reading (stamps, seals, signatures, handwritten notes),
 *     classification_v2_ocr.annotations, for the Stamps figure;
 *   - the duplicate verdicts: the matching engine's "duplicate_invoice" exceptions (v2_match_runs, one
 *     row per submission, holding its latest computation), the content-duplicate flag of every
 *     extraction run (extraction_v2_runs.duplicate) and of every classification run
 *     (classification_v2_runs.duplicate), and the number and seller the matching index compared
 *     (v2_match_index), for the Duplicate detection figure.
 *
 * This is the ONLY script that touches the database, and it only reads: every query runs in a
 * read-only transaction (default_transaction_read_only=on). Times are written in IST (GMT+05:30).
 *
 * The run is chosen as for every diagnostic (lib.mjs): --main-tag, --stability-tag, --cls-tenant,
 * --stability-ids and --db, each defaulting to the reference run. With --check it exports nothing: it counts the
 * rows each export query finds for the chosen run, so a run can be checked while it is still going.
 *
 *   node bench/post-run/export-db.mjs --corpus <AIDP-2K dir> [run options] [--psql <path>] [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { context, opt, args, writeJsonl, writeJson, sha256, sha256File, requireFinished } from './lib.mjs';

const PSQL = opt('psql', process.env.PSQL ?? (fs.existsSync('/opt/homebrew/opt/postgresql@17/bin/psql') ? '/opt/homebrew/opt/postgresql@17/bin/psql' : 'psql'));
const IST = (col) => `to_char(${col} AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+05:30'`;

/** One read-only query against the run's database; each result row comes back as one JSON object. */
function query(sql) {
  const out = execFileSync(PSQL, ['-X', '-d', context().db, '-At', '-v', 'ON_ERROR_STOP=1', '-c', `SELECT row_to_json(t) FROM (${sql}) t`], {
    env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on' },
    maxBuffer: 1024 * 1024 * 1024,
    encoding: 'utf8',
  });
  return out.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/** The export's queries, by tenant. --check runs the same queries, counted. */
const SQL = {
  readings: (tenant) => `SELECT doc_bytes_hash, page_count, ocr_engine, pagify_version, annotations,
      encode(sha256(convert_to(pagified_text, 'UTF8')), 'hex') AS pagified_sha256, ${IST('created_at')} AS created_at_ist
    FROM classification_v2_ocr WHERE external_tenant = '${tenant}'`,
  extractionRuns: (tenant) => `SELECT external_id, status, duplicate, cache_hit, doc_type, left(coalesce(error, ''), 120) AS error,
      ${IST('created_at')} AS created_at_ist
    FROM extraction_v2_runs WHERE external_tenant = '${tenant}' ORDER BY external_id, created_at`,
  matchRuns: (tenant) => `SELECT external_id, status, level, ${IST('computed_at')} AS computed_at_ist,
      result->'anchor' AS anchor,
      coalesce((SELECT json_agg(json_build_object('code', e->>'code', 'severity', e->>'severity', 'message', e->>'message'))
        FROM jsonb_array_elements(result->'exceptions') e WHERE e->>'code' = 'duplicate_invoice'), '[]'::json) AS duplicate_exceptions,
      jsonb_array_length(coalesce(result->'exceptions', '[]'::jsonb)) AS exceptions_total
    FROM v2_match_runs WHERE external_tenant = '${tenant}'`,
  matchIndex: (tenant) => `SELECT external_id, doc_type, doc_number_norm, seller_norm, ${IST('indexed_at')} AS indexed_at_ist
    FROM v2_match_index WHERE external_tenant = '${tenant}'`,
  classificationRuns: (a, b) => `SELECT external_tenant, external_id, status, duplicate, cache_hit, document_category, ${IST('created_at')} AS created_at_ist
    FROM classification_v2_runs WHERE external_tenant IN ('${a}', '${b}') ORDER BY external_tenant, external_id, created_at`,
};

/** Every corpus file (each main file and attachment) with the sha256 of its bytes, the key of a stored reading. */
function corpusFiles(ctx) {
  const files = [];
  for (const d of ctx.manifest.docs) {
    files.push({ id: d.id, slug: d.slug, file: d.file, role: 'main' });
    for (const a of d.attachments ?? []) files.push({ id: d.id, slug: d.slug, file: a.file, role: 'attachment', attachment_id: a.external_attachment_id });
  }
  for (const f of files) f.doc_bytes_hash = sha256File(path.join(ctx.corpusDir, f.file));
  return files;
}

const RUN_OPTIONS = 'check --main-tag, --stability-tag, --cls-tenant, --stability-ids and --db (node bench/post-run/export-db.mjs --check)';

export async function exportDb() {
  const ctx = context();
  const T = ctx.tenants;
  const stabMeta = ctx.stabMeta;
  if (!stabMeta?.documents) throw new Error(`no run-meta.json listing the documents of the repeatability run in ${ctx.stabDir}: run the repeatability lane first, or pass --stability-tag`);
  const files = corpusFiles(ctx);

  // ---- 1. the stored readings of the main run and their visual annotations --------------------------
  const ocr = query(SQL.readings(T.mainCls));
  if (!ocr.length) throw new Error(`no stored reading under ${T.mainCls} in database ${ctx.db}: ${RUN_OPTIONS}`);
  const byHash = new Map(ocr.map((r) => [r.doc_bytes_hash, r]));
  const annotations = files.map((f) => {
    const r = byHash.get(f.doc_bytes_hash);
    return {
      id: f.id, slug: f.slug, file: f.file, role: f.role, doc_bytes_hash: f.doc_bytes_hash,
      external_tenant: T.mainCls, stored: !!r,
      page_count: r?.page_count ?? null, ocr_engine: r?.ocr_engine ?? null, pagify_version: r?.pagify_version ?? null,
      pagified_sha256: r?.pagified_sha256 ?? null, created_at_ist: r?.created_at_ist ?? null,
      annotations: r?.annotations ?? null,
    };
  });
  writeJsonl(path.join(ctx.dbDir, 'annotations.jsonl'), annotations);

  // ---- 2. duplicate verdicts, per submission ---------------------------------------------------------
  const group = (rows) => { const m = new Map(); for (const r of rows) { if (!m.has(r.external_id)) m.set(r.external_id, []); m.get(r.external_id).push(r); } return m; };

  function submissions(tenant, ids) {
    const runs = group(query(SQL.extractionRuns(tenant)));
    if (!ids.some((x) => runs.has(x.external_id))) {
      throw new Error(`none of the ${ids.length} external ids expected under ${tenant} (${ids[0]?.external_id}, ...) has an extraction run in database ${ctx.db}: ${RUN_OPTIONS}`);
    }
    const match = new Map(query(SQL.matchRuns(tenant)).map((r) => [r.external_id, r]));
    const index = new Map(query(SQL.matchIndex(tenant)).map((r) => [r.external_id, r]));
    return ids.map(({ id, slug, external_id, repeat }) => {
      const rs = (runs.get(external_id) ?? []).map(({ external_id: _, ...x }) => x);
      const m = match.get(external_id) ?? null;
      const ix = index.get(external_id) ?? null;
      return {
        id, slug, repeat, external_tenant: tenant, external_id,
        extraction_runs: rs,
        match_run: m ? {
          status: m.status, level: m.level, computed_at_ist: m.computed_at_ist,
          anchor: m.anchor, exceptions_total: m.exceptions_total,
          duplicate_exceptions: (m.duplicate_exceptions ?? []).map((e) => ({ ...e, ref_external_id: (String(e.message).match(/another document \(([^)]+)\)/) ?? [])[1] ?? null })),
        } : null,
        match_index: ix ? { doc_type: ix.doc_type, doc_number_norm: ix.doc_number_norm, seller_norm: ix.seller_norm, indexed_at_ist: ix.indexed_at_ist } : null,
      };
    });
  }

  const repeats = stabMeta.repeats ?? 3;
  // suffixed: one submission per repeat, <id>--r<i>. shared: the repeats are one submission, the document's own id.
  const stabIds = ctx.stabilityIds === 'shared'
    ? stabMeta.documents.map((id) => ({ id, slug: ctx.corpus.byId.get(id)?.slug ?? null, external_id: id, repeat: null }))
    : stabMeta.documents.flatMap((id) => Array.from({ length: repeats }, (_, i) => ({
      id, slug: ctx.corpus.byId.get(id)?.slug ?? null, external_id: `${id}--r${i}`, repeat: `r${i}`,
    })));
  writeJsonl(path.join(ctx.dbDir, 'stability-submissions.jsonl'), submissions(T.stab, stabIds));

  const mainIds = ctx.manifest.docs.map((d) => ({ id: d.id, slug: d.slug, external_id: d.id, repeat: null }));
  writeJsonl(path.join(ctx.dbDir, 'main-pipeline-submissions.jsonl'), submissions(T.mainPipeline, mainIds));
  writeJsonl(path.join(ctx.dbDir, 'main-prompt-submissions.jsonl'), submissions(T.mainPrompt, mainIds));

  // The classification runs carry a duplicate column too; exported so its (empty) verdicts are on record.
  const cls = query(SQL.classificationRuns(T.mainCls, T.stabCls));
  const clsRows = [];
  for (const [key, rows] of group(cls.map((r) => ({ ...r, external_id: `${r.external_tenant}\u0000${r.external_id}` })))) {
    const [tenant, external_id] = key.split('\u0000');
    clsRows.push({ external_tenant: tenant, external_id, runs: rows.map(({ external_tenant, external_id: _, ...x }) => x) });
  }
  writeJsonl(path.join(ctx.dbDir, 'classification-runs.jsonl'), clsRows);

  const meta = {
    exported_at_ist: new Date(Date.now() + 330 * 60000).toISOString().replace('Z', '+05:30'),
    database: ctx.db,
    read_only: 'every query ran with default_transaction_read_only=on',
    tenants: T,
    files: {
      'annotations.jsonl': `classification_v2_ocr rows of ${T.mainCls}, one per corpus file (main file or attachment), joined by doc_bytes_hash = sha256 of the file's bytes; ${annotations.filter((a) => a.stored).length} of ${annotations.length} files have a stored reading; ${ocr.length - annotations.filter((a) => a.stored).length} stored rows match no corpus file`,
      'stability-submissions.jsonl': ctx.stabilityIds === 'shared'
        ? `one row per document of the repeatability run (${stabIds.length}), its ${repeats} repeats having been submitted under the document's own external id, so the platform holds them as one submission: every extraction run (status, duplicate flag, time), the matching engine's latest computation for it (v2_match_runs: status, duplicate_invoice exceptions) and what the matching index compared (number, seller, type)`
        : `one row per submission of the repeatability run (${stabIds.length}): every extraction run (status, duplicate flag, time), the matching engine's latest computation for it (v2_match_runs: status, duplicate_invoice exceptions) and what the matching index compared (number, seller, type)`,
      'main-pipeline-submissions.jsonl': `the same for every document of the main run's full lane (${mainIds.length})`,
      'main-prompt-submissions.jsonl': `the same for every document of the main run's text lane (${mainIds.length})`,
      'classification-runs.jsonl': 'every classification run of the main and repeatability runs, with its duplicate column, cache hit and category',
    },
    sha256: {},
  };
  for (const f of fs.readdirSync(ctx.dbDir).filter((f) => f.endsWith('.jsonl')).sort()) meta.sha256[f] = sha256(fs.readFileSync(path.join(ctx.dbDir, f)));
  writeJson(path.join(ctx.dbDir, 'export-meta.json'), meta);
  return meta;
}

/**
 * --check: the export's own queries, counted, for the chosen run; nothing is written. Says how far a run has
 * got and whether its rows fit the selection. Returns false (exit 1) when they do not: rows extracted but no
 * stored reading or classification run under the selected classification tenant (the wrong --cls-tenant), or
 * repeats whose extraction or classification ids are of the other form (the wrong --stability-ids). A repeat
 * is classified by its extraction's id under the lane's tenant (<id>--r<i>), or, with --cls-tenant cls, by the
 * document's own id under -cls.
 */
export function checkDb() {
  const ctx = context();
  const T = ctx.tenants;
  const fmt = (x) => x.toLocaleString('en-US');
  const count = (sql) => query(`SELECT count(*)::int AS n FROM (${sql}) q`)[0].n;
  const idsOf = (tenant) => query(`SELECT DISTINCT external_id FROM (${SQL.extractionRuns(tenant)}) q`).map((r) => r.external_id);
  const problems = [];
  console.log(`database ${ctx.db} (read-only), run ${ctx.tag} with repeatability run ${ctx.stabTag}; classification under ${ctx.clsTenant === 'cls' ? '<tag>-cls' : 'the lane\'s own tenant'}; repeat ids ${ctx.stabilityIds}`);

  const files = corpusFiles(ctx);
  const hashes = new Set(files.map((f) => f.doc_bytes_hash));
  const readings = query(`SELECT doc_bytes_hash FROM (${SQL.readings(T.mainCls)}) q`);
  console.log(`  stored readings (annotations.jsonl) under ${T.mainCls}: ${fmt(readings.length)} rows, ${fmt(readings.filter((r) => hashes.has(r.doc_bytes_hash)).length)} of the corpus's ${fmt(files.length)} files`);
  const clsMain = count(SQL.classificationRuns(T.mainCls, T.mainCls)), clsStab = count(SQL.classificationRuns(T.stabCls, T.stabCls));
  console.log(`  classification runs (classification-runs.jsonl): ${fmt(clsMain)} under ${T.mainCls}, ${fmt(clsStab)} under ${T.stabCls}`);

  const docIds = new Set(ctx.manifest.docs.map((d) => d.id));
  const lane = (label, file, tenant) => {
    const ids = idsOf(tenant);
    const runs = count(SQL.extractionRuns(tenant));
    console.log(`  ${label} (${file}) under ${tenant}: ${fmt(runs)} extraction runs over ${fmt(ids.length)} external ids, ${fmt(ids.filter((x) => docIds.has(x)).length)} of them corpus document ids; ${fmt(count(SQL.matchRuns(tenant)))} matching verdicts; ${fmt(count(SQL.matchIndex(tenant)))} index entries`);
    return { ids, runs };
  };
  const pipe = lane('main run, full lane', 'main-pipeline-submissions.jsonl', T.mainPipeline);
  lane('main run, text lane', 'main-prompt-submissions.jsonl', T.mainPrompt);
  const stab = lane('repeatability lane', 'stability-submissions.jsonl', T.stab);

  if (pipe.runs && !readings.length) {
    const other = T.mainCls === T.mainPipeline ? T.mainPipeline.replace(/-pipeline$/, '-cls') : T.mainPipeline;
    problems.push(`the full lane has extraction runs but nothing was classified under ${T.mainCls} (${fmt(count(SQL.readings(other)))} stored readings under ${other}): wrong --cls-tenant?`);
  }
  if (stab.runs && !clsStab) problems.push(`the repeatability lane has extraction runs but no classification run under ${T.stabCls}: wrong --cls-tenant?`);
  const suffixedIn = (ids) => ids.filter((x) => /--r\d+$/.test(x)).length;
  if (stab.ids.length) {
    const suffixed = suffixedIn(stab.ids);
    console.log(`  repeatability extraction ids: ${fmt(suffixed)} of the form <id>--r<n> (suffixed), ${fmt(stab.ids.length - suffixed)} plain (shared)`);
    if (ctx.stabilityIds === 'suffixed' && !suffixed) problems.push('the repeatability lane\'s extraction ids are plain document ids: pass --stability-ids shared');
    if (ctx.stabilityIds === 'shared' && suffixed === stab.ids.length) problems.push('the repeatability lane\'s extraction ids end in --r<n>: pass --stability-ids suffixed');
  } else console.log('  repeatability lane: nothing yet under this tenant (not started, or not in this database)');
  // A repeat's classification: by its extraction's id under the lane's tenant, or (--cls-tenant cls) by the document's own id under -cls.
  const clsIds = query(`SELECT DISTINCT external_id FROM (${SQL.classificationRuns(T.stabCls, T.stabCls)}) q`).map((r) => r.external_id);
  if (clsIds.length) {
    const suffixed = suffixedIn(clsIds);
    const want = ctx.clsTenant === 'lane' && ctx.stabilityIds === 'suffixed' ? 'suffixed' : 'plain';
    console.log(`  repeatability classification ids under ${T.stabCls}: ${fmt(suffixed)} of the form <id>--r<n>, ${fmt(clsIds.length - suffixed)} plain (this selection expects ${want === 'suffixed' ? '<id>--r<n>' : 'plain document ids'})`);
    if (want === 'suffixed' ? !suffixed : suffixed === clsIds.length) problems.push(`the repeats' classification runs under ${T.stabCls} carry ${want === 'suffixed' ? 'plain document ids' : 'ids ending in --r<n>'}: check --cls-tenant and --stability-ids`);
  }
  for (const p of problems) console.log(`  MISMATCH: ${p}`);
  console.log(problems.length ? 'the rows found do not fit this selection' : 'the export queries find this run\'s tenants; the counts are the rows so far');
  return !problems.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (args.includes('--check')) {
    process.exitCode = checkDb() ? 0 : 1;
  } else {
    requireFinished(context());
    const meta = await exportDb();
    console.log(`database evidence exported to ${context().dbDir}`);
    for (const [f, d] of Object.entries(meta.files)) console.log(`  ${f}: ${d}`);
  }
}
