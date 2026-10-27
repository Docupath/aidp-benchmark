/**
 * AIDP-CAP: a document's page as HTML, drawn only from its cells (cap/build.mjs), so the PDF and the answer key
 * can never disagree.
 *
 * Every page is drawn twice. The PAGE is what the system receives. The MAP is the same HTML with each printed value
 * in a colour of its own and a one-character marker in each mark, label and occlusion, also in a colour of its own:
 * colour changes nothing about where text lands, so reading the map's text layer back (cap/pdf.mjs) gives the page,
 * the position and the size of every value, mark and label exactly as the page prints them. Traceability is judged
 * against those positions. The map is never sent to a system.
 */
import { textOf } from './build.mjs';
import { PAGE_FONTS, faceCss } from './fonts.mjs';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// AIDP-2K's four looks, drawn with the shipped open fonts (fonts.mjs) instead of the drawing machine's own
const THEMES = [
  { font: "'AIDP Sans'", accent: '#1a3c6e', head: '#eef2f7' },
  { font: "'AIDP Serif'", accent: '#5b2120', head: '#f6efe7' },
  { font: "'AIDP Mono'", accent: '#222', head: '#eee' },
  { font: "'AIDP Sans'", accent: '#0b5e4f', head: '#e9f4f1' },
];
const JP_FONT = "'AIDP Japanese'";
const AR_FONT = "'AIDP Arabic', 'AIDP Sans'";

/** The colour of map entry i: cells in red 1, marks, labels and occlusions in red 2. Printed text is never either. */
export const mapColour = (kind, i) => `rgb(${kind === 'cell' ? 1 : 2},${(i >> 8) & 255},${i & 255})`;

function noiseCss(profile, scanned) {
  const layers = [];
  const skew = profile === 'none' ? 0 : profile === 'light' ? 0.4 : profile === 'medium' ? 1.1 : 2.2;
  if (profile === 'medium' || profile === 'heavy') {
    layers.push('<div style="position:fixed;top:0;left:30%;width:1.5px;height:100%;background:linear-gradient(180deg,rgba(0,0,0,.10),rgba(0,0,0,.02) 40%,rgba(0,0,0,.12));transform:rotate(.6deg);z-index:50"></div>');
    layers.push('<div style="position:fixed;top:62%;left:8%;width:120px;height:90px;border-radius:50%;background:radial-gradient(closest-side,rgba(139,90,43,.13),rgba(139,90,43,0));z-index:50"></div>');
  }
  if (profile === 'heavy') layers.push('<div style="position:fixed;top:38%;left:0;width:100%;height:14px;background:repeating-linear-gradient(90deg,rgba(0,0,0,.16) 0 3px,rgba(0,0,0,0) 3px 7px);opacity:.5;z-index:50"></div>');
  const transform = skew ? `transform:rotate(${skew}deg) scale(.985);` : '';
  // A scan is a picture of the page: the filter makes the browser draw the page as an image, so the PDF has no text.
  const filter = scanned ? (profile === 'heavy' ? 'filter:contrast(.82) brightness(1.04);' : 'filter:contrast(.95) brightness(1.02);') : '';
  return { body: transform, filter, layers: layers.join('') };
}

/**
 * The renderer's state for one drawing: in MAP mode it hands out colours and records what each one stands for.
 */
class Pen {
  constructor(map, rtl = false) { this.map = map; this.rtl = rtl; this.cells = []; this.marks = []; }
  cell(x) {
    if (Array.isArray(x)) return x.map((y) => this.cell(y)).join('');
    if (x == null) return '';
    if (typeof x !== 'object') return esc(x);
    if (!x.v) return '';
    let inner = esc(x.v);
    if (this.map && x.paths.length) {
      const i = this.cells.length + 1;
      this.cells.push({ i, paths: x.paths, text: x.v, occ: x.occ?.id ?? null });
      inner = `<span style="color:${mapColour('cell', i)}">${inner}</span>`;
    }
    if (x.occ) inner = `<span style="position:relative;display:inline-block">${inner}${this.occlusion(x.occ)}</span>`;
    // On a right-to-left page a value keeps its own direction (bdi): "12 l/h, PVDF head" stays in that order instead
    // of being displayed as "l/h, PVDF head 12".
    return this.rtl ? `<bdi>${inner}</bdi>` : inner;
  }
  marker(id, kind) {
    if (!this.map) return '';
    const i = this.marks.length + 1;
    this.marks.push({ i, id, kind });
    return `<span style="position:absolute;left:0;top:0;font:4px 'AIDP Sans';line-height:4px;color:${mapColour('mark', i)}">M</span>`;
  }
  occlusion(o) {
    const m = this.marker(o.id, `occlusion:${o.kind}`);
    if (o.kind === 'blot') return `<span style="position:absolute;left:-7px;right:-7px;top:-4px;bottom:-4px;background:radial-gradient(ellipse at 45% 55%,#0b1633 0 62%,#14224a 70%,#23305c 100%);border-radius:44% 58% 41% 63%/55% 39% 61% 45%;z-index:7">${m}</span>`;
    if (o.kind === 'label') return `<span style="position:absolute;left:-6px;right:-6px;top:-5px;bottom:-5px;background:#fbfbf7;border:1px solid #9a9a9a;box-shadow:1px 1px 2px rgba(0,0,0,.25);z-index:7;font:7px 'AIDP Sans';color:#555;text-align:center;overflow:hidden;line-height:9px">BIN&#160;07${m}</span>`;
    return `<span style="position:absolute;left:50%;top:50%;width:58px;height:58px;margin:-29px 0 0 -29px;border:4px solid rgba(112,72,32,.30);border-radius:50%;z-index:7">${m}</span>`;
  }
}

