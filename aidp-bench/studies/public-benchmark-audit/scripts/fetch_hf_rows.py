# Usage: python3 -I fetch_hf_rows.py <dataset> <config> <split> <out_jsonl> [max_rows] [start_offset_append]
# Fetches rows from the Hugging Face datasets-server JSON API, 100 at a time, and drops image columns
# (only the annotation columns are kept, so no image bytes are stored).
import sys, json, time, urllib.request, urllib.parse
ds, cfg, split, out = sys.argv[1:5]
maxrows = int(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] != "all" else None
start = int(sys.argv[6]) if len(sys.argv) > 6 else 0
base = "https://datasets-server.huggingface.co/rows"
def get(offset, length):
    q = urllib.parse.urlencode({"dataset": ds, "config": cfg, "split": split, "offset": offset, "length": length})
    for attempt in range(8):
        try:
            with urllib.request.urlopen(base + "?" + q, timeout=90) as r:
                return json.load(r)
        except Exception as e:
            wait = 2 ** attempt
            sys.stderr.write(f"retry {attempt} offset {offset}: {e}; sleeping {wait}s\n"); time.sleep(wait)
    raise SystemExit("failed at offset %d" % offset)
first = get(0, 1)
total = first["num_rows_total"]
img_cols = [f["name"] for f in first["features"] if f["type"].get("_type") == "Image"]
n = total if maxrows is None else min(total, maxrows)
with open(out, "a" if start else "w", encoding="utf-8") as fo:
    off = start
    while off < n:
        d = get(off, min(100, n - off))
        for r in d["rows"]:
            row = r["row"]
            for c in img_cols:
                if c in row: row[c] = "<image column dropped by fetch_hf_rows.py>"
            fo.write(json.dumps({"row_idx": r["row_idx"], "row": row}, ensure_ascii=False) + "\n")
        off += len(d["rows"])
        if not d["rows"]: break
        time.sleep(1.5)
print(json.dumps({"dataset": ds, "config": cfg, "split": split, "num_rows_total": total, "rows_written": off, "image_columns_dropped": img_cols, "features": [f["name"] for f in first["features"]]}))
