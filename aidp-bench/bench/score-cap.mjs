/**
 * AIDP-CAP scorer: the eighteen measures of the capability set, and the AIDP Score over every score-bearing measure
 * of AIDP v1.0, AIDP-2K's thirteen and AIDP-CAP's eighteen.
 *
 *   node bench/score-cap.mjs --corpus <AIDP-CAP dir> --main <run dir> --split <run dir> --contract <run dir>
 *        --rules <run dir> --board <AIDP-2K scoreboard.json> --out <dir> [--resamples 2000]
 *
 * Every measure is a share between 0 and 1. Most are passes over checks, pooled over every unit of the measure;
 * Instructions averages its seven instructions, each pooled, so no instruction weighs more for having more targets;
 * Calibration is one minus the calibration error, and the discrimination of right from wrong values. AIDP-CAP holds the
 * same number of documents of each of its six types, so pooling counts each type by how much of the capability it
 * carries. A lane that failed passes nothing and is charged every check a complete answer would have produced (section
 * 5.7). No output is changed: the scorer reads what the runner kept. The definitions are the specification's (section
 * 5.8), written here once.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { scoreFields, fieldKind, isPlainNumber, normNum } from './base-score.mjs';
import { splitReading, pagesOf } from './post-run/lib.mjs';
import { judgeDocument } from './post-run/reading-order.mjs';
import { applicablePacks, adheres, leaves as leavesOf } from './rule-packs-cap.mjs';
import { CUSTOMER_CONTRACT } from './cap-customer.mjs';
import { MEASURES as MEASURES_2K, unitsOf, measure as measure2k, weightsFor } from './aidp-score.mjs';
import { mulberry32, hashSeed } from '../corpus-gen/rng.mjs';

// -------------------------------------------------------------------------------------------------
// the measures
// -------------------------------------------------------------------------------------------------
export const CAP_MEASURES = [
  { id: 'cap.intake', label: 'Intake, pages read', capability: 'Intake', layer: 'read', agg: 'pooled', unit: 'pages that needed converting or could be dropped, and as many ordinary pages' },
  { id: 'cap.marks', label: 'Handwriting and stamps, marks read', capability: 'Handwriting and stamps', layer: 'read', agg: 'pooled', unit: 'marks, and one unmarked control page each' },
  { id: 'cap.barcodes', label: 'Barcodes, symbols decoded', capability: 'Barcodes', layer: 'read', agg: 'pooled', unit: 'barcode symbols printed whole' },
  { id: 'cap.reading_order', label: 'Reading order, rows read in order', capability: 'Reading order', layer: 'read', agg: 'pooled', unit: 'table rows' },
  { id: 'cap.legibility', label: 'Legibility, unreadable values declared', capability: 'Legibility', layer: 'read', agg: 'pooled', unit: 'values made unreadable, and one readable control each' },
  { id: 'cap.segmentation', label: 'Segmentation, documents cut out exactly', capability: 'Segmentation', layer: 'capture', agg: 'pooled', unit: 'documents inside files' },
  { id: 'cap.parsing', label: 'Parsing, parts in their own field', capability: 'Parsing', layer: 'understand', agg: 'pooled', unit: 'parts of values printed together' },
  { id: 'cap.decoding', label: 'Decoding, label fields on the right line', capability: 'Decoding', layer: 'understand', agg: 'pooled', unit: 'lot and serial numbers printed only on a line\'s label' },
  { id: 'cap.computation', label: 'Computation, implied values computed and shown', capability: 'Computation', layer: 'understand', agg: 'pooled', unit: 'values the page implies' },
  { id: 'cap.consistency_flags', label: 'Consistency, contradictions flagged', capability: 'Consistency', layer: 'understand', agg: 'pooled', unit: 'documents with a printed contradiction, and as many clean controls' },
  { id: 'cap.resolution', label: 'Resolution, supplier identified', capability: 'Resolution', layer: 'reason', agg: 'pooled', unit: 'documents' },
  { id: 'cap.adherence', label: 'Instructions, adherence', capability: 'Instructions', layer: 'reason', agg: 'packs', unit: 'instruction targets, each instruction counting equally' },
  { id: 'cap.containment', label: 'Instructions, containment', capability: 'Instructions', layer: 'reason', agg: 'packs', unit: 'values outside each instruction\'s scope, each instruction counting equally' },
  { id: 'cap.contract', label: 'Contract, customer contract', capability: 'Contract', layer: 'reason', agg: 'pooled', unit: 'schema and format checks' },
  { id: 'cap.traceability', label: 'Traceability, value located on the page', capability: 'Traceability', layer: 'trust', agg: 'pooled', unit: 'values the page prints legibly, and values it implies' },
  { id: 'cap.calibration_error', label: 'Calibration, one minus calibration error', capability: 'Calibration', layer: 'trust', agg: 'ece', unit: 'header values returned' },
  { id: 'cap.calibration_discrimination', label: 'Calibration, discrimination', capability: 'Calibration', layer: 'trust', agg: 'auroc', unit: 'pairs of a right and a wrong header value' },
  { id: 'cap.anomaly', label: 'Anomaly detection, cases handled right', capability: 'Anomaly detection', layer: 'trust', agg: 'pooled', unit: 'anomaly cases, and as many clean controls' },
];
/** AIDP-2K's measures that stay in the score: all but the three proxies, which AIDP-CAP measures in full. */
export const RETIRED_PROXIES = ['understand.decoding', 'reason.contract', 'trust.provenance'];
export const KEPT_2K = MEASURES_2K.filter((m) => !RETIRED_PROXIES.includes(m.id));
export const LAYERS_V1 = [
  { key: 'read', name: 'Read', measures: ['read.words', 'read.numbers', 'cap.intake', 'cap.marks', 'cap.barcodes', 'cap.reading_order', 'cap.legibility'] },
  { key: 'capture', name: 'Capture', measures: ['capture.identification', 'cap.segmentation', 'capture.rows_recall', 'capture.rows_precision', 'capture.completeness', 'capture.fidelity', 'capture.restraint'] },
  { key: 'understand', name: 'Understand', measures: ['understand.dates', 'understand.numbers', 'understand.codes', 'cap.parsing', 'cap.decoding', 'cap.computation', 'understand.consistency', 'cap.consistency_flags'] },
  { key: 'reason', name: 'Reason', measures: ['cap.resolution', 'cap.adherence', 'cap.containment', 'cap.contract'] },
  { key: 'trust', name: 'Trust', measures: ['trust.stability', 'cap.traceability', 'cap.calibration_error', 'cap.calibration_discrimination', 'cap.anomaly'] },
];

// -------------------------------------------------------------------------------------------------
// shared helpers
// -------------------------------------------------------------------------------------------------
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const filled = (v) => v != null && !(typeof v === 'string' && v.trim() === '') && !(Array.isArray(v) && v.length === 0);
const getPath = (obj, p) => String(p).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function setPathIn(o, p, v) { const ks = String(p).split('.'); let x = o; for (let i = 0; i < ks.length - 1; i++) { x = x?.[/^\d+$/.test(ks[i]) ? Number(ks[i]) : ks[i]]; if (x == null) return; } x[ks.at(-1)] = v; }
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const CJK_OR_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu;
/** Words and numbers, lower case, Japanese and Chinese split into single characters (they print no spaces). */
export function tokens(text) {
  const out = [];
  for (const m of String(text ?? '').normalize('NFKC').toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    const t = m[0];
    // each Japanese or Chinese character is a word of its own, and a run of anything else in it stays whole: the
    // "10" of 消費税10% is one number, not a "1" and a "0"
    if (CJK.test(t)) for (const p of t.matchAll(CJK_OR_RUN)) out.push(p[0]); else out.push(t);
  }
  return out;
}
function recall(want, have) {
  if (!want.length) return null;
  const bag = new Map();
  for (const t of have) bag.set(t, (bag.get(t) ?? 0) + 1);
  let hit = 0;
  for (const t of want) { const c = bag.get(t) ?? 0; if (c) { hit++; bag.set(t, c - 1); } }
  return hit / want.length;
}
/** Letters and digits only, accents removed, lower case: how a mark's words are compared with what was read. */
export const compact = (s) => String(s ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
/** Whether `needle` occurs in `hay` with at most `k` edits (approximate substring match, Sellers' algorithm). */
export function nearIn(needle, hay, k) {
  const m = needle.length;
  if (!m) return false;
  if (hay.includes(needle)) return true;
  let prev = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= hay.length; j++) {
    const cur = [0];
    for (let i = 1; i <= m; i++) cur[i] = Math.min(prev[i] + 1, cur[i - 1] + 1, prev[i - 1] + (needle[i - 1] === hay[j - 1] ? 0 : 1));
    if (cur[m] <= k) return true;
    prev = cur;
  }
  return false;
}
/** The reference comparison of one value with its key (base-score.mjs): correct, normalized, wrong, missing, spurious. */
export function judge(field, gv, ov) {
  const v = scoreFields({ S: { [field]: gv ?? '' } }, { S: { [field]: ov ?? '' } })[0];
  return v ? v.verdict : 'empty';
}
const right = (verdict) => verdict === 'correct' || verdict === 'normalized';
const norm = (s) => String(s ?? '').trim().toUpperCase();

