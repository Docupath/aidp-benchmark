#!/usr/bin/env python3
"""
Statistics for the difficulty-estimator rebuild. Reads per-document.csv (written by `estimator.py score`)
and writes results.json. Uses only numpy; every random step is seeded from the frozen configuration.

  python -I analyze.py <per-document.csv> <frozen-config.json> <estimator.py> <results.json>

Plain-words glossary of the statistics used:
  Spearman rank correlation (rho)  Sort the documents by the estimate and, separately, by the declared
      noise grade; rho measures how well the two orderings agree: +1 identical, 0 unrelated, -1 reversed.
  95% bootstrap interval  Re-draw the documents with replacement 2,000 times and recompute; the middle
      95% of those recomputed values is the interval. It says how much the number could move by chance.
  AUROC  Pick one trap document and one clean document at random (here: of the same type, noise grade
      and size); AUROC is the chance the trap document has the higher value. 0.5 = the feature cannot
      tell them apart; 1.0 or 0.0 = it always can.
  Permutation p-value  Shuffle the trap/clean labels inside each matched group 2,000 times; p is the
      share of shuffles giving a gap at least as large as the real one. Small p = unlikely to be chance.
"""
import csv
import hashlib
import json
import os
import math
import sys
from collections import Counter, defaultdict

import numpy as np

FEATURES_TRAP = ["blur_vl", "contrast_spread", "abs_skew", "skew_deg", "pages", "tokens_per_page",
                 "c_script", "estimate_primary", "estimate_visual"]
COMPONENTS = ["c_blur", "c_contrast", "c_skew", "c_pages", "c_density", "c_script"]


# ------------------------------------------------------------------------------------- basics
def fnum(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except ValueError:
        return None


def rankdata(x):
    """Average ranks (ties share the mean of their positions), 1-based. Vectorised."""
    x = np.asarray(x, dtype=float)
    sorter = np.argsort(x, kind="mergesort")
    inv = np.empty(sorter.size, dtype=np.intp)
    inv[sorter] = np.arange(sorter.size)
    xs = x[sorter]
    obs = np.r_[True, xs[1:] != xs[:-1]]
    dense = obs.cumsum()[inv]
    count = np.r_[np.nonzero(obs)[0], len(obs)]
    return 0.5 * (count[dense] + count[dense - 1] + 1)


def pearson(a, b):
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    if len(a) < 3 or a.std() == 0 or b.std() == 0:
        return None
    return float(np.corrcoef(a, b)[0, 1])


def spearman(a, b):
    return pearson(rankdata(a), rankdata(b))


def boot_ci(stat_fn, n, rng, B, *arrays):
    vals = []
    for _ in range(B):
        idx = rng.integers(0, n, n)
        v = stat_fn(*[arr[idx] for arr in arrays])
        if v is not None and not math.isnan(v):
            vals.append(v)
    if not vals:
        return None
    return [float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))]


def r4(v):
    return None if v is None else round(float(v), 4)


# ------------------------------------------------------------------------------------- frozen check
def check_frozen(frozen_path, estimator_path):
    rec = json.load(open(frozen_path, encoding="utf-8"))
    src = open(estimator_path, encoding="utf-8").read()
    block = src.split("# --- FROZEN-BEGIN ---", 1)[1].split("# --- FROZEN-END ---", 1)[0]
    h = hashlib.sha256(block.encode("utf-8")).hexdigest()
    if h != rec["frozen_block_sha256"]:
        sys.exit(f"REFUSING: frozen block changed ({h} != {rec['frozen_block_sha256']})")
    return rec


