#!/usr/bin/env python3
"""
Document difficulty estimator: the study behind section 6 of the white paper
"Precision Beyond the Page".

WHAT IT DOES, IN PLAIN WORDS
For each document it measures six things that can be observed after the document exists:

  blur      How soft the edges of the print are. Measured as the variance of the Laplacian: the
            Laplacian is a filter that responds to sudden light-to-dark jumps, so a sharp page (crisp
            letter edges) gives large, varied responses and a blurred page gives small ones.
  contrast  How far the darkest ink is from the paper. Measured as a percentile spread of grey levels:
            (99th percentile - 0.5th percentile) / 255. 1.0 means pure black ink on pure white paper.
  skew      How far the text lines are tilted from horizontal, in degrees. Measured by a projection
            profile search: the page's ink is projected onto a tilted axis for many candidate angles,
            and the angle at which the ink piles up into the sharpest rows (text lines) wins.
            Positive = rotated clockwise as seen on screen (the same sign as CSS rotate()).
  pages     How many pages the document has.
  density   How many text tokens each page carries, counted from the document's OWN text (the
            corpus's answer-key text or its OCR annotation, never re-read from the pixels here).
            A token is a run of non-space characters, except that each Chinese/Japanese character
            counts as one token because those scripts do not separate words with spaces.
  script    Which writing system the text uses: Latin, CJK, Arabic, and so on.

Each raw measurement becomes a 0-to-1 "difficulty component" through a FIXED rule (the FROZEN block
below), and the components are averaged with FIXED weights. If a component cannot be observed for a
document (for example a corpus that ships no text), it drops out and the remaining weights are scaled
up to sum to one. Nothing in this file is, or ever was, fitted to any outcome.

USAGE
  python -I estimator.py selftest
  python -I estimator.py freeze <out.json>                       # write the frozen configuration + hash
  python -I estimator.py aidp <corpus_dir> <out.jsonl>            # features for AIDP-2K (resumable)
  python -I estimator.py items <items.jsonl> <out.jsonl>          # features for public-corpus samples
  python -I estimator.py score <out.csv> <features.jsonl> [...]   # components + estimates per document
Run heavy steps with `nice -n 19`. Everything is single-threaded on purpose.
"""
import csv
import glob
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone

import numpy as np

os.environ.setdefault("OMP_NUM_THREADS", "1")
import cv2  # noqa: E402

cv2.setNumThreads(1)