/**
 * Which returned line item is which line of the key: by article number and name, then article number, then name and
 * quantity, then quantity and price, and last by position. A key line no returned line fits is left unplaced.
 */
export function alignRows(gtItems = [], outItems = []) {
  const sq = (v) => compact(v);
  const keys = [
    (r) => (sq(r?.['Article ID']) && sq(r?.['Article Name']) ? `${sq(r['Article ID'])}|${sq(r['Article Name'])}` : null),
    (r) => (sq(r?.['Article ID']) ? sq(r['Article ID']) : null),
    (r) => (sq(r?.['Article Name']) && sq(r?.Quantity) ? `${sq(r['Article Name'])}|${normNum(r.Quantity)}` : null),
    (r) => (r?.Quantity && r?.['Unit Price'] ? `${normNum(r.Quantity)}|${normNum(r['Unit Price'])}` : null),
  ];
  const map = new Array(gtItems.length).fill(-1);
  const used = new Set();
  for (const key of keys) {
    const idx = new Map();
    outItems.forEach((o, oi) => { if (used.has(oi)) return; const k = key(o); if (k) { if (!idx.has(k)) idx.set(k, []); idx.get(k).push(oi); } });
    gtItems.forEach((g, gi) => {
      if (map[gi] >= 0) return;
      const k = key(g);
      const c = k ? (idx.get(k) ?? []).filter((oi) => !used.has(oi)) : [];
      if (c.length) { map[gi] = c[0]; used.add(c[0]); }
    });
  }
  gtItems.forEach((_, gi) => { if (map[gi] < 0 && gi < outItems.length && !used.has(gi)) { map[gi] = gi; used.add(gi); } });
  return map;
}
/** A key path in the output's rows; null when the line was not placed. */
export function outPath(p, rowMap) {
  const m = String(p).match(/^Items\.(\d+)\.(.+)$/);
  if (!m) return p;
  const j = rowMap?.[Number(m[1])];
  return j == null || j < 0 ? null : `Items.${j}.${m[2]}`;
}
const unit = () => ({ p: 0, n: 0, items: [] });
const add = (u, pass, item) => { u.n++; if (pass) u.p++; if (item && u.items.length < 400) u.items.push({ ...item, pass: !!pass }); };
const charge = (u, k, item) => { for (let i = 0; i < k; i++) add(u, false, i === 0 ? item : null); };

// -------------------------------------------------------------------------------------------------
// Read
// -------------------------------------------------------------------------------------------------
const RTL_SCRIPT = /[\p{Script=Arabic}\p{Script=Hebrew}]/u;
/** A page's own words, as its PDF hands them back. A PDF hands back words in a right-to-left script in visual order
 *  and broken into pieces, so they are left out, and such a page is judged by its numbers and its other words. */
export const pageTokens = (text) => tokens(text).filter((t) => !RTL_SCRIPT.test(t));
/** Intake: a page is read when its words and numbers are at least half present in the reading page matched to it. Every
 *  page of every file that arrived (the document and its attachments) is matched one to one with the pages of the
 *  reading (main part and attachments together, however the reading numbers or orders them), best pairs first, so a
 *  page the reading dropped has no reading page of its own and is not read, however much it resembles another page.
 *  Returns the verdict of every page; the measure keeps the pages that needed converting or could be dropped (an
 *  attachment's, a scanned file's, a page fed upside down) and as many ordinary pages (scoreCap). */
export function intakePages(key, map, raw) {
  const { main, attachments } = splitReading(raw?.ok ? raw.ocr_text : '');
  const read = [...pagesOf(main), ...attachments.flatMap((a) => pagesOf(a))].map((s) => tokens(s.body));
  const turned = key.dims?.upside_down_page;
  const pages = [
    ...(map?.pages ?? []).map((pg) => ({ want: pageTokens(pg.text), where: `page ${pg.page}`, condition: pg.page === turned ? 'upside down' : key.dims?.scanned ? 'scanned' : null })),
    ...(map?.attachments ?? []).flatMap((a) => a.pages.map((pg) => ({ want: pageTokens(pg.text), where: `${a.id} page ${pg.page}`, condition: 'attachment' }))),
  ].filter((p) => p.want.length);
  const pairs = [];
  pages.forEach((p, i) => read.forEach((have, j) => { const r = recall(p.want, have) ?? 0; if (r > 0) pairs.push([r, i, j]); }));
  pairs.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
  const best = new Array(pages.length).fill(0), usedPage = new Set(), usedRead = new Set();
  for (const [r, i, j] of pairs) { if (usedPage.has(i) || usedRead.has(j)) continue; usedPage.add(i); usedRead.add(j); best[i] = r; }
  return pages.map((p, i) => ({ where: p.where, condition: p.condition, pass: best[i] >= 0.5, recall: +best[i].toFixed(3) }));
}

const TICK = /\[(x|ticked)\]|✓|✔|☑/i;
const pageAnnotations = (raw, page) => (raw?.classification?.annotations ?? []).filter((a) => a.page === page);
const annotationText = (raw, page, kinds = ['stamps', 'seals', 'signatures', 'handwritten_notes']) => pageAnnotations(raw, page).flatMap((a) => kinds.flatMap((k) => a[k] ?? [])).join(' \n ');
const readingPage = (raw, page) => pagesOf(splitReading(raw?.ok ? raw.ocr_text : '').main).find((s) => s.n === page)?.body ?? '';
const reported = {
  note: (raw, page) => pageAnnotations(raw, page).some((a) => (a.handwritten_notes ?? []).length > 0),
  stamp: (raw, page) => pageAnnotations(raw, page).some((a) => (a.stamps ?? []).length + (a.seals ?? []).length > 0),
  signature: (raw, page) => pageAnnotations(raw, page).some((a) => (a.signatures ?? []).length > 0) || /\bsign(ed|ature)\b/i.test(annotationText(raw, page, ['handwritten_notes', 'stamps'])) || /\[(signed|signature)\]/i.test(readingPage(raw, page)),
  tick: (raw, page) => TICK.test(readingPage(raw, page)) || /\btick|check ?mark|✓/i.test(annotationText(raw, page)),
};
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const month = (s) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;
/** The written forms of a date: digits with dots, slashes or hyphens (day or month first, or year first), Japanese
 *  year-month-day characters, and an English month name before or after the day. */
const DATE_FORMS = [
  [/(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})/g, (m) => { const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])]; return a > 999 ? [`${a}-${b}-${c}`] : c > 999 ? [`${c}-${b}-${a}`, `${c}-${a}-${b}`] : []; }],
  [/(\d{4})年(\d{1,2})月(\d{1,2})日/g, (m) => [`${Number(m[1])}-${Number(m[2])}-${Number(m[3])}`]],
  [/(\d{1,2})\.?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})/gi, (m) => [`${Number(m[3])}-${month(m[2])}-${Number(m[1])}`]],
  [/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/gi, (m) => [`${Number(m[3])}-${month(m[1])}-${Number(m[2])}`]],
];
/** All the dates a text mentions, as year-month-day, read day-first and month-first where the form allows both. */
export function datesIn(text) {
  const out = new Set();
  for (const [rx, f] of DATE_FORMS) for (const m of String(text ?? '').matchAll(rx)) for (const d of f(m)) out.add(d);
  return out;
}
const withoutDates = (text) => DATE_FORMS.reduce((t, [rx]) => t.replace(rx, ' '), String(text ?? ''));
const CJK_CHAR = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u;
/** A page's reading less the words the page itself prints. Each printed word takes one occurrence of itself out of the
 *  reading: the one that sits among the same neighbouring words as the printed word does on the page, and the first of
 *  those where several do equally well. So "Approved by" printed under a signature line is never read as a stamp, and a
 *  handwritten "10" written above a printed "10%" stays. Single Japanese and Chinese characters stay, since a page
 *  prints most of them somewhere. */
