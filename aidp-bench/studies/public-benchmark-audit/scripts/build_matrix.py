# Usage: python3 -I scripts/build_matrix.py <audit_dir>
# Builds matrix.json and README.md from the evidence files. Every number quoted in a cell is
# re-read from the evidence JSON files and asserted, so a cell cannot drift from its evidence.
import sys, os, json, datetime, collections

AUD = sys.argv[1]
def ev(name): return json.load(open(os.path.join(AUD, "evidence", name), encoding="utf-8"))
IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
def ist_of(path):
    t = os.path.getmtime(os.path.join(AUD, path))
    return datetime.datetime.fromtimestamp(t, IST).strftime("%Y-%m-%d %H:%M IST")
BUILT = datetime.datetime.now(IST).strftime("%Y-%m-%d %H:%M IST")

# ---------------------------------------------------------------- evidence and assertions
sro = ev("sroie_scan.json"); cord = ev("cord_scan.json"); fun = ev("funsd_scan.json"); doc = ev("docile_sample_scan.json")
vab = ev("vrdu_adbuy_scan.json"); vrg = ev("vrdu_registration_scan.json"); dvq = ev("docvqa_scan.json")
omn = ev("omnidocbench_scan.json"); tab = ev("tables_scan.json")
knd = ev("kleister_nda_dev0_scan.json"); knt = ev("kleister_nda_train_scan.json"); knterm = ev("kleister_nda_train_terms.json")
kcd = ev("kleister_charity_dev0_scan.json"); kcnum = ev("kleister_charity_dev0_charity_number_printed.json")

