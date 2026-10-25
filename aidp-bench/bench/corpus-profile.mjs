/**
 * Profiles AIDP-2K without rendering it, and writes CORPUS.md and corpus-profile.json from the result.
 *
 * buildDoc() is pure and deterministic in (slug, index, seed), so the composition of the corpus can be computed
 * exactly by calling it for every document, without a browser and without the PDFs. Every number on CORPUS.md comes
 * from here, not from a hand-typed table.
 *
 *   node aidp-bench/bench/corpus-profile.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { TYPES, PER_TYPE, SEED } from '../corpus-gen/composition.mjs';
import { DOC_TYPES } from '../corpus-gen/schema.mjs';
import { buildDoc } from '../corpus-gen/data.mjs';
import { Rng } from '../corpus-gen/rng.mjs';

const BENCH = path.resolve(new URL('..', import.meta.url).pathname);
const display = (slug) => DOC_TYPES.find((t) => t.slug === slug)?.display ?? slug;

/** Every non-empty leaf value of an answer key. */
const countValues = (gt) => {
  let n = 0;
  const walk = (v) => {
    if (v == null) return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'object') { Object.values(v).forEach(walk); return; }
    if (String(v).trim() !== '') n++;
  };
  walk(gt);
  return n;
};
/** Rows of the answer key's tables: every list the key holds at its top level. */
const countRows = (gt) => Object.values(gt ?? {}).filter(Array.isArray).reduce((a, x) => a + x.length, 0);