const NEIGHBOURS = 3;
export function beyondPrint(readingText, printedText) {
  const p = tokens(printedText), r = tokens(readingText);
  const at = new Map();
  r.forEach((t, i) => { if (!CJK_CHAR.test(t)) { if (!at.has(t)) at.set(t, []); at.get(t).push(i); } });
  const near = (pi, ri) => { let n = 0; for (let k = 1; k <= NEIGHBOURS; k++) { if (pi - k >= 0 && p[pi - k] === r[ri - k]) n++; if (pi + k < p.length && p[pi + k] === r[ri + k]) n++; } return n; };
  const pairs = [];
  p.forEach((t, pi) => { if (!CJK_CHAR.test(t)) for (const ri of at.get(t) ?? []) pairs.push([near(pi, ri), ri, pi]); });
  pairs.sort((x, y) => y[0] - x[0] || x[1] - y[1] || x[2] - y[2]);
  const out = new Set(), used = new Set();
  for (const [, ri, pi] of pairs) if (!out.has(ri) && !used.has(pi)) { out.add(ri); used.add(pi); }
  return r.filter((_, i) => !out.has(i)).join(' ');
}
/** A mark's words are in a text when they occur there together with at most one character in five different, and each
 *  short word of letters or digits (initials, a count) occurs exactly. */
function wordsIn(words, text) {
  const want = compact(words);
  if (!want) return true;
  const have = new Set(tokens(text));
  return nearIn(want, compact(text), Math.floor(want.length / 5)) && tokens(words).filter((w) => /^[a-z0-9]{1,3}$/.test(w)).every((w) => have.has(w));
}
/** Handwriting and stamps: a written note or a stamp is read when its words are in what the system recorded for its
 *  page, apart from what the page prints (its page description, and its reading less the page's printed words), and a
 *  stamp's date is there in any written form; a signature or a tick when the system reports one on its page. */
const RTL_LOCALE = /^(ar|he|fa|ur)\b/i;
/** A note as a right-to-left page draws it: each run of digits or Latin letters reversed ("01.11" shows as "11.10"). */
export const drawnRtl = (s) => String(s ?? '').replace(/[0-9A-Za-z]+(?:[.,:/-][0-9A-Za-z]+)*/g, (run) => [...run].reverse().join(''));
export function scoreMarks(key, raw, map = null) {
  const u = unit();
  for (const m of key.cap.marks ?? []) {
    if (!raw?.ok) { add(u, false, { mark: m.id, kind: m.kind, page: m.page, why: 'no answer' }); continue; }
    if (m.kind === 'note' || m.kind === 'stamp') {
      const notes = annotationText(raw, m.page), reading = readingPage(raw, m.page);
      const own = `${notes} ${beyondPrint(reading, map?.pages?.find((p) => p.page === m.page)?.text ?? '')}`;
      const dates = m.kind === 'stamp' ? datesIn(m.text) : new Set();
      const found = datesIn(`${notes} ${reading}`);
      // a handwritten note is drawn one character at a time, so on a right-to-left page each run of digits or Latin
      // letters in it is drawn in reverse ("24" shows as "42"): the note may be read as the key writes it or as drawn
      const texts = m.kind === 'note' && RTL_LOCALE.test(key.locale ?? '') ? [m.text, drawnRtl(m.text)] : [m.text];
      const ok = texts.some((t) => (dates.size
        ? wordsIn(withoutDates(t), own) && [...dates].some((d) => found.has(d))
        : wordsIn(t, own)));
      add(u, ok, { mark: m.id, kind: m.kind, page: m.page, text: m.text });
    } else add(u, reported[m.kind](raw, m.page), { mark: m.id, kind: m.kind, page: m.page });
  }
  return u;
}
/** A control page of an unmarked document: it passes when nothing of the mark's kind is reported on it. */
export function scoreMarkControl(kind, page, raw) {
  const u = unit();
  add(u, !!raw?.ok && !reported[kind](raw, page), { control: kind, page });
  return u;
}

/** A payload compared as the reference run compares one (score-das.mjs, barcodePayloads): an escaped line break read
 *  as a line break, a symbology identifier dropped, and then its letters and digits only, case aside, so a GS1 string
 *  with or without its brackets and separators, and a payment code with its lines broken or joined, compare alike. */
export const payloadKey = (s) => String(s ?? '').replace(/\\n/g, '\n').normalize('NFKC').toLowerCase()
  .replace(/^\s*\][a-z]\d/, '').replace(/[^\p{L}\p{N}]+/gu, '');
export function scoreBarcodes(key, raw) {
  const u = unit();
  const got = (raw?.ok ? raw.extraction?.Barcodes ?? [] : []).map((b) => String(b?.Text ?? b ?? ''));
  for (const b of key.cap.barcodes ?? []) add(u, got.some((g) => payloadKey(g) === payloadKey(b.payload)), { symbol: b.id, symbology: b.symbology });
  return u;
}

/** The printed tables of a document, from its correct text: the line-item table, or the freight charges. */
export function printedTablesOf(text) {
  const lines = String(text ?? '').split('\n');
  const tables = [];
  let cur = null;
  for (const line of lines) {
    if (!/^\| .* \|$/.test(line)) { if (cur && cur.rows.length) tables.push(cur); cur = null; continue; }
    const cells = line.slice(2, -2).split(' | ');
    if (!cur) { cur = { table: 'table', part: 'main', cols: cells, rows: [] }; continue; }
    if (cells.join('|') === cur.cols.join('|')) continue; // a table's head repeated on a new page
    cur.rows.push(cells);
  }
  if (cur && cur.rows.length) tables.push(cur);
  return tables.filter((t) => t.cols.length >= 3);
}
export function scoreReadingOrder(doc, text, raw, rtl) {
  const u = unit();
  const tables = printedTablesOf(text);
  if (!tables.length) return u;
  const res = judgeDocument({ doc, gen: { content: { stickers: [] } }, tables, reading: raw?.ok ? raw.ocr_text : '', coverage: new Map(), rtl });
  for (const r of res) if (r.verdict !== 'excluded') add(u, r.verdict === 'pass' && (r.lines ?? 1) === 1, { row: r.row, reason: r.reason ?? null });
  return u;
}

/** The system's own word that it could not read a value: a flag naming the reading uncertain, unreadable, illegible or
 *  obscured, or an unreadable tag in the value. A flag that only says the value was not found in the source text does
 *  not count: a guess is never found there either. */
const UNREADABLE_FLAG = /reading_uncertain|unreadable|illegible|obscured/i;
const UNREADABLE_TAG = /\[(obscured|illegible|cut off)\]/i;
const declaredUnreadable = (conf, q, v) => UNREADABLE_TAG.test(String(v ?? '')) || (conf[q]?.flags ?? []).some((f) => UNREADABLE_FLAG.test(String(f)));
/** Legibility: a value made unreadable passes when nothing was returned for it, or what was returned carries the
 *  system's own word that it could not read it; its readable control passes when the value was returned right and not
 *  so marked. A line the scorer cannot place fails. */
export function scoreLegibility(key, raw) {
  const u = unit();
  const out = raw?.ok ? raw.extraction ?? {} : null;
  const rows = out ? alignRows(key.gt.Items ?? [], out.Items ?? []) : [];
  const conf = raw?.field_confidence?.fields ?? {};
  for (const o of key.cap.occlusions ?? []) {
    const q = out ? outPath(o.path, rows) : null;
    const v = q ? getPath(out, q) : undefined;
    if (o.hidden) add(u, !!q && (!filled(v) || declaredUnreadable(conf, q, v)), { occlusion: o.id, path: o.path, kind: o.kind, returned: filled(v) ? String(v).slice(0, 60) : '' });
    else add(u, !!q && right(judge(o.path.split('.').pop(), o.value, v)) && !declaredUnreadable(conf, q, v), { occlusion: o.id, path: o.path, kind: 'control' });
  }
  return u;
}

// -------------------------------------------------------------------------------------------------
// Capture and Understand
// -------------------------------------------------------------------------------------------------
/** Segmentation: each document inside a file passes when one returned part spans exactly its pages; returned parts
 *  that overlap are not a cut, and every document of that file fails. */
