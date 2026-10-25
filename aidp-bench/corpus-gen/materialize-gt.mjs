/**
 * Materializes the ground-truth half of AIDP-2K without rendering a page.
 *
 * buildDoc() is pure in (slug, index, seed), so every answer key, ground-truth text and manifest
 * entry regenerates deterministically at a given generator commit. Rendering the 2,000 PDFs takes
 * about a minute with six browser workers; the answer keys take seconds, and they are all that scoring,
 * profiling and auditing need. Use generate.mjs when the pages themselves are wanted.
 *
 * --out names the corpus folder the keys, page texts and manifest are written to.
 *
 *   node aidp-bench/corpus-gen/materialize-gt.mjs --out <corpus>
 *
 * KEYS ONLY. With --keys-only, an already rendered corpus at --out gets new answer keys and nothing
 * else: no PDF, no canonical text and no manifest entry is written. The canonical text each document
 * would produce is compared with the file on disk first, and the run aborts if a single one differs,
 * because a key may only change where the page it describes has not. Every changed key value is
 * counted per document type and field and written to --report, so the change is published, not merely
 * made.
 *
 *   node aidp-bench/corpus-gen/materialize-gt.mjs --out /path/aidp2k --keys-only --report keys-changed.json
 *
 * Both modes also write contract.json beside the keys: each type's contracted output schema
 * (contract.mjs), which the scorer checks Contract against, with the version of the field definitions it was
 * written from, as frozen in schema-snapshot.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { TYPES, PER_TYPE, SEED as COMPOSITION_SEED } from './composition.mjs';
import { buildDoc, applyGeneratorFlags, generatorSettingsRecord } from './data.mjs';
import { gtText, attachmentGtText, combine } from './gttext.mjs';
import { contractFor } from './contract.mjs';
import { FIELDS_VERSION } from './fields-snapshot.mjs';

/** The contract of every type, written beside the keys: what the scorer checks Contract against. */
function writeContracts(out, fieldsVersion) {
  const body = {
    description: 'The contracted output schema of each document type (corpus-gen/contract.mjs), the one the answer keys are written in: every section a response returns, under the name it returns it, its shape, and its fields; and every section the published format allows.',
    fields_version: fieldsVersion ?? null,
    contracts: Object.fromEntries(TYPES.map((slug) => [slug, contractFor(slug)])),
  };
  fs.writeFileSync(path.join(out, 'contract.json'), JSON.stringify(body, null, 1));
}