# =====================================================================================================
# FROZEN. Every constant in this block was written on 2026-10-22 BEFORE any feature was computed on any
# document and BEFORE any feature was compared with any outcome (noise grade, rotation, trap flag).
# They are declared, not fitted, and must never be tuned afterwards. `freeze` hashes this block; the
# analysis refuses to run if the hash changes.
#
# Disclosure: the generator's source (aidp-bench/corpus-gen/render.mjs) was read before this block was
# written, so it was known that the noise grade drives a page rotation (0.4 / 1.1 / 2.2 degrees) and,
# for the heavy grade only, a contrast filter. To avoid exploiting that, the primary weights are EQUAL
# across the six components, and the anchors below are generic document-imaging rules of thumb rather
# than values chosen to separate the AIDP grades.
# --- FROZEN-BEGIN ---
FROZEN = {
    "raster_dpi": 100,                 # PDFs are rasterised at 100 dpi, greyscale
    "max_pages_rasterised": 3,         # only the first 3 pages are rasterised
    "work_pixels": 1_000_000,          # images larger than ~1 megapixel (A4 at 100 dpi) are downscaled
                                       # to that area; smaller images are never upscaled
    # Component transforms (raw feature -> difficulty in [0, 1], 0 = no difficulty from this source)
    "blur_sharp_vl": 1000.0,           # variance of Laplacian >= 1000 -> 0 (sharp)
    "blur_blurry_vl": 100.0,           # <= 100 -> 1 (the conventional blur threshold); log-linear between
    "contrast_good": 0.80,             # percentile spread >= 0.80 -> 0
    "contrast_poor": 0.30,             # <= 0.30 -> 1; linear between
    "skew_max_deg": 5.0,               # |angle| / 5 degrees, capped at 1
    "skew_search_deg": 10.0,           # angles searched: -10 .. +10 degrees
    "skew_coarse_step": 0.25,          # coarse step, then a fine search +-0.30 at 0.02 degrees
    "skew_fine_halfwidth": 0.30,
    "skew_fine_step": 0.02,
    "skew_min_ink_pixels": 300,        # fewer ink pixels than this -> skew not observable on that page
    "skew_max_points": 200_000,        # ink pixels are thinned to at most this many (fixed stride)
    "pages_max": 32,                   # log2(pages) / log2(32), capped at 1 (1 page -> 0, 32+ -> 1)
    "density_low": 50.0,               # tokens per page <= 50 -> 0
    "density_high": 1000.0,            # >= 1000 -> 1; log-linear between
    "script_difficulty": {             # writing system -> difficulty
        "latin": 0.0, "greek": 0.5, "cyrillic": 0.5,
        "cjk": 1.0, "arabic": 1.0, "hebrew": 1.0, "indic": 1.0, "thai": 1.0, "other": 1.0,
    },
    "script_nonlatin_share": 0.15,     # the commonest non-Latin script wins if it holds >= 15% of letters
    "script_min_letters": 20,          # fewer letters than this -> script not observable
    # Weights. PRIMARY is the six-component estimator the paper describes. VISUAL is a pre-declared
    # secondary estimator using only the three image components. Both are reported; neither is fitted.
    "weights_primary": {"blur": 1 / 6, "contrast": 1 / 6, "skew": 1 / 6,
                        "pages": 1 / 6, "density": 1 / 6, "script": 1 / 6},
    "weights_visual": {"blur": 1 / 3, "contrast": 1 / 3, "skew": 1 / 3},
    # Analysis plan, also fixed in advance
    "analysis": {
        "seed": 20261022,
        "bootstrap_resamples": 2000,
        "permutations": 2000,
        "subsample_n": 16,              # the paper's AIDP sample size
        "subsample_draws": 10000,
        "noise_ordinal": {"none": 0, "light": 1, "medium": 2, "heavy": 3},
        "applied_rotation_deg": {"none": 0.0, "light": 0.4, "medium": 1.1, "heavy": 2.2},  # render.mjs
        "trap_dims": ["mismatch", "missingTotals", "stickerMismatch"],
        "structural_dims": ["coverPage", "bundle"],
        "match_on": ["slug", "noise", "scale"],
        "near_constant_sd": 0.02,       # a corpus whose estimate has SD below this is "near-constant"
        "single_component_r2": 0.90,    # one component explaining >= 90% of the estimate's variance
        "alpha": 0.05,
    },
}
# --- FROZEN-END ---
# =====================================================================================================

COMPONENTS = ["blur", "contrast", "skew", "pages", "density", "script"]
IST = timezone(timedelta(hours=5, minutes=30))


def frozen_hash():
    """SHA-256 of the FROZEN block's source text, so any later edit is detectable."""
    src = open(os.path.abspath(__file__), encoding="utf-8").read()
    block = src.split("# --- FROZEN-BEGIN ---", 1)[1].split("# --- FROZEN-END ---", 1)[0]
    return hashlib.sha256(block.encode("utf-8")).hexdigest()


# ------------------------------------------------------------------------------- image features
def standardise(gray):
    """Downscale to about one megapixel if larger; never upscale."""
    h, w = gray.shape[:2]
    if h * w > FROZEN["work_pixels"]:
        s = math.sqrt(FROZEN["work_pixels"] / float(h * w))
        gray = cv2.resize(gray, (max(1, int(round(w * s))), max(1, int(round(h * s)))),
                          interpolation=cv2.INTER_AREA)
    return gray