export function scoreSegmentation(bundle, raw) {
  const u = unit();
  const parts = raw?.ok ? (raw.documents ?? []).slice().sort((a, b) => a.page_start - b.page_start) : [];
  const overlap = parts.some((p, i) => i > 0 && p.page_start <= parts[i - 1].page_end);
  for (const d of bundle.documents) add(u, !overlap && parts.some((p) => p.page_start === d.page_start && p.page_end === d.page_end), { doc: d.id, pages: `${d.page_start}-${d.page_end}`, ...(overlap ? { why: 'returned parts overlap' } : {}) });
  return u;
}
export function scoreParsing(key, raw) {
  const u = unit();
  const out = raw?.ok ? raw.extraction ?? {} : null;
  const hidden = new Set((key.cap.occlusions ?? []).filter((o) => o.hidden).map((o) => o.path));
  for (const g of key.cap.parsing ?? []) for (const p of g.parts) {
    if (hidden.has(p)) continue;
    const gv = getPath(key.gt, p);
    if (!filled(gv)) continue;
    add(u, !!out && right(judge(p.split('.').pop(), gv, getPath(out, p))), { compound: g.compound, path: p });
  }
  return u;
}
/** Decoding: on the lines whose lot and serial are printed only on the label, each must hold the label's value. */
export function scoreDecoding(key, raw) {
  const u = unit();
  const out = raw?.ok ? raw.extraction ?? {} : null;
  const rows = out ? alignRows(key.gt.Items ?? [], out.Items ?? []) : [];
  for (const l of (key.cap.labels ?? []).filter((x) => x.label_only)) {
    const j = rows[l.row];
    const row = out && j >= 0 ? out.Items?.[j] : null;
    add(u, !!row && norm(row['Lot Number']) === norm(l.lot), { label: l.id, field: 'Lot Number' });
    if (l.serial) add(u, !!row && norm(row['Serial Number']) === norm(l.serial), { label: l.id, field: 'Serial Number' });
  }
  return u;
}
/** Whether the system records a value as computed: in its derivation record, by the value's source, in its own words
 *  for the field (the reasons it gives for values it worked out), or by locating the value at the values it was
 *  computed from. One rule, read by Computation and by Traceability. */
