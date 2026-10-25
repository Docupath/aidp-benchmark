# Usage: python3 -I kleister_context.py <repo_dir> <split> <document_name> <regex> [<regex> ...]
# Prints short text windows around each regex match in one document's text_best column.
import sys, os, lzma, re
repo, split, doc = sys.argv[1:4]; pats = sys.argv[4:]
with lzma.open(os.path.join(repo, split, "in.tsv.xz"), "rt", encoding="utf-8") as f:
    for line in f:
        cols = line.rstrip("\n").split("\t")
        if cols[0] != doc: continue
        t = cols[-1].replace("\\n", " ").replace("\\f", " ")
        t = re.sub(r"\s+", " ", t)
        for p in pats:
            ms = list(re.finditer(p, t, flags=re.I))
            print(f"[{p}] matches={len(ms)}")
            for m in ms[:3]: print("   ...", t[max(0, m.start()-90): m.end()+60].strip(), "...")
        break
