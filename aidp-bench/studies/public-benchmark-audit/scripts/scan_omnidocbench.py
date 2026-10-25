# Usage: python3 -I scan_omnidocbench.py <OmniDocBench.json> <out_scan.json> <out_sample.json>
import sys, json, collections
src, out, out_sample = sys.argv[1:4]
data = json.load(open(src, encoding="utf-8"))
res = {"source": src, "pages": len(data)}
page_keys = collections.Counter(); info_keys = collections.Counter(); pattr_keys = collections.Counter()
pattr_vals = collections.defaultdict(collections.Counter); cats = collections.Counter(); det_keys = collections.Counter()
battr_keys = collections.Counter(); battr_vals = collections.defaultdict(collections.Counter)
tables_html = 0; dets = 0; dets_with_poly = 0; tr_counts = 0; extra_keys = collections.Counter(); rel_types = collections.Counter()
for p in data:
    for k in p: page_keys[k] += 1
    pi = p.get("page_info", {})
    for k in pi: info_keys[k] += 1
    for k, v in (pi.get("page_attribute") or {}).items():
        pattr_keys[k] += 1; pattr_vals[k][str(v)] += 1
    for k in (p.get("extra") or {}): extra_keys[k] += 1
    for r in (p.get("extra") or {}).get("relation", []): rel_types[r.get("relation") or r.get("relation_type")] += 1
    for d in p.get("layout_dets", []):
        dets += 1
        for k in d: det_keys[k] += 1
        if d.get("poly"): dets_with_poly += 1
        cats[d.get("category_type")] += 1
        for k, v in (d.get("attribute") or {}).items():
            battr_keys[k] += 1; battr_vals[k][str(v)] += 1
        if d.get("category_type") == "table" and d.get("html"):
            tables_html += 1; tr_counts += d["html"].count("<tr")
res.update({"page_keys": dict(page_keys), "page_info_keys": dict(info_keys), "page_attribute_keys": dict(pattr_keys),
    "page_attribute_values": {k: dict(v) for k, v in pattr_vals.items()}, "layout_det_keys": dict(det_keys),
    "layout_dets": dets, "layout_dets_with_poly": dets_with_poly, "category_types": dict(cats.most_common()),
    "block_attribute_keys": dict(battr_keys), "block_attribute_values": {k: dict(v.most_common(12)) for k, v in battr_vals.items()},
    "tables_with_html": tables_html, "table_rows_total_in_html": tr_counts, "extra_keys": dict(extra_keys), "relation_types": dict(rel_types)})
json.dump(res, open(out, "w"), indent=1, ensure_ascii=False)
# small sample: first page with a table, trimmed
for p in data:
    if any(d.get("category_type") == "table" for d in p.get("layout_dets", [])):
        json.dump(p, open(out_sample, "w"), indent=1, ensure_ascii=False); break
print(json.dumps(res, indent=1, ensure_ascii=False)[:7000])
