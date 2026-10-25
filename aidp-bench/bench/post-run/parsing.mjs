/**
 * Post-run diagnostic 5. Parsing: were values printed together separated into the fields that hold
 * their parts?
 *
 * Counts parts. The corpus prints two compounds on every field-key document (the six field-key types,
 * 1,200 documents):
 *   the seller's one-line address  "<street>, <postal code> <city>, <country>"   render.mjs line 73
 *   the buyer's postal code with city  "<postal code> <city>"                    render.mjs lines 44 to 49
 * Their parts are six fields of the answer key: Seller street (Address, or Street 1 where the contract
 * names it so), Seller Postal Code, Seller City, Seller Country, Buyer Postal Code, Buyer City. Each
 * part with a non-empty key value is classified from the full lane's extraction:
 *   own field     returned correctly in its own field, by the scorer's own comparison (base-score.mjs,
 *                 scoreFields, the rules of rules.mjs): what Fidelity counts as right;
 *   merged        its own field lacks it, and another field of the same party block holds it together
 *                 with other text: the compound was left unseparated;
 *   neighbour     its own field lacks it, and another field of the same block holds exactly it: separated,
 *                 but delivered under another field's name;
 *   other         wrong or missing in its own field and not found in a neighbour (Fidelity and
 *                 Completeness already count these), split into: own field holds it plus other text,
 *                 own field holds something else, own field empty.
 * The text lane (the correct text, no reading) is classified the same way, beside it.
 */
import path from 'node:path';
import { context, pipelineRaw, readJsonOr, writeJsonl, rate, squash } from './lib.mjs';
import { scoreFields } from '../base-score.mjs';
import { RULES, FIELD_KEY_TYPES } from '../rules.mjs';

const PARTS = [
  { sec: 'Seller', field: 'street', compound: 'seller one-line address' },
  { sec: 'Seller', field: 'Postal Code', compound: 'seller one-line address' },
  { sec: 'Seller', field: 'City', compound: 'seller one-line address' },
  { sec: 'Seller', field: 'Country', compound: 'seller one-line address' },
  { sec: 'Buyer', field: 'Postal Code', compound: 'buyer postal code and city' },
  { sec: 'Buyer', field: 'City', compound: 'buyer postal code and city' },
];

function classify(gtj, output) {
  const vmap = new Map(scoreFields(gtj.gt, output, RULES).map((v) => [v.path, v]));
  const out = [];
  for (const part of PARTS) {
    const block = gtj.gt[part.sec] ?? {};
    const field = part.field === 'street' ? ('Address' in block ? 'Address' : 'Street 1') : part.field;
    const want = block[field];
    if (want == null || !String(want).trim()) continue;
    const v = vmap.get(`${part.sec}.${field}`);
    const got = output?.[part.sec]?.[field];
    const rec = { part: `${part.sec}.${part.field === 'street' ? 'street' : part.field}`, field: `${part.sec}.${field}`, compound: part.compound, key: want, returned: got ?? null, verdict: v?.verdict ?? 'missing' };
    if (v && (v.verdict === 'correct' || v.verdict === 'normalized')) { out.push({ ...rec, class: 'own field' }); continue; }
    const need = squash(want), own = squash(got);
    const sibs = Object.entries(output?.[part.sec] ?? {}).filter(([k, x]) => k !== field && typeof x === 'string' && x.trim());
    if (need && !own.includes(need)) {
      const exact = sibs.find(([, x]) => squash(x) === need);
      const host = sibs.find(([, x]) => squash(x).includes(need) && squash(x).length > need.length);
      if (host) { out.push({ ...rec, class: 'merged', in_field: `${part.sec}.${host[0]}`, in_value: host[1] }); continue; }
      if (exact) { out.push({ ...rec, class: 'neighbour', in_field: `${part.sec}.${exact[0]}` }); continue; }
    }
    const how = !own ? 'own field empty' : own.includes(need) ? 'own field holds it plus other text' : 'own field holds something else';
    out.push({ ...rec, class: 'other', how });
  }
  return out;
}

