/**
 * The post-run diagnostics of the AIDP v1.0 reference run, all six, from outputs that already exist.
 *
 * Computed AFTER the run, from the run's kept outputs, the corpus and the exported database fields.
 * They are not part of the AIDP Score and enter none of its measures: they are diagnostics, published
 * beside the result under spec section 7.6. Nothing here calls a model, an API or a service; the only
 * script that reads the platform's database is export-db.mjs, and only when asked to.
 *
 *   node bench/post-run/index.mjs --corpus <AIDP-2K dir> [--export-db] [run options] [--out <dir>]
 *
 *   --export-db   first refresh db-export/ from the run's database (read-only); without it the figures
 *                 are computed from the exported files alone, as a third party would
 *   run options   --main-tag, --stability-tag, --cls-tenant, --stability-ids, --db (lib.mjs); with none,
 *                 the run is the reference run (aidp-v1-main), as published
 *
 * Writes to <run>/post-run/ (or --out): summary.json, one JSONL of per-document evidence per figure, and by-eye/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { context, args, writeJson, writeJsonl, sha256, toIST, readJsonOr, HERE, REFERENCE, requireFinished } from './lib.mjs';
import { exportDb } from './export-db.mjs';
import { intake } from './intake.mjs';
import { stamps } from './stamps.mjs';
import { readingOrder } from './reading-order.mjs';
import { legibility } from './legibility.mjs';
import { parsing } from './parsing.mjs';
import { duplicates } from './duplicates.mjs';

const ctx = context();
const t0 = Date.now();
console.log(`run ${ctx.tag} (${ctx.runDir}), repeatability run ${ctx.stabTag} (${ctx.stabDir}) -> ${ctx.outDir}`);
requireFinished(ctx);
if (args.includes('--export-db')) {
  console.log(`exporting from database ${ctx.db}: ${Object.values(ctx.tenants).filter((t, i, a) => a.indexOf(t) === i).join(', ')}`);
  await exportDb();
  console.log('database fields exported');
}

const figures = [];
const steps = [
  ['intake', () => intake({ byEyeDir: path.join(ctx.outDir, 'by-eye') }), 'rows'],
  ['stamps', () => stamps(), 'rows'],
  ['reading-order', () => readingOrder(), 'docs'],
  ['legibility', () => legibility(), 'rows'],
  ['parsing', () => parsing(), 'rows'],
  ['duplicates', () => duplicates(), 'rows'],
];
for (const [name, run, key] of steps) {
  const s = Date.now();
  const res = await run();
  writeJsonl(path.join(ctx.outDir, `${name}.jsonl`), res[key]);
  figures.push(res.figure);
  const f = res.figure;
  const shown = f.not_measured ? 'not measured (see its not_measured)' : `${f.numerator}${f.denominator != null ? ` of ${f.denominator} (${f.rate == null ? 'n/a' : `${(f.rate * 100).toFixed(2)}%`})` : ''}`;
  console.log(`${name}: ${shown} in ${Math.round((Date.now() - s) / 1000)} s`);
}

const scripts = Object.fromEntries(fs.readdirSync(HERE).filter((f) => f.endsWith('.mjs')).sort().map((f) => [f, sha256(fs.readFileSync(path.join(HERE, f)))]));
const evidence = Object.fromEntries(fs.readdirSync(ctx.outDir).filter((f) => f.endsWith('.jsonl')).sort().map((f) => [f, sha256(fs.readFileSync(path.join(ctx.outDir, f)))]));
const meta = readJsonOr(path.join(ctx.dbDir, 'export-meta.json'));
// The options that select this run (none for the reference run), so the reproduce lines reproduce THIS run.
const sel = ctx.selectionArgs ? ` ${ctx.selectionArgs}` : '';
const dbSel = ctx.db !== REFERENCE.db ? ` --db ${ctx.db}` : '';
writeJson(path.join(ctx.outDir, 'summary.json'), {
  title: 'AIDP v1.0 reference run: post-run diagnostics',
  status: 'Computed after the run from its kept outputs, the corpus and exported database fields. Not part of the AIDP Score; diagnostics under spec section 7.6, published beside the result. No output of the run was changed beyond the publication changes listed in Annex B of the specification, none of which changes a score.',
  computed_at_ist: toIST(new Date()),
  run: {
    tag: ctx.runMeta?.tag ?? null,
    platform_git_sha: ctx.runMeta?.platform?.git_sha ?? null,
    run_started_ist: ctx.runMeta?.first_started_at ? toIST(ctx.runMeta.first_started_at) : null,
    run_finished_ist: ctx.runMeta?.finished_at ? toIST(ctx.runMeta.finished_at) : null,
  },
  corpus: { seed: ctx.seed, documents: ctx.manifest.docs.length, manifest_sha256: ctx.manifestSha256, matches_run_manifest: ctx.runMeta?.corpus?.manifest_sha256 === ctx.manifestSha256 },
  database_fields: meta ? { exported_at_ist: meta.exported_at_ist, database: meta.database, files: meta.sha256 } : null,
  figures,
  by_eye: readJsonOr(path.join(ctx.outDir, 'by-eye', 'verdicts.json')),
  reproduce: [
    `node aidp-bench/bench/post-run/index.mjs --corpus <AIDP-2K dir>${sel}   (from the published files, db-export/ included)`,
    `node aidp-bench/bench/post-run/index.mjs --corpus <AIDP-2K dir>${sel}${dbSel} --export-db   (refresh db-export/ from the run's database first)`,
    `node aidp-bench/bench/post-run/by-eye.mjs --corpus <AIDP-2K dir>${sel}   (draw the seeded reading-order sample checked by eye)`,
  ],
  scripts_sha256: scripts,
  evidence_sha256: evidence,
  elapsed_s: Math.round((Date.now() - t0) / 1000),
});
console.log(`summary -> ${path.join(ctx.outDir, 'summary.json')}`);
