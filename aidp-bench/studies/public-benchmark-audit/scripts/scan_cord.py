# Usage: python3 -I scan_cord.py <out_json> <split.jsonl> [<split.jsonl> ...]
import sys, json, re, collections
out = sys.argv[1]; files = sys.argv[2:]
res = {"files": files, "docs": 0}
gt_top_keys = collections.Counter(); parse_paths = collections.Counter(); value_types = collections.Counter()
word_keys = collections.Counter(); line_keys = collections.Counter(); meta_keys = collections.Counter()
dot_thousands = 0; comma_decimal = 0; numeric_values = 0; empty_values = 0
menu_docs = 0; menu_items_total = 0; multi_item_docs = 0
raw_hits = collections.Counter()
categories = collections.Counter()
words_with_quad = 0; words_total = 0
row0 = None
def walk(prefix, v):
    global dot_thousands, comma_decimal, numeric_values, empty_values
    if isinstance(v, dict):
        for k, x in v.items(): walk(prefix + "." + k if prefix else k, x)
    elif isinstance(v, list):
        for x in v: walk(prefix + "[]", x)
    else:
        parse_paths[prefix] += 1; value_types[type(v).__name__] += 1
        if isinstance(v, str):
            if v.strip() == "": empty_values += 1
            if re.fullmatch(r"-?\d{1,3}(\.\d{3})+", v.strip()): dot_thousands += 1
            if re.fullmatch(r"-?\d+(,\d{3})+", v.strip()): comma_decimal += 1
            if re.fullmatch(r"-?[\d.,]+", v.strip()): numeric_values += 1
for fn in files:
    for line in open(fn, encoding="utf-8"):
        r = json.loads(line); raw = r["row"]["ground_truth"]; gt = json.loads(raw)
        res["docs"] += 1
        for k in gt: gt_top_keys[k] += 1
        for k in gt.get("meta", {}): meta_keys[k] += 1
        for pat in ("normal", "canonical", "\"value\"", "currency", "iso", "decimal", "doc_type", "document_type", "difficulty", "barcode", "qr"):
            if pat in raw.lower(): raw_hits[pat] += 1
        p = gt["gt_parse"]; walk("", p)
        m = p.get("menu")
        if m is not None:
            menu_docs += 1
            n = len(m) if isinstance(m, list) else 1
            menu_items_total += n
            if n > 1: multi_item_docs += 1
        for vl in gt.get("valid_line", []):
            categories[vl.get("category")] += 1
            for k in vl: line_keys[k] += 1
            for w in vl.get("words", []):
                words_total += 1
                if "quad" in w: words_with_quad += 1
                for k in w: word_keys[k] += 1
        if fn.endswith("test.jsonl") and r["row_idx"] == 0:
            row0 = {"row_idx": 0, "gt_parse": p, "raw_contains_60000": ("60000" in raw), "raw_contains_60000.00": ("60000.00" in raw),
                    "occurrences_of_60.000_in_raw": raw.count("60.000"), "raw_length_chars": len(raw)}
res.update({"top_level_keys": dict(gt_top_keys), "meta_keys": dict(meta_keys), "valid_line_keys": dict(line_keys), "word_keys": dict(word_keys),
    "gt_parse_value_types": dict(value_types), "gt_parse_leaf_paths": dict(parse_paths.most_common()),
    "empty_string_values": empty_values, "numeric_like_values": numeric_values,
    "values_with_dot_as_thousands_separator_like_60.000": dot_thousands, "values_with_comma_thousands": comma_decimal,
    "docs_with_menu": menu_docs, "menu_items_total": menu_items_total, "docs_with_more_than_one_menu_item": multi_item_docs,
    "valid_line_categories": dict(categories.most_common()), "words_total": words_total, "words_with_quad": words_with_quad,
    "raw_substring_hits_docs": dict(raw_hits), "test_row0": row0})
json.dump(res, open(out, "w"), indent=1, ensure_ascii=False)
print(json.dumps({k: res[k] for k in ["docs","top_level_keys","meta_keys","valid_line_keys","word_keys","gt_parse_value_types","empty_string_values","numeric_like_values","values_with_dot_as_thousands_separator_like_60.000","values_with_comma_thousands","docs_with_menu","menu_items_total","docs_with_more_than_one_menu_item","words_total","words_with_quad","raw_substring_hits_docs","test_row0"]}, indent=1, ensure_ascii=False))
print("leaf paths:", list(res["gt_parse_leaf_paths"].items())[:45])