const bump = (m, k, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
// The field measures count expected values as the reference run's scorer paired them (gt_populated): each nested list
// of the payment section, such as its tax lines or payment methods, is one value there, and the free-text payment
// description is left out.
const REF_BOARD = path.join(BENCH, 'results', 'aidp-v1-main', 'scoreboard.json');
const FIELD_EXPECTED = fs.existsSync(REF_BOARD)
  ? JSON.parse(fs.readFileSync(REF_BOARD, 'utf8')).docs.reduce((a, d) => a + (d.lanes?.pipeline?.L2?.gt_populated ?? 0), 0) : null;
const locales = new Map(), dims = new Map();
const types = [];
const T = { docs: 0, fieldDocs: 0, factDocs: 0, values: 0, rows: 0, facts: 0, softFacts: 0, attachments: 0, flags: 0, derived: 0, stickers: 0, bundleDrawn: 0, stamped: 0 };

for (const slug of TYPES) {
  const row = { slug, display: display(slug), mode: null, docs: 0, values: 0, rows: 0, facts: 0, softFacts: 0, locales: new Set() };
  for (let i = 0; i < PER_TYPE; i++) {
    const d = buildDoc(slug, i, SEED);
    row.mode = d.mode; row.docs++; row.locales.add(d.locale);
    T.docs++;
    const hardFacts = (d.facts ?? []).filter((f) => !f.soft).length;
    const softFacts = (d.facts ?? []).length - hardFacts;
    if (d.mode === 'fields') {
      T.fieldDocs++;
      const v = countValues(d.gt), r = countRows(d.gt);
      row.values += v; row.rows += r; T.values += v; T.rows += r;
    } else {
      T.factDocs++;
      row.facts += hardFacts; row.softFacts += softFacts; T.facts += hardFacts; T.softFacts += softFacts;
    }
    bump(locales, d.locale);
    // The stamp is drawn by the renderer from its own seeded stream, exactly as generate.mjs draws it.
    const tr = new Rng(`${SEED}:theme:${slug}:${i}`);
    tr.int(0, 3);
    if (d.content.noiseProfile !== 'none' && tr.chance(0.3)) T.stamped++;
    if (d.attachment) T.attachments++;
    if (d.dims.bundle) T.bundleDrawn++;
    if ((d.expectedFlags ?? []).length) T.flags++;
    if ((d.expectedDerived ?? []).length) T.derived++;
    if ((d.expectedFuture ?? []).length) T.stickers++;
    for (const [k, val] of Object.entries(d.dims ?? {})) {
      if (val === false || val == null) continue;
      bump(dims, val === true ? k : `${k}=${val}`);
    }
  }
  types.push({ ...row, locales: row.locales.size });
}

const sortDesc = (m) => Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
const profile = {
  seed: SEED, per_type: PER_TYPE, types: TYPES.length, documents: T.docs,
  documents_with_full_answer_keys: T.fieldDocs, answer_key_values: T.values, answer_key_table_rows: T.rows,
  documents_with_fact_keys: T.factDocs, facts_scored: T.facts, facts_recorded_not_scored: T.softFacts,
  documents_with_an_attachment: T.attachments, documents_drawn_for_the_attachment_condition: T.bundleDrawn,
  documents_expecting_a_flag: T.flags, documents_expecting_a_derived_value: T.derived,
  documents_with_a_contradicting_sticker: T.stickers,
  documents_with_a_paid_stamp: T.stamped,
  locales: sortDesc(locales), dimensions: sortDesc(dims),
  by_type: types.map((t) => ({ slug: t.slug, display: t.display, key: t.mode === 'fields' ? 'full answer key' : 'fact key',
    documents: t.docs, answer_key_values: t.values, answer_key_table_rows: t.rows, facts_scored: t.facts, locales: t.locales })),
  generated_by: 'aidp-bench/bench/corpus-profile.mjs',
};
fs.writeFileSync(path.join(BENCH, 'corpus-profile.json'), JSON.stringify(profile, null, 2) + '\n');

/* ------------------------------------------------------------- CORPUS.md */

const N = (v) => v.toLocaleString('en-US');
const pct = (v) => ((v / T.docs) * 100).toFixed(1) + '%';
const fieldTypes = types.filter((t) => t.mode === 'fields'), factTypes = types.filter((t) => t.mode !== 'fields');
const plural = (s) => s.toLowerCase() + 's';
const list = (xs) => xs.map((t) => plural(t.display)).join(', ').replace(/, ([^,]*)$/, ' and $1');
const FIELD_NOTE = FIELD_EXPECTED ? `; the reference run's field measures expect ${N(FIELD_EXPECTED)}, because they count each nested list of the payment section, such as its tax lines or payment methods, as one value and leave out the free-text payment description` : '';

const MEANING = {
  'scale=small': 'one to four line items; also every document of a type without line items',
  'scale=medium': '18 to 45 line items, a table long enough to need reading rather than glancing',
  'scale=large': '120 to 220 line items, a table that fills several pages',
  'scale=xl': '500 line items (invoices and purchase orders only), a table that runs over many pages, where rows get counted twice at the page break',
  'noise=none': 'a clean digital page',
  'noise=light': 'the page tilted slightly (0.4 degrees)',
  'noise=medium': 'the page tilted 1.1 degrees, with a fold shadow and a stain',
  'noise=heavy': 'the page tilted 2.2 degrees, with a fold shadow, a stain, a fax band and lowered contrast; drawn as a picture of the page, so the PDF is image-only and has no text layer (not declared in the answer keys; found by the difficulty study)',
  coverPage: 'a cover page in front of the document proper',
  bundle: `the attachment condition: of these, the ${N(T.attachments)} documents with 3 to 8 lines carry a separate attached PDF that breaks two of their lines down into their parts, and their answer keys hold those parts in place of the two lines; the other ${N(T.bundleDrawn - T.attachments)} are unchanged`,
  mismatch: 'a printed total that disagrees with the lines beneath it; the system is expected to flag it',
  missingTotals: 'no printed totals at all; the system is expected to derive the net and total amounts from the lines',
  stickerMismatch: 'a barcode sticker whose lot number contradicts the printed line it sits on',
};
const dimRows = Object.entries(profile.dimensions)
  .map(([k, v]) => `| \`${k}\` | ${N(v)} | ${pct(v)} | ${MEANING[k] ?? ''} |`).join('\n');
const typeRows = types.map((t) => `| ${t.display} | \`${t.slug}\` | ${t.mode === 'fields' ? 'full answer key' : 'fact key'} | ${N(t.docs)} | ${t.mode === 'fields' ? `${N(t.values)} values, ${N(t.rows)} table rows` : `${N(t.facts)} facts`} | ${t.locales} |`).join('\n');
const localeRows = Object.entries(profile.locales).map(([k, v]) => `| \`${k}\` | ${N(v)} | ${pct(v)} |`).join('\n');
const heavy = dims.get('noise=heavy') ?? 0;

fs.writeFileSync(path.join(BENCH, 'CORPUS.md'), `# AIDP-2K: the corpus

**${N(T.docs)} documents. ${TYPES.length} document types, ${N(PER_TYPE)} of each. ${locales.size} locales. One seed, \`${SEED}\`.**

AIDP-2K is the dataset AIDP-Bench scores against. It is synthetic: every document was generated by the code in
[\`corpus-gen/\`](corpus-gen/), and every person, address, account number, article and amount in it is invented.
So is every company name, with two exceptions: one Portuguese company is named after the publisher, Docupath, and the
freight invoices print a vessel name that carries a real shipping line's name, with real container-owner codes. No
document belongs to anyone, so all of it can be published.

The ${TYPES.length} types are shapes any accounts payable, procurement or legal team would recognise on sight:
${list(types)}.

## Answer key first

The generator writes each document's answers first and then draws the page from them, so nothing is labelled after the
fact. That ordering is what makes invention measurable. Every value the page prints is held by the answer key in the
field the output contract defines for it, so a value a system returns in a field the key leaves empty was never
printed there. The key holds each value in standard form while the page prints it in local form: the key holds
\`7761.00\` where a German page prints \`7.761,00\`, and \`DE\` where the page prints "Germany". The difference is exactly
the conversion a system is asked to perform.

The field names are read from [\`corpus-gen/schema-snapshot.json\`](corpus-gen/schema-snapshot.json), so the generator
needs nothing outside this repository.

## What is in it

| | |
|---|---|
| Documents | ${N(T.docs)} |
| Document types | ${TYPES.length}, ${N(PER_TYPE)} documents each |
| Locales | ${locales.size} |
| Documents with a full answer key, every value the page prints except the details the specification lists as unrecorded | ${N(T.fieldDocs)}: ${list(fieldTypes)} |
| Values in those answer keys | ${N(T.values)}, in ${N(T.rows)} table rows and the fields around them${FIELD_NOTE} |
| Documents with a fact key, a list of facts the output must contain | ${N(T.factDocs)}: ${list(factTypes)}, whose layouts are too open to list every field |
| Facts the output must contain | ${N(T.facts)} (the keys also record ${N(T.softFacts)} looser facts, such as dates, which are not scored) |
| PDF files | ${N(T.docs + T.attachments)}: one per document, plus ${N(T.attachments)} attached files |
| Documents with a separate attached file | ${N(T.attachments)} |
| Documents expecting a flag (printed total disagrees with its lines) | ${N(T.flags)} |
| Documents expecting a derived value (no printed totals) | ${N(T.derived)} |
| Documents with a barcode sticker contradicting its line | ${N(T.stickers)} |
| Image-only PDFs (no text layer) | ${N(heavy)}, the documents at \`noise=heavy\` |

**Attachments, not bundles.** No file holds two documents. ${N(T.attachments)} documents carry a second PDF beside them: an
attachment that breaks two of the document's lines down into their parts, which the answer key holds in place of the
two lines. Splitting several documents that arrive in one file (the specification's Segmentation) is not measured by
this corpus.

### Document types

| Type | Slug | Key | Documents | What the key holds | Locales |
|---|---|---|---|---|---|
${typeRows}

### Locales

Each locale carries its own labels, date order, number format, currency and, where it applies, script and text
direction. A number written \`1.234,56\` has to survive as one thousand two hundred and thirty four point five six, not
as one point two.

| Locale | Documents | Share |
|---|---|---|
${localeRows}

### Hard cases

Each condition below is present in a minority of documents on purpose: the majority are controls that must **not**
trigger the behaviour, so a safeguard that fires too eagerly is caught by the same run that measures whether it fires
at all.

| Dimension | Documents | Share | What it means |
|---|---|---|---|
${dimRows}

${N(T.stamped)} of the documents that are not clean also carry a "paid" stamp across the page.

## Get the PDFs, or regenerate everything

The answer keys, page texts, \`manifest.json\` and \`contract.json\` are committed in [\`corpus/\`](corpus/). The
${N(T.docs + T.attachments)} PDFs are published as an asset of the v1.0 release, and [\`corpus/PDF-SHA256SUMS\`](corpus/PDF-SHA256SUMS)
holds the SHA-256 fingerprint of every one, so a download can be checked against the files that were run:

\`\`\`bash
tar -xzf aidp-2k-v1.0-pdfs.tar.gz -C aidp-bench/corpus
cd aidp-bench/corpus && shasum -a 256 -c PDF-SHA256SUMS     # on Linux: sha256sum -c PDF-SHA256SUMS
\`\`\`

The whole corpus also regenerates from this repository:

\`\`\`bash
npm ci
npm run keys -- --out <folder>    # answer keys, page texts, manifest.json and contract.json, in seconds
npx playwright install chromium   # once, for drawing pages
npm run render -- --out <folder>  # the ${N(T.docs + T.attachments)} PDFs, about a minute with six browser workers
node aidp-bench/bench/corpus-profile.mjs   # rewrites this page
node aidp-bench/bench/corpus-sample.mjs    # rewrites the browsable sample
\`\`\`

The regenerated answer keys, page texts, \`manifest.json\` and \`contract.json\` are byte for byte the files in
\`corpus/\`. The PDFs are not, and cannot be: every PDF carries the date and time it was drawn (its creation and
modification dates), so a regenerated file never has the fingerprint in \`PDF-SHA256SUMS\`. That is why the release
files are published as they were run. Compared page by page, a full regeneration of all ${N(T.docs + T.attachments)} PDFs on
macOS, with the pinned browser (Playwright 1.63.0), gave:

- the same number of pages and the same text on every page, in all ${N(T.docs + T.attachments)} files;
- identical pixels (every page drawn at 96 dots per inch) in 1,975 files;
- small differences in the pixels of 37 files, all of them heavily degraded documents of two or more pages. Those pages
  are drawn as pictures, and the browser draws such a picture slightly differently from one run to the next, mostly
  near a page break: two further regenerations of the same 37 files differed from each other in 14 of them.

The pages use fonts that come with macOS (Helvetica Neue, Georgia, Courier New, Verdana, Hiragino Sans and Geeza Pro).
On a system without them the browser substitutes other fonts, so pages can break and look differently; the answer
keys and page texts do not depend on fonts.

## Explore it

- **[Browse the sample](corpus-sample/)**: sixteen documents, the first of each type and the first carrying each hard
  condition, every page beside its answer key and page text.
- **[Read the methodology](METHODOLOGY.md)**: how each capability is scored.
- **[See the results](results/)**: the per-document evidence behind every published figure.

## Paired with a collected corpus

A generated corpus can prove what only construction can prove, such as invention. It cannot show how a system behaves
on the documents real customers send, and a benchmark that is generated end to end can be tuned to its own generator.
The standard therefore pairs AIDP-2K with **AIDP-Field**, documents that people reviewed on a commercially available
IDP platform, whose name is withheld. Those documents are never published, and nothing from them is in this corpus.
The only figures from them in this repository are the all-account totals quoted in section 1 of the paper, listed with
how each was computed in [\`analysis/README.md\`](../analysis/README.md).

---

Generated by \`aidp-bench/bench/corpus-profile.mjs\`. Every number on this page is computed from the generator itself,
not typed in by hand, except the three results of the PDF regeneration check (1,975, 37 and 14), which were measured on
22 October 2026 by drawing the corpus again and comparing it with the release files.
`);

console.log(`${N(T.docs)} documents across ${TYPES.length} types, ${locales.size} locales`);
console.log(`${N(T.values)} answer-key values in ${N(T.rows)} table rows; ${N(T.facts)} scored facts; ${N(T.attachments)} attachments`);
console.log(`profile -> ${path.join(BENCH, 'corpus-profile.json')}`);
console.log(`explorer -> ${path.join(BENCH, 'CORPUS.md')}`);
