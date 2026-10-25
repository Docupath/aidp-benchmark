# Usage: python3 -I scan_funsd.py <annotations_root> <out_json>
import sys, os, json, collections
root, out = sys.argv[1], sys.argv[2]
res = {"docs": 0}
entity_keys = collections.Counter(); word_keys = collections.Counter(); doc_keys = collections.Counter()
labels = collections.Counter(); q_total = 0; q_unanswered = 0; q_answered = 0; ex_unanswered = []
with_box = 0; ents = 0
for split in sorted(os.listdir(root)):
    adir = os.path.join(root, split, "annotations")
    for f in sorted(os.listdir(adir)):
        d = json.load(open(os.path.join(adir, f), encoding="utf-8"))
        res["docs"] += 1
        for k in d: doc_keys[k] += 1
        form = d["form"]; byid = {e["id"]: e for e in form}
        for e in form:
            ents += 1
            for k in e: entity_keys[k] += 1
            if "box" in e: with_box += 1
            for w in e.get("words", []):
                for k in w: word_keys[k] += 1
            labels[e["label"]] += 1
            if e["label"] == "question":
                q_total += 1
                partners = set()
                for a, b in e.get("linking", []):
                    other = b if a == e["id"] else a
                    if other in byid and byid[other]["label"] == "answer": partners.add(other)
                if partners: q_answered += 1
                else:
                    q_unanswered += 1
                    if len(ex_unanswered) < 5: ex_unanswered.append({"file": f"{split}/annotations/{f}", "id": e["id"], "text": e["text"], "box": e["box"], "linking": e.get("linking")})
res.update({"doc_level_keys": dict(doc_keys), "entity_keys": dict(entity_keys), "word_keys": dict(word_keys), "entities": ents, "entities_with_box": with_box,
    "labels": dict(labels), "questions": q_total, "questions_linked_to_an_answer": q_answered, "questions_with_no_linked_answer": q_unanswered,
    "unanswered_examples": ex_unanswered})
json.dump(res, open(out, "w"), indent=1, ensure_ascii=False)
print(json.dumps(res, indent=1, ensure_ascii=False))
