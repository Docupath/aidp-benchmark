/**
 * The contracted output schema of each document type, read from the field definitions frozen in schema-snapshot.json
 * (fields-snapshot.mjs).
 *
 * It is the same schema the generator writes answer keys in (schemaFieldList), with two
 * things the listing states but does not apply:
 *
 *   names   the listing's alias notes say which tables the response returns under another name
 *           ('"Invoice Charges" in the returned document = the table "Charges" here'), and its
 *           "(nested)" records are tables the response returns at the top level (the freight
 *           projection). A section carries the name the response gives it.
 *   shapes  whether a section is one object or a list of rows, read from the published format (its
 *           structure view), which is where the response's shapes are declared. A table
 *           the response builds by projection carries the columns the format publishes for it, its row
 *           id included; every other section carries the fields the listing asks for.
 *
 * `allowed` is every section the published format may emit for the type, so a section the format allows
 * (Flags, for one) is never charged as a section outside the contract, even when a system adds it to every response.
 *
 * The scorer never imports this module: materialize-gt.mjs writes these contracts into the corpus as
 * contract.json, beside the answer keys, and the scorer reads them from there.
 */
import { schemaFieldList, structureView } from './fields-snapshot.mjs';

const ALIAS_NOTE = /^"([^"]+)" in the returned document = the table "([^"]+)" here/;
const shapeOf = (v) => (Array.isArray(v) ? 'array' : v && typeof v === 'object' ? 'object' : 'scalar');
/** The columns a published table really has: an alias entry names its target, a real column is "". */
const columnsOf = (v) => {
  const row = Array.isArray(v) ? v[0] : v;
  return row && typeof row === 'object' ? Object.entries(row).filter(([, x]) => x === '').map(([k]) => k) : [];
};

const cache = new Map();
export function contractFor(slug) {
  if (cache.has(slug)) return cache.get(slug);
  const aliases = {};
  const listed = [];
  for (const line of schemaFieldList(slug).split('\n')) {
    if (!line.trim()) continue;
    const a = line.match(ALIAS_NOTE);
    if (a) { aliases[a[2]] = a[1]; continue; }
    const i = line.indexOf(':');
    if (i < 0) continue;
    const raw = line.slice(0, i).trim();
    const nested = /\s*\(nested\)$/.test(raw);
    listed.push({ internal: raw.replace(/\s*\(nested\)$/, ''), nested, fields: line.slice(i + 1).split(',').map((s) => s.trim()).filter(Boolean) });
  }
  const published = structureView(slug);

  const sections = [];
  for (const s of listed) {
    const name = aliases[s.internal] ?? s.internal;
    const projected = s.nested || name !== s.internal;
    if (s.nested && !(name in published)) continue;  // a record the response keeps nested
    const pub = published[name];
    sections.push({ name, internal: s.internal, shape: pub !== undefined ? shapeOf(pub) : 'object', fields: projected && pub !== undefined ? columnsOf(pub) : s.fields });
  }
  // A table an alias names that the listing has no section line for (Line Containers is the shipment's
  // own Containers column, returned as a table of its own).
  for (const [internal, name] of Object.entries(aliases)) {
    if (sections.some((x) => x.name === name) || !(name in published)) continue;
    sections.push({ name, internal, shape: shapeOf(published[name]), fields: columnsOf(published[name]) });
  }
  const contract = {
    slug,
    sections,
    allowed: [...new Set([...sections.map((x) => x.name), ...Object.keys(published), 'extra_fields_array'])],
  };
  cache.set(slug, contract);
  return contract;
}

export const contractSection = (slug, name) => contractFor(slug).sections.find((s) => s.name === name) ?? null;
