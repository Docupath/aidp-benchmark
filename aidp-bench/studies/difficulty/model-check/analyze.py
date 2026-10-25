"""Model check, analysis: the model's answers through the study's own statistic.

usage: <study venv python> d7_analyze.py <study dir> <model run dir> <out json>

The planted-problem documents and their matched clean controls are chosen exactly as the study chooses them
(analyze.trap_tests: same type, noise grade and size; controls carry none of the five generator dimensions),
and each model answer becomes a feature beside the study's own six measurements. The statistic is the study's
stratified AUROC with its bootstrap range, permutation p-value and Holm adjustment, under the study's frozen
analysis settings and seed. The same function is run on the study's own estimates for the same documents, so
the two can be read side by side.
"""
import csv
import json
import os
import sys

import numpy as np

STUDY, RUN, OUT = sys.argv[1:4]
sys.path.insert(0, STUDY)
import analyze  # noqa: E402  (the study's own code, unchanged)

A = json.load(open(os.path.join(STUDY, 'frozen-config.json')))['frozen']['analysis']
rows = [r for r in csv.DictReader(open(os.path.join(STUDY, 'per-document.csv'))) if r['corpus'] == 'AIDP-2K']
answers = {}
for f in os.listdir(os.path.join(RUN, 'answers')):
    rec = json.load(open(os.path.join(RUN, 'answers', f)))
    if rec.get('ok'):
        answers[rec['id']] = rec['answer']
MODEL_FEATURES = {
    'model_difficulty': 'difficulty',
    'model_totals_disagree': 'totals_disagree_probability',
    'model_totals_missing': 'totals_missing_probability',
    'model_sticker_disagrees': 'sticker_disagrees_probability',
    'model_any_problem': 'any_problem_probability',
}
for r in rows:
    a = answers.get(r['id'])
    for col, key in MODEL_FEATURES.items():
        r[col] = '' if a is None else str(a.get(key))
answered = [r for r in rows if r['id'] in answers]

analyze.FEATURES_TRAP = list(MODEL_FEATURES) + ['estimate_primary', 'estimate_visual']
rng = np.random.default_rng(A['seed'])
traps = analyze.trap_tests(answered, A, rng)

# Rank correlation with the declared noise grade, on the same documents, for the model's rating and the study's
# visual estimate.
noise = np.array([float(r['noise_ordinal']) for r in answered])
def spearman(col):
    v = np.array([float(r[col]) for r in answered])
    return round(float(analyze.spearman(v, noise)), 4)

out = {
    'documents_answered': len(answers),
    'spearman_with_noise_grade': {'model_difficulty': spearman('model_difficulty'), 'estimate_visual': spearman('estimate_visual'),
                                  'estimate_primary': spearman('estimate_primary')},
    'traps_vs_matched_controls': traps,
}
json.dump(out, open(OUT, 'w'), indent=1)
for name in ('mismatch', 'missingTotals', 'stickerMismatch', 'anyTrap'):
    g = traps.get(name, {})
    print(name, 'traps', g.get('n_trap_matched'), 'controls', g.get('n_controls'))
    for f in analyze.FEATURES_TRAP:
        x = g.get('features', {}).get(f, {})
        print(f'   {f:26s} AUROC {x.get("auroc")} {x.get("ci95")} p_holm {x.get("p_holm")}')
print('spearman with noise grade', out['spearman_with_noise_grade'])
