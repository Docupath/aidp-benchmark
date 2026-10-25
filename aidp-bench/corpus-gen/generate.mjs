// Draws AIDP-2K: the PDFs, with the answer keys, page texts and manifest beside them. Deterministic from --seed:
// the keys, texts and manifest regenerate byte for byte, and the PDFs with the same pages and text (1,975 of the
// 2,012 with the same pixels too, never with the same bytes: see CORPUS.md). The defaults are the standard composition
// (composition.mjs): ten types, 200 each,
// seed docupath-corpus-v1. Needs a browser: npx playwright install chromium.
//   node aidp-bench/corpus-gen/generate.mjs [--out <dir>] [--count 200] [--types invoice,quote] [--seed s] [--concurrency 6]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { TYPES as COMPOSITION, PER_TYPE, SEED as COMP_SEED } from './composition.mjs';
import { buildDoc, applyGeneratorFlags, generatorSettingsRecord } from './data.mjs';
import { toHtml, attachmentHtml, renderPdf } from './render.mjs';
import { gtText, attachmentGtText, combine } from './gttext.mjs';
import { Rng } from './rng.mjs';

const args = process.argv.slice(2);
applyGeneratorFlags(args); // --valid-accounts, --due-dates-from-terms: both off by default (data.mjs)
// The last occurrence of an option wins, so `npm run render -- --out <dir>` overrides the script's own --out.
const opt = (name, def) => { const i = args.lastIndexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const SEED = opt('seed', COMP_SEED);
const COUNT = Number(opt('count', String(PER_TYPE)));
const OUT = path.resolve(opt('out', 'aidp-bench/corpus-regenerated'));
const CONC = Number(opt('concurrency', '6'));
const TYPES = (opt('types', '') || COMPOSITION.join(',')).split(',').map((s) => s.trim()).filter(Boolean);

const jobs = [];
for (const slug of TYPES) for (let i = 0; i < COUNT; i++) jobs.push({ slug, i });
console.log(`corpus-gen: ${TYPES.length} types x ${COUNT} = ${jobs.length} docs -> ${OUT} (seed "${SEED}")`);

fs.mkdirSync(OUT, { recursive: true });
const manifest = [];
let done = 0, failed = 0;
const t0 = process.hrtime.bigint();

const browser = await chromium.launch();
async function worker(wid) {
  const page = await browser.newPage();
  for (;;) {
    const job = jobs.shift();
    if (!job) break;
    const { slug, i } = job;
    try {
      const doc = buildDoc(slug, i, SEED);
      const dir = path.join(OUT, slug);
      fs.mkdirSync(dir, { recursive: true });
      const r = new Rng(`${SEED}:theme:${slug}:${i}`);
      const themeIdx = r.int(0, 3);
      const stamp = doc.content.noiseProfile !== 'none' && r.chance(0.3) ? doc.content.locale.labels.paid : null;
      const pdf = await renderPdf(page, await toHtml(doc.content, themeIdx, stamp));
      fs.writeFileSync(path.join(dir, `${doc.id}.pdf`), pdf);
      let attFiles = [];
      let text = gtText(doc.content);
      if (doc.attachment) {
        const attPdf = await renderPdf(page, await attachmentHtml(doc.attachment));
        const attId = `${doc.id}-att-A`;
        fs.writeFileSync(path.join(dir, `${attId}.pdf`), attPdf);
        attFiles = [{ file: `${slug}/${attId}.pdf`, external_attachment_id: attId }];
        text = combine(text, [attachmentGtText(doc.attachment)]);
      }
      fs.writeFileSync(path.join(dir, `${doc.id}.gt.txt`), text);
      fs.writeFileSync(path.join(dir, `${doc.id}.gt.json`), JSON.stringify({
        id: doc.id, slug, category: doc.category, category_alt: doc.category_alt ?? [], mode: doc.mode, locale: doc.locale, dims: doc.dims,
        gt: doc.gt, facts: doc.facts, expected_flags: doc.expectedFlags, expected_derived: doc.expectedDerived,
        expected_flags_future: doc.expectedFuture,
      }, null, 1));
      manifest.push({ id: doc.id, slug, category: doc.category, category_alt: doc.category_alt ?? [], mode: doc.mode, locale: doc.locale, dims: doc.dims, file: `${slug}/${doc.id}.pdf`, gt: `${slug}/${doc.id}.gt.json`, text: `${slug}/${doc.id}.gt.txt`, attachments: attFiles });
      done++;
      if (done % 100 === 0) console.log(`  ${done}/${done + jobs.length + failed} done`);
    } catch (e) {
      failed++;
      console.error(`FAIL ${slug}-${i}: ${String(e?.message ?? e).slice(0, 200)}`);
    }
  }
  await page.close();
}
await Promise.all(Array.from({ length: CONC }, (_, w) => worker(w)));
await browser.close();
manifest.sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ seed: SEED, count: COUNT, types: TYPES, ...generatorSettingsRecord(), docs: manifest }, null, 1));
const secs = Number(process.hrtime.bigint() - t0) / 1e9;
console.log(`corpus-gen: ${done} ok, ${failed} failed in ${secs.toFixed(1)}s -> ${path.join(OUT, 'manifest.json')}`);
process.exit(failed ? 1 : 0);