export function recordedAsComputed(raw, geo, q) {
  if (!raw?.ok || !q) return false;
  return (raw.derived_fields?.derivations ?? []).some((x) => x.kind === 'derived' && x.field_path === q)
    || raw.field_confidence?.fields?.[q]?.source === 'derived'
    || !!raw.field_confidence?.model_derivations?.[q]
    // in its own words for the field: a value it marks as inferred, with its reason, or a line's field it names as
    // derived without the line's number, when it does not claim that line's value was printed
    || (raw.field_confidence?.fields?.[q]?.source === 'inferred' && !!raw.field_confidence?.fields?.[q]?.justification)
    || (/\.\d+\./.test(q) && !!raw.field_confidence?.model_derivations?.[q.replace(/\.\d+\./, '.')] && raw.field_confidence?.fields?.[q]?.source !== 'exact')
    || (geo?.ok && geo.answer?.fields?.[q]?.basis === 'derived-source');
}
/** The figures a page prints: every number to the cent, and every date as year-month-day. */
export function printedFigures(text) {
  const nums = new Set(), dates = new Set();
  for (const t of String(text ?? '').match(/-?\d[\d.,' ]*\d|\d/g) ?? []) { const n = normNum(t.replace(/ /g, '')); if (n != null) nums.add(Number(n).toFixed(2)); }
  for (const t of String(text ?? '').match(/\d{1,4}[./-]\d{1,2}[./-]\d{1,4}/g) ?? []) { const k = dayKey(t); if (k) dates.add(k); }
  return { nums, dates };
}
const dayKey = (s) => { const x = String(s).match(/(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})/); if (!x) return null; const [a, b, c] = x.slice(1).map(Number); return a > 31 ? `${a}-${b}-${c}` : `${c}-${b}-${a}`; };
/** The values a page implies and does not print. A value whose figure the page prints after all (a one-line document's
 *  subtotal is its line amount, and so is the unit price of a line of quantity one) is read there, not computed, so
 *  Computation and Traceability leave it out; Calibration still judges it against the value it implies. */
export function impliedOnly(key, figures) {
  const printed = (x) => (/date/i.test(x.path) ? figures.dates.has(dayKey(x.value)) : figures.nums.has(Number(normNum(x.value)).toFixed(2)));
  return { ...key, cap: { ...key.cap, derivations: (key.cap.derivations ?? []).filter((x) => !printed(x)) } };
}
/** Computation: the value is right, and the system records it as computed. */
export function scoreComputation(key, raw, geo = null) {
  const u = unit();
  const out = raw?.ok ? raw.extraction ?? {} : null;
  const rows = out ? alignRows(key.gt.Items ?? [], out.Items ?? []) : [];
  for (const d of key.cap.derivations ?? []) {
    const q = out ? outPath(d.path, rows) : null;
    const v = q ? getPath(out, q) : undefined;
    const valueRight = !!q && right(judge(d.path.split('.').pop(), d.value, v));
    const shown = recordedAsComputed(raw, geo, q);
    add(u, valueRight && shown, { path: d.path, method: d.method, value_right: valueRight, shown_as_computed: shown });
  }
  return u;
}
/** A flag on an amount that says the document's own arithmetic does not hold. A bank or tax number's checksum is not
 *  arithmetic and never counts. */
const MONEY = /(Amount|Total|Subtotal|Tax|Net)(\.|$)|tax_total|Unit Price/i;
const NOT_MONEY = /account_no|Account Number|IBAN|BIC|Swift|VAT No|Registration/i;
const moneyPath = (p) => MONEY.test(String(p)) && !NOT_MONEY.test(String(p));
export const contradictionFlagged = (raw) => (raw?.derived_fields?.derivations ?? []).some((d) => d.kind === 'mismatch' && moneyPath(d.field_path))
  || Object.entries(raw?.field_confidence?.fields ?? {}).some(([p, e]) => moneyPath(p) && (e?.flags ?? []).some((f) => /^(printed_mismatch|line_arithmetic_fail)/.test(String(f)) && !/checksum/i.test(String(f))));
export function scoreConsistencyFlag(raw, expected) {
  const u = unit();
  const f = !!raw?.ok && contradictionFlagged(raw);
  add(u, !!raw?.ok && (expected ? f : !f), { expected, flagged: f });
  return u;
}

// -------------------------------------------------------------------------------------------------
// Reason
// -------------------------------------------------------------------------------------------------
export function scoreResolution(key, raw) {
  const u = unit();
  const want = key.cap.supplier?.code ?? '';
  const got = raw?.ok ? (raw.enriched_extraction?.['Supplier Code'] ?? raw.extraction?.['Supplier Code'] ?? '') : null;
  add(u, got != null && norm(got) === norm(want), { want, got: got ?? '(no answer)' });
  return u;
}

const NOISE = (k) => /^Barcodes\./.test(k) || /Payment Details Description$/.test(k);
function flat(obj, pre = '', out = {}) {
  if (obj == null || typeof obj !== 'object') { out[pre] = obj; return out; }
  if (Array.isArray(obj)) { obj.forEach((v, i) => flat(v, `${pre}.${i}`, out)); return out; }
  for (const k of Object.keys(obj)) flat(obj[k], pre ? `${pre}.${k}` : k, out);
  return out;
}
const sq = (v) => String(v ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
/** One flat answer re-keyed to the key's line numbers, so two answers that order lines differently compare line by line. */
function keyed(key, ans) {
  const rows = alignRows(key.gt.Items ?? [], ans?.Items ?? []);
  const back = new Map(rows.map((oj, gi) => [oj, gi]).filter(([oj]) => oj >= 0));
  const out = {};
  for (const [k, v] of Object.entries(flat(ans ?? {}))) {
    const m = k.match(/^Items\.(\d+)\.(.+)$/);
    if (!m) { out[k] = v; continue; }
    const gi = back.get(Number(m[1]));
    out[gi == null ? `Items.unplaced-${m[1]}.${m[2]}` : `Items.${gi}.${m[2]}`] = v;
  }
  return out;
}
/** Instructions: adherence and containment of each applicable instruction on one document, as { instruction: unit }.
 *  A target's expected value is the instruction applied to the system's own value with no instruction; containment
 *  counts the values outside the instruction's scope that the two answers with no instruction agree on, and asks that
 *  the instructed answer leaves them as they were. With nothing to compare (an answer missing) every target is
 *  charged, and every value the key fills outside the scope. */
export function scoreInstructions(key, raw) {
  const adh = {}, con = {};
  const b1 = raw?.baselines?.[0]?.ok ? raw.baselines[0].extraction : null;
  const b2 = raw?.baselines?.[1]?.ok ? raw.baselines[1].extraction : null;
  const base = b1 ? keyed(key, b1) : null;
  const base2 = b2 ? keyed(key, b2) : null;
  const keyFlat = flat(key.gt);
  for (const pack of applicablePacks(key)) {
    const a = (adh[pack.id] = unit()), c = (con[pack.id] = unit());
    const entry = (raw?.packs ?? []).find((p) => p.id === pack.id);
    const targets = pack.targets(key.gt);
    if (!base || !base2 || !entry?.ok) {
      const outOfScope = Object.entries(keyFlat).filter(([k, v]) => filled(v) && !NOISE(k) && !targets.includes(k) && !pack.scope(k, v));
      const why = !base || !base2 ? 'no answer without the instruction' : 'no answer';
      charge(a, targets.length, { pack: pack.id, why });
      charge(c, outOfScope.length, { pack: pack.id, why });
      continue;
    }
    const out = keyed(key, entry.extraction);
    for (const t of targets) {
      const was = base[t];
      if (!filled(was)) continue; // nothing to transform: the system returned no value here without the instruction
      const want = pack.expect(was, key.gt, t);
      if (want == null) continue;
      add(a, adheres(want, out[t]), { pack: pack.id, path: t, want, got: out[t] ?? '' });
    }
    for (const k of new Set([...Object.keys(base), ...Object.keys(out)])) {
      if (NOISE(k) || targets.includes(k) || pack.scope(k, base[k]) || pack.scope(k, out[k])) continue;
      if (!filled(base[k]) && !filled(out[k])) continue;
      if (sq(base[k]) !== sq(base2[k])) continue; // varies between two answers with no instruction: not the instruction's doing
      add(c, sq(base[k]) === sq(out[k]), { pack: pack.id, path: k });
    }
  }
  return { adh, con };
}

/** Contract: the customer's contract, checked on the answer the customer receives (the enriched extraction). */
function contractChecks(key, out, contract, u) {
  const shapeOf = (v) => (Array.isArray(v) ? 'array' : v && typeof v === 'object' ? 'object' : 'scalar');
  const keyOf = (n) => String(n).split(/\s+-\s+/)[0].replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
  const outBy = Object.fromEntries(Object.entries(out).map(([k, v]) => [keyOf(k), v]));
  const gtBy = Object.fromEntries(Object.entries(key.gt).map(([k, v]) => [keyOf(k), v]));
  // schema: each contracted section present in its shape; each contracted field the key leaves empty still emitted
  for (const sec of contract.sections) {
    const o = outBy[keyOf(sec.name)];
    if (o === undefined) { add(u, false, { check: 'section', path: sec.name, why: 'absent' }); continue; }
    const os = shapeOf(o);
    const ok = os === sec.shape || (sec.shape === 'array' && os === 'object') || (sec.shape === 'object' && Array.isArray(o) && o.length <= 1);
    add(u, ok, { check: 'section', path: sec.name, ...(ok ? {} : { why: `shape ${sec.shape} returned as ${os}` }) });
    if (!ok) continue;
    const oi = Array.isArray(o) ? o[0] ?? null : o;
    if (!oi || typeof oi !== 'object' || Array.isArray(oi)) continue;
    const g = gtBy[keyOf(sec.name)];
    const gi = Array.isArray(g) ? g[0] ?? null : g;
    for (const f of sec.fields) {
      if (gi && typeof gi === 'object' && filled(gi[f])) continue; // a value the key holds is Capture's to count
      add(u, f in oi, { check: 'field', path: `${sec.name}.${f}` });
    }
  }
  // the customer's own field is allowed beside the contract; whether it is filled right is Resolution's to count
  const allowed = new Set([...contract.sections.map((x) => x.name), ...(contract.allowed ?? []), ...CUSTOMER_CONTRACT.added_fields, 'Flags', 'Barcodes', 'extra_fields_array'].map(keyOf));
  for (const k of Object.keys(out)) if (!allowed.has(keyOf(k))) add(u, false, { check: 'section', path: k, why: 'not in the contract' });
  // formats, for every value the key holds: the customer's contract asks for the value in its format, so a value the
  // answer leaves out does not meet it
  const DATE = new RegExp(CUSTOMER_CONTRACT.date.pattern), ACCOUNT = new RegExp(CUSTOMER_CONTRACT.account.pattern);
  const rows = alignRows(key.gt.Items ?? [], out.Items ?? []);
  const aligned = { ...out, Items: (key.gt.Items ?? []).map((_, i) => (rows[i] >= 0 ? out.Items?.[rows[i]] : undefined)) };
  const walk = (g, o, p = '') => {
    if (g == null || typeof g !== 'object') return;
    if (Array.isArray(g)) { g.forEach((v, i) => walk(v, Array.isArray(o) ? o[i] : undefined, `${p}.${i}`)); return; }
    for (const k of Object.keys(g)) {
      const gv = g[k], ov = o?.[k], pp = p ? `${p}.${k}` : k;
      if (gv && typeof gv === 'object') { walk(gv, ov, pp); continue; }
      if (!filled(gv) || /^Barcodes/.test(pp)) continue;
      const has = filled(ov), got = has ? ov : '(not returned)';
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(String(gv))) add(u, has && DATE.test(String(ov).trim()), { check: 'date format', path: pp, got });
      else if (/(account_no|Account Number)$/.test(k)) add(u, has && ACCOUNT.test(String(ov).trim()), { check: 'account format', path: pp, got });
      else if (fieldKind(gv, k) === 'number') add(u, has && isPlainNumber(ov), { check: 'number format', path: pp, got });
    }
  };
  walk(key.gt, aligned);
  return u;
}
/** The key written in the customer's formats: the complete answer a failed lane is charged against. */
export function perfectAnswer(key) {
  const o = JSON.parse(JSON.stringify(key.gt));
  for (const [p, v] of leavesOf(o)) {
    if (typeof v !== 'string') continue;
    const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) setPathIn(o, p, `${m[3]}-${m[2]}-${m[1]}`);
    else if (/(account_no|Account Number)$/.test(p)) setPathIn(o, p, v.replace(/\s/g, ''));
  }
  return o;
}
export function scoreContract(key, raw, contract) {
  const u = unit();
  if (!raw?.ok) { charge(u, contractChecks(key, perfectAnswer(key), contract, unit()).n, { why: 'no answer' }); return u; }
  return contractChecks(key, raw.enriched_extraction ?? raw.extraction ?? {}, contract, u);
}

// -------------------------------------------------------------------------------------------------
// Trust
// -------------------------------------------------------------------------------------------------
const SKIP_TRACE = (p) => /^Barcodes/.test(p) || /Payment Details Description$/.test(p);
/** The fields a barcode's payload carries: a GS1 string's element strings, a payment code's lines (an amount also
 *  without its currency), a Code 128's whole text; letters and digits only. */
const symbolFields = (payload) => String(payload ?? '').replace(/\\n/g, '\n').split(/\(\d{2,4}\)|\n|\u001d/)
  .map((x) => compact(x)).flatMap((x) => [x, x.replace(/^[a-z]{3}(?=\d)/, '')]).filter((x) => x.length >= 3);
/** Where the page also carries a value in a barcode: the top-left corner of each symbol that holds the value as one of
 *  its fields, a label only for its own line's values. The map records a symbol by that corner alone. */
export function symbolCorners(key, map, p, value) {
  const want = compact(value);
  if (want.length < 3) return [];
  const row = String(p).match(/^Items\.(\d+)\./);
  return (key.cap?.barcodes ?? [])
    .filter((b) => (row ? b.row === Number(row[1]) : b.row == null) && map?.marks?.[b.id] && symbolFields(b.payload).includes(want))
    .map((b) => map.marks[b.id]);
}
/** Traceability: a value the page prints legibly, delivered right, is traced when the system's box for it, on the
 *  right page, holds the centre of where the page prints it and is no taller than three of its lines and no wider than
 *  four times its width, or, where the page also carries the value in a barcode, covers that symbol's corner and is no
 *  larger than a symbol; a value the page implies, delivered right, when the system records it as computed. A value
 *  not delivered right is untraced, so a lane that failed passes nothing. */
export function scoreTraceability(key, map, raw, geo) {
  const u = unit();
  const out = raw?.ok ? raw.extraction ?? {} : {};
  const fields = geo?.ok ? geo.answer?.fields ?? {} : {};
  const rows = alignRows(key.gt.Items ?? [], out.Items ?? []);
  // a page fed upside down is left out: a system may give a box on it in the page's own frame or turned upright
  const turned = key.dims?.upside_down_page ?? null;
  const hidden = new Set((key.cap.occlusions ?? []).filter((o) => o.hidden).map((o) => o.id));
  for (const [p, boxes] of Object.entries(map?.values ?? {})) {
    if (SKIP_TRACE(p)) continue;
    const truth = boxes.filter((b) => !(b.occlusion && hidden.has(b.occlusion)) && b.page !== turned);
    const gv = getPath(key.gt, p);
    if (!truth.length || !filled(gv)) continue;
    const q = outPath(p, rows);
    const delivered = !!raw?.ok && !!q && right(judge(p.split('.').pop(), gv, getPath(out, q)));
    const f = q ? fields[q] : null;
    const corners = symbolCorners(key, map, p, gv).filter((c) => c.page !== turned);
    const ok = delivered && !!f?.located && (f.boxes ?? []).some((b) => truth.some((t) => b.page === t.page
      && t.x + t.w / 2 >= b.x - 0.01 && t.x + t.w / 2 <= b.x + b.w + 0.01 && t.y + t.h / 2 >= b.y - 0.01 && t.y + t.h / 2 <= b.y + b.h + 0.01
      && b.h <= 3 * t.h + 0.01 && b.w <= 4 * t.w + 0.02)
      || corners.some((c) => b.page === c.page && c.x >= b.x - 0.01 && c.x <= b.x + b.w + 0.01 && c.y >= b.y - 0.01 && c.y <= b.y + b.h + 0.01 && b.h <= 0.15 && b.w <= 0.6));
    add(u, ok, { path: p, basis: f?.basis ?? null, delivered_right: delivered });
  }
  for (const d of key.cap.derivations ?? []) {
    const q = outPath(d.path, rows);
    const delivered = !!raw?.ok && !!q && right(judge(d.path.split('.').pop(), d.value, getPath(out, q)));
    add(u, delivered && recordedAsComputed(raw, geo, q), { path: d.path, derived: true, delivered_right: delivered });
  }
  return u;
}

/** The header values of an answer, by path: every leaf of its object sections, a nested block (its taxes, its payment
 *  methods) leaf by leaf, the row tables (line items, a freight invoice's tables) and the barcodes aside. */
export function headerLeaves(obj) {
  const out = {};
  for (const [sec, v] of Object.entries(obj ?? {})) {
    if (sec === 'Barcodes' || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    for (const [p, x] of leavesOf(v, sec)) if ((x == null || typeof x !== 'object') && !/Payment Details Description$/.test(p)) out[p] = x;
  }
  return out;
}
/** Calibration's values: every header value returned, each with its own confidence (a value with none is taken as fully
 *  confident, so withholding confidence earns nothing), judged right or not against the key (a value the page implies
 *  against the value it implies; a value returned where the key holds none is wrong, and whether it should have been
 *  returned at all is Restraint's to count). Each value is [confidence, right, invented]. A lane that failed counts
 *  every header value the key holds as returned wrong at full confidence. */
export function calibrationValues(key, raw) {
  const vals = [];
  const judgedKey = JSON.parse(JSON.stringify(key.gt));
  for (const d of key.cap.derivations ?? []) setPathIn(judgedKey, d.path, d.value);
  const want = headerLeaves(judgedKey);
  if (!raw?.ok) {
    for (const v of Object.values(want)) if (filled(v)) vals.push([1, 0, 0]);
    return { vals, no_confidence: 0 };
  }
  const conf = raw.field_confidence?.fields ?? {};
  const got = headerLeaves(raw.extraction ?? {});
  let none = 0;
  // only the fields the answer key defines, as Restraint counts them: a field the key does not define (a second name the
  // system gives a tax line's amount, say) is neither right nor wrong
  for (const [p, ov] of Object.entries(got)) {
    if (!filled(ov) || !(p in want)) continue;
    const gv = want[p];
    let c = Number(conf[p]?.c);
    if (conf[p]?.c == null || !Number.isFinite(c)) { c = 1; none++; }
    vals.push([Math.min(1, Math.max(0, c)), right(judge(p.split('.').pop(), gv ?? '', ov)) ? 1 : 0, filled(gv) ? 0 : 1]);
  }
  return { vals, no_confidence: none };
}
/** One minus the expected calibration error over ten equal-width bins: the size-weighted gap between the confidence
 *  given and the share of values that were right. */
export function oneMinusEce(vals) {
  if (!vals.length) return null;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, c: 0, r: 0 }));
  for (const [c, r] of vals) { const b = bins[Math.min(9, Math.floor(c * 10))]; b.n++; b.c += c; b.r += r; }
  return 1 - bins.reduce((s, b) => s + (b.n ? (b.n / vals.length) * Math.abs(b.c / b.n - b.r / b.n) : 0), 0);
}
/** Discrimination: the share of pairs of a right and a wrong value in which the right one has the higher confidence,
 *  ties counting half (the area under the ROC curve). */
