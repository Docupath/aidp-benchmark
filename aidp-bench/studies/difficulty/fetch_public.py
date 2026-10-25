#!/usr/bin/env python3
"""
Fetch SMALL samples (at most 50 documents each) from public document corpora, without downloading any
full dataset, and write an items file per corpus for `estimator.py items`.

How each corpus is reached without downloading it whole:
  CORD, FUNSD, SROIE, DocVQA  Hugging Face dataset viewer API, one row at a time
                              (https://datasets-server.huggingface.co/rows)
  OmniDocBench                its 42 MB annotation file (deleted after the sample is cut), plus one page
                              image per sampled page
  RD-TableBench               HTTP byte-range reads inside its 450 MB zip: only the zip directory and
                              the sampled entries are transferred
  Kleister NDA                its 0.3 MB text file plus one PDF per sampled document (from GitHub)
  Kleister Charity            its 6.4 MB text file plus one PDF per sampled document (public S3 bucket
                              named in the repo's git-annex remote log); PDFs over 15 MB are skipped
  VRDU                        the annotation file is STREAMED (not stored) and only the sampled
                              records kept; one PDF per sampled document (from GitHub)
  DocILE                      not fetched: gated behind a registration token from the organisers

Downloaded files are untrusted data: they are written under <out_dir>/<corpus>/ only, never executed,
and only read by `python -I` processes.

  python -I fetch_public.py inspect <dataset> <config> <split>
  python -I fetch_public.py fetch <corpus-key> <out_dir>
  python -I fetch_public.py zipls <url>
"""
import gzip
import html
import io
import json
import lzma
import os
import random
import re
import sys
import time
import urllib.parse
import urllib.request
import zipfile

API = "https://datasets-server.huggingface.co"
UA = {"User-Agent": "difficulty-study/1.0 (small research sample)"}
N_PER_CORPUS = 50
SEED = 20261022


