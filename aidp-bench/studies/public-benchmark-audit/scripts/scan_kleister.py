# Usage: python3 -I scan_kleister.py <repo_dir> <split> <out_scan.json>
# Compares the keys each document is asked for (in.tsv column 2) with the keys answered in expected.tsv,
# and checks whether each expected value is printed verbatim in the document text (text_best column).
import sys, os, lzma, json, re, collections, csv
repo, split, out = sys.argv[1:4]
csv.field_size_limit(10**9)
exp = [l.rstrip("\n") for l in open(os.path.join(repo, split, "expected.tsv"), encoding="utf-8")]
rows = []
with lzma.open(os.path.join(repo, split, "in.tsv.xz"), "rt", encoding="utf-8") as f:
    for line in f:
        rows.append(line.rstrip("\n").split("\t"))
assert len(rows) == len(exp), (len(rows), len(exp))
asked_ct = collections.Counter(); answered_ct = collections.Counter(); decoy_ct = collections.Counter(); extra_ct = collections.Counter()
verb = collections.Counter(); nonverb = collections.Counter(); nonverb_ex = collections.defaultdict(list); shapes = collections.defaultdict(collections.Counter)
docs_with_decoy = 0
def unesc(t): return t.replace("\\n", " ").replace("\\f", " ").replace("\\t", " ").replace("\\\\", "\\")
def norm(s): return re.sub(r"\s+", " ", s).strip().lower()
for row, e in zip(rows, exp):
    fname, keys = row[0], row[1].split()
    text = norm(unesc(row[-1]))
    pairs = [p.split("=", 1) for p in e.split()] if e.strip() else []
    answered = set(k for k, v in pairs)
    for k in keys: asked_ct[k] += 1
    for k in answered: answered_ct[k] += 1
    dec = [k for k in keys if k not in answered]
    for k in dec: decoy_ct[k] += 1
    if dec: docs_with_decoy += 1
    for k in answered:
        if k not in keys: extra_ct[k] += 1
    for k, v in pairs:
        vv = norm(v.replace("_", " "))
        shapes[k][re.sub(r"[A-Za-z]+", "A", re.sub(r"\d", "9", v))[:40]] += 1
        if vv and vv in text: verb[k] += 1
        else:
            nonverb[k] += 1
            if len(nonverb_ex[k]) < 4: nonverb_ex[k].append({"document": fname, "expected": v})
res = {"repo": repo, "split": split, "docs": len(exp), "keys_asked": dict(asked_ct), "keys_answered": dict(answered_ct),
       "asked_but_not_answered_decoys": dict(decoy_ct), "docs_with_at_least_one_decoy": docs_with_decoy,
       "answered_but_not_asked": dict(extra_ct),
       "expected_value_printed_verbatim_case_insensitive": dict(verb), "expected_value_not_printed_verbatim": dict(nonverb),
       "not_verbatim_examples": nonverb_ex, "value_shapes_top": {k: c.most_common(6) for k, c in shapes.items()}}
json.dump(res, open(out, "w"), indent=1, ensure_ascii=False)
print(json.dumps(res, indent=1, ensure_ascii=False)[:5000])