const markImg = (pen, m, src, style) => `<span style="position:relative;display:inline-block;${style}">${pen.marker(m.id, `mark:${m.kind}`)}<img src="${src}" style="display:block;max-width:100%"></span>`;

/** The page of one document. `assets` holds the drawn images: marks, labels and barcodes, by id. */
export function pageHtml(d, assets, { map = false } = {}) {
  const ct = d.content;
  const pen = new Pen(map, ct.dir === 'rtl');
  const loc = ct.locale;
  const L = loc.labels;
  const t = THEMES[d.theme % THEMES.length];
  const font = loc.lang === 'ja' ? JP_FONT : loc.lang === 'ar' ? AR_FONT : t.font;
  const noise = noiseCss(ct.noiseProfile, d.scanned && !map);
  const marks = ct.marks ?? [];
  const mk = (place) => marks.filter((m) => m.place === place);
  const cellTd = (x, cls = '') => `<td class="${cls}">${pen.cell(x)}</td>`;
  const kv = (rows) => `<table class="kv">${rows.map((r) => `<tr><td class="k">${pen.cell(r.label ?? r[0])}</td><td>${pen.cell(r.value ?? r[1])}</td></tr>`).join('')}</table>`;
  let inner = '';

  if (ct.coverPage) {
    inner += `<div style="height:88vh;display:flex;flex-direction:column;justify-content:center;align-items:center">
      <div style="font-size:26px;font-weight:bold;color:${t.accent}">${pen.cell(ct.seller.name)}</div>
      <div style="margin-top:18px;font-size:15px">Document Transmittal</div>
      <div style="margin-top:8px;color:#555">Please find the enclosed document. / Anbei das Dokument.</div></div>
    <div style="page-break-after:always"></div>`;
  }
  const S = ct.seller;
  inner += `<div class="head"><div><div class="brand">${pen.cell(S.name)}</div>
    <div class="sub">${pen.cell(S.street)}, ${pen.cell(S.postal)} ${pen.cell(S.city)}, ${pen.cell(S.country)}</div>
    ${S.vat ? `<div class="sub">${esc(L.vatNo)}: ${pen.cell(S.vat)}</div>` : ''}</div>
    <div class="title">${esc(ct.title)}</div></div>`;
  for (const b of (ct.barcodes ?? []).filter((x) => x.place === 'header')) inner += `<div class="bc header" style="position:relative;display:inline-block">${pen.marker(b.id, 'barcode')}<img src="${assets.barcodes[b.id]}" style="height:44px"></div>`;
  // a stamp has a band of its own between the header and the parties, so it covers no printed value
  for (const m of mk('top')) inner += `<div style="height:92px;position:relative">${markImg(pen, m, assets.marks[m.id], `position:absolute;left:46%;top:14px;transform:rotate(${m.rot}deg);opacity:.86`)}</div>`;

  const partyBlock = (label, p) => `<div class="party"><div class="plabel">${esc(label)}</div>
    <div><b>${pen.cell(p.name)}</b></div><div>${pen.cell(p.street)}</div><div>${pen.cell(p.postal)} ${pen.cell(p.city)}</div><div>${pen.cell(p.country)}</div>
    ${p.vat ? `<div>${esc(L.vatNo)}: ${pen.cell(p.vat)}</div>` : ''}</div>`;

  if (ct.kind === 'commercial') {
    inner += `<div class="cols"><div>${partyBlock(L.billTo, ct.buyer)}</div><div>${kv(ct.metaRows)}</div></div>`;
    for (const m of mk('header')) inner += `<div style="height:48px;position:relative">${markImg(pen, m, assets.marks[m.id], 'position:absolute;right:4%;top:2px;max-width:46%')}</div>`;
    const cols = ct.itemCols;
    const head = `<thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>`;
    const body = ct.rows.map((row, i) => {
      const ticks = marks.filter((m) => m.kind === 'tick' && m.row === i);
      const tds = cols.map((c, ci) => {
        // a tick is drawn in the line's first cell, before its number, where a person ticks a line off
        const tick = ci === 0 && ticks.length ? markImg(pen, ticks[0], assets.marks[ticks[0].id], 'width:15px;vertical-align:middle;margin-right:3px') : '';
        return `<td class="${c.num ? 'num' : ''}">${tick}${pen.cell(row[c.k])}</td>`;
      }).join('');
      const label = row.label ? `<tr class="lbl"><td colspan="${cols.length}" style="border-top:none;padding:2px 6px 5px 30px">${labelHtml(pen, row.label, assets)}</td></tr>` : '';
      // a line and the label stuck under it are one group, never split across a page break
      return `<tbody class="keep"><tr>${tds}</tr>${label}</tbody>`;
    }).join('');
    inner += `<table class="grid">${head}${body}</table>`;
    if (ct.totalsRows.length) inner += `<div class="totals">${ct.totalsRows.map((r) => `<div class="trow ${r.em ? 'em' : ''}"><span>${pen.cell(r.label)}</span><span>${pen.cell(r.value)}</span></div>`).join('')}</div>`;
    inner += `<div class="pay"><div class="plabel">${esc(L.payment)}</div>${kv(ct.paymentRows)}</div>`;
  } else {
    inner += `<div class="cols"><div>${partyBlock(L.from ?? 'From', S)}</div><div>${partyBlock(L.billTo ?? 'To', ct.buyer)}</div></div>`;
    for (const m of mk('header')) inner += `<div style="height:48px;position:relative">${markImg(pen, m, assets.marks[m.id], 'position:absolute;right:4%;top:2px;max-width:46%')}</div>`;
    for (const sec of ct.sections ?? []) {
      if (sec.heading) inner += `<div class="sech">${esc(sec.heading)}</div>`;
      const tb = sec.table;
      if (!tb) continue;
      if (tb.cols.every((c) => c === '')) inner += kv(tb.rows);
      else inner += `<table class="grid"><thead><tr>${tb.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${tb.rows.map((r) => `<tr>${r.map((x, i) => cellTd(x, i === r.length - 1 ? 'num' : '')).join('')}</tr>`).join('')}</tbody></table>`;
    }
  }
  for (const b of (ct.barcodes ?? []).filter((x) => x.place !== 'header')) inner += `<div class="bc ${b.place}" style="position:relative">${pen.marker(b.id, 'barcode')}<img src="${assets.barcodes[b.id]}" style="height:86px"></div>`;
  for (const m of mk('end')) {
    if (m.kind === 'signature') inner += `<div style="margin-top:20px;width:42%;position:relative"><div style="height:56px;position:relative">${markImg(pen, m, assets.marks[m.id], 'position:absolute;left:8px;bottom:-6px;max-width:100%')}</div><div style="border-top:1px solid #444;font-size:9.5px;color:#444;padding-top:2px">Approved by</div></div>`;
    else inner += `<div style="margin-top:14px;height:46px;position:relative">${markImg(pen, m, assets.marks[m.id], 'position:absolute;left:2%;top:0;max-width:60%')}</div>`;
  }
  if (ct.footerNote) inner += `<div class="foot">${esc(ct.footerNote)}</div>`;

  const html = `<!doctype html><html dir="${ct.dir}"><head><meta charset="utf-8"><style>
    ${faceCss(PAGE_FONTS)}
    @page { size: A4; margin: 14mm; }
    body { font-family: ${font}; font-size: 11px; color: #1b1b1b; ${noise.body} ${noise.filter} }
    .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid ${t.accent}; padding-bottom:8px; }
    .brand { font-size:19px; font-weight:bold; color:${t.accent}; }
    .sub { color:#555; font-size:9.5px; }
    .title { font-size:21px; font-weight:bold; color:${t.accent}; text-align:${ct.dir === 'rtl' ? 'left' : 'right'}; max-width: 46%; }
    .cols { display:flex; justify-content:space-between; gap:18px; margin:14px 0; }
    .party { font-size:11px; line-height:1.45; }
    .plabel { font-weight:bold; color:${t.accent}; margin-bottom:3px; text-transform:uppercase; font-size:9.5px; letter-spacing:.6px; }
    table.kv { border-collapse:collapse; font-size:10.5px; min-width:230px; }
    table.kv td { padding:2.5px 8px; border-bottom:1px solid #e3e3e3; }
    table.kv td.k { color:#444; font-weight:bold; white-space:nowrap; }
    table.grid { width:100%; border-collapse:collapse; margin:10px 0; font-size:10px; }
    table.grid th { background:${t.head}; border:1px solid #c9c9c9; padding:4px 6px; text-align:${ct.dir === 'rtl' ? 'right' : 'left'}; }
    table.grid td { border:1px solid #d9d9d9; padding:3.5px 6px; vertical-align:top; }
    table.grid td.num { text-align:right; white-space:nowrap; }
    tr.lbl td { background:#fff; }
    thead { display: table-header-group; }
    tr, tbody.keep { break-inside: avoid; }
    .totals { margin-left:auto; width:46%; margin-top:8px; }
    .trow { display:flex; justify-content:space-between; padding:3px 8px; border-bottom:1px solid #e3e3e3; }
    .trow.em { font-weight:bold; font-size:13px; border-top:2px solid ${t.accent}; border-bottom:2px solid ${t.accent}; }
    .pay { margin-top:16px; }
    .sech { font-weight:bold; color:${t.accent}; margin:14px 0 5px; font-size:12px; }
    .bc { margin-top:14px; } .bc.footer { text-align:center; } .bc.payment { float:right; }
    .foot { margin-top:22px; color:#555; font-size:9.5px; border-top:1px solid #ddd; padding-top:6px; }
  </style></head><body>${map ? '' : noise.layers}${inner}</body></html>`;
  return { html, cells: pen.cells, marks: pen.marks };
}