def get(url, binary=False, tries=6, timeout=90, headers=None):
    last = None
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={**UA, **(headers or {})})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                data = r.read()
            return data if binary else json.loads(data.decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            last = e
            # back off much longer when the server says we are asking too often
            time.sleep((20 * (k + 1)) if "429" in str(e) else 2 * (k + 1))
    raise RuntimeError(f"GET failed {url[:140]}: {last}")


def rows(dataset, config, split, offset, length):
    q = urllib.parse.urlencode({"dataset": dataset, "config": config, "split": split,
                                "offset": offset, "length": length})
    return get(f"{API}/rows?{q}")


def inspect(dataset, config, split):
    d = rows(dataset, config, split, 0, 1)
    print("num_rows_total", d.get("num_rows_total"))
    print("features", json.dumps(d["features"])[:1500])
    for k, v in d["rows"][0]["row"].items():
        print(" ", k, ":", json.dumps(v, ensure_ascii=False)[:500])


def sample(seq, n, seed=SEED):
    rnd = random.Random(seed)
    seq = list(seq)
    return sorted(rnd.sample(seq, min(n, len(seq))), key=lambda x: seq.index(x)) if seq else []


def save(url, path):
    if not os.path.exists(path):
        data = get(url, binary=True)
        with open(path, "wb") as f:
            f.write(data)
    return path


def write_items(cdir, items, note):
    with open(os.path.join(cdir, "items.jsonl"), "w", encoding="utf-8") as f:
        for it in items:
            f.write(json.dumps(it, ensure_ascii=False) + "\n")
    print(f"{os.path.basename(cdir)}: {len(items)} items. {note}", flush=True)


def html_text(s):
    return html.unescape(re.sub(r"<[^>]+>", " ", s or ""))


# --------------------------------------------------------------------------- Hugging Face viewer rows
def text_cord(row):
    gt = json.loads(row["ground_truth"])
    return " ".join(w["text"] for line in gt.get("valid_line", []) for w in line.get("words", []))


HF_SPECS = {
    "CORD": ("naver-clova-ix/cord-v2", "default", "test", "image", text_cord,
             "ground_truth.valid_line words (the corpus's own OCR annotation)"),
    "FUNSD": ("nielsr/funsd", "default", "test", "image", lambda r: " ".join(r.get("words") or []),
              "words (the corpus's own word annotation)"),
    "SROIE": ("rth/sroie-2019-v2", "default", "test", "image",
              lambda r: " ".join((r.get("objects") or {}).get("text") or []),
              "objects.text (the corpus's own OCR line annotation)"),
    "DocVQA": ("nielsr/docvqa_1200_examples", "default", "test", "image",
               lambda r: " ".join(r.get("words") or []),
               "words (the OCR words shipped with this DocVQA validation subset)"),
}


def fetch_hf(key, out_dir):
    dataset, config, split, img_col, text_fn, text_src = HF_SPECS[key]
    cdir = os.path.join(out_dir, key)
    os.makedirs(cdir, exist_ok=True)
    first = rows(dataset, config, split, 0, 100)
    total = first["num_rows_total"]
    allrows = {x["row_idx"]: x["row"] for x in first["rows"]}
    for start in range(100, total, 100):  # pages of 100 rows: few requests, no rate limit trouble
        time.sleep(3)
        for x in rows(dataset, config, split, start, 100)["rows"]:
            allrows[x["row_idx"]] = x["row"]
    order = list(range(total))
    random.Random(SEED).shuffle(order)
    items, seen_text = [], set()
    for off in order:
        if len(items) >= N_PER_CORPUS:
            break
        r = allrows.get(off)
        if r is None:
            continue
        img = r.get(img_col)
        if not isinstance(img, dict) or not img.get("src"):
            continue
        text = text_fn(r)
        sig = (text or "")[:400]
        if sig in seen_text:  # DocVQA rows are questions; several can share one page
            continue
        seen_text.add(sig)
        ext = os.path.splitext(urllib.parse.urlparse(img["src"]).path)[1] or ".jpg"
        path = save(img["src"], os.path.join(cdir, f"{split}-{off:05d}{ext}"))
        items.append({"id": f"{key}:{split}:{off}", "corpus": key, "images": [path], "pages": 1, "text": text,
                      "meta": {"source": f"https://huggingface.co/datasets/{dataset}", "config": config,
                               "split": split, "row": off, "text_source": text_src}})
        time.sleep(0.2)
    write_items(cdir, items, f"{dataset} {split}, {total} rows, seeded random order")


# --------------------------------------------------------------------------- OmniDocBench
def fetch_omnidoc(out_dir):
    key, repo = "OmniDocBench", "opendatalab/OmniDocBench"
    cdir = os.path.join(out_dir, key)
    os.makedirs(cdir, exist_ok=True)
    ann_path = os.path.join(cdir, "OmniDocBench.json")
    base = f"https://huggingface.co/datasets/{repo}/resolve/main"
    sub_path = os.path.join(cdir, "sampled-annotations.json")
    if os.path.exists(sub_path):
        picked = json.load(open(sub_path, encoding="utf-8"))
    else:
        save(f"{base}/OmniDocBench.json", ann_path)
        allrec = json.load(open(ann_path, encoding="utf-8"))
        idx = sample(range(len(allrec)), N_PER_CORPUS)
        picked = [allrec[i] for i in idx]
        json.dump(picked, open(sub_path, "w", encoding="utf-8"), ensure_ascii=False)
        os.remove(ann_path)  # keep only the sampled annotations on disk
        print(f"OmniDocBench: sampled {len(picked)} of {len(allrec)} pages")
    items = []
    for rec in picked:
        pi = rec.get("page_info", {})
        name = pi.get("image_path")
        if not name:
            continue
        path = save(f"{base}/images/{urllib.parse.quote(name)}", os.path.join(cdir, os.path.basename(name)))
        parts = []
        for det in rec.get("layout_dets", []):
            if det.get("text"):
                parts.append(det["text"])
            elif det.get("html"):
                parts.append(html_text(det["html"]))
            elif det.get("latex"):
                parts.append(det["latex"])
        attr = pi.get("page_attribute", {})
        items.append({"id": f"{key}:{name}", "corpus": key, "images": [path], "pages": 1, "text": "\n".join(parts),
                      "meta": {"source": f"https://huggingface.co/datasets/{repo}",
                               "text_source": "layout_dets text/html/latex (the corpus's own annotation)",
                               "language": attr.get("language"), "data_source": attr.get("data_source"),
                               "page_attribute": attr}})
        time.sleep(0.2)
    write_items(cdir, items, "seeded sample of annotated pages")


# --------------------------------------------------------------------------- RD-TableBench (zip ranges)
class HttpRangeFile(io.RawIOBase):
    """Read-only, seekable file over HTTP byte ranges, so zipfile only transfers what it reads."""

    def __init__(self, url):
        req = urllib.request.Request(url, headers={**UA, "Range": "bytes=0-0"})
        with urllib.request.urlopen(req, timeout=90) as r:
            self.url = r.geturl()
            cr = r.headers.get("Content-Range", "")
            self.size = int(cr.split("/")[-1])
        self.pos = 0
        self.transferred = 0

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else (self.pos + off if whence == 1 else self.size + off)
        return self.pos

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        if n == 0 or self.pos >= self.size:
            return b""
        end = min(self.size, self.pos + n) - 1
        data = get(self.url, binary=True, headers={"Range": f"bytes={self.pos}-{end}"})
        self.pos += len(data)
        self.transferred += len(data)
        return data

    def readinto(self, b):
        data = self.read(len(b))
        b[: len(data)] = data
        return len(data)


RDTB_URL = "https://huggingface.co/datasets/reducto/rd-tablebench/resolve/main/rd-tablebench.zip"


def zipls(url):
    f = HttpRangeFile(url)
    z = zipfile.ZipFile(io.BufferedReader(f, buffer_size=1 << 16))
    names = z.namelist()
    print(f"{len(names)} entries, zip size {f.size}, transferred {f.transferred}")
    exts = {}
    for n in names:
        exts[os.path.splitext(n)[1].lower()] = exts.get(os.path.splitext(n)[1].lower(), 0) + 1
    print(exts)
    for n in names[:12]:
        print(" ", n, z.getinfo(n).file_size)


def fetch_rdtb(out_dir):
    key = "RD-TableBench"
    cdir = os.path.join(out_dir, key)
    os.makedirs(cdir, exist_ok=True)
    f = HttpRangeFile(RDTB_URL)
    z = zipfile.ZipFile(io.BufferedReader(f, buffer_size=1 << 16))
    names = [n for n in z.namelist() if not n.startswith("__MACOSX") and not os.path.basename(n).startswith(".")]
    imgs = [n for n in names if os.path.splitext(n)[1].lower() in (".jpg", ".jpeg", ".png")]
    by_stem = {}
    for n in names:  # ground truth only; providers/* hold vendor outputs, not the corpus's own text
        if n.startswith("rd-tablebench/groundtruth/") and n.lower().endswith(".html"):
            by_stem[os.path.splitext(os.path.basename(n))[0]] = n
    pairs = [(n, by_stem.get(os.path.splitext(os.path.basename(n))[0])) for n in imgs]
    pairs = [p for p in pairs if p[1]]
    picked = sample(pairs, N_PER_CORPUS)
    items = []
    for img_name, gt_name in picked:
        path = os.path.join(cdir, os.path.basename(img_name))
        if not os.path.exists(path):
            with open(path, "wb") as out:
                out.write(z.read(img_name))
        text = html_text(z.read(gt_name).decode("utf-8", "replace"))
        items.append({"id": f"{key}:{os.path.basename(img_name)}", "corpus": key, "images": [path], "pages": 1,
                      "text": text, "meta": {"source": "https://huggingface.co/datasets/reducto/rd-tablebench",
                                             "zip_entry": img_name, "text_source": f"{gt_name} (ground-truth HTML, tags removed)"}})
    write_items(cdir, items, f"{len(pairs)} image+HTML pairs in the zip; transferred {f.transferred / 1e6:.1f} MB of {f.size / 1e6:.0f} MB")


# --------------------------------------------------------------------------- Kleister (NDA, Charity)
def kleister_unescape(s):
    return (s.replace("\\\\", "\x00").replace("\\n", "\n").replace("\\t", "\t").replace("\\f", "\f")
            .replace("\x00", "\\"))


def fetch_kleister(which, out_dir):
    key = {"nda": "Kleister-NDA", "charity": "Kleister-Charity"}[which]
    repo = f"applicaai/kleister-{which}"
    cdir = os.path.join(out_dir, key)
    os.makedirs(cdir, exist_ok=True)
    raw = f"https://raw.githubusercontent.com/{repo}/master"
    tsv_path = save(f"{raw}/dev-0/in.tsv.xz", os.path.join(cdir, "dev-0-in.tsv.xz"))
    # split on newline ONLY: str.splitlines() also breaks on form feeds and other separators that occur
    # raw inside the text columns, which would cut one document's row into several
    lines = lzma.open(tsv_path, "rt", encoding="utf-8", newline="\n").read().split("\n")
    rows_ = [ln.split("\t") for ln in lines if ln.strip()]
    order = list(range(len(rows_)))
    random.Random(SEED).shuffle(order)
    items, skipped = [], 0
    for i in order:
        if len(items) >= N_PER_CORPUS:
            break
        cols = rows_[i]
        fname, text_best = cols[0], kleister_unescape(cols[5]) if len(cols) > 5 else ""
        path = os.path.join(cdir, fname)
        if which == "nda":
            save(f"{raw}/documents/{urllib.parse.quote(fname)}", path)
            src = f"https://github.com/{repo} documents/{fname}"
        else:
            target = get(f"{raw}/documents/{urllib.parse.quote(fname)}", binary=True).decode().strip()
            annex_key = os.path.basename(target)
            m = re.match(r"SHA256E-s(\d+)--", annex_key)
            if not m or int(m.group(1)) > 15_000_000:
                skipped += 1
                continue
            url = f"https://applica-public.s3-eu-west-1.amazonaws.com/kleister-charity-git-annex/{annex_key}"
            save(url, path)
            src = url
        n_pages = text_best.count("\f") + 1 if text_best else None
        items.append({"id": f"{key}:{fname}", "corpus": key, "pdf": path, "pages": None, "text": text_best,
                      "meta": {"source": src, "split": "dev-0", "text_source": "text_best column of dev-0/in.tsv.xz",
                               "pages_by_text_breaks": n_pages}})
        time.sleep(0.2)
    write_items(cdir, items, f"dev-0 has {len(rows_)} documents; skipped {skipped} PDFs over 15 MB")


# --------------------------------------------------------------------------- VRDU
def fetch_vrdu(out_dir):
    key, repo = "VRDU", "google-research-datasets/vrdu"
    cdir = os.path.join(out_dir, key)
    os.makedirs(cdir, exist_ok=True)
    tree = get(f"https://api.github.com/repos/{repo}/git/trees/main?recursive=1")
    items = []
    for sub, n in (("registration-form", N_PER_CORPUS // 2), ("ad-buy-form", N_PER_CORPUS - N_PER_CORPUS // 2)):
        pdfs = [t["path"] for t in tree["tree"] if t["path"].startswith(f"{sub}/main/pdfs/") and t["path"].endswith(".pdf")]
        picked = sample(pdfs, n)
        want = {os.path.basename(p): p for p in picked}
        texts = {}
        url = f"https://raw.githubusercontent.com/{repo}/main/{sub}/main/dataset.jsonl.gz"
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=300) as r:  # streamed: never written to disk
            with gzip.GzipFile(fileobj=r) as gz:
                for ln in gz:
                    rec = json.loads(ln)
                    if rec.get("filename") in want:
                        texts[rec["filename"]] = (rec.get("ocr") or {}).get("text", "")
                        if len(texts) == len(want):
                            break
        for fname, p in want.items():
            local = os.path.join(cdir, re.sub(r"[^A-Za-z0-9._-]", "_", fname))
            save(f"https://raw.githubusercontent.com/{repo}/main/{urllib.parse.quote(p)}", local)
            items.append({"id": f"{key}:{sub}:{fname}", "corpus": key, "pdf": local, "pages": None,
                          "text": texts.get(fname), "meta": {"source": f"https://github.com/{repo}/blob/main/{p}",
                                                              "subset": sub, "text_source": "dataset.jsonl.gz ocr.text"}})
            time.sleep(0.2)
        print(f"VRDU {sub}: {len(want)} sampled of {len(pdfs)} PDFs, text found for {sum(1 for f in want if f in texts)}")
    write_items(cdir, items, "25 registration forms + 25 ad-buy forms")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "inspect":
        inspect(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "zipls":
        zipls(sys.argv[2])
    elif cmd == "fetch":
        k, out = sys.argv[2], sys.argv[3]
        if k in HF_SPECS:
            fetch_hf(k, out)
        elif k == "OmniDocBench":
            fetch_omnidoc(out)
        elif k == "RD-TableBench":
            fetch_rdtb(out)
        elif k in ("Kleister-NDA", "Kleister-Charity"):
            fetch_kleister("nda" if k == "Kleister-NDA" else "charity", out)
        elif k == "VRDU":
            fetch_vrdu(out)
        else:
            sys.exit(f"unknown corpus {k}")
    else:
        print(__doc__)
        sys.exit(2)
