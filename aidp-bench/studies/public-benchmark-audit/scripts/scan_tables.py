# Usage: python3 -I scan_tables.py <rd_groundtruth_dir> <rd_scores_csv> <OmniDocBench.json> <out_json>
import sys, os, re, json, csv, collections
gdir, scores, omni, out = sys.argv[1:5]
def cells(html): return re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", html, flags=re.S)
def is_empty(c): return re.sub(r"<[^>]+>|\s|&nbsp;", "", c) == ""
tags = collections.Counter(); attrs = collections.Counter(); n = 0; tc = 0; te = 0; rows = 0; ex_empty = None
for f in sorted(os.listdir(gdir)):
    s = open(os.path.join(gdir, f), encoding="utf-8", errors="replace").read(); n += 1
    for t in re.findall(r"<\s*([a-zA-Z0-9]+)", s): tags[t.lower()] += 1
    for a in re.findall(r"<[a-zA-Z0-9]+\s+([^>]*)>", s):
        for k in re.findall(r"([a-zA-Z\-]+)\s*=", a): attrs[k.lower()] += 1
    cs = cells(s); tc += len(cs); e = sum(1 for c in cs if is_empty(c)); te += e; rows += len(re.findall(r"<tr", s))
    if e and ex_empty is None: ex_empty = {"file": f, "first_300_chars": s[:300]}
hdr = next(csv.reader(open(scores, encoding="utf-8")))
langs = collections.Counter(r["language"] for r in csv.DictReader(open(scores, encoding="utf-8")))
data = json.load(open(omni, encoding="utf-8")); oc = 0; oe = 0; ot = 0
for p in data:
    for d in p["layout_dets"]:
        if d.get("category_type") == "table" and d.get("html"):
            ot += 1; cs = cells(d["html"]); oc += len(cs); oe += sum(1 for c in cs if is_empty(c))
res = {"rd_tablebench": {"groundtruth_files": n, "html_tags": dict(tags.most_common()), "html_attributes": dict(attrs.most_common()),
        "cells": tc, "empty_cells": te, "rows": rows, "example_with_empty_cell": ex_empty,
        "scores_csv_columns": hdr, "scores_csv_language_values": dict(langs)},
       "omnidocbench_tables": {"tables_with_html": ot, "cells": oc, "empty_cells": oe}}
json.dump(res, open(out, "w"), indent=1, ensure_ascii=False)
print(json.dumps(res, indent=1, ensure_ascii=False)[:3000])
