/**
 * AIDP-2K's field definitions, frozen.
 *
 * This module serves the generator three things from schema-snapshot.json: the document type registry, each type's
 * field listing, and each type's published structure view. It is data only. With it, the corpus regenerates from
 * nothing but this repository.
 */
import fs from 'node:fs';

const SNAP = JSON.parse(fs.readFileSync(new URL('./schema-snapshot.json', import.meta.url), 'utf8'));

/** The version of these field definitions, which every contract.json records. */
export const FIELDS_VERSION = SNAP.fields_version ?? null;

/** [{ slug, display }], in the registry's order. */
export const DOC_TYPE_REGISTRY = SNAP.registry;

/** The type's field listing, "Section: f1, f2" per line, exactly as the frozen field definitions state it. */
export function schemaFieldList(slug) {
  const t = SNAP.types[slug];
  if (!t || typeof t.schemaFieldList !== 'string') throw new Error(`schema snapshot has no field listing for "${slug}"`);
  return t.schemaFieldList;
}

/** The type's published structure view ({} for a type with no published format). */
export function structureView(slug) {
  return SNAP.types[slug]?.structureView ?? {};
}
