# Usage: python3 -I scan_docvqa.py <out_json> <validation.jsonl> <test.jsonl>
import sys, json, re, collections
out, valf, testf = sys.argv[1:4]
def load(f): return [json.loads(l)["row"] for l in open(f, encoding="utf-8")]
val = load(valf); test = load(testf)
res = {"validation_rows": len(val), "test_rows_sampled": len(test)}
keys = collections.Counter(); qtypes = collections.Counter(); n_answers = collections.Counter()
yesno = 0; yesno_examples = []; empty_ans = 0; docs = set(); variant_fmt = 0; variant_examples = []
for r in val:
    for k in r: keys[k] += 1
    docs.add(r["docId"])
    for t in r.get("question_types") or []: qtypes[t] += 1
    ans = r.get("answers") or []
    n_answers[len(ans)] += 1
    if not ans or all(not a.strip() for a in ans): empty_ans += 1
    low = set(a.strip().lower() for a in ans)
    if low and low <= {"yes", "no"}:
        yesno += 1
        if len(yesno_examples) < 3: yesno_examples.append({"questionId": r["questionId"], "question": r["question"], "answers": ans, "question_types": r["question_types"]})
    if len(ans) > 1:
        norm = set(re.sub(r"[^0-9a-z]", "", a.lower()) for a in ans)
        if len(norm) == 1 and len(set(ans)) > 1:
            variant_fmt += 1
            if len(variant_examples) < 5: variant_examples.append({"questionId": r["questionId"], "question": r["question"], "answers": ans})
test_answer_state = collections.Counter()
for r in test:
    a = r.get("answers")
    test_answer_state["null" if a is None else ("empty list" if a == [] else "non-empty")] += 1
res.update({"row_keys": dict(keys), "distinct_documents_in_validation_rows": len(docs), "question_types": dict(qtypes.most_common()),
    "answers_per_question": dict(sorted(n_answers.items())), "questions_with_empty_answer": empty_ans,
    "questions_answered_only_yes_or_no": yesno, "yes_no_examples": yesno_examples,
    "questions_whose_answer_variants_differ_only_in_formatting": variant_fmt, "formatting_variant_examples": variant_examples,
    "test_answers_state": dict(test_answer_state)})
json.dump(res, open(out, "w"), indent=1, ensure_ascii=False)
print(json.dumps(res, indent=1, ensure_ascii=False))
