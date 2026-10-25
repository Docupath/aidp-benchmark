# Usage: python3 -I kleister_never_printed.py <repo_dir> <split> <key> <out_json>
# For every expected value of <key>, test whether its digits appear in ANY of the four text layers
# (each OCR text layer the dataset ships, and their combination), allowing spaces/dots/dashes between digits.
import sys, os, lzma, json, re
repo, split, key, out = sys.argv[1:5]
exp = [l.rstrip("\n") for l in open(os.path.join(repo, split, "expected.tsv"), encoding="utf-8")]
rows = [l.rstrip("\n").split("\t") for l in lzma.open(os.path.join(repo, split, "in.tsv.xz"), "rt", encoding="utf-8")]
found = 0; missing = []; total = 0
for row, e in zip(rows, exp):
    vals = [p.split("=", 1)[1] for p in e.split() if p.startswith(key + "=")]
    if not vals: continue
    texts = [c.replace("\\n", " ") for c in row[2:]]
    for v in vals:
        total += 1
        digits = re.sub(r"\D", "", v)
        pat = r"(?<!\d)" + r"[\s.\-]?".join(digits) + r"(?!\d)"
        if any(re.search(pat, t) for t in texts): found += 1
        else: missing.append({"document": row[0], "expected": v, "text_layer_chars": [len(t) for t in texts]})
res = {"split": split, "key": key, "values": total, "digits_found_in_some_text_layer": found, "digits_absent_from_all_four_text_layers": len(missing), "absent_examples": missing[:25]}
json.dump(res, open(out, "w"), indent=1)
print(json.dumps(res, indent=1)[:3000])