def blur_vl(gray):
    """Variance of the Laplacian (3x3 kernel) of the greyscale page. Higher = sharper."""
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def contrast_spread(gray):
    """(P99 - P0.5) / 255 of grey levels: paper level minus darkest-ink level, 0..1."""
    lo, hi = np.percentile(gray, [0.5, 99.0])
    return float((hi - lo) / 255.0)


def ink_mask(gray):
    thr, _ = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # OpenCV's Otsu puts pixels EQUAL to the threshold on the dark side (dst = 255 only if src > thr)
    return gray <= min(float(thr), 200.0)  # never call near-white pixels ink


def skew_deg(gray):
    """Projection-profile skew. Returns (angle_deg or None, ink_pixels, peak_ratio).

    For a candidate angle a, each ink pixel (x, y) (y pointing down) is projected to
    r = y*cos(a) - x*sin(a). When a equals the page's clockwise rotation, the pixels of one text line
    share one r, so the histogram of r is as peaked as it can be. The criterion is the sum of squared
    histogram counts. peak_ratio = best criterion / criterion at 0 degrees (1.0 = no evidence of tilt).
    """
    ink = ink_mask(gray)
    ys, xs = np.nonzero(ink)
    n = int(xs.size)
    if n < FROZEN["skew_min_ink_pixels"]:
        return None, n, None
    if n > FROZEN["skew_max_points"]:
        stride = int(math.ceil(n / FROZEN["skew_max_points"]))
        xs, ys = xs[::stride], ys[::stride]
    xs = xs.astype(np.float64) - xs.mean()
    ys = ys.astype(np.float64) - ys.mean()

    def crit(a_deg):
        a = math.radians(a_deg)
        r = ys * math.cos(a) - xs * math.sin(a)
        r = np.rint(r - r.min()).astype(np.int64)
        h = np.bincount(r).astype(np.float64)
        return float((h * h).sum())

    lim = FROZEN["skew_search_deg"]
    coarse = np.arange(-lim, lim + 1e-9, FROZEN["skew_coarse_step"])
    cs = np.array([crit(a) for a in coarse])
    a0 = float(coarse[int(np.argmax(cs))])
    hw, st = FROZEN["skew_fine_halfwidth"], FROZEN["skew_fine_step"]
    fine = np.arange(a0 - hw, a0 + hw + 1e-9, st)
    fs = np.array([crit(a) for a in fine])
    best = float(fine[int(np.argmax(fs))])
    base = crit(0.0)
    return round(best, 3), n, (float(fs.max()) / base if base > 0 else None)


def page_features(gray):
    g = standardise(gray)
    a, n, pr = skew_deg(g)
    return {"h": int(g.shape[0]), "w": int(g.shape[1]), "blur_vl": round(blur_vl(g), 3),
            "contrast_spread": round(contrast_spread(g), 5), "skew_deg": a, "ink_pixels": n,
            "skew_peak_ratio": None if pr is None else round(pr, 4)}


def aggregate_pages(pages):
    """Blur and contrast: median over rasterised pages. Skew: the page with the most ink."""
    if not pages:
        return {"blur_vl": None, "contrast_spread": None, "skew_deg": None, "skew_page": None}
    out = {"blur_vl": float(np.median([p["blur_vl"] for p in pages])),
           "contrast_spread": float(np.median([p["contrast_spread"] for p in pages]))}
    cand = [(p["ink_pixels"], i) for i, p in enumerate(pages) if p["skew_deg"] is not None]
    if cand:
        _, i = max(cand)
        out["skew_deg"], out["skew_page"] = pages[i]["skew_deg"], i + 1
    else:
        out["skew_deg"], out["skew_page"] = None, None
    return out