const args = process.argv.slice(2);
applyGeneratorFlags(args); // --valid-accounts, --due-dates-from-terms: both off by default (data.mjs)
// The last occurrence of an option wins, so `npm run keys -- --out <dir>` overrides the script's own --out.
const opt = (n, d) => { const i = args.lastIndexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
// --seed draws the same composition from another seed (the held-out check's: see bench/samples/heldout-v1.json).
const SEED = opt('seed', COMPOSITION_SEED);
const OUT = path.resolve(opt('out', 'corpus-regenerated'));

if (args.includes('--keys-only')) {
  const leaves = (o, p = '', out = {}) => {
    if (o == null || typeof o !== 'object') { out[p] = o ?? ''; return out; }
    if (Array.isArray(o)) { if (!o.length) out[p] = '[]'; o.forEach((v, i) => leaves(v, `${p}.${i}`, out)); return out; }
    for (const k of Object.keys(o)) leaves(o[k], p ? `${p}.${k}` : k, out);
    return out;
  };
  const generic = (p) => p.replace(/\.\d+(?=\.|$)/g, '[]');
  const report = { out: OUT, documents: 0, keys_rewritten: 0, keys_unchanged: 0, changes: {} };
  let textMismatch = 0;
  for (const slug of TYPES) {
    for (let i = 0; i < PER_TYPE; i++) {
      const doc = buildDoc(slug, i, SEED);
      let text = gtText(doc.content);
      if (doc.attachment) text = combine(text, [attachmentGtText(doc.attachment)]);
      const txtFile = path.join(OUT, slug, `${doc.id}.gt.txt`);
      if (!fs.existsSync(txtFile) || fs.readFileSync(txtFile, 'utf8') !== text) { textMismatch++; console.error(`TEXT DIFFERS: ${doc.id}`); continue; }
      const rec = {
        id: doc.id, slug, category: doc.category, category_alt: doc.category_alt ?? [], mode: doc.mode, locale: doc.locale, dims: doc.dims,
        gt: doc.gt, facts: doc.facts, expected_flags: doc.expectedFlags, expected_derived: doc.expectedDerived,
        expected_flags_future: doc.expectedFuture,
      };
      const gtFile = path.join(OUT, slug, `${doc.id}.gt.json`);
      const next = JSON.stringify(rec, null, 1);
      const prev = fs.existsSync(gtFile) ? fs.readFileSync(gtFile, 'utf8') : null;
      report.documents++;
      if (prev === next) { report.keys_unchanged++; continue; }
      const a = prev ? leaves(JSON.parse(prev)) : {}, b = leaves(rec);
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const was = a[k] === undefined ? '(absent)' : a[k], now = b[k] === undefined ? '(absent)' : b[k];
        if (String(was) === String(now)) continue;
        const key = `${slug} ${generic(k)}`;
        const c = report.changes[key] ??= { values: 0, documents: new Set(), examples: [] };
        c.values++; c.documents.add(doc.id);
        if (c.examples.length < 3) c.examples.push({ id: doc.id, path: k, was, now });
      }
      fs.writeFileSync(gtFile, next);
      report.keys_rewritten++;
    }
  }
  if (textMismatch) { console.error(`${textMismatch} canonical texts would change: the generator no longer reproduces these pages. Refusing; nothing beyond the keys above was written.`); process.exit(1); }
  writeContracts(OUT, FIELDS_VERSION);
  for (const c of Object.values(report.changes)) c.documents = c.documents.size;
  if (opt('report', '')) fs.writeFileSync(path.resolve(opt('report')), JSON.stringify(report, null, 1));
  console.log(`keys only: ${report.documents} documents, ${report.keys_rewritten} answer keys rewritten, ${report.keys_unchanged} unchanged; every canonical text identical; no PDF, text or manifest written`);
  for (const [k, c] of Object.entries(report.changes).sort()) console.log(`  ${k}: ${c.values} values in ${c.documents} documents`);
  process.exit(0);
}

const manifest = [];
let written = 0;
for (const slug of TYPES) {
  fs.mkdirSync(path.join(OUT, slug), { recursive: true });
  for (let i = 0; i < PER_TYPE; i++) {
    const doc = buildDoc(slug, i, SEED);
    let text = gtText(doc.content);
    let attFiles = [];
    if (doc.attachment) {
      const attId = `${doc.id}-att-A`;
      attFiles = [{ file: `${slug}/${attId}.pdf`, external_attachment_id: attId }];
      text = combine(text, [attachmentGtText(doc.attachment)]);
    }
    const rec = {
      id: doc.id, slug, category: doc.category, category_alt: doc.category_alt ?? [], mode: doc.mode, locale: doc.locale, dims: doc.dims,
      gt: doc.gt, facts: doc.facts, expected_flags: doc.expectedFlags, expected_derived: doc.expectedDerived,
      expected_flags_future: doc.expectedFuture,
    };
    const gtJson = JSON.stringify(rec, null, 1);
    fs.writeFileSync(path.join(OUT, slug, `${doc.id}.gt.json`), gtJson);
    fs.writeFileSync(path.join(OUT, slug, `${doc.id}.gt.txt`), text);

    manifest.push({ id: doc.id, slug, category: doc.category, category_alt: doc.category_alt ?? [], mode: doc.mode, locale: doc.locale, dims: doc.dims, file: `${slug}/${doc.id}.pdf`, gt: `${slug}/${doc.id}.gt.json`, text: `${slug}/${doc.id}.gt.txt`, attachments: attFiles });
    written++;
  }
}
manifest.sort((a, b) => a.id.localeCompare(b.id));
const manifestJson = JSON.stringify({ seed: SEED, count: PER_TYPE, types: TYPES, ...generatorSettingsRecord(), docs: manifest }, null, 1);
fs.writeFileSync(path.join(OUT, 'manifest.json'), manifestJson);
writeContracts(OUT, FIELDS_VERSION);
console.log(`${written} ground truths -> ${OUT}`);
