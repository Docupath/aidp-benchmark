// Canonical page text of the same content model, for the text lane: extraction measured on correct text,
// with reading taken out. Laid out as a page reading is: page markers, pipe tables, "Barcode:/QR Code:" lines.
const ROWS_PER_PAGE = 38;

const pipeRow = (cells) => `| ${cells.map((c) => String(c ?? '').replace(/\|/g, '/')).join(' | ')} |`;

export function gtText(content) {
  const L = content.locale.labels;
  const pages = [];
  let cur = [];
  const push = (line = '') => cur.push(line);
  const breakPage = () => { pages.push(cur.join('\n')); cur = []; };

  if (content.coverPage) {
    push(content.seller.name); push(''); push('Document Transmittal'); push('Please find the enclosed document.');
    breakPage();
  }
  push(content.seller.name);
  push(`${content.seller.street}, ${content.seller.postal} ${content.seller.city}, ${content.seller.country}`);
  if (content.seller.vat) push(`${L.vatNo}: ${content.seller.vat}`);
  if (content.seller.reg) push(`${L.regNo}: ${content.seller.reg}`);
  push(''); push(content.title); push('');
  push(L.billTo ?? 'Bill To');
  push(content.buyer.name); push(content.buyer.street); push(`${content.buyer.postal} ${content.buyer.city}`); push(content.buyer.country);
  if (content.buyer.vat) push(`${L.vatNo}: ${content.buyer.vat}`);
  push('');

  if (content.kind === 'commercial' || content.kind === 'receipt') {
    for (const [k, v] of content.metaRows) push(pipeRow([k, v]));
    push('');
    push(pipeRow(content.itemCols.map((c) => c.label)));
    let rowsOnPage = 0;
    for (const row of content.rows) {
      push(pipeRow(content.itemCols.map((c) => row[c.k] ?? '')));
      if (++rowsOnPage >= ROWS_PER_PAGE) { breakPage(); push(pipeRow(content.itemCols.map((c) => c.label))); rowsOnPage = 0; }
    }
    push('');
    for (const [k, v] of content.totalsRows) push(pipeRow([k, v]));
    push('');
    push(L.payment);
    for (const [k, v] of content.paymentRows) push(pipeRow([k, v]));
  } else {
    for (const sec of content.sections ?? []) {
      if (sec.heading) { push(''); push(sec.heading); }
      if (sec.paragraphs) for (const p of sec.paragraphs) { push(''); push(p); }
      if (sec.table) {
        const isKv = sec.table.cols.every((c) => c === '');
        if (!isKv) push(pipeRow(sec.table.cols));
        let n = 0;
        for (const row of sec.table.rows) { push(pipeRow(row)); if (++n >= ROWS_PER_PAGE) { breakPage(); n = 0; } }
      }
    }
  }
  if (content.footerNote) { push(''); push(content.footerNote); }
  const bcLines = [];
  for (const b of [...(content.barcodes ?? []), ...(content.stickers ?? [])]) {
    bcLines.push(`${b.bcid === 'qrcode' ? 'QR Code' : 'Barcode'}: ${b.text}`);
  }
  if (bcLines.length) { push(''); push('## Barcodes:'); push(''); for (const l of bcLines) { push(l); push(''); push('---'); push(''); } }
  breakPage();
  return pages.map((p, i) => `# --- | Page ${i + 1} | --- #\n\n${p}`).join('\n\n');
}

export function attachmentGtText(att) {
  const lines = [att.title, '', `Ref: ${att.refDoc}`, '', 'This document provides the item-level breakdown for grouped line items in the accompanying document.'];
  for (const b of att.blocks) {
    lines.push('', b.heading, b.refLine, pipeRow(b.cols));
    for (const row of b.rows) lines.push(pipeRow(row));
    lines.push(pipeRow(['', '', b.subtotal[0], b.subtotal[1]]));
  }
  return `# --- | Page 1 | --- #\n\n${lines.join('\n')}`;
}

/** Main and attachment texts combined, with the separators a page reading puts between them. */
export function combine(mainText, attTexts) {
  let out = mainText.trim();
  if (attTexts.length) {
    out += `\n\n##Attachments----------------------------`;
    for (const a of attTexts) out += `\n\n----------------------------\n\n${a.trim()}`;
  }
  return out;
}
