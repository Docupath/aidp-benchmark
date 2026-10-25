# Usage: python3 -I kleister_nda_terms.py <repo_dir> <split> <out_json>
# For each expected term N_unit, look for N (digits or English word) followed within 25 characters by the unit.
import sys, os, lzma, re, json
repo, split, out = sys.argv[1:4]
words = {1:"one",2:"two",3:"three",4:"four",5:"five",6:"six",7:"seven",8:"eight",9:"nine",10:"ten",11:"eleven",12:"twelve",13:"thirteen",14:"fourteen",15:"fifteen",18:"eighteen",20:"twenty",24:"twenty[- ]four",30:"thirty",36:"thirty[- ]six",48:"forty[- ]eight",60:"sixty",90:"ninety"}
exp = [l.rstrip("\n") for l in open(os.path.join(repo, split, "expected.tsv"), encoding="utf-8")]
rows = [l.rstrip("\n").split("\t") for l in lzma.open(os.path.join(repo, split, "in.tsv.xz"), "rt", encoding="utf-8")]
found = 0; missing = []
for row, e in zip(rows, exp):
    for p in e.split():
        if not p.startswith("term="): continue
        v = p.split("=", 1)[1]; m = re.match(r"(\d+)_(\w+?)s?$", v)
        if not m: missing.append({"document": row[0], "expected": v, "why": "unparsed"}); continue
        n, unit = int(m.group(1)), m.group(2)
        num = r"(?:%d|%s)" % (n, words.get(n, r"\b\B"))
        pat = num + r"\W{0,4}(?:\(\s*%d\s*\))?\W{0,4}.{0,12}?%s" % (n, unit)
        text = " ".join(c.replace("\\n", " ") for c in row[2:])
        if re.search(pat, text, flags=re.I): found += 1
        else: missing.append({"document": row[0], "expected": v})
res = {"split": split, "term_values": found + len(missing), "number_and_unit_found_in_text": found, "not_found_as_number_and_unit": len(missing), "examples": missing[:15]}
json.dump(res, open(out, "w"), indent=1); print(json.dumps(res, indent=1)[:2500])