export function auroc(vals) {
  const pos = vals.filter((v) => v[1] === 1).length, neg = vals.length - pos;
  if (!pos || !neg) return null;
  const sorted = vals.slice().sort((a, b) => a[0] - b[0]);
  let rankSum = 0;
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j < sorted.length && sorted[j][0] === sorted[i][0]) j++;
    const avg = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) if (sorted[k][1] === 1) rankSum += avg;
    i = j;
  }
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

/** Anomaly detection: anything that stops a document: a duplicate signal, a rule's flag or rejection, a matching
 *  exception. An anomaly passes when it is stopped, a control when it is not. */
export function stopSignals(raw, matching) {
  const s = [];
  if (raw?.classification?.duplicate) s.push('duplicate (same file)');
  if (raw?.duplicate) s.push('duplicate (same content)');
  for (const f of raw?.enrichment_report?.flags ?? []) s.push(`flag ${f.flag_name}`);
  if (raw?.rejected) s.push('rejected');
  for (const f of raw?.rules_applied?.flags ?? []) s.push(`rule flag ${f.rule_id}`);
  for (const f of raw?.extraction?.Flags ?? []) s.push(`flag ${f?.Label ?? ''}`);
  for (const e of matching?.ok ? matching.answer?.result?.exceptions ?? [] : []) s.push(`matching ${e.code}`);
  return s;
}
/** A case is judged on the document's answer and its matching verdict together: a case without either is a failed lane
 *  and fails, whatever its role. */
export function scoreAnomaly(kase, raw, matching) {
  const u = unit();
  const answered = !!raw?.ok && !!matching?.ok;
  const s = answered ? stopSignals(raw, matching) : [];
  add(u, answered && (kase.role === 'anomaly' ? s.length > 0 : s.length === 0), { case: kase.kind, role: kase.role, signals: s, ...(answered ? {} : { why: raw?.ok ? 'no matching verdict' : 'no answer' }) });
  return u;
}

// -------------------------------------------------------------------------------------------------
// the whole set
// -------------------------------------------------------------------------------------------------
/** The registered controls: one for each case they balance, drawn in the order of the SHA-256 of the seed, the purpose
 *  and the document's id, from the documents that carry nothing that could set them off: one of the same type that has
 *  not yet served this purpose for this kind of case, or, where that type has none left, one of any type, so a measure
 *  never holds fewer controls than cases. Only when every document that could serve has served (a small part of a set,
 *  never the whole of AIDP-CAP) does one serve again, marked as reused. */
export function drawControls(manifest, keys, { purpose, slugOf, kindOf = () => '', need, eligible }) {
  const pool = manifest.docs.filter((d) => eligible(d, keys.get(d.id)))
    .sort((a, b) => sha(`${manifest.seed}:${purpose}:${a.id}`).localeCompare(sha(`${manifest.seed}:${purpose}:${b.id}`)));
  if (!pool.length && need.length) throw new Error(`${purpose}: no document can serve as a control`);
  const used = new Map();
  return need.map((want) => {
    const kind = kindOf(want);
    if (!used.has(kind)) used.set(kind, new Map());
    const u = used.get(kind);
    let d = pool.find((x) => x.slug === slugOf(want) && !u.has(x.id)) ?? pool.find((x) => !u.has(x.id));
    const reused = !d;
    if (reused) d = pool.reduce((a, x) => ((u.get(x.id) ?? 0) < (u.get(a.id) ?? 0) ? x : a), pool[0]);
    u.set(d.id, (u.get(d.id) ?? 0) + 1);
    return { for: want, id: d.id, same_type: d.slug === slugOf(want), ...(reused ? { reused: true } : {}) };
  });
}

/**
 * Scores the whole set. Returns, beside the measures, every unit grouped by its OWNER (the document, copy or file it
 * belongs to) and the owner's stratum (its document type, or "file"), which is what the bootstrap resamples: an owner
 * drawn once brings every unit it carries, in every measure.
 */
