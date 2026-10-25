# Usage: python3 -I scan_vrdu.py <dataset.jsonl.gz> <meta.json> <out_annotations_only.jsonl> <out_scan.json>
# Writes an annotations-only copy (OCR text dropped) and a scan of what the answer key holds.
import sys, gzip, json, re, collections
src, metaf, out_ann, out_scan = sys.argv[1:5]
meta = json.load(open(metaf))
schema = list(meta["entity_name_to_match_func"].keys())
res = {"source_file": src, "docs": 0}
top_keys = collections.Counter(); ent_docs = collections.Counter(); mentions = collections.Counter()
mention_shapes = collections.Counter(); bad = 0; li_groups = 0; li_docs = 0; empty_text = 0
date_shapes = collections.Counter(); price_shapes = collections.Counter(); examples = {}
missing_per_entity = collections.Counter()
with gzip.open(src, "rt", encoding="utf-8") as f, open(out_ann, "w", encoding="utf-8") as fo:
    for line in f:
        d = json.loads(line); res["docs"] += 1
        for k in d: top_keys[k] += 1
        fo.write(json.dumps({"filename": d["filename"], "annotations": d["annotations"]}, ensure_ascii=False) + "\n")
        seen = set(); has_li = False
        for a in d["annotations"]:
            name, ms = a[0], a[1]
            if isinstance(name, list):
                has_li = True; li_groups += 1
                for sub in name: seen.add(sub)
                continue
            seen.add(name)
            for m in ms:
                mentions[name] += 1
                text, box, spans = m[0], m[1], m[2]
                mention_shapes["text+[page,x1,y1,x2,y2]+spans" if isinstance(box, list) and len(box) == 5 else "other"] += 1
                if text.strip() == "": empty_text += 1
                fn = meta["entity_name_to_match_func"].get(name, "")
                t = text.strip()
                if fn == "DateMatch":
                    s = re.sub(r"[A-Za-z]+", "A", re.sub(r"\d", "9", t)); date_shapes[s] += 1; examples.setdefault("date:" + s, t)
                if fn == "PriceMatch":
                    s = re.sub(r"\d", "9", t); price_shapes[s] += 1; examples.setdefault("price:" + s, t)
        if has_li: li_docs += 1
        for e in seen: ent_docs[e] += 1
        for e in schema:
            if e not in seen: missing_per_entity[e] += 1
res.update({"record_keys": dict(top_keys), "schema_entities_from_meta": schema,
    "docs_with_entity": dict(ent_docs), "docs_missing_entity": dict(missing_per_entity),
    "mentions_per_entity": dict(mentions), "mention_shape": dict(mention_shapes), "empty_text_mentions": empty_text,
    "line_item_groups": li_groups, "docs_with_line_items": li_docs,
    "date_value_shapes_top": date_shapes.most_common(12), "price_value_shapes_top": price_shapes.most_common(12),
    "shape_examples": dict(list(examples.items())[:30])})
json.dump(res, open(out_scan, "w"), indent=1, ensure_ascii=False)
print(json.dumps(res, indent=1, ensure_ascii=False)[:4000])