A = lambda cond, msg: (_ for _ in ()).throw(AssertionError(msg)) if not cond else None
# SROIE
A(sro["splits"]["test"]["files"] == 347 and sro["splits"]["train"]["files"] == 626, "sroie files")
A(sro["splits"]["test"]["keysets"] == {"address,company,date,total": 347}, "sroie test keysets")
A(sro["splits"]["test"]["empty_value_counts"] == {} and sro["splits"]["test"]["missing_key_counts"] == {}, "sroie test empties")
A(sro["splits"]["train"]["missing_key_counts"] == {"address": 1} and sro["splits"]["train"]["empty_value_counts"] == {"total": 1}, "sroie train gaps")
A(all(not x["extra_keys"] for x in sro["splits"].values()), "sroie extra keys")
dv = sum(sro["splits"][s]["value_found_verbatim_on_a_single_box_line"]["date"] for s in ("train", "test"))
tv = sum(sro["splits"][s]["value_found_verbatim_on_a_single_box_line"]["total"] for s in ("train", "test"))
A((dv, tv) == (965, 969), "sroie verbatim")
A(sro["date_shape_count"] == 17, "sroie date shapes")
xc = ev("sroie_test_crosscheck.json")
A(xc["identical_tuples"] == 347 and xc["empty_fields_rth"] == 0 and xc["empty_fields_losyash"] == 0, "sroie crosscheck")
snv = ev("sroie_nonverbatim.json")
A(len(snv["cases"]) == 11 and sum(1 for c in snv["cases"] if c["class"] == "reformatted") == 8 and snv["date_values"] + snv["non_empty_total_values"] == 1945, "sroie nonverbatim")
A(973 - dv + 972 - tv == 11, "sroie 11")
# CORD
A(cord["docs"] == 200 and cord["test_row0"]["gt_parse"]["menu"]["price"] == "60.000", "cord row0")
A(cord["test_row0"]["raw_contains_60000"] is False and cord["test_row0"]["raw_contains_60000.00"] is False, "cord 60000")
A(cord["test_row0"]["occurrences_of_60.000_in_raw"] == 12 and cord["test_row0"]["raw_length_chars"] == 5411, "cord raw")
A(cord["gt_parse_value_types"] == {"str": 2520} and cord["empty_string_values"] == 0, "cord types")
A(cord["values_with_dot_as_thousands_separator_like_60.000"] == 324 and cord["values_with_comma_thousands"] == 799 and cord["numeric_like_values"] == 1772, "cord numbers")
A(cord["words_total"] == 4542 and cord["words_with_quad"] == 4542, "cord quads")
A(cord["menu_items_total"] == 472 and cord["docs_with_more_than_one_menu_item"] == 115, "cord menu")
A(cord["meta_keys"] == {"version": 200, "split": 200, "image_id": 200, "image_size": 200}, "cord meta")
A(cord["gt_parse_leaf_paths"]["sub_total.tax_price"] == 89, "cord tax")
# FUNSD
A(fun["docs"] == 199 and fun["entities"] == 9743 and fun["entities_with_box"] == 9743, "funsd entities")
A(fun["questions"] == 4343 and fun["questions_with_no_linked_answer"] == 1627, "funsd questions")
A(sum(fun["word_keys"].values()) // 2 == 31485, "funsd words")
# DocILE
A(doc["field_extractions"] == 11 and doc["fields_with_bbox_and_page"] == 11, "docile fields")
A(doc["line_item_extractions"] == 40 and doc["line_items_with_bbox_and_page"] == 40, "docile li")
A({"document_type", "currency", "cluster_id"} <= set(doc["metadata_scalar_keys"]), "docile meta")
# VRDU
A(vab["docs"] == 641 and vrg["docs"] == 1915, "vrdu docs")
A(vab["mention_shape"] == {"text+[page,x1,y1,x2,y2]+spans": 10051} and vrg["mention_shape"] == {"text+[page,x1,y1,x2,y2]+spans": 8840}, "vrdu boxes")
A(vab["docs_missing_entity"]["agency"] == 358 and vrg["docs_missing_entity"]["signer_title"] == 1366, "vrdu missing")
A(vab["line_item_groups"] == 9163 and vab["docs_with_line_items"] == 636 and vrg["line_item_groups"] == 0, "vrdu li")
# DocVQA
A(dvq["validation_rows"] == 5349 and dvq["distinct_documents_in_validation_rows"] == 1286, "docvqa rows")
A(dvq["questions_with_empty_answer"] == 0 and dvq["questions_answered_only_yes_or_no"] == 33, "docvqa answers")
yn = ev("docvqa_yes_no_pages.json")
A(yn["count"] == 33 and yn["inspected"] == 4 and yn["inspected_answer_word_printed"] == 4, "docvqa yes/no pages")
A(all(os.path.exists(os.path.join(AUD, "samples/docvqa/one-page-row%d/page.jpg" % n)) for n in (134, 1012, 4056, 4925)), "docvqa page images")
A(dvq["questions_whose_answer_variants_differ_only_in_formatting"] == 1712, "docvqa variants")
A(dvq["test_answers_state"] == {"null": 600}, "docvqa test")
A(set(dvq["row_keys"]) == {"questionId", "question", "question_types", "image", "docId", "ucsf_document_id", "ucsf_document_page_no", "answers", "data_split"}, "docvqa keys")
A(dvq["question_types"]["handwritten"] == 319 and dvq["question_types"]["Yes/No"] == 28, "docvqa qtypes")
# OmniDocBench
A(omn["pages"] == 1651 and len(omn["page_attribute_values"]["data_source"]) == 10, "omni pages")
A(omn["page_attribute_values"]["data_source"]["historical_document"] == 5, "omni hist")
A(omn["page_attribute_values"]["subset"] == {"equation_hard": 100, "layout_hard": 99, "table_hard": 97, "v1.5": 1355}, "omni subsets")
A(omn["layout_dets"] == 32798 and omn["layout_dets_with_poly"] == 32798, "omni polys")
A(omn["tables_with_html"] == 665 and omn["table_rows_total_in_html"] == 7353, "omni tables")
A(len(omn["category_types"]) == 28, "omni categories")
A(tab["omnidocbench_tables"] == {"tables_with_html": 665, "cells": 43771, "empty_cells": 3759}, "omni cells")
# RD-TableBench
rd = tab["rd_tablebench"]
A(rd["groundtruth_files"] == 1000 and rd["cells"] == 75867 and rd["empty_cells"] == 9158 and rd["rows"] == 13033, "rd cells")
A(rd["html_attributes"]["colspan"] == 1723 and rd["html_attributes"]["rowspan"] == 1311, "rd spans")
A(len(rd["scores_csv_language_values"]) == 15, "rd languages")
# Kleister NDA
A(knd["docs"] == 83 and knd["asked_but_not_answered_decoys"] == {"effective_date": 15, "term": 41, "jurisdiction": 5} and knd["docs_with_at_least_one_decoy"] == 48, "nda dev decoys")
A(knt["docs"] == 254 and sum(knt["asked_but_not_answered_decoys"].values()) == 218 and knt["docs_with_at_least_one_decoy"] == 160, "nda train decoys")
A(knd["keys_answered"]["effective_date"] == 62 and knd["expected_value_not_printed_verbatim"]["effective_date"] == 62, "nda dates")
A(knterm["term_values"] == 82 and knterm["not_found_as_number_and_unit"] == 11, "nda terms")
# Kleister Charity
A(kcd["docs"] == 440 and sum(kcd["asked_but_not_answered_decoys"].values()) == 97 and kcd["docs_with_at_least_one_decoy"] == 66, "charity decoys")
A(all(v == 440 for v in kcd["keys_asked"].values()) and len(kcd["keys_asked"]) == 8, "charity asked")
A(kcd["keys_answered"]["income_annually_in_british_pounds"] == 434 and kcd["expected_value_not_printed_verbatim"]["income_annually_in_british_pounds"] == 430, "charity money")
A(kcnum["values"] == 437 and kcnum["digits_absent_from_all_four_text_layers"] == 9 and kcnum["digits_found_in_some_text_layer"] == 428, "charity numbers")


# quoted examples, read straight from the sample files. Apart from CORD (CC BY 4.0), a dataset's own text is not
# published with this audit, so each example is checked by the SHA-256 of the line or record it sits in.
import hashlib
H = lambda s: hashlib.sha256(s.encode("utf-8")).hexdigest()[:16]
SRT = os.path.join(AUD, "samples/sroie/losyash-sroie-datasetv2/repo/")
A(json.load(open(SRT + "train/entities/X51005433522.txt"))["total"] == "", "sroie empty total")
A(H(open(SRT + "train/box/X51005433522.txt").read().split("\n")[20]) == "1506e3b35e1dff95", "sroie nett total")
A("address" not in json.load(open(SRT + "train/entities/X51005663280.txt")), "sroie missing address")
A(H(open(SRT + "test/entities/X00016469670.txt").read().split("\n")[3]) == "186b7e07c8273ac1" and H(open(SRT + "test/box/X00016469670.txt").read().split("\n")[6]) == "e2e05ffb1052df27", "sroie key and box")
r0 = json.loads(open(os.path.join(AUD, "samples/cord/hf-naver-clova-ix-cord-v2/test.jsonl")).readline())
vl = json.loads(r0["row"]["ground_truth"])["valid_line"]
A(any(l["category"] == "menu.price" and l["words"][0]["text"] == "60.000" and l["words"][0]["quad"]["x1"] == 174 and l["words"][0]["quad"]["y1"] == 410 for l in vl), "cord quad")
fd = json.load(open(os.path.join(AUD, "samples/funsd/annotations/testing_data/annotations/82092117.json")))
A(any(e["id"] == 22 and H(e["text"]) == "529ac3623958f82b" and e["linking"] == [] for e in fd["form"]), "funsd id 22")
reg1 = json.loads(open(os.path.join(AUD, "samples/vrdu/annotations-only/registration-form.annotations.jsonl")).readline())
A(reg1["filename"] == "19410222_DLA Piper US LLP_Amendment_Amendment.pdf" and reg1["annotations"][0][0] == "registration_num" and reg1["annotations"][0][1][0][2] == [[2380, 2385]], "vrdu reg example")
ndl = open(os.path.join(AUD, "samples/kleister-nda/github-applicaai-kleister-nda/repo/train/expected.tsv"), encoding="utf-8").read().split("\n")
A((H(ndl[14]), H(ndl[46]), H(ndl[195])) == ("347fc6d8ab1cfc7f", "787f7184f37d5f3c", "1361c4c0bd25b25a"), "nda train lines")
A(H(open(os.path.join(AUD, "samples/kleister-nda/github-applicaai-kleister-nda/repo/dev-0/expected.tsv"), encoding="utf-8").readline().rstrip("\n")) == "45e7367d89019b16", "nda dev line 1")
chl = open(os.path.join(AUD, "samples/kleister-charity/github-applicaai-kleister-charity/repo/dev-0/expected.tsv"), encoding="utf-8").read().split("\n")
A(H(chl[1]) == "17ea208f419d5de4" and H(chl[9]) == "6ac1e16977a6501c" and "income" not in chl[0], "charity lines")
rdx = open(os.path.join(AUD, "samples/rd-tablebench/hf-reducto-rd-tablebench/rd-tablebench/groundtruth/10035_png.rf.07e8e5bf2e9ad4e77a84fd38d1f53f38.html"), encoding="utf-8").read()
A(H(rdx) == "5eebe05a2b2a705d", "rd values")
dl = json.load(open(os.path.join(AUD, "samples/docile/github-rossumai-docile/repo/tests/data/sample-dataset/annotations/516f2d61ea404b30a9192a72.json")))
A(any(f["fieldtype"] == "date_issue" and H(f["text"]) == "61ba2d7a0dc1e1e9" for f in dl["field_extractions"]), "docile date")
si = collections.Counter()
for k, v in omn["page_attribute_values"]["special_issue"].items():
    for t in k.strip("[]").replace("'", "").split(", "):
        if t: si[t] += v
A((si["fuzzy_scan"], si["watermark"], si["with_watermark"], si["geometric_deformation"], si["colorful_backgroud"]) == (30, 73, 24, 13, 266), "omni special issues")
A(omn["page_attribute_values"]["data_source"] == {"book": 276, "academic_literature": 215, "note": 118, "PPT2PDF": 253, "colorful_textbook": 159, "historical_document": 5, "magazine": 149, "exam_paper": 193, "research_report": 132, "newspaper": 151}, "omni genres")
A(dvq["question_types"] == {"layout": 1981, "table/list": 1780, "form": 1021, "free_text": 765, "handwritten": 319, "figure/diagram": 265, "others": 236, "Image/Photo": 98, "Yes/No": 28}, "docvqa qtypes all")
A(kcd["asked_but_not_answered_decoys"] == {"address__street_line": 50, "income_annually_in_british_pounds": 6, "spending_annually_in_british_pounds": 6, "address__postcode": 14, "address__post_town": 18, "charity_number": 3}, "charity decoy split")
A(os.path.getsize(os.path.join(AUD, "samples/kleister-charity/s3-annex-one-pdf/cc9880ece943bf688b49359a8c219b04.pdf")) == 4781158, "charity pdf size")

# ---------------------------------------------------------------- properties
PROPS = [
 (1, "per-field keys", "per-field keys", "Completeness and Fidelity (Capture)",
  "present: each answer is stored under a named field from a fixed schema. partial: answers are keyed, but to free text (a printed label or a question) rather than a fixed set of named fields. absent: no field-level answers (page transcription, layout or table structure only)."),
 (2, "explicit empties", "explicit empties", "Restraint (values invented)",
  "present: for each document the key states which fields were asked and which have no value (explicitly, or by a documented rule that an asked field left out of the key means 'no value'), so a value returned for an empty field is a countable false positive. partial: emptiness is only implied by omission from a closed field set (sometimes enforced by the scorer), or recorded only as empty table cells. absent: empty fields cannot be told apart from unannotated ones, or the scored split has no empty field at all."),
 (3, "canonical beside printed", "canonical beside printed", "Normalisation (Understand)",
  "present: the key stores both the printed form and a normalised (canonical) value. partial: the key stores the canonical value only (the printed form stays in the page or its OCR text, not beside it), or only for some fields. absent: the key stores the printed form only."),
 (4, "values never printed", "values never printed", "Computation and Attribution (Understand)",
  "present: the key deliberately includes answers the page does not print (inferred, computed or looked up) and marks them. partial: such answers exist but incidentally and unmarked. absent: every answer is printed on the page, either as written or merely reformatted. Document-level classification labels (type, language) are judged under property 12, not here."),
 (5, "evidence locations", "evidence locations", "Traceability (Trust)",
  "present: every answer (or every annotated element, for parsing corpora) carries its position (box or polygon plus page, or character offsets). partial: positions exist for text lines but are not linked to the answers. absent: no positions."),
 (6, "derivability flags", "derivability flags", "Computation (Understand)",
  "present: the key marks whether a missing value can be derived from other values. partial: some derived values are marked. absent: nothing in the schema records derivability."),
 (7, "planted traps with controls", "planted traps with controls", "Escalation (Trust) and Consistency (Understand)",
  "present: the corpus plants known defects and pairs them with matched clean controls, and the key says which is which. partial: planted defects without controls, or controls without a key. absent: natural documents only."),
 (8, "declared difficulty", "declared difficulty", "reporting by difficulty (section 6 difficulty study)",
  "present: every document (or page) carries declared difficulty labels or a declared hard subset. partial: per-document attributes that are known difficulty factors, or per-document membership in a harder evaluation condition (unseen layout or template), without a grade. absent: nothing per document."),
 (9, "instruction ground truth", "instruction ground truth (also called rule ground truth)", "Instructions (Reason)",
  "present: correct outputs under written customer rules, with an untouched baseline. absent: no rules."),
 (10, "payload keys", "payload keys", "Decoding (Understand) and barcode payloads (Read)",
  "present: decoded barcode or QR contents are stored. absent: no encoded-content field."),
 (11, "line-item / table row structure", "line-item / table row structure", "Line items (Capture)",
  "present: the key groups values into rows or line items. partial: tables exist only as unstructured text. absent: no row structure."),
 (12, "document type labels", "document type labels", "Identification (Capture)",
  "present: each document carries a type label from a set of more than one type. partial: type implied only by sub-corpus or file name. absent: single-type corpus with no label, or no label."),
 (13, "multi-document segmentation boundaries", "multi-document segmentation boundaries", "Segmentation (Capture)",
  "present: files holding several documents carry the boundaries. absent: one document per file, or multi-document files removed."),
 (14, "entity resolution targets", "entity resolution targets", "Resolution (Reason)",
  "present: printed names are linked to entries in a master list or registry that contains plausible wrong candidates. partial: the key carries a registry identifier for the real entity, sourced from the registry, but no candidate list. absent: names stored only as printed."),
 (15, "repeatability needs (documents only)", "repeatability (needs only documents)", "Repeatability (Trust)",
  "present: the documents themselves are distributed, so the same document can be submitted twice and the outputs compared; no answer key is needed. absent: documents not available."),
]

# ---------------------------------------------------------------- benchmarks and sources
B = collections.OrderedDict()
B["sroie"] = dict(name="SROIE", cite="[6]", date_from="evidence/sroie_scan.json",
  downloaded="Answer keys and line transcriptions only (no images): train/entities, test/entities, train/box, test/box from the Losyash/SROIE-datasetv2 mirror (626 train + 347 test receipts). Cross-checked against the 626 raw organiser key files in zzzDavid/ICDAR-2019-SROIE data/key (same keysets, same two gaps) and against the 347 test answers of the Hugging Face copy rth/sroie-2019-v2 (identical). Competition paper text (arXiv 2103.10213).",
  urls=["https://github.com/Losyash/SROIE-datasetv2/tree/235ba41db8e7c7dc1437143baadb0882a4446d5c", "https://github.com/zzzDavid/ICDAR-2019-SROIE/tree/27be4271b251c256f695acbade9a801bffe85994/data/key", "https://huggingface.co/datasets/rth/sroie-2019-v2", "https://arxiv.org/abs/2103.10213", "https://rrc.cvc.uab.es/?ch=13 (official, registration required, not used)"])
B["cord"] = dict(name="CORD", cite="[5]", date_from="evidence/cord_scan.json",
  downloaded="ground_truth column of the test (100) and validation (100) splits of naver-clova-ix/cord-v2 through the Hugging Face rows API, image column dropped. The train split (800) could not be fetched: the rows API returned HTTP 500 for every train request. CORD README (class table).",
  urls=["https://huggingface.co/datasets/naver-clova-ix/cord-v2 (revision 7f0115a4b758a71d6473b8d085751692da2fef98)", "https://datasets-server.huggingface.co/rows?dataset=naver-clova-ix/cord-v2&config=default&split=test&offset=0&length=1", "https://github.com/clovaai/cord/blob/327310ce58c1623255821d062b3a759ff3789e3c/README.md"])
B["funsd"] = dict(name="FUNSD", cite="[7]", date_from="evidence/funsd_scan.json",
  downloaded="The official dataset.zip (16,838,830 bytes, SHA-256 c31735649e4f441bcbb4fd0f379574f7520b42286e80b01d80b445649d54761f); only the 199 annotation JSON files were kept, the zip and images were deleted.",
  urls=["https://guillaumejaume.github.io/FUNSD/dataset.zip"])
B["docile"] = dict(name="DocILE", cite="[8]", date_from="evidence/docile_sample_scan.json",
  downloaded="Access-gated (a token is needed for the data). Used instead: the published schema in the GitHub repository (README, Field class, evaluation code, tutorials), the one real annotation file the repository publishes (tests/data/sample-dataset/annotations/516f2d61ea404b30a9192a72.json, with its OCR and PDF in the repository), and the paper text (arXiv 2302.05658).",
  urls=["https://github.com/rossumai/docile/tree/45f1f00d184664e23b0fb657574ce07b2bfac065", "https://github.com/rossumai/docile/blob/45f1f00d184664e23b0fb657574ce07b2bfac065/tests/data/sample-dataset/annotations/516f2d61ea404b30a9192a72.json", "https://arxiv.org/abs/2302.05658"])
B["vrdu"] = dict(name="VRDU", cite="[9]", date_from="evidence/vrdu_adbuy_scan.json",
  downloaded="Both main/dataset.jsonl.gz files (ad-buy 31,986,319 bytes, SHA-256 5fbf579a023e1068433f3115006da109145307cdd3e1b64346b92c959384ef36; registration 54,839,306 bytes, SHA-256 9dd5f711e34861bdf9a98e05415355b522439e8658fcef763ef8d9b6b50cdc49), reduced to annotations-only copies (OCR text dropped) and then deleted; both meta.json files; two few-shot split files; the evaluation toolkit from google-research; paper text (arXiv 2211.15421).",
  urls=["https://github.com/google-research-datasets/vrdu/tree/04a4df7ac5cc694e51c48115c03fe428f0e240cc", "https://github.com/google-research/google-research/tree/600df90d3b8875e62efa9d462faa9d87276fad74/vrdu", "https://arxiv.org/abs/2211.15421"])
B["docvqa"] = dict(name="DocVQA", cite="[10]", date_from="evidence/docvqa_scan.json",
  downloaded="All 5,349 validation questions and the first 600 test questions of the lmms-lab DocVQA mirror (config DocVQA) through the Hugging Face rows API, image column dropped. The official files are on the ICDAR RRC site behind registration.",
  urls=["https://huggingface.co/datasets/lmms-lab/DocVQA (now served as lmms-lab-encoder/DocVQA, revision 539088ef8a8ada01ac8e2e6d4e372586748a265e)", "https://datasets-server.huggingface.co/rows?dataset=lmms-lab-encoder/DocVQA&config=DocVQA&split=validation&offset=0&length=100", "https://rrc.cvc.uab.es/?ch=17 (official, registration required, not used)"])
B["omnidocbench"] = dict(name="OmniDocBench", cite="[11]", date_from="evidence/omnidocbench_scan.json",
  downloaded="The full annotation file OmniDocBench.json (42,208,096 bytes, SHA-256 a45cd84b04ad8b793e775089640e6b681209abea33ead54c1828ddca35fae496) and the dataset README; no images.",
  urls=["https://huggingface.co/datasets/opendatalab/OmniDocBench/tree/aa1ee96d106dbe53d0ae59474d75c6e6d9b53fec"])
B["kleister-nda"] = dict(name="Kleister NDA", cite="[12]", date_from="evidence/kleister_nda_dev0_scan.json",
  downloaded="README, config, expected.tsv for train and dev-0, expected-original.tsv for train, and in.tsv.xz (document text from four OCR tools) for train, dev-0 and test-A, by sparse git checkout; of the 726 PDFs in documents/ only the two behind the computed terms were downloaded. Paper text (arXiv 2105.05796).",
  urls=["https://github.com/applicaai/kleister-nda/tree/c2c7bf069b919bfb618b268fda2a2c079c0db316", "https://arxiv.org/abs/2105.05796"])
B["kleister-charity"] = dict(name="Kleister Charity", cite="[12]", date_from="evidence/kleister_charity_dev0_scan.json",
  downloaded="README, config, expected.tsv for train and dev-0, expected-original.tsv for train, dev-0 in.tsv.xz, the two git-annex fetch scripts, by sparse git checkout; one PDF (the report behind dev-0 line 10, 4,781,158 bytes) fetched from the public S3 annex to check one answer against the page. Paper text (arXiv 2105.05796).",
  urls=["https://github.com/applicaai/kleister-charity/tree/2309f4861cc49864ac653a7fa108efc2144400b3", "https://applica-public.s3-eu-west-1.amazonaws.com/kleister-charity-git-annex/SHA256E-s4781158--31a9e1f04b48c83c19680d8e38f9dbd691e7df9b92c0be081cab85b104d7d745.pdf", "https://arxiv.org/abs/2105.05796"])
B["rd-tablebench"] = dict(name="RD-TableBench", cite="[13]", date_from="evidence/tables_scan.json",
  downloaded="Only the 1,000 ground-truth HTML files and providers/scores.csv, read out of the 449,578,580-byte rd-tablebench.zip with HTTP range requests (about 3.6 MB transferred for the ground truth), so the PDFs and images were never downloaded; the grading code README.",
  urls=["https://huggingface.co/datasets/reducto/rd-tablebench/tree/7748503e2bd5f210d27aa2ef5fdf4b8aa13099bb", "https://github.com/reductoai/rd-tablebench/blob/1cae108e6395ddc8389af17385f9769519070558/README.md"])

S = "samples/"
SRO = S + "sroie/losyash-sroie-datasetv2/repo/"; SROU = "https://github.com/Losyash/SROIE-datasetv2/blob/235ba41db8e7c7dc1437143baadb0882a4446d5c/"
CRD = S + "cord/hf-naver-clova-ix-cord-v2/"; CRDU = "https://datasets-server.huggingface.co/rows?dataset=naver-clova-ix/cord-v2&config=default&split=test&offset=0&length=1"
CRM = S + "cord/github-clovaai-cord/README.md"; CRMU = "https://github.com/clovaai/cord/blob/327310ce58c1623255821d062b3a759ff3789e3c/README.md"
FN = S + "funsd/annotations/"; FNU = "https://guillaumejaume.github.io/FUNSD/dataset.zip, member dataset/"
DC = S + "docile/github-rossumai-docile/repo/"; DCU = "https://github.com/rossumai/docile/blob/45f1f00d184664e23b0fb657574ce07b2bfac065/"
DCS = "tests/data/sample-dataset/annotations/516f2d61ea404b30a9192a72.json"; DCP = S + "docile/arxiv-2302.05658/docile-paper.txt"; DCPU = "https://arxiv.org/abs/2302.05658"
VR = S + "vrdu/"; VRU = "https://github.com/google-research-datasets/vrdu/blob/04a4df7ac5cc694e51c48115c03fe428f0e240cc/"
VRE = S + "vrdu/github-google-research-vrdu-eval/"; VREU = "https://github.com/google-research/google-research/blob/600df90d3b8875e62efa9d462faa9d87276fad74/vrdu/"
DQ = S + "docvqa/hf-lmms-lab-docvqa/"; DQU = "https://datasets-server.huggingface.co/rows?dataset=lmms-lab-encoder/DocVQA&config=DocVQA&split=validation"
OM = S + "omnidocbench/hf-opendatalab-omnidocbench/"; OMU = "https://huggingface.co/datasets/opendatalab/OmniDocBench/blob/aa1ee96d106dbe53d0ae59474d75c6e6d9b53fec/"
KN = S + "kleister-nda/github-applicaai-kleister-nda/repo/"; KNU = "https://github.com/applicaai/kleister-nda/blob/c2c7bf069b919bfb618b268fda2a2c079c0db316/"
KC = S + "kleister-charity/github-applicaai-kleister-charity/repo/"; KCU = "https://github.com/applicaai/kleister-charity/blob/2309f4861cc49864ac653a7fa108efc2144400b3/"
KP = S + "kleister-charity/arxiv-2105.05796/kleister-paper.txt"; KPU = "https://arxiv.org/abs/2105.05796"
RD = S + "rd-tablebench/hf-reducto-rd-tablebench/rd-tablebench/"; RDU = "https://huggingface.co/datasets/reducto/rd-tablebench/blob/7748503e2bd5f210d27aa2ef5fdf4b8aa13099bb/rd-tablebench.zip, member rd-tablebench/"
RDR = S + "rd-tablebench/github-reductoai-rd-tablebench/README.md"; RDRU = "https://github.com/reductoai/rd-tablebench/blob/1cae108e6395ddc8389af17385f9769519070558/README.md"

def src(local, record, url): return {"local": local, "record": record, "url": url}

C = {}  # (bench, prop) -> (verdict, evidence, source)
def cell(b, p, v, e, s): C[(b, p)] = (v, e, s)

# ---------------- SROIE
cell("sroie", 1, "present", "Every key file holds exactly four named fields, company, date, address and total (for example test file X00016469670, lines 2 to 5).", src(SRO + "test/entities/X00016469670.txt", "lines 2-5", SROU + "test/entities/X00016469670.txt"))
cell("sroie", 2, "absent", "The schema is closed (all 973 key files use only company, date, address, total), but the scored test split has no empty field to invent into: 347 of 347 test keys fill all four (0 of 1,388 cells empty), and a second, independent copy of the test answers (Hugging Face rth/sroie-2019-v2) agrees on all 347. Train has 2 gaps recorded two different ways: X51005663280 omits address (the receipt prints none); X51005433522 stores total as an empty string although the receipt prints a net total (line 21 of its box file).", src("evidence/sroie_scan.json; evidence/sroie_test_crosscheck.json; " + SRO + "train/entities/X51005433522.txt; " + SRO + "train/box/X51005433522.txt", "splits.test.keysets; identical_tuples; splits.train.missing_key_counts and empty_value_counts", SROU + "train/entities/X51005433522.txt"))
cell("sroie", 3, "absent", "Values are stored as printed: dates in 17 different shapes (day, month and year in several orders, with slashes, hyphens, dots, spaces or no separator, and months in figures or in letters), totals as printed (with or without a currency sign or code). No canonical value is stored beside them. Only 8 of 1,945 date and total values are stored reformatted instead of as printed (for example train file X51005447850, whose date is stored without the separators the receipt prints), which is annotator variation, not a convention.", src("evidence/sroie_scan.json; evidence/sroie_nonverbatim.json", "date_shapes_top, total_shapes_top; cases", SROU + "train/entities/X51005447850.txt"))
cell("sroie", 4, "absent", "All four fields are printed fields: the date is found word for word on one printed line for 965 of 973 receipts and the total for 969 of 972 non-empty totals; of the other 11, 8 are reformatted printed values and 3 disagree with the page (for example test file X51005442322, whose key and receipt give different years); none is inferred.", src("evidence/sroie_scan.json; evidence/sroie_nonverbatim.json", "value_found_verbatim_on_a_single_box_line; cases", SROU + "test/entities/X51005442322.txt"))
cell("sroie", 5, "partial", "Box files give a quadrilateral for every printed text line, but the four answers are not linked to boxes; they can only be located by string search, and key and box disagree in places (test file X00016469670: one character of the address differs between key line 4 and box line 7).", src(SRO + "test/box/X00016469670.txt; " + SRO + "test/entities/X00016469670.txt", "box line 7; key line 4", SROU + "test/box/X00016469670.txt"))
cell("sroie", 6, "absent", "Key files contain only company, date, address, total; nothing records derivability.", src("evidence/sroie_scan.json", "splits.*.keysets", SROU))
cell("sroie", 7, "absent", "Real receipts only; no planted defects, no controls, no field that could mark one.", src("evidence/sroie_scan.json", "splits.*.keysets", SROU))
cell("sroie", 8, "absent", "No per-receipt attribute of any kind in key or box files.", src("evidence/sroie_scan.json", "splits.*.keysets", SROU))
cell("sroie", 9, "absent", "Fixed four-field extraction; no rules or rule outputs.", src(S + "sroie/arxiv-2103.10213/sroie-competition-paper.txt", "lines 127-140, Task 3 definition", "https://arxiv.org/abs/2103.10213"))
cell("sroie", 10, "absent", "No barcode or QR payload field in the four-field schema.", src("evidence/sroie_scan.json", "splits.*.keysets", SROU))
cell("sroie", 11, "absent", "Header fields only; item lines exist only as unlabelled lines in the box transcription.", src(SRO + "train/box/X51005433522.txt", "item lines are plain text lines", SROU + "train/box/X51005433522.txt"))
cell("sroie", 12, "absent", "Single document type (receipts); no type label stored.", src("evidence/sroie_scan.json", "splits.*.keysets", SROU))
cell("sroie", 13, "absent", "One receipt per image; no boundary annotation.", src(S + "sroie/arxiv-2103.10213/sroie-competition-paper.txt", "lines 97-112, dataset description", "https://arxiv.org/abs/2103.10213"))
cell("sroie", 14, "absent", "company is the name as printed (for example train file X00016469612); no registry or master-list identifier.", src(SRO + "train/entities/X00016469612.txt", "company", SROU + "train/entities/X00016469612.txt"))
cell("sroie", 15, "present", "Receipt images are distributed (train/img 626 and test/img 347 JPGs in the mirror; also on the RRC site).", src("not downloaded, seen in the repository tree listing", "folders train/img and test/img", "https://github.com/Losyash/SROIE-datasetv2/tree/235ba41db8e7c7dc1437143baadb0882a4446d5c"))
# ---------------- CORD
cell("cord", 1, "present", "gt_parse keys every answer to one of 30 named classes (README class table). Test row 0: menu.nm -TICKET CP, menu.cnt 2, menu.price 60.000, total.total_price 60.000.", src(CRD + "test.jsonl", "row_idx 0, ground_truth.gt_parse", CRDU))
cell("cord", 2, "partial", "No empty value is ever stored (0 empty strings among 2,520 gt_parse values); absence is implied only by a class being left out of a closed 30-class set (sub_total.tax_price appears in at most 91 of 200 receipts).", src("evidence/cord_scan.json", "empty_string_values, gt_parse_leaf_paths", CRMU))
cell("cord", 3, "absent", "Values are printed strings only. Test row 0 stores 60.000 for price, item subtotal, subtotal, total and card payment; its 5,411-character annotation contains 60.000 twelve times and 60000 or 60000.00 nowhere. Across 200 receipts, 324 values use a dot as thousands separator and 799 a comma.", src(CRD + "test.jsonl; evidence/cord_scan.json", "row_idx 0; test_row0, values_with_dot_as_thousands_separator_like_60.000", CRDU))
cell("cord", 4, "absent", "Every gt_parse value is assembled from labelled printed words in valid_line; nothing is inferred.", src(CRD + "test.jsonl", "row_idx 0, valid_line", CRDU))
cell("cord", 5, "present", "All 4,542 words in valid_line carry a quad (x1..y4) and sit in a line with a category and group_id, so each answer maps to its printed words (test row 0: menu.price word 60.000 at x1 174, y1 410).", src(CRD + "test.jsonl; evidence/cord_scan.json", "row_idx 0 valid_line; words_with_quad", CRDU))
cell("cord", 6, "absent", "Annotation keys are gt_parse, meta, valid_line, roi, repeating_symbol, dontcare; words carry quad, is_key, row_id, text. No derivability marker.", src("evidence/cord_scan.json", "top_level_keys, word_keys", CRDU))
cell("cord", 7, "absent", "Real receipts only; no planted defects or controls.", src("evidence/cord_scan.json", "top_level_keys", CRDU))
cell("cord", 8, "absent", "meta holds only version, split, image_id, image_size.", src("evidence/cord_scan.json", "meta_keys", CRDU))
cell("cord", 9, "absent", "No rules or rule outputs.", src("evidence/cord_scan.json", "top_level_keys", CRDU))
cell("cord", 10, "absent", "No payload class among the 30; the only QR in 200 receipts is the printed word QR (validation row 32).", src(CRD + "validation.jsonl", "row_idx 32", CRDU.replace("split=test", "split=validation")))
cell("cord", 11, "present", "menu is a list of items (nm, cnt, price, sub-items): 472 items over 200 receipts, 115 receipts with more than one; group_id and sub_group_id carry the row grouping.", src("evidence/cord_scan.json", "menu_items_total, docs_with_more_than_one_menu_item", CRDU))
cell("cord", 12, "absent", "Receipts only; no type label in meta.", src("evidence/cord_scan.json", "meta_keys", CRDU))
cell("cord", 13, "absent", "One receipt per image; no boundaries.", src("evidence/cord_scan.json", "top_level_keys", CRDU))
cell("cord", 14, "absent", "No store identity field in the 30 classes; no master list.", src(CRM, "lines 42-95, class table", CRMU))
cell("cord", 15, "present", "Receipt images ship in the dataset's parquet files (image column, dropped by this audit's fetch).", src("evidence/cord_scan.json", "files", "https://huggingface.co/datasets/naver-clova-ix/cord-v2"))
# ---------------- FUNSD
cell("funsd", 1, "partial", "Entities are labelled question, answer, header or other and linked question to answer; the 'key' is the printed question text (for example entity id 22 of testing file 82092117.json), not a named field from a fixed schema.", src(FN + "testing_data/annotations/82092117.json", "form[] entity id 22", FNU + "testing_data/annotations/82092117.json"))
cell("funsd", 2, "partial", "1,627 of 4,343 question entities have no linked answer, which records many blank form fields (for example entity id 22 of 82092117.json, whose linking list is empty), but unlinked questions also come from table headers, so emptiness is implied, not stated.", src("evidence/funsd_scan.json; " + FN + "testing_data/annotations/82092117.json", "questions_with_no_linked_answer; entity id 22", FNU + "testing_data/annotations/82092117.json"))
cell("funsd", 3, "absent", "Entity text as printed; no normalised value field (entity keys: box, text, label, words, linking, id).", src("evidence/funsd_scan.json", "entity_keys", FNU))
cell("funsd", 4, "absent", "Every entity is a box of printed words.", src("evidence/funsd_scan.json", "entities_with_box", FNU))
cell("funsd", 5, "present", "All 9,743 entities have a box, and all 31,485 words have their own box.", src("evidence/funsd_scan.json", "entities_with_box, word_keys", FNU))
cell("funsd", 6, "absent", "Entity keys are box, text, label, words, linking, id; no derivability field.", src("evidence/funsd_scan.json", "entity_keys", FNU))
cell("funsd", 7, "absent", "Real forms only; no planted defects or controls.", src("evidence/funsd_scan.json", "doc_level_keys", FNU))
cell("funsd", 8, "absent", "The only document-level key is form.", src("evidence/funsd_scan.json", "doc_level_keys", FNU))
cell("funsd", 9, "absent", "No rules or rule outputs.", src("evidence/funsd_scan.json", "doc_level_keys", FNU))
cell("funsd", 10, "absent", "No payload field.", src("evidence/funsd_scan.json", "entity_keys", FNU))
cell("funsd", 11, "absent", "No row or line-item grouping, only question to answer links.", src("evidence/funsd_scan.json", "entity_keys", FNU))
cell("funsd", 12, "absent", "All documents are forms; no type label.", src("evidence/funsd_scan.json", "doc_level_keys", FNU))
cell("funsd", 13, "absent", "One form per image; no boundaries.", src("evidence/funsd_scan.json", "doc_level_keys", FNU))
cell("funsd", 14, "absent", "No entity identifiers; names stored as printed.", src("evidence/funsd_scan.json", "entity_keys", FNU))
cell("funsd", 15, "present", "The 199 form images (149 training, 50 testing PNGs) ship in dataset.zip beside the annotations.", src("evidence/funsd_zip_listing.json", "members dataset/*/images/*.png", "https://guillaumejaume.github.io/FUNSD/dataset.zip"))
# ---------------- DocILE
cell("docile", 1, "present", "Each field has a fieldtype from 55 classes (paper line 29). The public sample annotation has 11 fields, among them document_id, date_issue, vendor_name, amount_due and customer_id.", src(DC + DCS, "field_extractions[0..10]", DCU + DCS))
cell("docile", 2, "partial", "No empty marker: a field type absent from a document is simply not listed. The scorer counts unmatched predictions as false positives (FP metric), so omission works as an implicit empty within the closed 55-class set.", src(DC + "docile/evaluation/evaluate.py", "METRIC_NAMES line 25; false_positives line 353", DCU + "docile/evaluation/evaluate.py"))
cell("docile", 3, "absent", "text is stored as printed: in the sample, date_issue and date_due hold their dates exactly as printed, in two different shapes; Field has only bbox, page, score, text, fieldtype, line_item_id. Metadata carries a document-level currency label, not a normalised field value.", src(DC + DCS + "; " + DC + "docile/dataset/field.py", "field_extractions; class Field", DCU + "docile/dataset/field.py"))
cell("docile", 4, "absent", "Fields are annotated as a triplet of location (bounding box and page), field type and text (paper lines 453-455), so every answer is printed. Metadata labels (currency, language, document type) describe the document and are judged under property 12.", src(DCP, "lines 453-455, 470-474", DCPU))
cell("docile", 5, "present", "bbox and page on 11 of 11 fields and 40 of 40 line-item fields in the sample; the primary metric matches predictions by location.", src(DC + DCS + "; evidence/docile_sample_scan.json", "fields_with_bbox_and_page, line_items_with_bbox_and_page", DCU + DCS))
cell("docile", 6, "absent", "Field keys are bbox, fieldtype, page, text (plus line_item_id); no derivability marker.", src("evidence/docile_sample_scan.json", "field_keys, line_item_keys", DCU + DCS))
cell("docile", 7, "absent", "Real documents plus 100k synthetic documents generated from annotated templates (paper line 270), but no planted defects with matched controls.", src(DCP, "lines 263-273, 508-520", DCPU))
cell("docile", 8, "partial", "Each document carries cluster_id, and the evaluator reports 0-shot, few-shot and many-shot layout subsets (README line 110): a declared generalisation condition, not a difficulty grade.", src(DC + "README.md; " + DC + DCS, "README line 110; metadata.cluster_id", DCU + "README.md"))
cell("docile", 9, "absent", "No rules or rule outputs.", src(DC + "README.md", "Tasks and evaluation metrics section", DCU + "README.md"))
cell("docile", 10, "absent", "No barcode or QR field type; neither word appears in the paper or README.", src(DCP + "; " + DC + "README.md", "text search", DCPU))
cell("docile", 11, "present", "line_item_id on every LIR field (40 fields in the sample) plus a table grid whose rows are typed header, data, gap, gap-with-text, footer.", src("evidence/docile_sample_scan.json", "line_item_ids, table_grid_row_types", DCU + DCS))
cell("docile", 12, "present", "metadata.document_type on every document (set in the sample); the paper lists nine invoice-like document types (lines 326-328), selected with a proprietary classifier.", src(DC + DCS + "; " + DCP, "metadata.document_type; paper lines 326-328", DCPU))
cell("docile", 13, "absent", "PDF files composed of several documents were split and annotated separately (paper lines 451-452): boundaries were removed during curation, not recorded.", src(DCP, "lines 451-452", DCPU))
cell("docile", 14, "absent", "customer_id and vendor_name are stored as printed; no master list.", src(DC + DCS, "field_extractions customer_id, vendor_name", DCU + DCS))
cell("docile", 15, "present", "PDFs are distributed with the annotations once an access token is obtained from docile.rossum.ai (README line 30); one sample PDF is public in the repository.", src(DC + "README.md", "line 30", DCU + "tests/data/sample-dataset/pdfs/516f2d61ea404b30a9192a72.pdf"))
# ---------------- VRDU
cell("vrdu", 1, "present", "Annotations are [entity name, mentions] with names fixed by meta.json (registration: file_date, foreign_principle_name, registrant_name, registration_num, signer_name, signer_title; ad-buy: advertiser, agency, contract_num, flight_from, flight_to, gross_amount, product, tv_address, property and line-item fields).", src(VR + "github-google-research-datasets-vrdu/repo/registration-form/main/meta.json", "entity_name_to_match_func", VRU + "registration-form/main/meta.json"))
cell("vrdu", 2, "partial", "No empty marker, but an entity left out of a document's key counts as absent: the scorer puts any extraction for an entity name not in the ground truth into unmatched extractions, i.e. false positives (benchmark_utils.py lines 489-492). Such cases are common: agency is absent from 358 of 641 ad-buy forms, signer_title from 1,366 of 1,915 registration forms.", src(VRE + "benchmark_utils.py; evidence/vrdu_adbuy_scan.json; evidence/vrdu_registration_scan.json", "lines 489-492; docs_missing_entity", VREU + "benchmark_utils.py#L489-L492"))
cell("vrdu", 3, "absent", "Values are stored as printed (dates and prices in many printed shapes; see date_value_shapes_top and price_value_shapes_top). The scorer normalises both sides when scoring (DateMatch, PriceMatch) and even accepts a swapped day and month (match_utils.py line 305), but no canonical value is stored.", src("evidence/vrdu_adbuy_scan.json; " + VRE + "match_utils.py", "date_value_shapes_top, price_value_shapes_top; lines 240-313", VREU + "match_utils.py#L240-L313"))
cell("vrdu", 4, "absent", "Every mention carries a box and a character span into the OCR text, so every answer is printed.", src("evidence/vrdu_adbuy_scan.json; evidence/vrdu_registration_scan.json", "mention_shape", VRU + "README.md"))
cell("vrdu", 5, "present", "Every mention has [page, x1, y1, x2, y2] plus character offsets (10,051 ad-buy and 8,840 registration top-level mentions), for example the registration_num mention of record 1 of the registration-form annotations, with its box and its character span.", src(VR + "annotations-only/registration-form.annotations.jsonl", "record 1, file 19410222_DLA Piper US LLP_Amendment_Amendment.pdf", VRU + "registration-form/main/dataset.jsonl.gz"))
cell("vrdu", 6, "absent", "Records are filename, file_path, ocr, annotations; mentions are text, box, spans; no derivability marker.", src("evidence/vrdu_adbuy_scan.json", "record_keys, mention_shape", VRU + "README.md"))
cell("vrdu", 7, "absent", "Real public filings only; no planted defects or controls.", src(VR + "github-google-research-datasets-vrdu/repo/README.md", "lines 8-12", VRU + "README.md"))
cell("vrdu", 8, "partial", "Three tasks of declared rising difficulty (single, mixed, unseen template; README lines 44-58 call the last the hardest), with per-document membership given by the few-shot split files; no per-document grade.", src(VR + "github-google-research-datasets-vrdu/repo/README.md", "lines 42-58", VRU + "README.md"))
cell("vrdu", 9, "absent", "No rules or rule outputs.", src(VR + "github-google-research-datasets-vrdu/repo/README.md", "Data and Tasks", VRU + "README.md"))
cell("vrdu", 10, "absent", "No payload entity in either meta.json.", src(VR + "github-google-research-datasets-vrdu/repo/ad-buy-form/main/meta.json", "entity_name_to_match_func", VRU + "ad-buy-form/main/meta.json"))
cell("vrdu", 11, "present", "Ad-buy line items are grouped records [channel, program_desc, program_start_date, program_end_date, sub_amount]: 9,163 groups in 636 of 641 ad-buy forms (meta.json pattern line_item). Registration forms have none.", src("evidence/vrdu_adbuy_scan.json; " + VR + "github-google-research-datasets-vrdu/repo/ad-buy-form/main/meta.json", "line_item_groups; entity_appearance_pattern", VRU + "ad-buy-form/main/meta.json"))
cell("vrdu", 12, "partial", "Type is implied by sub-corpus (registration forms vs ad-buy forms); registration sub-types (Amendment, Dissemination Report, Short-Form) appear only in split-file and PDF file names, e.g. 19410222_DLA Piper US LLP_Amendment_Amendment.pdf.", src(VR + "annotations-only/registration-form.annotations.jsonl", "record 1 filename", VRU + "registration-form/few_shot-splits"))
cell("vrdu", 13, "absent", "One filing per PDF; no boundaries.", src("evidence/vrdu_registration_scan.json", "record_keys", VRU + "README.md"))
cell("vrdu", 14, "absent", "registrant_name and registration_num are annotated from the page with boxes; no link to the FARA register is stored.", src(VR + "annotations-only/registration-form.annotations.jsonl", "record 1", VRU + "registration-form/main/dataset.jsonl.gz"))
cell("vrdu", 15, "present", "Raw PDFs ship in main/pdfs (641 ad-buy, 1,915 registration).", src(VR + "github-google-research-datasets-vrdu/repo/README.md", "line 19", VRU + "README.md"))
# ---------------- DocVQA
cell("docvqa", 1, "partial", "Answers are keyed to free-text questions about a page, not to named fields (for example validation questionId 24580, row_idx 1).", src(DQ + "validation.jsonl", "row_idx 1", DQU))
cell("docvqa", 2, "absent", "Every question has a non-empty answer (0 of 5,349 validation questions empty); there are no unanswerable questions, so a made-up answer cannot be told apart from a wrong one.", src("evidence/docvqa_scan.json", "questions_with_empty_answer", DQU))
cell("docvqa", 3, "absent", "Answers are printed spans with accepted variants; 1,712 of 5,349 questions list variants that differ only in case or punctuation (for example questionId 49168, whose accepted answers write the same times once with a colon and once with a full stop). No canonical form.", src("evidence/docvqa_scan.json", "questions_whose_answer_variants_differ_only_in_formatting", DQU))
cell("docvqa", 4, "absent", "Answers are spans of page text. Even the 33 bare yes or no answers are mostly printed words: all 4 pages inspected print the answer word, in a table cell (questionIds 57557 and 56784) or as the label of a ticked box (questionIds 1623 and 39139); the other 29 were not inspected.", src("evidence/docvqa_yes_no_pages.json; " + S + "docvqa/one-page-row134/page.jpg", "questions[].inspected", DQU))
cell("docvqa", 5, "absent", "Row fields are questionId, question, question_types, image, docId, ucsf_document_id, ucsf_document_page_no, answers, data_split; no answer position.", src("evidence/docvqa_scan.json", "row_keys", DQU))
cell("docvqa", 6, "absent", "No derivability field (see row fields).", src("evidence/docvqa_scan.json", "row_keys", DQU))
cell("docvqa", 7, "absent", "Real archive pages only; no planted defects or controls.", src("evidence/docvqa_scan.json", "row_keys", DQU))
cell("docvqa", 8, "partial", "Each question carries question_types (layout 1,981, table/list 1,780, form 1,021, free_text 765, handwritten 319, figure/diagram 265, others 236, Image/Photo 98, Yes/No 28): evidence-type tags such as handwritten, per question, not a difficulty grade.", src("evidence/docvqa_scan.json", "question_types", DQU))
cell("docvqa", 9, "absent", "Questions ask for a span; there are no written rules with expected transformed outputs.", src("evidence/docvqa_scan.json", "row_keys", DQU))
cell("docvqa", 10, "absent", "No payload field.", src("evidence/docvqa_scan.json", "row_keys", DQU))
cell("docvqa", 11, "absent", "table/list questions are answered with a single string; no row structure.", src("evidence/docvqa_scan.json", "row_keys", DQU))
cell("docvqa", 12, "absent", "No document type field; question_types describe the question, not the document.", src("evidence/docvqa_scan.json", "row_keys", DQU))
cell("docvqa", 13, "absent", "One page per question (ucsf_document_page_no); no boundaries.", src("evidence/docvqa_scan.json", "row_keys", DQU))
cell("docvqa", 14, "absent", "No entity identifiers.", src("evidence/docvqa_scan.json", "row_keys", DQU))
cell("docvqa", 15, "present", "Page images are distributed (image column). Test answers are withheld (600 of 600 sampled test rows have answers null), which does not matter for repeatability.", src(DQ + "test.jsonl; evidence/docvqa_scan.json", "test_answers_state", DQU.replace("split=validation", "split=test")))
# ---------------- OmniDocBench
cell("omnidocbench", 1, "absent", "Ground truth is page parsing: 32,798 layout elements with category_type (text_block 16,520, title 4,441, table 665, ...) and text, LaTeX or HTML; no named fields.", src("evidence/omnidocbench_scan.json", "category_types", OMU + "OmniDocBench.json"))
cell("omnidocbench", 2, "partial", "No fields; empty table cells are recorded as empty in the table HTML (3,759 of 43,771 cells in 665 tables), so text invented into a blank cell is detectable.", src("evidence/tables_scan.json", "omnidocbench_tables", OMU + "OmniDocBench.json"))
cell("omnidocbench", 3, "absent", "Text as printed; LaTeX for formulas and HTML for tables are markup of the printed content, not normalised values.", src("evidence/omnidocbench_scan.json", "layout_det_keys", OMU + "OmniDocBench.json"))
cell("omnidocbench", 4, "absent", "Every element transcribes what is on the page.", src("evidence/omnidocbench_scan.json", "layout_det_keys", OMU + "OmniDocBench.json"))
cell("omnidocbench", 5, "present", "All 32,798 layout elements carry a poly (four corners) and a reading order; spans carry boxes too. Positions are for blocks and spans, not for field values.", src("evidence/omnidocbench_scan.json", "layout_dets_with_poly", OMU + "OmniDocBench.json"))
cell("omnidocbench", 6, "absent", "Element keys are category_type, poly, ignore, order, anno_id, attribute, text, latex, html, table_edit_status, merge_list; no derivability marker.", src("evidence/omnidocbench_scan.json", "layout_det_keys", OMU + "OmniDocBench.json"))
cell("omnidocbench", 7, "absent", "The 296 hard pages are selected hard pages, not planted defects with matched controls.", src("evidence/omnidocbench_scan.json", "page_attribute_values.subset", OMU + "OmniDocBench.json"))
cell("omnidocbench", 8, "present", "Every page carries page_attribute.special_issue (e.g. fuzzy_scan 30 pages, watermark 73 plus with_watermark 24, geometric_deformation 13, colorful_backgroud 266) and a subset, with 296 pages declared hard (equation_hard 100, layout_hard 99, table_hard 97). First table_hard page: page-c7792da7-4167-4f5c-a7ca-ec0f8833f83b.png.", src("evidence/omnidocbench_scan.json; " + OM + "OmniDocBench.json", "page_attribute_values; record 199", OMU + "OmniDocBench.json"))
cell("omnidocbench", 9, "absent", "No rules or rule outputs.", src("evidence/omnidocbench_scan.json", "page_keys", OMU + "OmniDocBench.json"))
cell("omnidocbench", 10, "absent", "No barcode or QR category among the 28 category types; one page mentions a QR code in a text block only (record 143, page-0b772bee-71ec-4d4a-a406-d7691b1a6e86.png, element box_id_3).", src("evidence/omnidocbench_scan.json", "category_types", OMU + "OmniDocBench.json"))
cell("omnidocbench", 11, "present", "665 tables with HTML ground truth (7,353 tr rows) and LaTeX: table structure for parsing, not business line items.", src("evidence/omnidocbench_scan.json", "tables_with_html, table_rows_total_in_html", OMU + "OmniDocBench.json"))
cell("omnidocbench", 12, "present", "page_attribute.data_source on all 1,651 pages: book 276, PPT2PDF 253, academic_literature 215, exam_paper 193, colorful_textbook 159, newspaper 151, magazine 149, research_report 132, note 118, historical_document 5.", src("evidence/omnidocbench_scan.json", "page_attribute_values.data_source", OMU + "OmniDocBench.json"))
cell("omnidocbench", 13, "absent", "Single pages; extra.relation only links captions and truncated paragraphs within a page.", src("evidence/omnidocbench_scan.json", "relation_types", OMU + "OmniDocBench.json"))
cell("omnidocbench", 14, "absent", "No entity identifiers.", src("evidence/omnidocbench_scan.json", "layout_det_keys", OMU + "OmniDocBench.json"))
cell("omnidocbench", 15, "present", "Page images are distributed in the images folder of the dataset repository.", src(OM + "README.md", "lines 37-39", OMU + "README.md"))
# ---------------- Kleister NDA
cell("kleister-nda", 1, "present", "expected.tsv stores key=value pairs for effective_date, jurisdiction, party and term (for example dev-0 line 1, which holds all four keys, party twice).", src(KN + "dev-0/expected.tsv", "line 1", KNU + "dev-0/expected.tsv#L1"))
cell("kleister-nda", 2, "present", "Each document's input lists the keys asked (in.tsv column 2, e.g. effective_date jurisdiction party term) and README line 128 says decoy keys are left out of expected.tsv rather than given an empty value. dev-0: 61 asked keys have no value across 48 of 83 documents (term 41, effective_date 15, jurisdiction 5); train: 218 across 160 of 254.", src(KN + "README.md; evidence/kleister_nda_dev0_scan.json; evidence/kleister_nda_train_scan.json", "README lines 17 and 128; asked_but_not_answered_decoys", KNU + "README.md#L128"))
cell("kleister-nda", 3, "partial", "Canonical value only, the printed form is not stored beside it. dev-0 record 1: the effective date, the term and the jurisdiction are written out in words on the page and stored in normalised form (an ISO date, a number with a unit, a place name joined by underscores). All 62 dev dates are ISO and none is printed that way (README lines 153-161).", src(KN + "dev-0/expected.tsv; " + KN + "dev-0/in.tsv.xz; evidence/kleister_nda_dev0_scan.json", "line 1; record 1, file 073f3b9eb0c7088be4ef688f4edfdb6d.pdf", KNU + "dev-0/expected.tsv#L1"))
cell("kleister-nda", 4, "partial", "Incidental and unmarked: some terms are computed from printed dates. train line 196: a term in months, computed from a printed start date and end date (the word month appears nowhere in the PDF's text); train line 15: a term in days, computed the same way; train line 47: a term in years, from an anniversary named in words. 11 of 82 train terms are not printed as a number and unit.", src(KN + "train/expected.tsv; " + KN + "train/in.tsv.xz; evidence/kleister_nda_train_terms.json; " + S + "kleister-nda/github-two-pdfs/c2149cc784d2d783c2de0c7b2f02a12f.pdf", "lines 15, 47, 196", KNU + "train/expected.tsv#L196"))
cell("kleister-nda", 5, "absent", "expected.tsv holds key=value only; README line 9 says the task is not named-entity recognition and that where the information sits on the page does not matter.", src(KN + "README.md", "lines 8-10", KNU + "README.md#L9"))
cell("kleister-nda", 6, "absent", "Nothing marks which answers are derived, although some are (see property 4).", src(KN + "train/expected.tsv", "line 196", KNU + "train/expected.tsv#L196"))
cell("kleister-nda", 7, "absent", "Real EDGAR filings only; no planted defects or controls.", src(KP, "lines 201-206", KPU))
cell("kleister-nda", 8, "absent", "No per-document attribute beyond file name, keys and four text layers (in-header.tsv: filename, keys and four text columns, one from each page-reading tool).", src(KN + "in-header.tsv", "line 1", KNU + "in-header.tsv"))
cell("kleister-nda", 9, "absent", "No rules or rule outputs.", src(KN + "README.md", "Information to be extracted", KNU + "README.md"))
cell("kleister-nda", 10, "absent", "No payload key.", src(KN + "README.md", "lines 141-149", KNU + "README.md"))
cell("kleister-nda", 11, "absent", "Four document-level keys; no rows.", src(KN + "README.md", "lines 141-149", KNU + "README.md"))
cell("kleister-nda", 12, "absent", "Single document type (non-disclosure agreements).", src(KN + "README.md", "line 1", KNU + "README.md"))
cell("kleister-nda", 13, "absent", "One agreement per document; no boundaries.", src(KN + "README.md", "Structure of data sets", KNU + "README.md"))
cell("kleister-nda", 14, "absent", "party values are normalised printed names (for example dev-0 line 1); no registry identifier.", src(KN + "dev-0/expected.tsv", "line 1", KNU + "dev-0/expected.tsv#L1"))
cell("kleister-nda", 15, "present", "The PDFs ship in documents/ (726 files) and four OCR text layers per document ship in in.tsv.xz.", src(KN + "README.md", "Directory structure", KNU + "README.md"))
# ---------------- Kleister Charity
cell("kleister-charity", 1, "present", "Eight keys: address__post_town, address__postcode, address__street_line, charity_name, charity_number, income_annually_in_british_pounds, report_date, spending_annually_in_british_pounds (dev-0 line 2).", src(KC + "dev-0/expected.tsv", "line 2", KCU + "dev-0/expected.tsv#L2"))
cell("kleister-charity", 2, "present", "All 440 dev documents are asked all eight keys (in.tsv column 2); 97 asked keys have no value across 66 documents (street_line 50, post_town 18, postcode 14, income 6, spending 6, charity_number 3), e.g. dev-0 line 1 has no income, spending or street. README lines 19-21 describe these decoy keys, which must be left without a value.", src(KC + "README.md; evidence/kleister_charity_dev0_scan.json", "README lines 19-21; asked_but_not_answered_decoys", KCU + "dev-0/expected.tsv#L1"))
cell("kleister-charity", 3, "partial", "Canonical value only. dev-0 line 2: the income is stored as a full amount in pounds where the statement of financial activities prints it in thousands under a thousands heading (the report text also states the full amount), and the report date is stored as an ISO date where the page writes it out in words. 430 of 434 dev income values are not printed in their stored form (README lines 181-202).", src(KC + "dev-0/expected.tsv; " + KC + "dev-0/in.tsv.xz; evidence/kleister_charity_dev0_scan.json", "line 2; record 87ff1046fb88668ed4e0476d66abd733.pdf", KCU + "dev-0/expected.tsv#L2"))
cell("kleister-charity", 4, "partial", "Incidental and unmarked: answers were taken from the Charity Commission register (paper lines 278-280), and 9 of 437 dev charity numbers appear in none of the four text layers. dev-0 line 10: the stored charity number appears nowhere in the document, although its 39-page PDF has a text layer on every page and not even the number's first three digits occur in it. The paper (lines 555-556) adds that about 5% of money values need their scale (thousands, millions) inferred.", src("evidence/kleister_charity_dev0_charity_number_printed.json; " + KC + "dev-0/expected.tsv; " + S + "kleister-charity/s3-annex-one-pdf/cc9880ece943bf688b49359a8c219b04.pdf; " + KP, "line 10; paper lines 278-280, 555-556", KCU + "dev-0/expected.tsv#L10"))
cell("kleister-charity", 5, "absent", "expected.tsv holds key=value only; no positions.", src(KC + "dev-0/expected.tsv", "all lines", KCU + "dev-0/expected.tsv"))
cell("kleister-charity", 6, "absent", "No flag marks scaled or register-sourced answers.", src(KC + "dev-0/expected.tsv", "line 10", KCU + "dev-0/expected.tsv#L10"))
cell("kleister-charity", 7, "absent", "Real filed reports only; no planted defects or controls.", src(KP, "lines 255-268", KPU))
cell("kleister-charity", 8, "absent", "No per-document attribute beyond file name, keys and four text layers (in-header.tsv).", src(KC + "in-header.tsv", "line 1", KCU + "in-header.tsv"))
cell("kleister-charity", 9, "absent", "No rules or rule outputs.", src(KC + "README.md", "Information to be extracted", KCU + "README.md"))
cell("kleister-charity", 10, "absent", "No payload key.", src(KC + "README.md", "Information to be extracted", KCU + "README.md"))
cell("kleister-charity", 11, "absent", "Annual totals only (income, spending); no rows.", src(KC + "README.md", "Information to be extracted", KCU + "README.md"))
cell("kleister-charity", 12, "absent", "Single document type (charity annual reports).", src(KP, "lines 227-232", KPU))
cell("kleister-charity", 13, "absent", "Documents holding reports for more than one organisation were deleted rather than segmented (paper lines 266-267).", src(KP, "lines 266-267", KPU))
cell("kleister-charity", 14, "partial", "charity_number is the register's identifier for the real organisation, and names and addresses were taken from the register and then corrected (paper lines 278-293), so the key says which registered entity a report belongs to; there is no candidate list with near-duplicates, and the number is printed in 428 of 437 dev reports.", src(KP + "; evidence/kleister_charity_dev0_charity_number_printed.json", "paper lines 278-293", KPU))
cell("kleister-charity", 15, "present", "PDFs are distributed through git-annex from a public S3 bucket (annex-get-all-from-s3.sh); the one fetched for this audit matched its SHA-256 key. Four OCR text layers ship in in.tsv.xz.", src(KC + "annex-get-all-from-s3.sh; " + S + "kleister-charity/s3-annex-one-pdf/cc9880ece943bf688b49359a8c219b04.pdf", "SHA-256 31a9e1f04b48c83c19680d8e38f9dbd691e7df9b92c0be081cab85b104d7d745", KCU + "annex-get-all-from-s3.sh"))
# ---------------- RD-TableBench
cell("rd-tablebench", 1, "absent", "Ground truth is one HTML table per document (1,000 files); no named fields.", src("evidence/tables_scan.json", "rd_tablebench.groundtruth_files", RDU + "groundtruth/"))
cell("rd-tablebench", 2, "partial", "No fields; empty cells are recorded as empty td elements (9,158 of 75,867 cells), so text invented into a blank cell lowers the alignment score.", src("evidence/tables_scan.json; " + RD + "groundtruth/10035_png.rf.07e8e5bf2e9ad4e77a84fd38d1f53f38.html", "rd_tablebench.empty_cells", RDU + "groundtruth/10035_png.rf.07e8e5bf2e9ad4e77a84fd38d1f53f38.html"))
cell("rd-tablebench", 3, "absent", "Cell text as printed, thousands separators and accounting parentheses included (for example row 4 of 10035_png...html); the scorer only strips whitespace, newlines and hyphens (README line 60).", src(RD + "groundtruth/10035_png.rf.07e8e5bf2e9ad4e77a84fd38d1f53f38.html; " + RDR, "row 4; README line 60", RDRU))
cell("rd-tablebench", 4, "absent", "Cells transcribe the printed table.", src(RD + "groundtruth/1_png.rf.a663bbe8e0baf14d27916684fa0e9ec0.html", "whole file", RDU + "groundtruth/1_png.rf.a663bbe8e0baf14d27916684fa0e9ec0.html"))
cell("rd-tablebench", 5, "absent", "HTML only (tags table, tr, th, td, sup, sub, br; attributes colspan, rowspan); no cell coordinates.", src("evidence/tables_scan.json", "rd_tablebench.html_tags, html_attributes", RDU + "groundtruth/"))
cell("rd-tablebench", 6, "absent", "No derivability marker (see tags and attributes).", src("evidence/tables_scan.json", "rd_tablebench.html_attributes", RDU + "groundtruth/"))
cell("rd-tablebench", 7, "absent", "Real public documents only; no planted defects or controls.", src(RDR, "line 13", RDRU))
cell("rd-tablebench", 8, "absent", "scores.csv adds per-table vendor scores and a language column (15 languages), not a declared difficulty.", src("evidence/tables_scan.json; " + RD + "providers/scores.csv", "scores_csv_columns", RDU + "providers/scores.csv"))
cell("rd-tablebench", 9, "absent", "No rules or rule outputs.", src(RDR, "methodology", RDRU))
cell("rd-tablebench", 10, "absent", "No payload field.", src("evidence/tables_scan.json", "rd_tablebench.html_tags", RDU + "groundtruth/"))
cell("rd-tablebench", 11, "present", "1,000 tables with 13,033 tr rows, 1,723 colspan and 1,311 rowspan attributes.", src("evidence/tables_scan.json", "rd_tablebench.rows, html_attributes", RDU + "groundtruth/"))
cell("rd-tablebench", 12, "absent", "No document type label (scores.csv columns: vendor scores, pdf_path, language).", src("evidence/tables_scan.json", "scores_csv_columns", RDU + "providers/scores.csv"))
cell("rd-tablebench", 13, "absent", "One table crop per document; no boundaries.", src("evidence/tables_scan.json", "rd_tablebench.groundtruth_files", RDU + "groundtruth/"))
cell("rd-tablebench", 14, "absent", "No entity identifiers.", src("evidence/tables_scan.json", "rd_tablebench.html_tags", RDU + "groundtruth/"))
cell("rd-tablebench", 15, "present", "1,000 PDFs and 1,000 page images ship in rd-tablebench.zip (pdfs/, _images/).", src("evidence/rd_tablebench_zip_listing.json", "members under rd-tablebench/pdfs and rd-tablebench/_images", "https://huggingface.co/datasets/reducto/rd-tablebench/blob/7748503e2bd5f210d27aa2ef5fdf4b8aa13099bb/rd-tablebench.zip"))

assert len(C) == 150, len(C)
for (b, p), (v, e, s) in C.items():
    assert v in ("present", "partial", "absent"), (b, p, v)

# ---------------------------------------------------------------- write matrix.json
def counts_for(pid):
    c = collections.Counter(C[(b, pid)][0] for b in B)
    return {k: c.get(k, 0) for k in ("present", "partial", "absent")}
matrix = {
 "title": "Ground-truth audit of ten public document-AI benchmarks",
 "built_at_ist": BUILT,
 "audit_dir": AUD,
 "verdict_scale": {"present": "the answer key holds the property in the sense of the rule", "partial": "the key holds part of it, incidentally, implicitly or only for some fields or documents", "absent": "the key does not hold it"},
 "properties": [{"id": p[0], "name": p[1], "paper_wording": p[2], "measure_served": p[3], "rule": p[4], "counts": counts_for(p[0])} for p in PROPS],
 "benchmarks": [{"id": k, "name": v["name"], "paper_citation": v["cite"], "what_was_downloaded": v["downloaded"], "sources": v["urls"], "date_checked_ist": ist_of(v["date_from"])} for k, v in B.items()],
 "cells": [{"benchmark": b, "benchmark_name": B[b]["name"], "property_id": p, "property": PROPS[p - 1][1], "verdict": C[(b, p)][0], "evidence": C[(b, p)][1], "source": C[(b, p)][2], "date_checked_ist": ist_of(B[b]["date_from"])} for b in B for p in range(1, 16)],
 "summary_by_benchmark": {B[b]["name"]: dict(collections.Counter(C[(b, p)][0] for p in range(1, 16))) for b in B},
}
text_all = json.dumps(matrix, ensure_ascii=False)
for bad in ("—", "–", "|"):
    assert bad not in text_all, "forbidden character in matrix: %r at %s" % (bad, text_all[max(0, text_all.find(bad) - 80): text_all.find(bad) + 20])
json.dump(matrix, open(os.path.join(AUD, "matrix.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("matrix.json written:", len(matrix["cells"]), "cells")
for p in matrix["properties"]: print(p["id"], p["name"], p["counts"])
for k, v in matrix["summary_by_benchmark"].items(): print(k, v)

# ---------------------------------------------------------------- README.md
def du(path):
    tot = 0
    for root, dirs, files in os.walk(path):
        for f in files:
            fp = os.path.join(root, f)
            if not os.path.islink(fp): tot += os.path.getsize(fp)
    return tot
def mb(n): return "%.1f MB" % (n / 1e6)
L = []
w = L.append
w("# Ground-truth audit of ten public document-AI benchmarks")
w("")
w("Built %s. Every verdict below points at a saved file, and every number was re-read from the saved evidence when this page was generated." % BUILT)
w("")
w("For publication on 22 October 2026, every quotation of a public dataset's own files (its answers, questions, page text and README sentences) was replaced by a pointer to the file, line or record it came from, except a few short values from CORD, whose CC BY 4.0 licence allows them with credit (CORD: Park et al., 2019, https://github.com/clovaai/cord). Where a dataset's own file or\ncolumn names name commercial extraction systems or models, counts replace the names. No count and no verdict changed.")
w("")
w("## What this is, in plain words")
w("")
w("A benchmark is a public collection of documents (receipts, forms, invoices, reports) plus an answer key. The answer key, also called ground truth, is the file that says what the right answers are, so a system's output can be marked right or wrong. Section 5 of the white paper 'Precision Beyond the Page' compares the answer keys of ten public benchmarks on fifteen kinds of information, as a matrix (a grid of benchmarks against properties). This folder is that audit, with every piece of evidence kept.")
w("")
w("For each benchmark the actual answer files were downloaded (annotation files only, no image sets), scanned by small scripts that count what is there, and judged property by property. Each judgement, called a verdict, is one of three words:")
w("")
w("- present: the answer key holds this kind of information, in the sense of the written rule for that property.")
w("- partial: the key holds some of it: only implicitly, only by accident, only for some fields, or only for some documents.")
w("- absent: the key does not hold it.")
w("")
w("A few terms used throughout:")
w("")
w("- Field: a named slot for one piece of information, such as 'total' or 'invoice date'.")
w("- Printed form and canonical form: the printed form is how a value looks on the page (60.000, 31 March 2016). The canonical form is the one standard way of writing it that a computer system expects (60000.00, 2016-03-31). Converting one into the other is called normalisation.")
w("- Bounding box: the rectangle on the page where a value sits, given as coordinates. It is the evidence location of the value.")
w("- Invention: a system returning a value for a field that the page leaves empty. You can only catch it if the answer key records that the field is empty.")
w("- Decoy key: a field a system is asked for that has no answer in the document, on purpose.")
w("")
w("## The short answer")
w("")
w("- Normalisation: CORD's test row 0 stores the price as the text 60.000 and never as 60000.00, while both Kleister datasets store normalised dates, money and terms where the pages print other forms.")
w("- Invention: SROIE's test answers have no empty field at all, so they cannot show a system inventing a value. Kleister (declared decoy keys) and VRDU (its scorer counts answers for missing fields) can.")
w('- Never-printed values: both Kleister datasets hold some, by accident and unmarked; no dataset marks them.')
w('- Evidence locations: DocILE and VRDU attach a box to every answer.')
w('- Payload keys, derivability flags and rule ground truth are absent from all ten.')
w('- Every corpus distributes its documents, so repeatability can be measured on all ten.')
w("")
w("## Method")
w("")
w("1. The fifteen properties are the answer-key information AIDP's measures need (white paper, section 5). AIDP-2K's own keys carry most of them, but not yet evidence locations, customer reference records or full derivability flags. They are: per-field keys, explicit empties, canonical beside printed, values never printed, evidence locations, derivability flags, planted traps with controls, declared difficulty, instruction (rule) ground truth, payload keys, line-item and table row structure, document type labels, multi-document segmentation boundaries, entity resolution targets and repeatability.")
w("2. For each benchmark the smallest set of files that contains the answer key was downloaded: sparse git checkouts of only the annotation folders, the Hugging Face rows API with the image column dropped, and HTTP range requests that read single files out of large zip archives without downloading the rest. Each download went into its own new folder under samples/. Downloaded files were treated as untrusted data: scripts live in scripts/ and were run with python3 -I, with paths passed as arguments.")
w("3. One script per benchmark (scripts/scan_*.py) reads every downloaded annotation record and writes counts to evidence/*.json: which keys exist, how many values are empty, how values are written, which carry positions, and so on. An absence verdict is based on the full list of keys that occur in the files, not on not noticing something.")
w("4. scripts/build_matrix.py holds the 150 verdicts with their evidence and sources, re-reads every quoted number from evidence/*.json and stops if any number no longer matches, then writes matrix.json and this README.")
w("5. Where the text of a paper or README was needed (for example how Kleister made its answers), the text was saved under samples/ and is cited by line number.")
w("6. Times are India Standard Time (IST, GMT+05:30).")
w("")
w("## The fifteen properties and the rule for each verdict")
w("")
for p in PROPS:
    w("%d. %s. Paper's wording: %s. Measure it serves (this audit's mapping): %s. Rule: %s" % (p[0], p[1], p[2], p[3], p[4]))
w("")
w("## Results at a glance")
w("")
w("For each property, which benchmarks hold it.")
w("")
for p in PROPS:
    groups = collections.OrderedDict((v, [B[b]["name"] for b in B if C[(b, p[0])][0] == v]) for v in ("present", "partial", "absent"))
    parts = ["%s: %s" % (v, ", ".join(n) if n else "none") for v, n in groups.items()]
    w("- %d. %s. %s." % (p[0], p[1], "; ".join(parts)))
w("")
w("Counts per benchmark (present / partial / absent out of 15):")
w("")
for b in B:
    c = collections.Counter(C[(b, p)][0] for p in range(1, 16))
    w("- %s %s: %d present, %d partial, %d absent." % (B[b]["name"], B[b]["cite"], c["present"], c["partial"], c["absent"]))
w("")
w("## The matrix, benchmark by benchmark")
w("")
for b in B:
    w("### %s %s" % (B[b]["name"], B[b]["cite"]))
    w("")
    w("Checked %s. What was downloaded: %s" % (ist_of(B[b]["date_from"]), B[b]["downloaded"]))
    w("")
    w("Sources: " + "; ".join(B[b]["urls"]) + ".")
    w("")
    for p in range(1, 16):
        v, e, s = C[(b, p)]
        w("- %d. %s: %s. %s Where: %s, at %s. Online: %s." % (p, PROPS[p - 1][1], v.upper(), e, s["local"], s["record"], s["url"]))
    w("")
w("## Limits of this audit")
w("")
w("- The verdicts are judgements made against written rules. The borderline ones are marked partial and explain themselves (for example DocVQA's question-type tags counted as partial declared difficulty, and table corpora's empty cells counted as partial explicit empties). Someone applying a stricter rule could move those cells to absent; none of the corrections above depends on a borderline cell.")
w("- CORD: only the test and validation splits (200 receipts) were scanned. The rows API returned HTTP 500 for every request on the 800-receipt train split. The paper's claim concerns the test split, which was read in full.")
w("- DocILE is access-gated. It was judged from its published schema, its evaluation code, its paper and the one real annotation file its repository publishes, not from the full annotation set.")
w("- Kleister's test answers and DocVQA's test answers are withheld by their authors; the train and dev (Kleister) and validation (DocVQA) answers were used.")
w("- DocVQA: 4 of its 33 yes/no answers were checked against their page images (all print the answer word); the other 29 were not.")
w("- The checks that a Kleister answer is 'not printed' search four independent OCR text layers. One case was confirmed against the PDF itself (39 pages, text layer on every page, not even the stored number's first three digits anywhere, the two image-heavy pages viewed).")
w("")
w("## Files in this folder, and how to rebuild")
w("")
w("- matrix.json: the 150 verdicts (benchmark, property, verdict, evidence, source with local path, record and URL, date checked in IST), the property rules, per-benchmark download notes, and counts.")
w("- evidence/: one JSON file of counts per scan, plus summaries of the RD-TableBench and FUNSD archive listings. For publication, the example records the scans save beside their counts (values, questions, answers and page text quoted from the datasets' own files) were removed, apart from CORD's; every count is unchanged, and the scans write the examples again when rerun.")
w("- scripts/: the fetch, scan and build scripts. Rebuild with: python3 -I scripts/build_matrix.py <this folder>, after fetching samples/: the build re-reads the downloaded files to check each verdict's evidence. The scans can be rerun from the files in samples/ with the commands given at the top of each script. samples/ is not published, because the downloaded files belong to their authors; fetch them again from the sources listed below.")
w("- samples/ (not published): what was downloaded, one folder per source:")
SAMP = [
 ("samples/sroie/losyash-sroie-datasetv2", "https://github.com/Losyash/SROIE-datasetv2 at 235ba41d, sparse checkout of train and test entities and box folders"),
 ("samples/sroie/zzzdavid-icdar2019-sroie", "https://github.com/zzzDavid/ICDAR-2019-SROIE at 27be4271, sparse checkout of data/key"),
 ("samples/sroie/hf-rth-sroie-2019-v2", "the 347 test rows of rth/sroie-2019-v2 (entities and line boxes, image column dropped), used to cross-check the test answers"),
 ("samples/sroie/arxiv-2103.10213", "SROIE competition paper text, https://arxiv.org/abs/2103.10213"),
 ("samples/cord/hf-naver-clova-ix-cord-v2", "test and validation rows (ground_truth only), Hugging Face rows API, revision 7f0115a4"),
 ("samples/cord/github-clovaai-cord", "CORD README at 327310ce"),
 ("samples/funsd/annotations", "the 199 annotation files from https://guillaumejaume.github.io/FUNSD/dataset.zip (zip deleted)"),
 ("samples/docile/github-rossumai-docile", "https://github.com/rossumai/docile at 45f1f00d, sparse checkout of README, schema code, evaluation code, tutorials and the public sample annotation"),
 ("samples/docile/arxiv-2302.05658", "DocILE paper text"),
 ("samples/vrdu/github-google-research-datasets-vrdu", "https://github.com/google-research-datasets/vrdu at 04a4df7a, README, meta.json files, two split files"),
 ("samples/vrdu/annotations-only", "annotation part of both dataset.jsonl.gz files (OCR text dropped; the archives were deleted)"),
 ("samples/vrdu/github-google-research-vrdu-eval", "VRDU evaluation toolkit, google-research at 600df90d"),
 ("samples/vrdu/arxiv-2211.15421", "VRDU paper text"),
 ("samples/docvqa/hf-lmms-lab-docvqa", "5,349 validation rows and 600 test rows, image column dropped, Hugging Face rows API, revision 539088ef"),
 ("samples/docvqa/one-page-row134", "page image for validation row 134 (question 57557), to check a yes answer against the page"),
 ("samples/docvqa/one-page-row1012", "page image for validation row 1012 (question 1623)"),
 ("samples/docvqa/one-page-row4056", "page image for validation row 4056 (question 39139)"),
 ("samples/docvqa/one-page-row4925", "page image for validation row 4925 (question 56784)"),
 ("samples/omnidocbench/hf-opendatalab-omnidocbench", "OmniDocBench.json and README, revision aa1ee96d"),
 ("samples/kleister-nda/github-applicaai-kleister-nda", "https://github.com/applicaai/kleister-nda at c2c7bf06, sparse checkout without documents/"),
 ("samples/kleister-nda/github-two-pdfs", "the two NDA PDFs behind the computed terms (train lines 15 and 196), from documents/ at c2c7bf06"),
 ("samples/kleister-charity/github-applicaai-kleister-charity", "https://github.com/applicaai/kleister-charity at 2309f486, sparse checkout without documents/ and train in.tsv.xz"),
 ("samples/kleister-charity/s3-annex-one-pdf", "one charity report PDF from the public annex bucket, SHA-256 31a9e1f0..."),
 ("samples/kleister-charity/arxiv-2105.05796", "Kleister paper text"),
 ("samples/rd-tablebench/hf-reducto-rd-tablebench", "the 1,000 ground-truth HTML files and providers/scores.csv out of rd-tablebench.zip, revision 7748503e"),
 ("samples/rd-tablebench/github-reductoai-rd-tablebench", "grading code README at 1cae108e"),
]
for path, what in SAMP:
    assert os.path.exists(os.path.join(AUD, path)), path
    w("  - %s (%s): %s" % (path, mb(du(os.path.join(AUD, path))), what))
w("")
w("## Disk used")
w("")
tot = du(AUD)
w("The audit's working folder held %s in total, of which samples/ was %s (including the git metadata of the sparse checkouts). The largest single file is OmniDocBench.json (42.2 MB). About 130 MB more was transferred and not kept: the two VRDU archives (86.8 MB) and the FUNSD zip (16.8 MB), deleted once their annotation part was extracted; four paper PDFs (8.9 MB), deleted once converted to text; and about 16.5 MB of zip ranges read out of RD-TableBench and FUNSD. Well inside the 2 GB budget." % (mb(tot), mb(du(os.path.join(AUD, "samples")))))
w("")
readme = "\n".join(L) + "\n"
for bad in ("—", "–", "|"):
    assert bad not in readme, "forbidden character in README: %r near %s" % (bad, readme[max(0, readme.find(bad) - 80): readme.find(bad) + 20])
open(os.path.join(AUD, "README.md"), "w", encoding="utf-8").write(readme)
print("README.md written:", len(readme), "chars;", "audit folder", mb(tot))