# ------------------------------------------------------------------------------------- noise grade
def noise_tracking(rows, A, rng):
    B = A["bootstrap_resamples"]
    keep = [r for r in rows if fnum(r["estimate_primary"]) is not None]
    y = np.array([fnum(r["noise_ordinal"]) for r in keep])
    out = {"n": len(keep), "grade_counts": dict(Counter(r["noise"] for r in keep))}
    for est in ["estimate_primary", "estimate_visual"]:
        x = np.array([fnum(r[est]) for r in keep])
        rho = spearman(x, y)
        ci = boot_ci(spearman, len(x), rng, B, x, y)
        by_grade = {}
        for g, k in sorted(A["noise_ordinal"].items(), key=lambda t: t[1]):
            xs = x[y == k]
            by_grade[g] = {"n": int(xs.size), "mean": r4(xs.mean()), "median": r4(np.median(xs)),
                           "p25": r4(np.percentile(xs, 25)), "p75": r4(np.percentile(xs, 75))}
        per_type = {}
        for slug in sorted({r["slug"] for r in keep}):
            m = np.array([r["slug"] == slug for r in keep])
            per_type[slug] = {"n": int(m.sum()), "rho": r4(spearman(x[m], y[m]))}
        out[est] = {"rho": r4(rho), "ci95": [r4(c) for c in ci], "by_grade": by_grade, "per_type": per_type}
    comp = {}
    for c in COMPONENTS + ["blur_vl", "contrast_spread", "abs_skew", "pages", "tokens_per_page"]:
        pairs = [(fnum(r[c]), fnum(r["noise_ordinal"])) for r in rows if fnum(r[c]) is not None]
        if len(pairs) < 3:
            comp[c] = {"n": len(pairs), "rho": None}
            continue
        xa = np.array([p[0] for p in pairs])
        ya = np.array([p[1] for p in pairs])
        comp[c] = {"n": len(pairs), "rho": r4(spearman(xa, ya)),
                   "ci95": [r4(v) for v in (boot_ci(spearman, len(xa), rng, B, xa, ya) or [None, None])],
                   "distinct_values": int(len(set(xa.tolist())))}
    out["components_diagnostic"] = comp
    return out, keep


