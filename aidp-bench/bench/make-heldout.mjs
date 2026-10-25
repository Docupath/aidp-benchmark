/**
 * Held-out check: the sample, exactly as registered in samples/heldout-v1.json before its seed existed.
 *
 *   node bench/make-heldout.mjs --round <drand round json> --corpus <generated corpus> --out <held-out corpus>
 *
 * --round    the drand round the registration names (https://api.drand.sh/public/6579746), saved as JSON
 * --corpus   the corpus corpus-gen/generate.mjs wrote with --count 200 and the seed below
 * --out      where the held-out corpus is written: the sampled documents and their own manifest.json
 *
 * The seed is 'aidp-heldout-v1:' + the round's randomness. On the mainnet chain the randomness is the
 * SHA-256 of the round's signature, which is checked here; the signature itself is checked against the
 * chain's public key by any drand client. For each type, the 200 ids are sorted by the SHA-256 hex digest
 * of seed + ':' + id and the first 30 kept (300 documents); the repeat sample is the first 10 of each
 * field-key type's sample in the same order (60 documents), written to samples/heldout-v1-repeats.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const REG = JSON.parse(fs.readFileSync(path.join(HERE, 'samples', 'heldout-v1.json'), 'utf8'));
const ROUND = JSON.parse(fs.readFileSync(path.resolve(opt('round')), 'utf8'));
const CORPUS = path.resolve(opt('corpus'));
const OUT = path.resolve(opt('out'));
const PER_TYPE = 30;
const REPEATS_PER_TYPE = 10;
const FIELD_TYPES = ['invoice', 'purchase-order', 'credit-note', 'freight-invoice', 'consignment-order', 'consignment-invoice'];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

if (ROUND.round !== 6579746) throw new Error(`the registration names round 6579746, got ${ROUND.round}`);
if (sha(Buffer.from(ROUND.signature, 'hex')) !== ROUND.randomness) throw new Error('randomness is not the SHA-256 of the signature');
const SEED = `aidp-heldout-v1:${ROUND.randomness}`;

const manifest = JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8'));
if (manifest.seed !== SEED) throw new Error(`the corpus was generated with seed ${manifest.seed}, not ${SEED}`);
const byType = {};
for (const d of manifest.docs) (byType[d.slug] ??= []).push(d);
const order = (d) => sha(`${SEED}:${d.id}`);
const sample = [];
const repeats = [];
for (const slug of Object.keys(byType).sort()) {
  const ranked = byType[slug].slice().sort((a, b) => order(a).localeCompare(order(b)));
  if (ranked.length !== 200) throw new Error(`${slug}: ${ranked.length} documents, expected 200`);
  const kept = ranked.slice(0, PER_TYPE);
  sample.push(...kept);
  if (FIELD_TYPES.includes(slug)) repeats.push(...kept.slice(0, REPEATS_PER_TYPE).map((d) => d.id));
}

fs.mkdirSync(OUT, { recursive: true });
for (const d of sample) {
  const files = [d.file, d.gt, d.text, ...(d.attachments ?? []).map((a) => a.file)];
  for (const f of files) {
    // A key-only corpus (npm run keys) has no PDFs: they are copied where they exist, and every key and text must.
    if (!fs.existsSync(path.join(CORPUS, f))) { if (f === d.gt || f === d.text) throw new Error(`missing ${f}`); continue; }
    fs.mkdirSync(path.dirname(path.join(OUT, f)), { recursive: true });
    fs.copyFileSync(path.join(CORPUS, f), path.join(OUT, f));
  }
}
sample.sort((a, b) => a.id.localeCompare(b.id));
// The output contract of each type, the same for every document of that type, sits beside the keys: Contract is
// checked against it (scoring.mjs), never against an answer key's own structure.
if (fs.existsSync(path.join(CORPUS, 'contract.json'))) fs.copyFileSync(path.join(CORPUS, 'contract.json'), path.join(OUT, 'contract.json'));
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
  seed: SEED, count: PER_TYPE, types: manifest.types,
  ...(manifest.generator_settings ? { generator_settings: manifest.generator_settings } : {}), docs: sample,
  heldout: { registration: 'bench/samples/heldout-v1.json', drand_round: ROUND.round, generated_per_type: 200, sampled_per_type: PER_TYPE },
}, null, 1));
repeats.sort();
fs.writeFileSync(path.join(HERE, 'samples', 'heldout-v1-repeats.json'), JSON.stringify({
  purpose: 'Repeatability on the held-out documents: three full-lane runs per document with the extraction cache bypassed.',
  method: REG.repeat_sample,
  seed: SEED, corpus_seed: SEED, per_type: REPEATS_PER_TYPE, types: FIELD_TYPES, count: repeats.length, documents: repeats,
}, null, 1));
console.log(`held-out corpus: ${sample.length} documents -> ${OUT}; repeat sample: ${repeats.length} documents`);
