// Doc-type schemas parsed from the field listings frozen in schema-snapshot.json (fields-snapshot.mjs), so ground
// truth keys match the field layout the v1.0 corpus was written in.
import { contractFor } from './contract.mjs';
import { DOC_TYPE_REGISTRY, schemaFieldList } from './fields-snapshot.mjs';

export const DOC_TYPES = DOC_TYPE_REGISTRY.map((d) => ({ slug: d.slug, display: d.display }));

const cache = new Map();
/** { sections: [{name, fields:[..]}], items: {section, fields} | null, meta: {section, fields} | null } */
export function schemaFor(slug) {
  if (cache.has(slug)) return cache.get(slug);
  const listing = schemaFieldList(slug); // "Section: f1, f2\n..."
  // A line with no colon is a note, not a section (the freight listing carries three, of the form
  // '"Invoice Charges" in the returned document = the table "Charges" here; ...'). Parsing one as a
  // section made an empty junk section in every freight answer key, so such lines are skipped.
  const sections = listing.split('\n').filter((line) => line.trim() && line.includes(':')).map((line) => {
    const i = line.indexOf(':');
    return { name: line.slice(0, i).trim(), fields: line.slice(i + 1).split(',').map((s) => s.trim()).filter(Boolean) };
  });
  const items = sections.find((s) => /^items$/i.test(s.name) || (s.fields.includes('Quantity') && (s.fields.includes('Article Name') || s.fields.includes('Description')))) || null;
  const meta = sections.find((s) => s.fields.some((f) => /Currency Code|Total Amount|Invoice Number|Order Number|Credit Note|Receipt Number|Quote Number/i.test(f))) || null;
  const out = { sections, items, meta };
  cache.set(slug, out);
  return out;
}
export function hasField(slug, section, field) {
  const s = schemaFor(slug).sections.find((x) => x.name === section);
  return !!s && s.fields.includes(field);
}
/**
 * Empty-but-complete GT skeleton, in the CONTRACT's names and shapes (contract.mjs): a section the
 * response returns as one object gets every field as "", a section it returns as a list of rows is []
 * until the type's builder writes the rows the page prints, and a table the response returns under
 * another name carries that name.
 */
export function skeleton(slug) {
  const gt = {};
  for (const s of contractFor(slug).sections) {
    if (s.shape === 'array') { gt[s.name] = []; continue; }
    gt[s.name] = {};
    for (const f of s.fields) gt[s.name][f] = '';
  }
  return gt;
}
/** One row of a contracted table: every column the contract gives it, "" unless given. */
export function contractRow(slug, section, values = {}) {
  const s = contractFor(slug).sections.find((x) => x.name === section);
  if (!s) throw new Error(`${slug}: no contracted section "${section}"`);
  return Object.fromEntries(s.fields.map((f) => [f, values[f] ?? '']));
}
export const itemSkeleton = (slug) => {
  const sch = schemaFor(slug);
  const o = {};
  if (sch.items) for (const f of sch.items.fields) o[f] = '';
  return o;
};
