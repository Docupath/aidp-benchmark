// Rebuilds corpus/manifest.json from the ground-truth files on disk. The generator writes this file
// at the end of a full run; this recovers it for a corpus that was generated in pieces.
import fs from 'node:fs';
import path from 'node:path';
// The corpus folder: the first argument, or the environment variable AIDP_CORPUS_DIR. There is no default.
//   node aidp-bench/bench/rebuild-manifest.mjs <corpus dir>
const CORPUS = process.argv[2] || process.env.AIDP_CORPUS_DIR;
if (!CORPUS) { console.error('usage: node aidp-bench/bench/rebuild-manifest.mjs <corpus dir>   (or set AIDP_CORPUS_DIR)'); process.exit(2); }
const docs = [];
for (const slug of fs.readdirSync(CORPUS)) {
  const dir = path.join(CORPUS, slug);
  if (!fs.statSync(dir).isDirectory()) continue;
  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (!f.endsWith('.gt.json')) continue;
    const id = f.replace(/\.gt\.json$/, '');
    if (!fs.existsSync(path.join(dir, id + '.pdf'))) continue;
    let gt;
    try { gt = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    const attachments = files.filter((x) => x.startsWith(id + '-att-') && x.endsWith('.pdf'))
      .sort()
      .map((x) => ({ file: `${slug}/${x}`, external_attachment_id: x.replace(/\.pdf$/, '') }));
    docs.push({
      id, slug, category: gt.category, category_alt: gt.category_alt ?? [], mode: gt.mode,
      locale: gt.locale, dims: gt.dims ?? {},
      file: `${slug}/${id}.pdf`, gt: `${slug}/${f}`, text: `${slug}/${id}.gt.txt`,
      attachments,
    });
  }
}
docs.sort((a, b) => a.id.localeCompare(b.id));
// A rebuilt manifest keeps the seed and any generator settings the corpus was made with.
let previous = {};
try { previous = JSON.parse(fs.readFileSync(path.join(CORPUS, 'manifest.json'), 'utf8')); } catch (e) { /* none yet */ }
const out = { seed: previous.seed ?? 'docupath-corpus-v1', rebuilt: true, count: docs.length, types: [...new Set(docs.map((d) => d.slug))].sort(),
  ...(previous.generator_settings ? { generator_settings: previous.generator_settings } : {}), docs };
fs.writeFileSync(path.join(CORPUS, 'manifest.json'), JSON.stringify(out, null, 1));
console.log(`manifest rebuilt: ${docs.length} docs, ${out.types.length} types -> ${path.join(CORPUS, 'manifest.json')}`);
const withAtt = docs.filter((d) => d.attachments.length).length;
console.log(`  bundles (with attachments): ${withAtt}`);
const dims = {};
for (const d of docs) for (const [k, v] of Object.entries(d.dims)) if (v === true) dims[k] = (dims[k] ?? 0) + 1;
console.log('  planted dimensions:', JSON.stringify(dims));
const byScale = {}; for (const d of docs) byScale[d.dims.scale ?? '?'] = (byScale[d.dims.scale ?? '?'] ?? 0) + 1;
console.log('  scale bands:', JSON.stringify(byScale));
const byNoise = {}; for (const d of docs) byNoise[d.dims.noise ?? '?'] = (byNoise[d.dims.noise ?? '?'] ?? 0) + 1;
console.log('  noise bands:', JSON.stringify(byNoise));
