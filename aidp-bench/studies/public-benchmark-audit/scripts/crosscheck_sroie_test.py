# Usage: python3 -I crosscheck_sroie_test.py <rth_test.jsonl> <losyash_repo_dir> <out_json>
# Compares the SROIE test answers in two independent mirrors (as multisets of the four-field tuples)
# and counts empty fields in each.
import sys, os, json, collections
rth, los, out = sys.argv[1:4]
def tup(d): return tuple((d.get(k) or "").strip() for k in ("company", "date", "address", "total"))
A = collections.Counter(); emptyA = 0; keysA = collections.Counter()
for l in open(rth, encoding="utf-8"):
    e = json.loads(l)["row"]["objects"]["entities"]
    keysA[",".join(sorted(e.keys()))] += 1
    t = tup(e); A[t] += 1; emptyA += sum(1 for x in t if x == "")
B = collections.Counter(); emptyB = 0
d = os.path.join(los, "test", "entities")
for f in os.listdir(d):
    t = tup(json.load(open(os.path.join(d, f), encoding="utf-8"))); B[t] += 1; emptyB += sum(1 for x in t if x == "")
res = {"rth_rows": sum(A.values()), "losyash_files": sum(B.values()), "rth_entity_keysets": dict(keysA),
       "empty_fields_rth": emptyA, "empty_fields_losyash": emptyB,
       "identical_tuples": sum((A & B).values()), "only_in_rth": sum((A - B).values()), "only_in_losyash": sum((B - A).values()),
       "examples_only_in_rth": [list(t) for t in list((A - B).keys())[:3]], "examples_only_in_losyash": [list(t) for t in list((B - A).keys())[:3]]}
json.dump(res, open(out, "w"), indent=1, ensure_ascii=False)
print(json.dumps(res, indent=1, ensure_ascii=False))
