# Usage: python3 -I scan_docile.py <annotation.json> <out_json>
import sys, json, collections
src, out = sys.argv[1:3]
d = json.load(open(src, encoding="utf-8"))
def keys(lst): return sorted(set(k for f in lst for k in f))
fe, li, lh, m = d["field_extractions"], d["line_item_extractions"], d["line_item_headers"], d["metadata"]
grid = m.get("page_to_table_grid", {})
res = {"source": src, "top_level_keys": list(d.keys()), "metadata_keys": list(m.keys()),
  "metadata_scalars": {k: v for k, v in m.items() if not isinstance(v, (dict, list))},
  "field_extractions": len(fe), "field_keys": keys(fe), "fields_with_bbox_and_page": sum(1 for f in fe if "bbox" in f and "page" in f),
  "fieldtypes": sorted(set(f["fieldtype"] for f in fe)),
  "line_item_extractions": len(li), "line_item_keys": keys(li), "line_items_with_bbox_and_page": sum(1 for f in li if "bbox" in f and "page" in f),
  "line_item_ids": sorted(set(f["line_item_id"] for f in li)), "line_item_fieldtypes": sorted(set(f["fieldtype"] for f in li)),
  "line_item_headers": len(lh),
  "table_grid_keys": {p: list(g.keys()) for p, g in grid.items()},
  "table_grid_row_types": {p: dict(collections.Counter(r["row_type"] for r in g["rows"])) for p, g in grid.items()},
  "date_fields_as_stored": [{"fieldtype": f["fieldtype"], "text": f["text"]} for f in fe if f["fieldtype"].startswith("date")],
  "amount_fields_as_stored": [{"fieldtype": f["fieldtype"], "text": f["text"]} for f in fe if "amount" in f["fieldtype"]]}
json.dump(res, open(out, "w"), indent=1, ensure_ascii=False)
print(json.dumps(res, indent=1, ensure_ascii=False))