def subsample16(keep, A, rng, est, paper_value=0.609):
    """How variable is a rank correlation measured on only 16 documents?"""
    x = np.array([fnum(r[est]) for r in keep])
    y = np.array([fnum(r["noise_ordinal"]) for r in keep])
    n, D, k = len(x), A["subsample_draws"], A["subsample_n"]
    res = {}
    vals = []
    for _ in range(D):
        idx = rng.choice(n, k, replace=False)
        v = spearman(x[idx], y[idx])
        if v is not None:
            vals.append(v)
    vals = np.array(vals)
    res["random_16"] = {"draws": int(vals.size), "median": r4(np.median(vals)), "p2_5": r4(np.percentile(vals, 2.5)),
                        "p97_5": r4(np.percentile(vals, 97.5)), "share_at_or_above_0_609": r4((vals >= paper_value).mean())}
    by = {g: np.where(y == g)[0] for g in sorted(set(y.tolist()))}
    vals = []
    for _ in range(D):
        idx = np.concatenate([rng.choice(by[g], k // len(by), replace=False) for g in by])
        v = spearman(x[idx], y[idx])
        if v is not None:
            vals.append(v)
    vals = np.array(vals)
    res["stratified_4_per_grade"] = {"draws": int(vals.size), "median": r4(np.median(vals)),
                                     "p2_5": r4(np.percentile(vals, 2.5)), "p97_5": r4(np.percentile(vals, 97.5)),
                                     "share_at_or_above_0_609": r4((vals >= paper_value).mean())}
    return res


# ------------------------------------------------------------------------------------- skew recovery
def skew_recovery(rows, A, rng):
    B = A["bootstrap_resamples"]
    rot = A["applied_rotation_deg"]
    have = [r for r in rows if fnum(r["skew_deg"]) is not None]
    out = {"n_documents": len(rows), "n_skew_observed": len(have), "n_skew_missing": len(rows) - len(have),
           "sign_convention": "positive = clockwise as seen on screen, the sign of CSS rotate()", "by_grade": {}}
    est = np.array([fnum(r["skew_deg"]) for r in have])
    app = np.array([fnum(r["applied_rotation_deg"]) for r in have])
    for g in sorted(rot, key=lambda k: rot[k]):
        m = app == rot[g]
        e = est[m]
        if e.size == 0:
            continue
        err = e - rot[g]
        med_ci = boot_ci(lambda a: float(np.median(a)), e.size, rng, B, e)
        out["by_grade"][g] = {
            "applied_deg": rot[g], "n": int(e.size), "median_est_deg": r4(np.median(e)),
            "median_ci95": [r4(c) for c in med_ci], "mean_est_deg": r4(e.mean()), "sd_deg": r4(e.std(ddof=1)),
            "p25": r4(np.percentile(e, 25)), "p75": r4(np.percentile(e, 75)),
            "mae_deg": r4(np.abs(err).mean()), "within_0_1_deg": r4((np.abs(err) <= 0.1).mean()),
            "within_0_25_deg": r4((np.abs(err) <= 0.25).mean()),
            "sign_matches": r4((np.sign(e) == np.sign(rot[g])).mean()) if rot[g] != 0 else None,
            "abs_over_1_deg": r4((np.abs(e) > 1.0).mean()),
        }
    out["overall"] = {"pearson_r": r4(pearson(est, app)), "spearman_rho": r4(spearman(est, app)),
                      "mae_deg": r4(np.abs(est - app).mean()),
                      "ols_slope": r4(np.polyfit(app, est, 1)[0]), "ols_intercept": r4(np.polyfit(app, est, 1)[1])}
    # nearest-grade classification from the estimated angle (precision/recall for heavy)
    levels = np.array(sorted(rot.values()))
    pred = levels[np.argmin(np.abs(np.abs(est)[:, None] - levels[None, :]), axis=1)]
    out["nearest_angle_grade_accuracy"] = r4((pred == app).mean())
    tp = int(((pred == 2.2) & (app == 2.2)).sum())
    out["heavy_detection"] = {"rule": "estimated |angle| nearest to 2.2 among 0 / 0.4 / 1.1 / 2.2",
                              "precision": r4(tp / max(1, int((pred == 2.2).sum()))),
                              "recall": r4(tp / max(1, int((app == 2.2).sum()))), "true_positives": tp}
    conf = defaultdict(Counter)
    for a_, p_ in zip(app, pred):
        conf[str(a_)][str(p_)] += 1
    out["confusion_applied_to_nearest"] = {k: dict(v) for k, v in conf.items()}
    return out


# ------------------------------------------------------------------------------------- traps
def stratified_auroc_from_ranks(strata):
    """strata: list of (values_trap, values_control). AUROC = sum_s U_s / n_c,s  /  sum_s k_s."""
    num = den = 0.0
    for vt, vc in strata:
        k, m = len(vt), len(vc)
        if k == 0 or m == 0:
            continue
        r = rankdata(np.concatenate([vt, vc]))
        U = r[:k].sum() - k * (k + 1) / 2.0
        num += U / m
        den += k
    return num / den if den else None


def trap_tests(rows, A, rng):
    B, P, alpha = A["bootstrap_resamples"], A["permutations"], A["alpha"]
    dims_all = A["trap_dims"] + A["structural_dims"]
    for r in rows:
        r["abs_skew"] = None if fnum(r["skew_deg"]) is None else abs(fnum(r["skew_deg"]))

    def flag(r, d):
        return str(r.get(d, "0")) == "1"

    clean = [r for r in rows if not any(flag(r, d) for d in dims_all)]
    key = lambda r: tuple(r[k] for k in A["match_on"])  # noqa: E731
    pool = defaultdict(list)
    for r in clean:
        pool[key(r)].append(r)
    groups = {d: [d] for d in dims_all}
    groups["anyTrap"] = A["trap_dims"]
    out = {"definition": {
        "trap_documents": "carry the named defect and NO other of the five generator dimensions "
                          "(anyTrap: at least one of mismatch / missingTotals / stickerMismatch and no cover page or bundle)",
        "controls": "documents with none of the five dimensions, of the same type, noise grade and size",
        "statistic": "stratified AUROC (chance a trap document exceeds a matched control; 0.5 = indistinguishable)",
        "ci": f"{B} bootstrap resamples within strata", "p": f"{P} within-stratum label permutations, two-sided",
        "verdict_rule": "indistinguishable = 95% CI contains 0.5 AND Holm-adjusted p >= 0.05"}}
    for name, dset in groups.items():
        others = [d for d in dims_all if d not in dset]
        traps = [r for r in rows if any(flag(r, d) for d in dset) and not any(flag(r, d) for d in others)]
        excluded = sum(1 for r in rows if any(flag(r, d) for d in dset)) - len(traps)
        strata_t = defaultdict(list)
        for r in traps:
            strata_t[key(r)].append(r)
        matched = {s: (ts, pool[s]) for s, ts in strata_t.items() if pool.get(s)}
        n_t = sum(len(ts) for ts, _ in matched.values())
        n_c = sum(len(cs) for _, cs in matched.values())
        res = {"n_with_dimension": len(traps) + excluded, "n_excluded_other_dimension": excluded,
               "n_trap_matched": n_t, "n_trap_unmatched": len(traps) - n_t, "n_controls": n_c,
               "n_strata": len(matched), "features": {}}
        pvals = {}
        for f in FEATURES_TRAP:
            strata = []
            tvals_all, cmeans = [], []
            for ts, cs in matched.values():
                vt = np.array([fnum(r[f]) for r in ts if fnum(r[f]) is not None])
                vc = np.array([fnum(r[f]) for r in cs if fnum(r[f]) is not None])
                if vt.size and vc.size:
                    strata.append((vt, vc))
                    tvals_all.extend(vt.tolist())
                    cmeans.extend([vc.mean()] * vt.size)
            if not strata:
                res["features"][f] = {"n_trap": 0}
                continue
            auc = stratified_auroc_from_ranks(strata)
            den = float(sum(vt.size for vt, _ in strata))
            boot_num = np.zeros(B)
            perm_num = np.zeros(P)
            for vt, vc in strata:
                k, m = vt.size, vc.size
                # bootstrap: resample trap and control documents within the stratum (vectorised over B)
                a = vt[rng.integers(0, k, (B, k))][:, :, None]
                b = vc[rng.integers(0, m, (B, m))][:, None, :]
                boot_num += ((a > b).sum(axis=(1, 2)) + 0.5 * (a == b).sum(axis=(1, 2))) / m
                # permutation: ranks do not change when labels are shuffled, so a shuffled U is the
                # rank sum of k randomly chosen members of the stratum
                r = rankdata(np.concatenate([vt, vc]))
                pick = np.argsort(rng.random((P, k + m)), axis=1)[:, :k]
                perm_num += (r[pick].sum(axis=1) - k * (k + 1) / 2.0) / m
            boots, perms = boot_num / den, perm_num / den
            ci = [float(np.percentile(boots, 2.5)), float(np.percentile(boots, 97.5))]
            extreme = int((np.abs(perms - 0.5) >= abs(auc - 0.5) - 1e-12).sum())
            p = (1 + extreme) / (1 + P)
            allv = [np.concatenate([vt, vc]) for vt, vc in strata]
            ks = [vt.size for vt, _ in strata]
            pvals[f] = p
            res["features"][f] = {"n_trap": int(sum(ks)), "n_control": int(sum(v.size - k for v, k in zip(allv, ks))),
                                  "auroc": r4(auc), "ci95": [r4(c) for c in ci], "p_perm": r4(p),
                                  "trap_mean": r4(np.mean(tvals_all)), "matched_control_mean": r4(np.mean(cmeans))}
        # Holm adjustment across the features of this group
        order = sorted(pvals, key=lambda k: pvals[k])
        m = len(order)
        running = 0.0
        for i, f in enumerate(order):
            adj = min(1.0, (m - i) * pvals[f])
            running = max(running, adj)
            res["features"][f]["p_holm"] = r4(running)
        for f, v in res["features"].items():
            if "auroc" in v:
                lo, hi = v["ci95"]
                v["indistinguishable"] = bool(lo <= 0.5 <= hi and v["p_holm"] >= alpha)
        res["indistinguishable_on_every_feature"] = all(v.get("indistinguishable", True) for v in res["features"].values())
        out[name] = res
    return out


# ------------------------------------------------------------------------------------- corpora
def corpus_profiles(rows, A, rng):
    B = A["bootstrap_resamples"]
    by = defaultdict(list)
    for r in rows:
        by[r["corpus"]].append(r)
    out = {}
    for corpus, rs in sorted(by.items()):
        est = np.array([fnum(r["estimate_primary"]) for r in rs if fnum(r["estimate_primary"]) is not None])
        comps = {}
        for c in COMPONENTS:
            vals = [fnum(r[c]) for r in rs if fnum(r[c]) is not None]
            comps[c] = {"observed_in": len(vals), "sd": r4(np.std(vals)) if vals else None,
                        "mean": r4(np.mean(vals)) if vals else None, "distinct": len(set(vals))}
        # share of the estimate's variance that one component alone explains (squared correlation)
        r2 = {}
        for c in COMPONENTS:
            pairs = [(fnum(r["estimate_primary"]), fnum(r[c])) for r in rs
                     if fnum(r[c]) is not None and fnum(r["estimate_primary"]) is not None]
            if len(pairs) >= 3:
                pr = pearson([p[0] for p in pairs], [p[1] for p in pairs])
                r2[c] = None if pr is None else r4(pr * pr)
        best = max(((v, k) for k, v in r2.items() if v is not None), default=(None, None))
        r2v = {}
        for c in ("c_blur", "c_contrast", "c_skew"):
            pairs = [(fnum(r["estimate_visual"]), fnum(r[c])) for r in rs
                     if fnum(r[c]) is not None and fnum(r["estimate_visual"]) is not None]
            if len(pairs) >= 3:
                pr = pearson([p[0] for p in pairs], [p[1] for p in pairs])
                r2v[c] = None if pr is None else r4(pr * pr)
        best_v = max(((v, k) for k, v in r2v.items() if v is not None), default=(None, None))
        sd = float(est.std()) if est.size else None
        med_ci = boot_ci(lambda a: float(np.median(a)), est.size, rng, B, est) if est.size else None
        sc = Counter(r["script_class"] or "none" for r in rs)
        vis = np.array([fnum(r["estimate_visual"]) for r in rs if fnum(r["estimate_visual"]) is not None])
        vis_ci = boot_ci(lambda a: float(np.median(a)), vis.size, rng, B, vis) if vis.size else None
        out[corpus] = {
            "visual_estimate_median": r4(np.median(vis)) if vis.size else None,
            "visual_estimate_median_ci95": [r4(c) for c in vis_ci] if vis_ci else None,
            "visual_estimate_sd": r4(vis.std()) if vis.size else None,
            "visual_near_constant": bool(vis.size and vis.std() < A["near_constant_sd"]),
            "visual_dominant_component": best_v[1], "visual_dominant_r2": best_v[0],
            "visual_single_component": bool(best_v[0] is not None and best_v[0] >= A["single_component_r2"]),
            "visual_share_at_floor": r4((vis <= 0.01).mean()) if vis.size else None,
            "n": len(rs), "estimate_median": r4(np.median(est)) if est.size else None,
            "estimate_median_ci95": [r4(c) for c in med_ci] if med_ci else None,
            "estimate_mean": r4(est.mean()) if est.size else None, "estimate_sd": r4(sd),
            "estimate_p25": r4(np.percentile(est, 25)) if est.size else None,
            "estimate_p75": r4(np.percentile(est, 75)) if est.size else None,
            "components_observed_median": r4(np.median([int(r["components_observed"]) for r in rs])),
            "components_varying": [c for c, v in comps.items() if v["sd"] is not None and v["sd"] > A["near_constant_sd"]],
            "components": comps, "r2_by_single_component": r2,
            "dominant_component": best[1], "dominant_r2": best[0],
            "near_constant": bool(sd is not None and sd < A["near_constant_sd"]),
            "single_component": bool(best[0] is not None and best[0] >= A["single_component_r2"]),
            "script_classes": dict(sc),
            "pages_median": r4(np.median([fnum(r["pages"]) for r in rs if fnum(r["pages"]) is not None])),
        }
    return out


def omnidoc_script(rows, public_feature_path):
    """Did the script component find OmniDocBench's Chinese pages without being told?"""
    lang = {}
    for ln in open(public_feature_path, encoding="utf-8"):
        rec = json.loads(ln)
        if rec["corpus"] == "OmniDocBench":
            lang[rec["id"]] = (rec.get("meta") or {}).get("language")
    if not any(lang.values()):
        # The published public-features.jsonl carries no OmniDocBench page labels (they are that dataset's own
        # annotation); fetch_public.py fetches them again. Without them there is nothing to compare.
        return None
    tab = defaultdict(Counter)
    for r in rows:
        if r["corpus"] == "OmniDocBench":
            tab[str(lang.get(r["id"]))][r["script_class"] or "none"] += 1
    return {k: dict(v) for k, v in tab.items()}


def aidp_script_check(rows):
    tab = defaultdict(Counter)
    for r in rows:
        tab[r["locale"]][r["script_class"] or "none"] += 1
    return {k: dict(v) for k, v in sorted(tab.items())}


def raw_by_grade(rows, A):
    out = {}
    for g, k in sorted(A["noise_ordinal"].items(), key=lambda t: t[1]):
        rs = [r for r in rows if r["noise"] == g]
        out[g] = {"n": len(rs)}
        for f in ["blur_vl", "contrast_spread", "skew_deg", "pages", "tokens_per_page"]:
            v = np.array([fnum(r[f]) for r in rs if fnum(r[f]) is not None])
            out[g][f] = {"median": r4(np.median(v)), "p25": r4(np.percentile(v, 25)), "p75": r4(np.percentile(v, 75))}
    return out


def image_only(rows):
    tab = defaultdict(Counter)
    for r in rows:
        tab[r["noise"]]["image_only" if str(r["pdf_image_only"]) == "1" else "has_text_layer"] += 1
    return {k: dict(v) for k, v in tab.items()}


def main():
    csv_path, frozen_path, est_path, out_path = sys.argv[1:5]
    public_features = sys.argv[5] if len(sys.argv) > 5 else None
    rec = check_frozen(frozen_path, est_path)
    A = rec["frozen"]["analysis"]
    rng = np.random.default_rng(A["seed"])
    rows = list(csv.DictReader(open(csv_path, encoding="utf-8")))
    aidp = [r for r in rows if r["corpus"] == "AIDP-2K"]
    for r in rows:
        r["abs_skew"] = None if fnum(r["skew_deg"]) is None else abs(fnum(r["skew_deg"]))
    results = {"frozen_block_sha256": rec["frozen_block_sha256"], "frozen_written": rec["written_ist"],
               "weights_primary": rec["frozen"]["weights_primary"], "weights_visual": rec["frozen"]["weights_visual"]}
    nt, keep = noise_tracking(aidp, A, rng)
    results["aidp_noise_grade"] = nt
    results["aidp_noise_grade"]["subsample_16_primary"] = subsample16(keep, A, rng, "estimate_primary")
    results["aidp_noise_grade"]["subsample_16_visual"] = subsample16(keep, A, rng, "estimate_visual")
    results["aidp_skew_recovery"] = skew_recovery(aidp, A, rng)
    results["aidp_traps_vs_matched_controls"] = trap_tests(aidp, A, rng)
    results["aidp_pdf_text_layer_by_grade"] = image_only(aidp)
    results["aidp_raw_features_by_grade"] = raw_by_grade(aidp, A)
    results["aidp_script_class_by_locale"] = aidp_script_check(aidp)
    results["corpus_profiles"] = corpus_profiles(rows, A, rng)
    if public_features:
        check = omnidoc_script(rows, public_features)
        if check is not None:
            results["omnidocbench_script_vs_language_label"] = check
        else:
            print("OmniDocBench page labels absent (run fetch_public.py): the stored script check is kept")
            results["omnidocbench_script_vs_language_label"] = json.load(open(out_path, encoding="utf-8"))["omnidocbench_script_vs_language_label"] if os.path.exists(out_path) else None
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=1, ensure_ascii=False)
    print(f"results -> {out_path}")


if __name__ == "__main__":
    main()