export function scoreCap({ corpus, mainDir, splitDir, contractDir, rulesDir }) {
  const manifest = readJson(path.join(corpus, 'manifest.json'));
  const contracts = readJson(path.join(corpus, 'contract.json')).contracts;
  const keys = new Map(manifest.docs.map((d) => [d.id, readJson(path.join(corpus, d.gt))]));
  const raws = new Map();
  const raw = (dir, id, lane) => { if (!dir) return null; const k = `${dir}:${id}:${lane}`; if (!raws.has(k)) raws.set(k, readJson(path.join(dir, 'raw', `${id}.${lane}.json`))); return raws.get(k); };
  const owners = new Map();
  const own = (id, stratum) => { if (!owners.has(id)) owners.set(id, { id, stratum, m: {} }); return owners.get(id); };
  const put = (mid, id, stratum, u) => { if (!u.n) return; const e = (own(id, stratum).m[mid] ??= { p: 0, n: 0, items: [] }); e.p += u.p; e.n += u.n; e.items.push(...u.items.slice(0, 200)); };
  const putPacks = (mid, id, stratum, byPack) => { const e = (own(id, stratum).m[mid] ??= { packs: {} }); for (const [k, u] of Object.entries(byPack)) { if (!u.n) continue; const x = (e.packs[k] ??= { p: 0, n: 0, items: [] }); x.p += u.p; x.n += u.n; x.items.push(...u.items.slice(0, 100)); } };
  const extra = { calibration_no_confidence: 0 };
  const resTypes = new Set(['invoice', 'credit-note', 'consignment-invoice', 'freight-invoice']);
  const pages = [];

  for (const d of manifest.docs) {
    const key = keys.get(d.id);
    const map = readJson(path.join(corpus, d.map));
    const implied = impliedOnly(key, printedFigures(fs.readFileSync(path.join(corpus, d.text), 'utf8')));
    const r = raw(mainDir, d.id, 'pipeline');
    const geo = mainDir ? readJson(path.join(mainDir, 'raw', `${d.id}.geometry.json`)) : null;
    for (const pg of intakePages(key, map, r)) pages.push({ ...pg, doc: d.id, slug: d.slug });
    put('cap.marks', d.id, d.slug, scoreMarks(key, r, map));
    put('cap.barcodes', d.id, d.slug, scoreBarcodes(key, r));
    put('cap.reading_order', d.id, d.slug, scoreReadingOrder(d, fs.readFileSync(path.join(corpus, d.text), 'utf8'), r, key.locale === 'ar-AE'));
    put('cap.legibility', d.id, d.slug, scoreLegibility(key, r));
    put('cap.parsing', d.id, d.slug, scoreParsing(key, r));
    put('cap.decoding', d.id, d.slug, scoreDecoding(key, r));
    put('cap.computation', d.id, d.slug, scoreComputation(implied, r, geo));
    if (resTypes.has(d.slug)) put('cap.resolution', d.id, d.slug, scoreResolution(key, r));
    put('cap.traceability', d.id, d.slug, scoreTraceability(implied, map, r, geo));
    const cal = calibrationValues(key, r);
    extra.calibration_no_confidence += cal.no_confidence;
    if (cal.vals.length) (own(d.id, d.slug).m['cap.calibration'] ??= { vals: [] }).vals.push(...cal.vals);
    if (key.cap.contradiction) put('cap.consistency_flags', d.id, d.slug, scoreConsistencyFlag(r, true));
  }
  // Intake: the pages that needed converting or could be dropped, and as many ordinary pages, drawn by the registered rule
  const cond = pages.filter((p) => p.condition);
  const ordinary = pages.filter((p) => !p.condition).sort((a, b) => sha(`${manifest.seed}:intake-control:${a.doc}:${a.where}`).localeCompare(sha(`${manifest.seed}:intake-control:${b.doc}:${b.where}`))).slice(0, cond.length);
  for (const p of [...cond, ...ordinary]) { const u = unit(); add(u, p.pass, { where: p.where, condition: p.condition ?? 'ordinary', recall: p.recall }); put('cap.intake', p.doc, p.slug, u); }
  // the clean controls for contradictions, and one unmarked control page for every mark
  const isClean = (d, k) => d.phase === 'A' && !d.role && !k.cap.contradiction && !(k.cap.derivations ?? []).length && !(k.cap.occlusions ?? []).length;
  const contraDocs = manifest.docs.filter((d) => keys.get(d.id).cap.contradiction);
  const contraControls = drawControls(manifest, keys, { purpose: 'consistency-control', need: contraDocs.map((d) => d.slug), slugOf: (s) => s, eligible: isClean });
  for (const c of contraControls) { const d = manifest.docs.find((x) => x.id === c.id); put('cap.consistency_flags', d.id, d.slug, scoreConsistencyFlag(raw(mainDir, d.id, 'pipeline'), false)); }
  const marks = manifest.docs.flatMap((d) => (keys.get(d.id).cap.marks ?? []).map((m) => ({ slug: d.slug, kind: m.kind, page: m.page ?? 1 })));
  // a control page carries no mark, and nothing made unreadable: an ink blot, a coffee ring or a label stuck on a page
  // is something a system may fairly describe as a mark
  const unmarked = (d, k) => !(k.cap.marks ?? []).length && !(k.cap.occlusions ?? []).length;
  const markControls = drawControls(manifest, keys, { purpose: 'mark-control', need: marks, slugOf: (x) => x.slug, kindOf: (x) => x.kind, eligible: unmarked });
  for (const c of markControls) {
    const d = manifest.docs.find((x) => x.id === c.id);
    // the same page number as the mark, or the control's last page when it is shorter
    put('cap.marks', d.id, d.slug, scoreMarkControl(c.for.kind, Math.min(c.for.page, d.pages), raw(mainDir, d.id, 'pipeline')));
  }
  // Segmentation: each file is its own owner, in the stratum of files
  for (const b of manifest.bundles) put('cap.segmentation', b.id, 'file', scoreSegmentation(b, raw(splitDir, b.id, 'split')));
  // Anomaly detection
  for (const k of [...manifest.cases.anomalies.map((x) => ({ ...x, role: 'anomaly' })), ...manifest.cases.controls.map((x) => ({ ...x, role: 'control' }))]) {
    const r = raw(mainDir, k.id, 'pipeline');
    const m = mainDir ? readJson(path.join(mainDir, 'raw', `${k.id}.matching.json`)) : null;
    const slug = manifest.docs.find((d) => d.id === (k.of ?? k.id))?.slug ?? 'invoice';
    put('cap.anomaly', k.id, slug, scoreAnomaly(k, r, m));
  }
  // Instructions
  for (const id of manifest.samples.instructions) {
    const d = manifest.docs.find((x) => x.id === id);
    const { adh, con } = scoreInstructions(keys.get(id), raw(rulesDir, id, 'rules'));
    putPacks('cap.adherence', id, d.slug, adh);
    putPacks('cap.containment', id, d.slug, con);
  }
  // Contract
  for (const id of manifest.samples.contract) {
    const d = manifest.docs.find((x) => x.id === id);
    put('cap.contract', id, d.slug, scoreContract(keys.get(id), raw(contractDir, id, 'contract'), contracts[d.slug]));
  }
  const all = [...owners.values()];
  const values = Object.fromEntries(CAP_MEASURES.map((m) => [m.id, { ...m, ...aggregate(m, all) }]));
  // beside the score: Calibration over the values the key holds, the invented ones left out
  const held = all.flatMap((o) => o.m['cap.calibration']?.vals ?? []).filter((v) => !v[2]);
  extra.calibration_without_invented = { values: held.length, one_minus_calibration_error: oneMinusEce(held), discrimination: auroc(held) };
  return { manifest, owners: all, values, controls: { consistency: contraControls, marks: markControls, reused: [...contraControls, ...markControls].filter((c) => c.reused).length, intake_ordinary_pages: ordinary.length, intake_condition_pages: cond.length }, extra };
}

/** One measure over a list of owners. */
export function aggregate(m, list) {
  if (m.agg === 'pooled') {
    let p = 0, n = 0;
    const byType = {};
    for (const o of list) { const e = o.m[m.id]; if (!e?.n) continue; p += e.p; n += e.n; const t = (byType[o.stratum] ??= { p: 0, n: 0 }); t.p += e.p; t.n += e.n; }
    return { value: n ? p / n : null, passes: p, checks: n, per_type: Object.fromEntries(Object.entries(byType).map(([t, x]) => [t, { ...x, value: x.n ? x.p / x.n : null }])) };
  }
  if (m.agg === 'packs') {
    const packs = {};
    for (const o of list) for (const [k, x] of Object.entries(o.m[m.id]?.packs ?? {})) { const t = (packs[k] ??= { p: 0, n: 0 }); t.p += x.p; t.n += x.n; }
    const vals = Object.values(packs).filter((x) => x.n).map((x) => x.p / x.n);
    return { value: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, passes: Object.values(packs).reduce((a, x) => a + x.p, 0), checks: Object.values(packs).reduce((a, x) => a + x.n, 0), per_instruction: Object.fromEntries(Object.entries(packs).map(([k, x]) => [k, { ...x, value: x.n ? x.p / x.n : null }])) };
  }
  const vals = list.flatMap((o) => o.m['cap.calibration']?.vals ?? []);
  if (m.agg === 'ece') return { value: oneMinusEce(vals), values: vals.length, right: vals.filter((v) => v[1]).length };
  if (m.agg === 'auroc') return { value: auroc(vals), values: vals.length, right: vals.filter((v) => v[1]).length };
  throw new Error(`unknown aggregation ${m.agg}`);
}

