/**
 * Writes the pre-declared samples of AIDP v1.0, before any run.
 *
 *   samples/stability-v1.json  repeatability: 20 documents of each of the ten types (200), each run
 *                              three times in the full lane with the extraction cache bypassed.
 *   samples/rules-v1.json      written instructions: 10 documents of each of the six field-key types (60).
 *
 * Each is a stratified random sample: within every document type the type's 200 document ids are
 * shuffled with a seeded generator and the first ones taken. The ids follow the corpus generator's
 * own naming (<type>-000 to <type>-199, corpus-gen/data.mjs), so the samples do not depend on any
 * rendered file and can be fixed, and committed, before the corpus is even regenerated. Running this
 * again produces byte-identical files; --check verifies the committed files instead of writing them.
 *
 *   node bench/make-samples.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rng } from '../corpus-gen/rng.mjs';
import { TYPES, PER_TYPE, SEED as CORPUS_SEED } from '../corpus-gen/composition.mjs';
import { FIELD_KEY_TYPES } from './rules.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'samples');
const CHECK = process.argv.includes('--check');

const idsOf = (type) => Array.from({ length: PER_TYPE }, (_, i) => `${type}-${String(i).padStart(3, '0')}`);

function sample({ seed, types, perType }) {
  const byType = {};
  for (const t of types) {
    const r = new Rng(`${seed}:${t}`);
    byType[t] = r.shuffle(idsOf(t)).slice(0, perType).sort();
  }
  return byType;
}

const specs = [
  {
    file: 'stability-v1.json',
    seed: 'aidp-v1.0-stability',
    types: TYPES,
    perType: 20,
    purpose: 'Repeatability (field stability). Each document is submitted three times in the full lane, the rendered PDF as a customer submits it, with the extraction cache bypassed (no_cache on /v2/extractions).',
  },
  {
    file: 'rules-v1.json',
    seed: 'aidp-v1.0-rules',
    types: FIELD_KEY_TYPES,
    perType: 10,
    purpose: 'Written-instruction compliance (adherence and containment). Each document is extracted once per applicable rule pack (rule-packs.mjs) in the text lane with the extraction cache bypassed, and compared with its own text-lane extraction from the main run.',
  },
];

let mismatch = 0;
fs.mkdirSync(OUT, { recursive: true });
for (const s of specs) {
  const byType = sample(s);
  const body = {
    purpose: s.purpose,
    method: `Stratified random sample: for each document type, the ${PER_TYPE} ids <type>-000 to <type>-${PER_TYPE - 1} shuffled with the seeded generator of corpus-gen/rng.mjs (seed "<sample seed>:<type>") and the first ${s.perType} taken, then sorted. Fixed before any run and written by bench/make-samples.mjs.`,
    seed: s.seed,
    corpus_seed: CORPUS_SEED,
    per_type: s.perType,
    types: [...s.types],
    count: Object.values(byType).reduce((a, x) => a + x.length, 0),
    documents: Object.values(byType).flat().sort(),
    by_type: byType,
  };
  const text = JSON.stringify(body, null, 1) + '\n';
  const file = path.join(OUT, s.file);
  if (CHECK) {
    const same = fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text;
    console.log(`${same ? 'unchanged' : 'DIFFERS  '}  ${path.relative(path.dirname(HERE), file)}  (${body.count} documents)`);
    if (!same) mismatch++;
  } else {
    fs.writeFileSync(file, text);
    console.log(`wrote ${path.relative(path.dirname(HERE), file)}: ${body.count} documents, ${s.perType} per type over ${s.types.length} types, seed "${s.seed}"`);
  }
}
process.exitCode = mismatch ? 1 : 0;
