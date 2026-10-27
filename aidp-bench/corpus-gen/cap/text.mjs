/**
 * AIDP-CAP: each document's correct text, laid out as a page reading is (page markers, pipe tables), for the text
 * lane that Instructions is measured in, and for the reading-order check. Built from the same cells the page is
 * drawn from. A value made unreadable on the page (an occlusion) is not in it, and neither is anything a mark or a
 * label carries: the correct text of a page is what the page legibly prints in type.
 */
import { textOf } from './build.mjs';

const ROWS_PER_PAGE = 38;
const t = (x) => (Array.isArray(x) ? x.map(t).join('') : x && typeof x === 'object' && 'v' in x ? (x.occ?.hidden ? '' : x.v) : String(x ?? ''));
const pipeRow = (cells) => `| ${cells.map((c) => t(c).replace(/\|/g, '/')).join(' | ')} |`;

export function capText(d) {
  const ct = d.content;
  const L = ct.locale.labels;
  const pages = [];
  let cur = [];
  const push = (line = '') => cur.push(line);
  const breakPage = () => { pages.push(cur.join('\n')); cur = []; };
  if (ct.coverPage) { push(textOf(ct.seller.name)); push(''); push('Document Transmittal'); push('Please find the enclosed document. / Anbei das Dokument.'); breakPage(); }
  const S = ct.seller;
  push(t(S.name));
  push(`${t(S.street)}, ${t(S.postal)} ${t(S.city)}, ${t(S.country)}`);
  if (S.vat) push(`${L.vatNo}: ${t(S.vat)}`);
  push(''); push(ct.title); push('');
  if (ct.kind === 'commercial') {
    push(L.billTo ?? 'Bill To');
    const B = ct.buyer;
    push(t(B.name)); push(t(B.street)); push(`${t(B.postal)} ${t(B.city)}`); push(t(B.country));
    if (B.vat) push(`${L.vatNo}: ${t(B.vat)}`);
    push('');
    for (const r of ct.metaRows) push(pipeRow([r.label, r.value]));
    push('');
    push(pipeRow(ct.itemCols.map((c) => c.label)));
    let n = 0;
    for (const row of ct.rows) {
      push(pipeRow(ct.itemCols.map((c) => row[c.k])));
      if (++n >= ROWS_PER_PAGE) { breakPage(); push(pipeRow(ct.itemCols.map((c) => c.label))); n = 0; }
    }
    push('');
    for (const r of ct.totalsRows) push(pipeRow([r.label, r.value]));
    push(''); push(L.payment);
    for (const r of ct.paymentRows) push(pipeRow([r.label, r.value]));
  } else {
    for (const [label, p] of [[L.from ?? 'From', S], [L.billTo ?? 'To', ct.buyer]]) {
      push(label); push(t(p.name)); push(t(p.street)); push(`${t(p.postal)} ${t(p.city)}`); push(t(p.country));
      if (p.vat) push(`${L.vatNo}: ${t(p.vat)}`);
      push('');
    }
    for (const sec of ct.sections ?? []) {
      // a table without a heading still starts on a line of its own, so it is never read as rows of the table before it
      if (sec.heading) { push(''); push(sec.heading); } else push('');
      const tb = sec.table;
      if (!tb) continue;
      const isKv = tb.cols.every((c) => c === '');
      if (!isKv) push(pipeRow(tb.cols));
      for (const row of tb.rows) push(pipeRow(row));
    }
  }
  if (ct.footerNote) { push(''); push(ct.footerNote); }
  breakPage();
  return pages.map((p, i) => `# --- | Page ${i + 1} | --- #\n\n${p}`).join('\n\n');
}
