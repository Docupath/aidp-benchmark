/**
 * Post-run diagnostic 3. Reading order: was each printed table row read as one row, its cells in the
 * order a reader of that script reads them?
 *
 * Counts rows (the capability's "sequences"): every row of every repeating table the corpus prints,
 * taken from the generator's own content model and checked line for line against each document's
 * correct text (the .gt.txt pipe rows):
 *   items          the line-item table of invoices, purchase orders, credit notes, consignment orders and
 *                  invoices, quotes and receipts
 *   Transactions   the bank statement's transaction table
 *   Charges        the freight invoice's charges table
 *   attachment     the breakdown tables of the twelve attachments
 *
 * A row PASSES when there is one line of the platform's page-lane reading (its main line) that holds
 * every judged cell of the row, in reading order, without the cells overlapping:
 *   - a cell is found as a run of whole tokens whose characters, spacing ignored, are the cell's
 *     ("1 234,56" and "1234,56" are one cell); punctuation counts, so a cell read with a decimal
 *     separator or a thousands mark changed or dropped ("4,304,97" for "4,304.97") is a misread;
 *   - a cell the page itself wraps onto a second printed line may be found as its first part on the
 *     main line and the rest on one of the next three lines, starting within six characters of the
 *     column the first part starts in ("LBL-" with "33557" under it), because every cell of a row
 *     starts on the row's first printed line (render.mjs: td vertical-align: top) and its rest is
 *     printed below it;
 *   - on a right-to-left page (ar-AE) a cell's own words may stand in display order ("0-10 bar, 4-20mA"
 *     is displayed "bar, 4-20mA 0-10", "-1,969.28" as "1,969.28-"), so there a cell may be found as its
 *     words in any order, and a number with its minus sign on either side; and the row may be written
 *     in either direction, logical (first column first, the order its reader reads it) or as displayed
 *     (first column last), because the reading writes both (see the README); the whole row must follow
 *     one direction;
 *   - two rows on one line both fail.
 * Order inside a cell is Printed text's question, not this one, and so is the exact spelling of a
 * cell: a cell that is misread is reported separately from a cell that is out of place.
 *
 * Beside the headline, a relaxed figure lets whole cells also stand on the row's next two lines (before
 * the next row's line), in reading order by column, the row's first cell on its first line: the reading
 * sometimes writes a row's numbers one line lower, under their columns, beside a wrapped description.
 *
 * Excluded, never charged:
 *   - cells physically covered by a barcode sticker (consignment documents), found from the PDF: each
 *     sticker's placement (the barcode image's transform, widened by its white padding and border) and
 *     each printed cell's characters (the text layer keeps the text under the sticker); a cell is
 *     covered when any of nine sample points inside any of its characters lies under the sticker;
 *   - the heavy-noise consignment documents, whose PDFs keep no text layer, so the cells under their
 *     stickers cannot be located; all their rows are excluded;
 *   - rows left with fewer than two cells to judge.
 */
import path from 'node:path';
import { context, generated, pipelineRaw, withPdf, pageLayer, writeJsonl, readJsonOr, rate } from './lib.mjs';

const CONT_LINES = 3;            // a wrapped cell's remainder is looked for on the next three lines

// -------------------------------------------------------------------------------------------------
// the printed tables
// -------------------------------------------------------------------------------------------------
const pipeRow = (cells) => `| ${cells.map((c) => String(c ?? '').replace(/\|/g, '/')).join(' | ')} |`;

/** Every repeating table the document prints, from the generator's content model (render.mjs logic). */
export function printedTables(gen) {
  const out = [];
  const c = gen.content;
  if ((c.kind === 'commercial' || c.kind === 'receipt') && c.itemCols && c.rows) {
    out.push({ table: 'items', part: 'main', cols: c.itemCols.map((x) => x.label), rows: c.rows.map((row) => c.itemCols.map((x) => String(row[x.k] ?? ''))) });
  } else {
    for (const sec of c.sections ?? []) {
      const t = sec.table;
      if (!t) continue;
      const kv = t.cols.filter(Boolean).length <= 0 || t.cols.every((x) => x === '') || (t.cols.length === 2 && t.cols[0] === '');
      if (kv) continue;
      out.push({ table: sec.heading ?? 'table', part: 'main', cols: t.cols, rows: t.rows.map((r) => r.map((x) => String(x ?? ''))) });
    }
  }
  if (gen.attachment) for (const b of gen.attachment.blocks) out.push({ table: 'attachment', part: 'attachment', cols: b.cols, rows: b.rows.map((r) => r.map((x) => String(x ?? ''))) });
  return out;
}