# ------------------------------------------------------------------------------- PDF helpers
def pdf_pages(path):
    out = subprocess.run(["pdfinfo", path], capture_output=True, text=True, timeout=120).stdout
    m = re.search(r"^Pages:\s+(\d+)", out, re.M)
    return int(m.group(1)) if m else None


def pdf_font_count(path):
    out = subprocess.run(["pdffonts", path], capture_output=True, text=True, timeout=120).stdout
    return max(0, len(out.strip().splitlines()) - 2)


def rasterise(path, n_pages, tmpdir):
    """First min(n_pages, 3) pages at 100 dpi, greyscale. Returns a list of uint8 arrays."""
    last = max(1, min(n_pages or 1, FROZEN["max_pages_rasterised"]))
    root = os.path.join(tmpdir, "p")
    subprocess.run(["pdftoppm", "-r", str(FROZEN["raster_dpi"]), "-gray", "-png", "-f", "1",
                    "-l", str(last), path, root], check=True, capture_output=True, timeout=600)
    files = sorted(glob.glob(root + "-*.png"), key=lambda f: int(re.findall(r"-(\d+)\.png$", f)[0]))
    imgs = [cv2.imread(f, cv2.IMREAD_GRAYSCALE) for f in files]
    for f in files:
        os.remove(f)
    return [im for im in imgs if im is not None]