export async function parsing() {
  const ctx = context();
  const rows = [];
  const lanes = { pipeline: {}, prompt: {} };
  const tally = (lane, k) => { lanes[lane][k] = (lanes[lane][k] ?? 0) + 1; };
  const byPart = {}, byType = {}, byLocale = {}, how = {};
  const merged = [], neighbour = [];
  for (const doc of ctx.manifest.docs.filter((d) => FIELD_KEY_TYPES.includes(d.slug))) {
    const gtj = ctx.corpus.gt(doc);
    const pipe = pipelineRaw(ctx, doc.id);
    const prompt = readJsonOr(path.join(ctx.rawDir, `${doc.id}.prompt.json`));
    const p = classify(gtj, pipe?.ok ? pipe.extraction : {});
    const t = classify(gtj, prompt?.ok ? prompt.extraction : {});
    for (const x of p) {
      tally('pipeline', x.class); tally('pipeline', 'parts');
      const add = (g, k) => { g[k] ??= { parts: 0, 'own field': 0, merged: 0, neighbour: 0, other: 0 }; g[k].parts++; g[k][x.class]++; };
      add(byPart, x.part); add(byType, doc.slug); add(byLocale, doc.locale);
      if (x.class === 'other') how[x.how] = (how[x.how] ?? 0) + 1;
      if (x.class === 'merged') merged.push({ id: doc.id, ...x });
      if (x.class === 'neighbour') neighbour.push({ id: doc.id, part: x.part, key: x.key, in_field: x.in_field });
    }
    for (const x of t) { tally('prompt', x.class); tally('prompt', 'parts'); }
    rows.push({ id: doc.id, slug: doc.slug, locale: doc.locale, pipeline: p, prompt: t.filter((x) => x.class !== 'own field') });
  }
  const P = lanes.pipeline, T = lanes.prompt;
  const figure = {
    id: 'parsing',
    capability: 'Parsing (Understand layer), values printed together',
    unit: 'parts (fields of a printed compound)',
    numerator: P['own field'] ?? 0,
    denominator: P.parts ?? 0,
    rate: rate(P['own field'] ?? 0, P.parts ?? 0),
    breakdown: {
      parts: P.parts, own_field: P['own field'] ?? 0, merged_into_a_neighbouring_field: P.merged ?? 0,
      in_a_neighbouring_field_alone: P.neighbour ?? 0, other_wrong_or_missing: P.other ?? 0,
      other_by_how: how,
      merged: merged.map((m) => ({ id: m.id, part: m.part, key: m.key, returned_in: m.in_field, value: m.in_value })),
      in_a_neighbouring_field_alone_examples: neighbour,
      by_part: byPart, by_type: byType, by_locale: byLocale,
      text_lane: { parts: T.parts, own_field: T['own field'] ?? 0, merged: T.merged ?? 0, neighbour: T.neighbour ?? 0, other: T.other ?? 0, rate_own_field: rate(T['own field'] ?? 0, T.parts ?? 0), note: 'The same parts from the text lane (the document\'s correct text, no reading): parsing without reading errors.' },
    },
    definition: 'Parts: the six key fields of the two printed compounds (Seller street, Postal Code, City and Country, printed as one line; Buyer Postal Code and City, printed on one line), on the 1,200 field-key documents, where the key value is non-empty. Numerator: parts returned correctly in their own field by the scorer\'s comparison. Merged: own field lacks the part and another field of the same party block holds it together with other text.',
    caveats: [
      'Computed after the run from kept outputs; not part of the AIDP Score; a diagnostic under spec section 7.6.',
      'Only a merge into another field of the same party block (Seller or Buyer) counts as merged; a part found in another section, or inside its own field together with a neighbour\'s text ("own field holds it plus other text", the mirror image of a merge), is counted under other.',
      'Freight invoices also print the seller\'s address as a block in the "From" box (street, "postal code city" and country on their own lines), so on those 200 documents the seller\'s street and country are not only printed inside the one-line compound.',
      'A part counted under "other" is wrong or missing in its own field for reasons that include misreading (a different city) as well as failed separation; Fidelity and Completeness already charge those values.',
    ],
  };
  return { figure, rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ctx = context();
  const { figure, rows } = await parsing();
  writeJsonl(path.join(ctx.outDir, 'parsing.jsonl'), rows);
  const { by_part, by_type, by_locale, ...b } = figure.breakdown;
  console.log(JSON.stringify({ ...figure, breakdown: { ...b, by_part } }, null, 1));
}
