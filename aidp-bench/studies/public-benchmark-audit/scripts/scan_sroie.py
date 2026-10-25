# Usage: python3 -I scan_sroie.py <losyash_repo_dir> <zzzdavid_repo_dir> <out_json>
import sys, os, json, re, collections
los, zzz, out = sys.argv[1], sys.argv[2], sys.argv[3]
res = {"splits": {}}
date_shapes = collections.Counter()
total_shapes = collections.Counter()
examples = {}
for split in ("train", "test"):
    edir = os.path.join(los, split, "entities"); bdir = os.path.join(los, split, "box")
    files = sorted(os.listdir(edir))
    keysets = collections.Counter(); missing = collections.Counter(); empty = collections.Counter()
    extra = collections.Counter(); parse_err = []
    verbatim = collections.Counter(); notverbatim = collections.Counter(); nv_examples = collections.defaultdict(list)
    for f in files:
        raw = open(os.path.join(edir, f), encoding="utf-8", errors="replace").read()
        try:
            d = json.loads(raw)
        except Exception as e:
            parse_err.append(f); continue
        keysets[",".join(sorted(d.keys()))] += 1
        for k in ("company", "date", "address", "total"):
            if k not in d: missing[k] += 1
            elif str(d[k]).strip() == "": empty[k] += 1
        for k in d:
            if k not in ("company", "date", "address", "total"): extra[k] += 1
        boxf = os.path.join(bdir, f)
        lines = []
        if os.path.exists(boxf):
            for ln in open(boxf, encoding="utf-8", errors="replace"):
                parts = ln.rstrip("\n").split(",", 8)
                if len(parts) == 9: lines.append(parts[8])
        joined = " ".join(lines)
        for k in ("date", "total", "company"):
            v = str(d.get(k, "")).strip()
            if not v: continue
            if any(v in l for l in lines): verbatim[k] += 1
            else:
                notverbatim[k] += 1
                if len(nv_examples[k]) < 3: nv_examples[k].append({"file": f"{split}/entities/{f}", "value": v})
        if "date" in d:
            shape = re.sub(r"[A-Za-z]", "A", re.sub(r"\d", "9", str(d["date"])))
            date_shapes[shape] += 1
            examples.setdefault("date:" + shape, f"{split}/entities/{f}: {d['date']}")
        if "total" in d:
            shape = re.sub(r"\d", "9", str(d["total"]))
            total_shapes[shape] += 1
    res["splits"][split] = {"files": len(files), "keysets": dict(keysets), "missing_key_counts": dict(missing),
        "empty_value_counts": dict(empty), "extra_keys": dict(extra), "parse_errors": parse_err,
        "value_found_verbatim_on_a_single_box_line": dict(verbatim), "value_not_verbatim_on_any_single_line": dict(notverbatim),
        "not_verbatim_examples": nv_examples}
res["date_shapes_top"] = date_shapes.most_common(15)
res["date_shape_examples"] = {k: v for k, v in examples.items() if k.startswith("date:")}
res["total_shapes_top"] = total_shapes.most_common(10)
# cross-check against zzzDavid raw organiser key files (train only)
zkeys = os.path.join(zzz, "data", "key")
zk = collections.Counter(); zmissing = collections.Counter(); zempty = collections.Counter()
for f in sorted(os.listdir(zkeys)):
    try: d = json.load(open(os.path.join(zkeys, f), encoding="utf-8", errors="replace"))
    except Exception: zk["PARSE_ERROR"] += 1; continue
    zk[",".join(sorted(d.keys()))] += 1
    for k in ("company", "date", "address", "total"):
        if k not in d: zmissing[k] += 1
        elif str(d[k]).strip() == "": zempty[k] += 1
res["zzzdavid_train_keys"] = {"files": sum(zk.values()), "keysets": dict(zk), "missing_key_counts": dict(zmissing), "empty_value_counts": dict(zempty)}
json.dump(res, open(out, "w"), indent=1)
print(json.dumps(res, indent=1)[:6000])