function labelHtml(pen, id, assets) {
  return `<span style="position:relative;display:inline-block;background:#fff;border:1px solid #bbb;padding:3px 6px;box-shadow:1px 2px 4px rgba(0,0,0,.25)">${pen.marker(id, 'label')}<img src="${assets.labels[id]}" style="height:${assets.labelHeights?.[id] ?? 34}px;display:block"></span>`;
}

/** An attachment that arrives with the document. Its text is not keyed: Intake asks only that its pages are read. */
export function attachmentHtml(att, d, assets) {
  const ct = d.content;
  const loc = ct.locale;
  const L = loc.labels;
  const number = textOf(ct.metaRows?.find((x) => x.key === 'number')?.value ?? ct.sections?.[0]?.table?.rows?.[0]?.[1]);
  const buyer = ct.buyer;
  let inner = `<div class="head"><div class="brand">${esc(textOf(ct.seller.name))}</div><div class="sub">${esc(att.title)}</div></div>`;
  if (att.kind === 'letter') {
    inner += `<p>${esc(textOf(buyer.name))}<br>${esc(textOf(buyer.street))}<br>${esc(textOf(buyer.postal))} ${esc(textOf(buyer.city))}</p>`;
    for (const p of att.paragraphs) inner += `<p class="para">${esc(p)}</p>`;
    inner += `<p>${esc(att.closing)}</p>`;
  } else {
    inner += `<p class="para">${esc(att.intro)}</p><table class="grid"><thead><tr>${att.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${att.rows.map((r) => `<tr>${r.map((x) => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    if (att.footer) inner += `<p class="para">${esc(att.footer)}</p>`;
  }
  const scan = att.scanned ? 'filter:contrast(.93) brightness(1.03);transform:rotate(.5deg) scale(.99);' : '';
  const font = loc.lang === 'ja' ? JP_FONT : loc.lang === 'ar' ? AR_FONT : "'AIDP Sans'";
  return `<!doctype html><html dir="${ct.dir}"><head><meta charset="utf-8"><style>
    ${faceCss(PAGE_FONTS)}
    @page { size: A4; margin: 16mm; } body { font-family: ${font}; font-size: 11px; color:#1b1b1b; ${scan} }
    .head { display:flex; justify-content:space-between; border-bottom:3px solid #444; padding-bottom:8px; margin-bottom:12px; }
    .brand { font-size:17px; font-weight:bold; } .sub { color:#555; font-size:13px; font-weight:bold; }
    .para { line-height:1.5; } table.grid { width:100%; border-collapse:collapse; margin:8px 0; font-size:10px; }
    table.grid th { background:#eee; border:1px solid #c9c9c9; padding:4px 6px; text-align:left; }
    table.grid td { border:1px solid #d9d9d9; padding:3.5px 6px; }
  </style></head><body>${inner}${number ? '' : ''}</body></html>`;
}