def load_image_gray(path):
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im is None:
        from PIL import Image  # fallback for formats OpenCV cannot read
        with Image.open(path) as pim:
            return np.array(pim.convert("L"))
    if im.ndim == 2:
        g = im
    elif im.shape[2] == 4:  # composite transparency onto white paper
        a = im[:, :, 3:4].astype(np.float32) / 255.0
        rgb = im[:, :, :3].astype(np.float32) * a + 255.0 * (1 - a)
        g = cv2.cvtColor(rgb.astype(np.uint8), cv2.COLOR_BGR2GRAY)
    else:
        g = cv2.cvtColor(im[:, :, :3], cv2.COLOR_BGR2GRAY)
    if g.dtype != np.uint8:
        g = cv2.normalize(g, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
    return g


# ------------------------------------------------------------------------------- text features
_CJK_CHAR = "぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ"
_TOKEN_RE = re.compile(r"[" + _CJK_CHAR + r"]|[^\s" + _CJK_CHAR + r"]+")
_SCRIPTS = [
    ("latin", re.compile(r"[A-Za-zÀ-ɏḀ-ỿ]")),
    ("greek", re.compile(r"[Ͱ-Ͽ]")),
    ("cyrillic", re.compile(r"[Ѐ-ӿ]")),
    ("arabic", re.compile(r"[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]")),
    ("hebrew", re.compile(r"[֐-׿]")),
    ("cjk", re.compile(r"[" + _CJK_CHAR + r"가-힯ᄀ-ᇿ]")),
    ("indic", re.compile(r"[ऀ-෿]")),
    ("thai", re.compile(r"[฀-๿]")),
]


def count_tokens(text):
    return len(_TOKEN_RE.findall(text or ""))


def script_class(text):
    """Returns (class or None, {script: letter count})."""
    counts = {name: len(rx.findall(text or "")) for name, rx in _SCRIPTS}
    letters = sum(counts.values())
    other = sum(1 for ch in (text or "") if ch.isalpha()) - letters
    if other > 0:
        counts["other"] = other
        letters += other
    if letters < FROZEN["script_min_letters"]:
        return None, counts
    nonlatin = sorted(((c, k) for k, c in counts.items() if k != "latin" and c > 0), reverse=True)
    if nonlatin and nonlatin[0][0] / letters >= FROZEN["script_nonlatin_share"]:
        return nonlatin[0][1], counts
    return "latin", counts


def aidp_text_clean(text):
    """AIDP .gt.txt carries page markers and table cell separators; neither is document text."""
    lines = [ln for ln in text.splitlines() if not re.match(r"^\s*#\s*---.*---\s*#\s*$", ln)]
    return "\n".join(lines).replace("|", " ")


# ------------------------------------------------------------------------------- components
def _clip01(v):
    return float(min(1.0, max(0.0, v)))


def components(rec):
    """Raw features -> difficulty components in [0, 1] (None when not observable)."""
    F = FROZEN
    c = {}
    vl = rec.get("blur_vl")
    if vl is None:
        c["blur"] = None
    else:
        lo, hi = math.log10(F["blur_blurry_vl"]), math.log10(F["blur_sharp_vl"])
        c["blur"] = _clip01((hi - math.log10(max(vl, 1e-6))) / (hi - lo))
    s = rec.get("contrast_spread")
    c["contrast"] = None if s is None else _clip01((F["contrast_good"] - s) / (F["contrast_good"] - F["contrast_poor"]))
    a = rec.get("skew_deg")
    c["skew"] = None if a is None else _clip01(abs(a) / F["skew_max_deg"])
    p = rec.get("pages")
    c["pages"] = None if not p else _clip01(math.log2(max(p, 1)) / math.log2(F["pages_max"]))
    tpp = rec.get("tokens_per_page")
    if tpp is None:
        c["density"] = None
    elif tpp <= F["density_low"]:
        c["density"] = 0.0
    else:
        lo, hi = math.log10(F["density_low"]), math.log10(F["density_high"])
        c["density"] = _clip01((math.log10(tpp) - lo) / (hi - lo))
    sc = rec.get("script_class")
    c["script"] = None if sc is None else float(F["script_difficulty"].get(sc, 1.0))
    return c


def estimate(comp, weights):
    """Weighted mean over the observable components; weights of missing components are dropped."""
    num = den = 0.0
    for k, w in weights.items():
        v = comp.get(k)
        if v is not None:
            num += w * v
            den += w
    return (num / den) if den > 0 else None


# ------------------------------------------------------------------------------- runners
def _done_ids(out_path):
    done = set()
    if os.path.exists(out_path):
        with open(out_path, encoding="utf-8") as f:
            for ln in f:
                try:
                    done.add(json.loads(ln)["id"])
                except Exception:
                    pass
    return done


def run_aidp(corpus_dir, out_path):
    man = json.load(open(os.path.join(corpus_dir, "manifest.json"), encoding="utf-8"))
    done = _done_ids(out_path)
    tmp_parent = os.path.join(os.path.dirname(os.path.abspath(out_path)), "tmp-raster")
    os.makedirs(tmp_parent, exist_ok=True)
    todo = [d for d in man["docs"] if d["id"] not in done]
    print(f"aidp: {len(man['docs'])} docs, {len(done)} already done, {len(todo)} to go", flush=True)
    t0 = datetime.now()
    with open(out_path, "a", encoding="utf-8") as out:
        for i, d in enumerate(todo, 1):
            pdf = os.path.join(corpus_dir, d["file"])
            n_main = pdf_pages(pdf)
            n_att = sum(pdf_pages(os.path.join(corpus_dir, a["file"])) or 0 for a in d.get("attachments", []))
            tmpdir = tempfile.mkdtemp(dir=tmp_parent)
            try:
                imgs = rasterise(pdf, n_main, tmpdir)
            finally:
                shutil.rmtree(tmpdir, ignore_errors=True)
            pages = [page_features(g) for g in imgs]
            agg = aggregate_pages(pages)
            text = aidp_text_clean(open(os.path.join(corpus_dir, d["text"]), encoding="utf-8").read())
            ntok = count_tokens(text)
            total_pages = (n_main or 0) + n_att
            sc, sc_counts = script_class(text)
            rec = {"id": d["id"], "corpus": "AIDP-2K", "slug": d["slug"], "locale": d["locale"], "mode": d["mode"],
                   "dims": d["dims"], "pages": total_pages, "pages_main": n_main, "pages_attachments": n_att,
                   "pages_rasterised": len(imgs), "per_page": pages, **agg, "tokens": ntok,
                   "tokens_per_page": (ntok / total_pages) if total_pages else None,
                   "script_class": sc, "script_counts": sc_counts,
                   "pdf_font_count": pdf_font_count(pdf)}  # extra observable, NOT part of the estimator
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            out.flush()
            if i % 50 == 0 or i == len(todo):
                el = (datetime.now() - t0).total_seconds()
                print(f"  {i}/{len(todo)} in {el:.0f}s ({el / i:.2f}s/doc)", flush=True)


def run_items(items_path, out_path):
    """Public-corpus samples. Each input line: {id, corpus, images:[paths]|pdf:path, pages, text, ...}."""
    done = _done_ids(out_path)
    tmp_parent = os.path.join(os.path.dirname(os.path.abspath(out_path)), "tmp-raster")
    os.makedirs(tmp_parent, exist_ok=True)
    items = [json.loads(ln) for ln in open(items_path, encoding="utf-8") if ln.strip()]
    print(f"items: {len(items)} ({len(done)} already done)", flush=True)
    with open(out_path, "a", encoding="utf-8") as out:
        for it in items:
            if it["id"] in done:
                continue
            imgs, n_pages = [], it.get("pages")
            if it.get("pdf"):
                n_pdf = pdf_pages(it["pdf"])
                n_pages = n_pages or n_pdf
                tmpdir = tempfile.mkdtemp(dir=tmp_parent)
                try:
                    imgs = rasterise(it["pdf"], n_pdf, tmpdir)
                finally:
                    shutil.rmtree(tmpdir, ignore_errors=True)
            for p in (it.get("images") or [])[: FROZEN["max_pages_rasterised"]]:
                imgs.append(load_image_gray(p))
            pages = [page_features(g) for g in imgs]
            agg = aggregate_pages(pages)
            text = it.get("text")
            ntok = count_tokens(text) if text is not None else None
            sc, sc_counts = script_class(text) if text is not None else (None, {})
            rec = {"id": it["id"], "corpus": it["corpus"], "pages": n_pages, "pages_rasterised": len(imgs),
                   "per_page": pages, **agg, "tokens": ntok,
                   "tokens_per_page": (ntok / n_pages) if (ntok is not None and n_pages) else None,
                   "script_class": sc, "script_counts": sc_counts,
                   "meta": it.get("meta", {})}
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")
            out.flush()


def run_score(out_csv, feature_files):
    W1, W2 = FROZEN["weights_primary"], FROZEN["weights_visual"]
    A = FROZEN["analysis"]
    rows = []
    for fp in feature_files:
        for ln in open(fp, encoding="utf-8"):
            if not ln.strip():
                continue
            r = json.loads(ln)
            c = components(r)
            dims = r.get("dims") or {}
            noise = dims.get("noise")
            row = {
                "id": r["id"], "corpus": r["corpus"], "slug": r.get("slug", ""), "locale": r.get("locale", ""),
                "noise": noise or "", "noise_ordinal": A["noise_ordinal"].get(noise, "") if noise else "",
                "applied_rotation_deg": A["applied_rotation_deg"].get(noise, "") if noise else "",
                "scale": dims.get("scale", ""),
                **{k: ("" if not dims else int(bool(dims.get(k)))) for k in A["trap_dims"] + A["structural_dims"]},
                "pages": r.get("pages"), "pages_rasterised": r.get("pages_rasterised"),
                "blur_vl": r.get("blur_vl"), "contrast_spread": r.get("contrast_spread"),
                "skew_deg": r.get("skew_deg"), "tokens": r.get("tokens"), "tokens_per_page": r.get("tokens_per_page"),
                "script_class": r.get("script_class"),
                **{"c_" + k: c[k] for k in COMPONENTS},
                "components_observed": sum(1 for k in COMPONENTS if c[k] is not None),
                "estimate_primary": estimate(c, W1), "estimate_visual": estimate(c, W2),
                "pdf_image_only": ("" if r.get("pdf_font_count") is None else int(r["pdf_font_count"] == 0)),
            }
            rows.append(row)
    cols = list(rows[0].keys())
    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for row in rows:
            w.writerow({k: ("" if v is None else (round(v, 6) if isinstance(v, float) else v)) for k, v in row.items()})
    print(f"score: {len(rows)} rows -> {out_csv}")


# ------------------------------------------------------------------------------- self-test
def selftest():
    """Synthetic checks of the measuring code only (no corpus data): skew sign and size, blur, contrast."""
    rng = np.random.default_rng(1)
    page = np.full((1169, 827), 255, np.uint8)
    for y in range(80, 1100, 22):  # text-like lines of dark blocks
        x = 60
        while x < 760:
            wlen = int(rng.integers(15, 60))
            page[y:y + 9, x:min(x + wlen, 770)] = 25
            x += wlen + int(rng.integers(6, 12))
    ok = True
    for theta in [0.0, 0.4, 1.1, 2.2, -1.5, 4.0]:
        # OpenCV's positive angle is counter-clockwise (y down), so -theta rotates CLOCKWISE by theta.
        M = cv2.getRotationMatrix2D((827 / 2, 1169 / 2), -theta, 1.0)
        rot = cv2.warpAffine(page, M, (827, 1169), borderValue=255)
        a, n, pr = skew_deg(rot)
        good = a is not None and abs(a - theta) <= 0.1
        ok &= good
        print(f"  skew: applied {theta:+.2f} (clockwise), estimated {a:+.3f}, ink {n}, peak {pr}  {'ok' if good else 'FAIL'}")
    sharp = blur_vl(page)
    soft = blur_vl(cv2.GaussianBlur(page, (0, 0), 2.0))
    good = soft < sharp
    ok &= good
    print(f"  blur: sharp VL {sharp:.0f} > blurred VL {soft:.0f}  {'ok' if good else 'FAIL'}")
    low = (page.astype(np.float32) * 0.5 + 100).astype(np.uint8)
    good = contrast_spread(low) < contrast_spread(page)
    ok &= good
    print(f"  contrast: full {contrast_spread(page):.3f} > faded {contrast_spread(low):.3f}  {'ok' if good else 'FAIL'}")
    sc, _ = script_class("請求書 Invoice number INV-1 東京都 大阪市 株式会社 Widget Pro 2000 Cleaning Agent")
    good = sc == "cjk"
    ok &= good
    print(f"  script: mixed Japanese/Latin -> {sc}  {'ok' if good else 'FAIL'}")
    sample = "# --- | Page 1 | --- #\n| 請求書 | INV-1 | 9,636 |"
    n_tok = count_tokens(aidp_text_clean(sample))
    good = n_tok == 5  # 請 求 書 (one token per CJK character), INV-1, 9,636; markers and cell bars removed
    ok &= good
    print(f"  tokens: AIDP line with page marker and cell bars -> {n_tok}  {'ok' if good else 'FAIL'}")
    print("selftest:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def freeze(out_path):
    rec = {"frozen": FROZEN, "frozen_block_sha256": frozen_hash(),
           "written_ist": datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S IST"),
           "note": "Written before any feature was computed on any document and before any outcome was examined."}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(rec, f, indent=1)
    print(f"frozen config sha256 {rec['frozen_block_sha256']} at {rec['written_ist']} -> {out_path}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "selftest":
        sys.exit(selftest())
    elif cmd == "freeze":
        freeze(sys.argv[2])
    elif cmd == "aidp":
        run_aidp(sys.argv[2], sys.argv[3])
    elif cmd == "items":
        run_items(sys.argv[2], sys.argv[3])
    elif cmd == "score":
        run_score(sys.argv[2], sys.argv[3:])
    else:
        print(__doc__)
        sys.exit(2)