// -------------------------------------------------------------------------------------------------
// the AIDP Score over AIDP-2K and AIDP-CAP
// -------------------------------------------------------------------------------------------------
const geoMean = (xs) => Math.exp(xs.reduce((s, x) => s + Math.log(Math.min(x, 1)), 0) / xs.length);
const r2 = (x) => +(x * 100).toFixed(2);
export function combinedScore(board, capValues) {
  const units = unitsOf(board);
  const w = weightsFor('type-equal');
  const all = { ...Object.fromEntries(KEPT_2K.map((m) => [m.id, measure2k(m, units, w).value])), ...Object.fromEntries(Object.entries(capValues).map(([k, x]) => [k, x.value])) };
  for (const [k, x] of Object.entries(all)) if (x == null || Number.isNaN(x)) throw new Error(`measure ${k} has no value`);
  const ids = LAYERS_V1.flatMap((L) => L.measures);
  if (ids.length !== new Set(ids).size || ids.length !== Object.keys(all).length) throw new Error('every measure must be in exactly one layer');
  const raw = geoMean(ids.map((id) => all[id]));
  const layers = LAYERS_V1.map((L) => ({ key: L.key, name: L.name, count: L.measures.length, raw: geoMean(L.measures.map((id) => all[id])) }));
  const recombined = r2(Math.exp(layers.reduce((s, L) => s + L.count * Math.log(L.raw), 0) / ids.length));
  if (recombined !== r2(raw)) throw new Error(`layers recombine to ${recombined}, not ${r2(raw)}`);
  return { score: r2(raw), raw, layers: layers.map((L) => ({ ...L, score: r2(L.raw) })), measures: ids.map((id) => ({ id, value: all[id], source: id.startsWith('cap.') ? 'AIDP-CAP' : 'AIDP-2K' })) };
}

/** The thirteen AIDP-2K measures the AIDP Score keeps, on one AIDP-2K board (the reference run's or the held-out
 *  check's): their equal-weight geometric mean, its layers among them, and its 95% range from resampling the board's
 *  documents within type. The held-out check ran on AIDP-2K's documents only, so this is how it is reported. */
export function thirteen(board, { resamples = 2000, seed = 'aidp-v1.0-cap-bootstrap' } = {}) {
  const geo = (xs) => Math.exp(xs.reduce((s, x) => s + Math.log(Math.min(x, 1)), 0) / xs.length);
  const ids = KEPT_2K.map((m) => m.id), kept = new Set(ids);
  const w = weightsFor('type-equal');
  const layers = LAYERS_V1.map((L) => ({ name: L.name, ids: L.measures.filter((id) => kept.has(id)) })).filter((L) => L.ids.length);
  const valuesOf = (u) => Object.fromEntries(KEPT_2K.map((m) => [m.id, measure2k(m, u, w).value]));
  const scoreOf = (v) => ({ score: geo(ids.map((id) => v[id])) * 100, layers: layers.map((L) => geo(L.ids.map((id) => v[id])) * 100) });
  const units = unitsOf(board);
  const point = scoreOf(valuesOf(units));
  const rnd = mulberry32(hashSeed(seed));
  const groupBy = (list, f) => { const m = new Map(); for (const x of list) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return [...m.values()]; };
  const pipe = groupBy(units.pipeline, (x) => x.slug), stab = groupBy(units.stability ?? [], (x) => x.slug);
  const draw = (groups) => groups.flatMap((xs) => Array.from({ length: xs.length }, () => xs[Math.floor(rnd() * xs.length)]));
  const scores = [];
  for (let r = 0; r < resamples; r++) { const v = valuesOf({ pipeline: draw(pipe), stability: draw(stab) }); if (!Object.values(v).some((x) => x == null)) scores.push(scoreOf(v).score); }
  const q = (xs, p) => { const s = xs.slice().sort((a, b) => a - b); const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
  return { score: point.score, low: q(scores, 0.025), high: q(scores, 0.975), layers: Object.fromEntries(layers.map((L, i) => [L.name, point.layers[i]])) };
}

/** 95% ranges: AIDP-2K's documents resampled within type as bootstrap.mjs does, and AIDP-CAP's owners (documents,
 *  copies and files) within their stratum alongside, each drawn owner bringing every unit it carries; the score is
 *  recomputed from both on every draw. */
export function combinedBootstrap(board, cap, { resamples = 2000, seed = 'aidp-v1.0-cap-bootstrap' } = {}) {
  const units = unitsOf(board);
  const w = weightsFor('type-equal');
  const rnd = mulberry32(hashSeed(seed));
  const groupBy = (list, f) => { const m = new Map(); for (const x of list) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return [...m.values()]; };
  const pipe = groupBy(units.pipeline, (x) => x.slug), stab = groupBy(units.stability, (x) => x.slug), caps = groupBy(cap.owners, (x) => x.stratum);
  const draw = (groups) => groups.flatMap((xs) => Array.from({ length: xs.length }, () => xs[Math.floor(rnd() * xs.length)]));
  const ids = LAYERS_V1.flatMap((L) => L.measures);
  const scores = [], layerDraws = LAYERS_V1.map(() => []), measureDraws = Object.fromEntries(ids.map((id) => [id, []]));
  for (let r = 0; r < resamples; r++) {
    const u = { pipeline: draw(pipe), stability: draw(stab) };
    const vals = {};
    for (const m of KEPT_2K) vals[m.id] = measure2k(m, u, w).value;
    const owners = draw(caps);
    for (const m of CAP_MEASURES) vals[m.id] = aggregate(m, owners).value;
    if (ids.some((id) => vals[id] == null)) continue;
    scores.push(geoMean(ids.map((id) => vals[id])) * 100);
    LAYERS_V1.forEach((L, i) => layerDraws[i].push(geoMean(L.measures.map((id) => vals[id])) * 100));
    for (const id of ids) measureDraws[id].push(vals[id] * 100);
  }
  const q = (xs, p) => { const s = xs.slice().sort((a, b) => a - b); const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
  const range = (xs) => ({ low: +q(xs, 0.025).toFixed(2), high: +q(xs, 0.975).toFixed(2) });
  return { resamples, used: scores.length, seed, method: 'AIDP-2K documents within type; AIDP-CAP documents, copies and files within their stratum, each bringing every unit it carries', score: range(scores), layers: Object.fromEntries(LAYERS_V1.map((L, i) => [L.name, range(layerDraws[i])])), measures: Object.fromEntries(ids.map((id) => [id, range(measureDraws[id])])) };
}

// -------------------------------------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
  const corpus = path.resolve(opt('corpus'));
  const out = path.resolve(opt('out'));
  fs.mkdirSync(out, { recursive: true });
  const cap = scoreCap({ corpus, mainDir: opt('main') && path.resolve(opt('main')), splitDir: opt('split') && path.resolve(opt('split')), contractDir: opt('contract') && path.resolve(opt('contract')), rulesDir: opt('rules') && path.resolve(opt('rules')) });
  const board = opt('board') ? readJson(path.resolve(opt('board'))) : null;
  const result = { corpus: 'AIDP-CAP', seed: cap.manifest.seed, measures: cap.values, controls: cap.controls, extra: cap.extra };
  if (board && Object.values(cap.values).every((v) => v.value != null)) {
    result.aidp_score = combinedScore(board, cap.values);
    result.bootstrap = combinedBootstrap(board, cap, { resamples: Number(opt('resamples', '2000')) });
  }
  fs.writeFileSync(path.join(out, 'scoreboard-cap.json'), JSON.stringify({ ...result, owners: cap.owners }, null, 1));
  for (const m of Object.values(cap.values)) console.log(`${m.label.padEnd(58)} ${m.value != null ? `${(m.value * 100).toFixed(2)}%`.padStart(8) : '     n/a'}  ${m.checks != null ? `${m.passes}/${m.checks}` : `${m.values} values`}`);
  if (result.aidp_score) {
    console.log(`\nAIDP Score ${result.aidp_score.score.toFixed(2)} (95% range ${result.bootstrap.score.low.toFixed(2)} to ${result.bootstrap.score.high.toFixed(2)}) over ${result.aidp_score.measures.length} measures`);
    for (const L of result.aidp_score.layers) console.log(`  ${L.name.padEnd(11)} ${L.score.toFixed(2)} (${L.count} measures)`);
  }
}