// -------------------------------------------------------------------------------------------------
// tokens
// -------------------------------------------------------------------------------------------------
const SPACES = /[\u00A0\u2007\u202F\u2009]/g;
/** A line's tokens with the column each starts and ends at (NFKC, lower case, odd spaces made plain). */
function tokenizeAt(s) {
  const line = String(s ?? '').normalize('NFKC').replace(SPACES, ' ');
  return [...line.matchAll(/\S+/g)].map((m) => ({ t: m[0].toLowerCase(), s: m.index, e: m.index + m[0].length }));
}
const tokenize = (s) => tokenizeAt(s).map((x) => x.t);

/**
 * A printed cell as it is looked for. `forms` are the spellings it may take with spacing removed: as
 * printed, and for a negative number also with its minus sign after the digits, which is how a
 * right-to-left page displays "-1,947.42" ("1,947.42-").
 */
function cellOf(text, idx) {
  const tokens = tokenize(text);
  const sq = tokens.join('');
  const forms = [sq];
  if (/^-[\d.,'\u2019]*\d$/.test(sq)) forms.push(`${sq.slice(1)}-`);
  return { idx, text, tokens, sq, forms, sorted: [...tokens].sort().join('\u0001') };
}

/**
 * Does `rem` continue on the next lines, below the cell? A wrapped cell's rest sits under the column
 * the cell starts in, on the next line (or carried over two lines), so the rest must start within
 * WRAP_COL characters of the column where the cell's first part starts.
 */
const WRAP_COL = 6;
function remainderOn(rem, conts, col) {
  const runFrom = (T, from, want, next) => {
    for (let s = 0; s < T.length; s++) {
      if (col != null && Math.abs(T[s].s - col) > WRAP_COL) continue;
      let acc = '';
      for (let e = s; e < T.length; e++) {
        acc += T[e].t;
        if (acc === want) return true;
        if (!want.startsWith(acc)) break;
        if (next && runFrom(next, 0, want.slice(acc.length), null)) return true;
      }
    }
    return false;
  };
  for (let i = 0; i < conts.length; i++) if (runFrom(conts[i], 0, rem, conts[i + 1] ?? null)) return true;
  return false;
}

/** Every place a cell can stand on a line: whole, wrapped (first part here, rest below) or, RTL, permuted. */
function placements(cell, T, conts, rtl, anyColumn = false) {
  const out = [];
  for (const form of cell.forms) {
    for (let s = 0; s < T.length; s++) {
      let acc = '';
      for (let e = s; e < T.length; e++) {
        acc += T[e].t;
        if (acc === form) { out.push({ s, e: e + 1, kind: 'whole' }); break; }
        if (!form.startsWith(acc)) break;
        if (acc.length >= 2 && remainderOn(form.slice(acc.length), conts, anyColumn ? null : T[s].s)) out.push({ s, e: e + 1, kind: 'wrapped' });
      }
    }
  }
  if (rtl && cell.tokens.length >= 2) {
    const k = cell.tokens.length;
    for (let s = 0; s + k <= T.length; s++) if (T.slice(s, s + k).map((x) => x.t).sort().join('\u0001') === cell.sorted) out.push({ s, e: s + k, kind: 'permuted' });
  }
  return out.sort((a, b) => a.s - b.s || a.e - b.e);
}

/** An assignment of one placement per cell, left to right, none overlapping; null when none exists. */
function inOrder(pls) {
  const memo = new Map();
  const go = (i, min) => {
    if (i === pls.length) return [];
    const key = `${i}:${min}`;
    if (memo.has(key)) return memo.get(key);
    let res = null;
    for (const p of pls[i]) { if (p.s < min) continue; const rest = go(i + 1, p.e); if (rest) { res = [p, ...rest]; break; } }
    memo.set(key, res);
    return res;
  };
  return go(0, 0);
}

// -------------------------------------------------------------------------------------------------
// cells under a sticker, from the PDF
// -------------------------------------------------------------------------------------------------
/** The sticker's white box: the barcode image's placement widened by its padding (3px 6px) and border (1px), in points. */
function stickerBox(tm) {
  const [a, b, c, d, e, f] = tm;
  const lu = Math.hypot(a, b), lv = Math.hypot(c, d);
  const pu = (4.5 + 0.75) / lu, pv = (2.25 + 0.75) / lv;
  return { o: [e - pu * a - pv * c, f - pu * b - pv * d], U: [a * (1 + 2 * pu), b * (1 + 2 * pu)], V: [c * (1 + 2 * pv), d * (1 + 2 * pv)] };
}
function inBox(box, x, y) {
  const [ux, uy] = box.U, [vx, vy] = box.V, det = ux * vy - uy * vx;
  if (!det) return false;
  const dx = x - box.o[0], dy = y - box.o[1];
  const s = (dx * vy - dy * vx) / det, t = (ux * dy - uy * dx) / det;
  return s >= 0 && s <= 1 && t >= 0 && t <= 1;
}
/**
 * A character is covered when any part of its ink lies under the sticker's box. Its quad runs from the
 * font's descent to its ascent, beyond the ink, so the test samples nine points inside the quad, at a
 * quarter, half and three quarters of its height and width: a sticker that only grazes the top of the
 * quad leaves the glyphs whole (by-eye/check-consignment-order-164-p1.png, row 1), while one that cuts
 * through the strokes hides them (by-eye/check-consignment-invoice-093-p4.png, rows 101 and 104, whose
 * serial and lot lose their tops to the sticker's edge). Any doubt goes to exclusion: a cell taken out
 * is never charged.
 */
const charCovered = (quad, boxes) => {
  const [ulx, uly, urx, ury, llx, lly, lrx, lry] = quad;
  for (const fx of [0.1, 0.5, 0.9]) {
    const bx = llx + fx * (lrx - llx), by = lly + fx * (lry - lly);
    const tx = ulx + fx * (urx - ulx), ty = uly + fx * (ury - uly);
    for (const fy of [0.25, 0.5, 0.75]) {
      const x = bx + fy * (tx - bx), y = by + fy * (ty - by);
      if (boxes.some((b) => inBox(b, x, y))) return true;
    }
  }
  return false;
};
const bare = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, '');

/**
 * Which printed cells a sticker covers, for one document.
 *
 * The PDF's text layer lists the table's text in document order, one line per cell (two or three for a
 * cell the page wraps), whatever the page's direction, so each printed row is found as a run of
 * consecutive text-layer lines that spell its cells in order: a cell matches one to three consecutive
 * lines whose text, spacing removed, is the cell's, or, as a right-to-left page hands back a cell in
 * display order ("l/h, PVDF head 12"), whose words are the cell's words in any order. Rows are looked
 * for in order, each after the one before; a row not found that way falls back to the characters of
 * the whole text, and a cell still not found is treated as covered (excluded, never charged). Each
 * found cell's characters are then tested against every sticker box on their page.
 */
async function stickerCoverage(file, tables) {
  return withPdf(file, async (docu) => {
    const plines = [];
    const boxes = new Map();
    let stickerImages = 0;
    for (let p = 0; p < docu.countPages(); p++) {
      const page = docu.loadPage(p);
      try {
        const { lines, images } = pageLayer(page);
        for (const l of lines) if (l.text.trim()) plines.push({ page: p, bare: bare(l.text), words: tokenize(l.text), chars: l.chars });
        for (const im of images) {
          if (im.h < 60 || im.h > 80 || im.w / im.h < 5) continue;   // the GS1-128 sticker image (bwip-js, height 9, scale 2)
          stickerImages++;
          if (!boxes.has(p)) boxes.set(p, []);
          boxes.get(p).push(stickerBox(im.tm));
        }
      } finally { page.destroy?.(); }
    }
    const lineCovered = (pl) => { const bx = boxes.get(pl.page); return !!bx && pl.chars.some((ch) => !/\s/.test(ch.c) && charCovered(ch.quad, bx)); };
    /** How many consecutive text-layer lines from i spell this cell (0 when none do). */
    const spell = (i, cell) => {
      const want = bare(cell.text), alt = cell.forms[1] ?? null;
      let joined = '', words = [];
      for (let k = 1; k <= 3 && i + k - 1 < plines.length; k++) {
        joined += plines[i + k - 1].bare;
        words = words.concat(plines[i + k - 1].words);
        if (joined.toLowerCase() === want.toLowerCase() || (alt && joined.toLowerCase() === alt)) return k;
        if (cell.tokens.length > 1 && words.length === cell.tokens.length && [...words].sort().join('\u0001') === cell.sorted) return k;
        if (joined.length >= want.length + 2) break;
      }
      return 0;
    };
    /** The row as a run of lines starting at line i: the lines each non-empty cell takes, or null. */
    const rowAt = (i, cells) => {
      const spans = [];
      let j = i;
      for (const c of cells) {
        if (!c.sq) { spans.push(null); continue; }
        const k = spell(j, c);
        if (!k) return null;
        spans.push([j, j + k]);
        j += k;
      }
      return { spans, end: j };
    };
    // the characters of the whole text, for the fallback
    const stream = [];
    for (const pl of plines) for (const ch of pl.chars) for (const c of ch.c.normalize('NFKC')) if (!/\s/.test(c)) stream.push({ c, page: pl.page, quad: ch.quad });
    const text = stream.map((x) => x.c).join('');
    const coveredRange = (i0, i1) => { for (let i = i0; i < i1; i++) { const x = stream[i]; const bx = boxes.get(x.page); if (bx && charCovered(x.quad, bx)) return true; } return false; };

    const covered = new Map();   // "t:r" -> [cell indexes]
    let cursor = 0, charCursor = 0, rowsByLines = 0, rowsByChars = 0, cellsUnlocated = 0;
    for (const [ti, t] of tables.entries()) {
      for (const [ri, cellsText] of t.rows.entries()) {
        const cells = cellsText.map((x, ci) => cellOf(x, ci));
        const cov = [];
        let found = null;
        for (let i = cursor; i < Math.min(plines.length, cursor + 120) && !found; i++) found = rowAt(i, cells);
        for (let i = 0; i < plines.length && !found; i++) found = rowAt(i, cells);
        if (found) {
          rowsByLines++;
          found.spans.forEach((sp, ci) => { if (sp && plines.slice(sp[0], sp[1]).some(lineCovered)) cov.push(ci); });
          cursor = found.end;
        } else {
          const parts = cellsText.map(bare);
          const rowStr = parts.join('');
          let at = rowStr ? text.indexOf(rowStr, charCursor) : -1;
          if (at < 0 && rowStr) at = text.indexOf(rowStr);
          if (at >= 0) {
            rowsByChars++;
            let k = at;
            parts.forEach((pp, ci) => { if (pp && coveredRange(k, k + pp.length)) cov.push(ci); k += pp.length; });
            charCursor = at + rowStr.length;
          } else {
            cells.forEach((c) => { if (c.sq) { cov.push(c.idx); cellsUnlocated++; } });
          }
        }
        if (cov.length) covered.set(`${ti}:${ri}`, cov);
      }
    }
    return { covered, stickerImages, rowsByLines, rowsByChars, cellsUnlocated, pages: docu.countPages() };
  });
}

// -------------------------------------------------------------------------------------------------
// one document
// -------------------------------------------------------------------------------------------------
/** Placements of a cell on one line of a block, with the line and the columns they occupy. */
function placementsAt(cell, T, li, conts, rtl, anyColumn = false) {
  return placements(cell, T[li], conts, rtl, anyColumn).map((p) => ({ ...p, line: li, c0: T[li][p.s].s, c1: T[li][p.e - 1].e }));
}

/**
 * The cells of a row, one placement each, in reading order over the row's lines: the first cell read
 * stands on the row's first line (a row starts where its first cell does); after it, on one line a
 * cell starts after the previous one ends, and on another line of the row it starts in a column to the
 * right of where the previous one starts. Null when no such assignment exists.
 */
function inOrderOverLines(pls, first) {
  const memo = new Map();
  const go = (i, prev) => {
    if (i === pls.length) return [];
    const key = `${i}:${prev ? `${prev.line}/${prev.s}/${prev.e}` : '-'}`;
    if (memo.has(key)) return memo.get(key);
    let res = null;
    for (const p of pls[i]) {
      const ok = !prev ? p.line === first : (p.line === prev.line ? p.s >= prev.e : p.c0 > prev.c0);
      if (!ok) continue;
      const rest = go(i + 1, p);
      if (rest) { res = [p, ...rest]; break; }
    }
    memo.set(key, res);
    return res;
  };
  return go(0, null);
}

/**
 * What the reading wrote where a sticker hides cells, for a row whose visible cells all stand on one
 * line in order. The hidden cells between two visible ones (or before the first, or after the last)
 * sit in the gap between those cells' tokens on the line; the gap holds a tag ("[obscured]",
 * "[illegible]", "[cut off]"), nothing, the printed value, or some other text (a guess, a partial
 * reading or the sticker's own human-readable line). `row_tagged` says whether the line carries a
 * legibility tag anywhere: the reading writes " [obscured]" at the END of a row a stamp or blot covers,
 * and "[illegible]" in place of a value it cannot read.
 */
const LEGIBILITY_TAG = /\[(?:obscured|illegible|cut off)\]/;
function hiddenCells({ cellsText, judged, assign, toks, dir, stickerWords }) {
  const judgedIdx = judged.map((c) => c.idx);
  const spanOf = new Map(judgedIdx.map((ci, k) => [ci, assign[k]]));
  const groups = [];
  let cur = null;
  cellsText.forEach((text, ci) => {
    const visible = spanOf.has(ci);
    const hiddenHere = !visible && String(text ?? '').trim();
    if (hiddenHere) { if (!cur) { cur = { cells: [], before: null, after: null }; groups.push(cur); } cur.cells.push(ci); return; }
    if (visible) { if (cur) cur.after = ci; cur = null; }
  });
  for (const g of groups) {
    const prevVisible = [...judgedIdx].reverse().find((ci) => ci < g.cells[0]);
    g.before = prevVisible ?? null;
  }
  const logical = dir === 'logical';
  const out = groups.map((g) => {
    // In logical order the gap runs from the end of the cell before to the start of the cell after;
    // a row written as displayed runs the other way along the line.
    const left = logical ? (g.before != null ? spanOf.get(g.before).e : 0) : (g.after != null ? spanOf.get(g.after).e : 0);
    const right = logical ? (g.after != null ? spanOf.get(g.after).s : toks.length) : (g.before != null ? spanOf.get(g.before).s : toks.length);
    const gap = toks.slice(left, Math.max(left, right)).map((x) => x.t);
    const printed = g.cells.map((ci) => cellOf(cellsText[ci], ci).sq).join('');
    const gapText = gap.join(' ');
    const joined = gap.join('');
    const what = LEGIBILITY_TAG.test(gapText) ? 'a legibility tag'
      : !gap.length ? 'nothing'
        : joined === printed ? 'the printed value'
          : printed.includes(joined) ? 'part of the printed value'
            : gap.some((t) => stickerWords.some((w) => t.includes(w))) ? 'the sticker\'s own text'
              : 'another value';
    return { cells: g.cells, wrote: what, ...(what !== 'nothing' && what !== 'the printed value' ? { text: gapText.slice(0, 120) } : {}) };
  });
  return { row_tagged: toks.some((x) => LEGIBILITY_TAG.test(x.t)), gaps: out };
}

export function judgeDocument({ doc, gen, tables, reading, coverage, rtl }) {
  // what each sticker prints under its bars: the GTIN, lot and serial of its GS1 payload
  const stickerWords = (gen.content.stickers ?? []).flatMap((st) => String(st.text).toLowerCase().split(/\(\d{2}\)/).filter((w) => w.length >= 6));
  const lines = String(reading ?? '').split('\n');
  const T = lines.map(tokenizeAt);
  // token -> lines (a cell's tokens, and a prefix of its first token for a wrapped cell's first part)
  const index = new Map();
  const add = (k, li) => { let s = index.get(k); if (!s) index.set(k, (s = new Set())); s.add(li); };
  T.forEach((toks, li) => { for (const x of toks) add(x.t, li); });
  const linesWith = (tok) => index.get(tok) ?? new Set();
  // How often each cell's text is printed in this document: only a cell printed once can be traced.
  const printedCount = new Map();
  for (const t of tables) for (const r of t.rows) for (const x of r) { const k = cellOf(x, 0).sq; if (k) printedCount.set(k, (printedCount.get(k) ?? 0) + 1); }
  const isMarkerOrBlank = (li) => !lines[li]?.trim() || /# --- \| Page \d+ \| --- #/.test(lines[li]);

  // ---- pass 1: each row's main line, the line holding most of its cells; pass when they are all there, in order
  const rows = [];
  for (const [ti, t] of tables.entries()) {
    for (const [ri, cellsText] of t.rows.entries()) {
      const covered = new Set(coverage?.get(`${ti}:${ri}`) ?? []);
      const judged = cellsText.map((x, ci) => cellOf(x, ci)).filter((c) => c.sq && !covered.has(c.idx));
      const base = { table: t.table, part: t.part, row: ri, cells: cellsText.length, covered_cells: [...covered].sort((x, y) => x - y) };
      if (judged.length < 2) { rows.push({ base, judged, excluded: true, cellsText }); continue; }
      const score = new Map();
      for (const c of judged) {
        const hit = new Set();
        for (const tk of c.tokens) for (const li of linesWith(tk)) hit.add(li);
        for (const f of c.forms.slice(1)) for (const li of linesWith(f)) hit.add(li);
        const first = c.tokens[0] ?? '';
        for (let k = Math.min(first.length - 1, 24); k >= 2; k--) for (const li of linesWith(first.slice(0, k))) hit.add(li);
        for (const li of hit) score.set(li, (score.get(li) ?? 0) + 1);
      }
      const cands = [...score.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, 12).map(([li]) => li);
      let best = null;
      for (const li of cands) {
        const conts = T.slice(li + 1, li + 1 + CONT_LINES);
        const pls = judged.map((c) => placements(c, T[li], conts, rtl));
        const present = pls.filter((p) => p.length).length;
        let dir = null, assign = inOrder(pls);
        if (assign) dir = 'logical';
        else if (rtl) { const rev = inOrder([...pls].reverse()); if (rev) { assign = rev.reverse(); dir = 'as displayed (first column last)'; } }
        const cand = { li, present, dir, assign };
        if (dir) { best = cand; break; }
        if (!best || present > best.present) best = cand;
      }
      rows.push({ base, judged, best, cellsText });
    }
  }

  // ---- pass 2: a row the main line alone does not settle is judged over its own lines: the main line and
  // the lines below it, up to two, before the next row's main line, a page marker or a blank line.
  const mainLines = new Set(rows.filter((r) => r.best && r.best.present >= 2).map((r) => r.best.li));
  const results = [];
  for (const r of rows) {
    const { base, judged, best } = r;
    if (r.excluded) { results.push({ ...base, verdict: 'excluded', why: 'fewer than two cells left to judge' }); continue; }
    if (!best || best.present < 2) { results.push({ ...base, verdict: 'fail', reason: 'row not found', judged: judged.map((c) => c.text) }); continue; }
    if (best.dir) {
      const hidden = base.covered_cells.length ? hiddenCells({ cellsText: r.cellsText, judged, assign: best.assign, toks: T[best.li], dir: best.dir, stickerWords }) : null;
      results.push({ ...base, verdict: 'pass', line: best.li, lines: 1, direction: best.dir, wrapped: best.assign.filter((p) => p.kind === 'wrapped').length, permuted: best.assign.filter((p) => p.kind === 'permuted').length, ...(hidden ? { hidden } : {}) });
      continue;
    }
    const block = [best.li];
    for (let k = best.li + 1; k <= best.li + 2 && k < lines.length; k++) { if (mainLines.has(k) || isMarkerOrBlank(k)) break; block.push(k); }
    const pls = judged.map((c) => block.flatMap((li) => placementsAt(c, T, li, T.slice(li + 1, li + 1 + CONT_LINES), rtl)).sort((x, y) => x.line - y.line || x.s - y.s));
    let dir = null, assign = inOrderOverLines(pls, best.li);
    if (assign) dir = 'logical';
    else if (rtl) { const rev = inOrderOverLines([...pls].reverse(), best.li); if (rev) { assign = rev.reverse(); dir = 'as displayed (first column last)'; } }
    if (dir) {
      results.push({ ...base, verdict: 'pass', line: best.li, lines: block.length, direction: dir, wrapped: assign.filter((p) => p.kind === 'wrapped').length, permuted: assign.filter((p) => p.kind === 'permuted').length, cells_below_main_line: assign.filter((p) => p.line !== best.li).length });
      continue;
    }
    const missing = judged.filter((c, k) => !pls[k].length);
    const shown = { line: best.li, line_text: lines[best.li].slice(0, 300), next_lines: lines.slice(best.li + 1, best.li + 3).map((l) => l.slice(0, 200)), judged: judged.map((c) => c.text) };
    // Would the row stand if a wrapped cell's rest could sit under any column? Then the only fault is
    // that the rest of a wrapped cell was written under a neighbouring column: reported as such.
    const loose = judged.map((c) => block.flatMap((li) => placementsAt(c, T, li, T.slice(li + 1, li + 1 + CONT_LINES), rtl, true)).sort((x, y) => x.line - y.line || x.s - y.s));
    if (inOrderOverLines(loose, best.li) || (rtl && inOrderOverLines([...loose].reverse(), best.li))) {
      results.push({ ...base, verdict: 'fail', reason: 'a wrapped cell\'s rest under another column', ...shown });
      continue;
    }
    if (!missing.length) { results.push({ ...base, verdict: 'fail', reason: 'out of order', ...shown }); continue; }
    // Where are the cells that are not in the row's lines? A cell printed once in the document, and long
    // enough to be told apart, is looked for on every other line: found elsewhere, it is out of place;
    // found nowhere, its text is not in the reading (misread, dropped or marked unreadable).
    const where = missing.map((c) => {
      if (c.sq.length < 4) return { cell: c.text, found: 'not traceable (short)' };
      if ((printedCount.get(c.sq) ?? 0) > 1) return { cell: c.text, found: 'not traceable (printed in several rows)' };
      const cands2 = new Set([...linesWith(c.tokens[0] ?? '')]);
      if (c.forms[1]) for (const li of linesWith(c.forms[1])) cands2.add(li);
      const elsewhere = [...cands2].some((li) => !block.includes(li) && placements(c, T[li], [], rtl).length > 0);
      return { cell: c.text, found: elsewhere ? 'on another line' : 'nowhere in the reading' };
    });
    const reason = where.some((w) => w.found === 'on another line') ? 'cells on another line'
      : where.some((w) => w.found === 'nowhere in the reading') ? 'cell text not in the reading'
        : 'cells not in the row\'s lines (not traceable)';
    results.push({ ...base, verdict: 'fail', reason, ...shown, missing: where });
  }
  // Two rows read onto one line are not two rows in their order: both fail.
  const byLine = new Map();
  for (const x of results) if (x.verdict === 'pass') byLine.set(x.line, (byLine.get(x.line) ?? 0) + 1);
  for (const x of results) if (x.verdict === 'pass' && byLine.get(x.line) > 1) { x.verdict = 'fail'; x.reason = 'two rows on one line'; x.line_text = lines[x.line].slice(0, 300); }
  return results;
}

export async function readingOrder() {
  const ctx = context();
  const docs = [];
  const tally = { rows: 0, judged: 0, strict: 0, relaxed: 0, excluded_rows: 0, excluded_documents: 0, rows_in_excluded_documents: 0, covered_cells: 0, gt_text_rows_checked: 0, gt_text_rows_missing: 0, strict_with_wrapped_cell: 0, strict_with_permuted_words: 0 };
  const reasons = {}, groups = {};
  const bump = (g, k, v) => { groups[g] ??= {}; groups[g][k] ??= { judged: 0, passed: 0, passed_relaxed: 0 }; for (const f of ['judged', 'passed', 'passed_relaxed']) groups[g][k][f] += v[f]; };
  for (const doc of ctx.manifest.docs) {
    const gen = generated(doc, ctx.seed);
    const tables = printedTables(gen);
    const rtl = gen.content.dir === 'rtl';
    // the printed rows are the correct text's rows, line for line
    const gtLines = new Set(ctx.corpus.text(doc).split('\n'));
    let missingInGt = 0, rowsHere = 0;
    for (const t of tables) for (const r of t.rows) { rowsHere++; if (!gtLines.has(pipeRow(r))) missingInGt++; }
    tally.rows += rowsHere; tally.gt_text_rows_checked += rowsHere; tally.gt_text_rows_missing += missingInGt;
    const stickers = gen.content.stickers?.length ?? 0;
    const heavy = doc.dims?.noise === 'heavy';
    const docRow = { id: doc.id, slug: doc.slug, locale: doc.locale, direction: rtl ? 'rtl' : 'ltr', noise: doc.dims?.noise ?? null, stickers, rows: rowsHere, rows_not_in_correct_text: missingInGt };
    if (stickers && heavy) {
      tally.excluded_documents++; tally.rows_in_excluded_documents += rowsHere;
      docs.push({ ...docRow, excluded: 'heavy-noise PDF with stickers: no text layer to find the cells under the stickers' });
      continue;
    }
    let coverage = null;
    if (stickers) {
      // Stickers are printed on the main file only; an attachment's rows are never covered.
      const cov = await stickerCoverage(path.join(ctx.corpusDir, doc.file), tables.map((t) => (t.part === 'main' ? t : { ...t, rows: [] })));
      coverage = cov.covered;
      docRow.sticker_images = cov.stickerImages;
      docRow.coverage = { rows_located_line_by_line: cov.rowsByLines, rows_located_in_the_character_stream: cov.rowsByChars, cells_not_located_and_excluded: cov.cellsUnlocated, rows_with_covered_cells: cov.covered.size, covered_cells: [...cov.covered.values()].reduce((a, v) => a + v.length, 0) };
      tally.covered_cells += docRow.coverage.covered_cells;
    }
    const raw = pipelineRaw(ctx, doc.id);
    const res = judgeDocument({ doc, gen, tables, reading: raw?.ocr_text ?? '', coverage, rtl });
    const j = res.filter((r) => r.verdict !== 'excluded');
    const relaxed = j.filter((r) => r.verdict === 'pass');
    // Strict: every judged cell starts on the row's one line. A row that needed its next lines passes only relaxed.
    const strict = relaxed.filter((r) => !(r.cells_below_main_line > 0));
    tally.judged += j.length; tally.strict += strict.length; tally.relaxed += relaxed.length; tally.excluded_rows += res.length - j.length;
    tally.strict_with_wrapped_cell += strict.filter((r) => r.wrapped > 0).length;
    tally.strict_with_permuted_words += strict.filter((r) => r.permuted > 0).length;
    for (const r of j) {
      if (r.verdict === 'fail') reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
      else if (r.cells_below_main_line > 0) reasons['cells moved to the row\'s next line (passes relaxed)'] = (reasons['cells moved to the row\'s next line (passes relaxed)'] ?? 0) + 1;
    }
    const v = (rows) => ({ judged: rows.length, passed: rows.filter((r) => r.verdict === 'pass' && !(r.cells_below_main_line > 0)).length, passed_relaxed: rows.filter((r) => r.verdict === 'pass').length });
    bump('by_type', doc.slug, v(j)); bump('by_locale', doc.locale, v(j)); bump('by_noise', doc.dims?.noise ?? 'none', v(j));
    for (const t of new Set(j.map((r) => r.table))) bump('by_table', t, v(j.filter((r) => r.table === t)));
    if (stickers) bump('by_stickers', 'documents with stickers (excluded cells removed)', v(j)); else bump('by_stickers', 'documents without stickers', v(j));
    if (rtl) for (const r of strict) bump('rtl_direction', r.direction, { judged: 1, passed: 1, passed_relaxed: 1 });
    docs.push({
      ...docRow, judged: j.length, passed: strict.length, passed_relaxed: relaxed.length, excluded_rows: res.length - j.length,
      verdicts: res.map((r) => (r.verdict === 'pass'
        ? { t: r.table, row: r.row, v: r.cells_below_main_line > 0 ? 'pass relaxed' : 'pass', dir: r.direction === 'logical' ? 'L' : 'D', line: r.line, ...(r.wrapped ? { wrapped: r.wrapped } : {}), ...(r.permuted ? { permuted: r.permuted } : {}), ...(r.lines > 1 ? { lines: r.lines, below: r.cells_below_main_line } : {}), ...(r.covered_cells.length ? { covered: r.covered_cells } : {}), ...(r.hidden ? { hidden: r.hidden } : {}) }
        : r)),
    });
  }
  const withRate = (g) => Object.fromEntries(Object.entries(g ?? {}).sort().map(([k, x]) => [k, { judged: x.judged, passed: x.passed, rate: rate(x.passed, x.judged), passed_relaxed: x.passed_relaxed, rate_relaxed: rate(x.passed_relaxed, x.judged) }]));
  const byEye = readJsonOr(path.join(ctx.outDir, 'by-eye', 'verdicts.json'))?.reading_order ?? null;
  const ordered = tally.strict + (reasons['out of order'] ?? 0) + (reasons['two rows on one line'] ?? 0);
  const figure = {
    id: 'reading-order',
    capability: 'Reading order (Read layer), table rows',
    unit: 'rows',
    numerator: tally.strict,
    denominator: tally.judged,
    rate: rate(tally.strict, tally.judged),
    relaxed: {
      numerator: tally.relaxed, denominator: tally.judged, rate: rate(tally.relaxed, tally.judged),
      definition: 'As the headline, except that whole cells may also stand on the row\'s next two lines (before the next row\'s line), in reading order by column, the row\'s first cell on its first line.',
    },
    breakdown: {
      rows_printed: tally.rows,
      printed_rows_checked_against_correct_text: { rows: tally.gt_text_rows_checked, missing_from_correct_text: tally.gt_text_rows_missing },
      excluded_documents: tally.excluded_documents,
      rows_in_excluded_documents: tally.rows_in_excluded_documents,
      cells_covered_by_stickers_excluded: tally.covered_cells,
      rows_excluded_with_fewer_than_two_cells_left: tally.excluded_rows,
      judged_rows: tally.judged,
      not_passing_by_reason: reasons,
      not_passing_note: 'Reasons are a best attribution, not a second measure: "cell text not in the reading" means a judged cell could not be found as written anywhere in the reading (misread, dropped or marked unreadable), which Printed text already counts; "out of order", "cells on another line", "two rows on one line" and "cells moved to the row\'s next line" are order and row-structure faults; "a wrapped cell\'s rest under another column" means the row stands only if a wrapped cell\'s second part may sit under a neighbouring column; "not traceable" means a missing cell is too short, or printed in several rows, to say where it went.',
      passes_with_a_wrapped_cell_continued_below: tally.strict_with_wrapped_cell,
      passes_with_a_cells_words_in_display_order: tally.strict_with_permuted_words,
      out_of_order_among_rows_with_every_cell_on_its_line: { out_of_order: (reasons['out of order'] ?? 0) + (reasons['two rows on one line'] ?? 0), of: ordered, rate_in_order: rate(tally.strict, ordered) },
      by_table: withRate(groups.by_table),
      by_type: withRate(groups.by_type),
      by_locale: withRate(groups.by_locale),
      by_noise: withRate(groups.by_noise),
      by_stickers: withRate(groups.by_stickers),
      right_to_left_passes_by_direction: Object.fromEntries(Object.entries(groups.rtl_direction ?? {}).map(([k, x]) => [k, x.passed])),
    },
    by_eye: byEye,
    definition: 'A row passes when one line of the page-lane reading holds every judged cell of the printed row, starting in reading order with no overlap: logical (first column first) on left-to-right pages; on right-to-left (ar-AE) pages logical or as displayed (first column last), one direction for the whole row. A cell is found as whole tokens, spacing ignored; a cell the page itself wraps may continue on the next three lines, under the column it starts in; on right-to-left pages a cell\'s words and a negative number\'s minus sign may stand in display order. Two rows on one line both fail. Numerator: rows that pass. Denominator: judged rows (every row of every printed repeating table, less the excluded).',
    caveats: [
      'Computed after the run from kept outputs and the corpus PDFs; not part of the AIDP Score; a diagnostic under spec section 7.6.',
      `Cells physically covered by a barcode sticker are excluded (${tally.covered_cells} cells), located from each PDF's geometry (any of nine sample points of a character's ink under the sticker's box); the ${tally.excluded_documents} heavy-noise consignment documents, whose PDFs keep no text layer, are excluded whole (${tally.rows_in_excluded_documents} rows). The geometry was checked by eye on three pages (by-eye/check-*.png).`,
      'A row also fails when a judged cell is misread or dropped (a content fault Printed text already counts); the reasons separate those from order faults, and "out_of_order_among_rows_with_every_cell_on_its_line" gives order alone.',
      `Right-to-left rows are accepted in either direction because the platform writes them both ways, sometimes within one document (${groups.rtl_direction?.['as displayed (first column last)']?.passed ?? 0} passing right-to-left rows as displayed, ${groups.rtl_direction?.logical?.passed ?? 0} logical); a row that mixes the two fails.`,
      'The population is every row of every repeating table the corpus prints (line items, bank transactions, freight charges, attachment breakdowns), taken from the generator and verified row for row against each document\'s correct text.',
    ],
  };
  return { figure, docs };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ctx = context();
  const { figure, docs } = await readingOrder();
  writeJsonl(path.join(ctx.outDir, 'reading-order.jsonl'), docs);
  console.log(JSON.stringify(figure, null, 1));
}
