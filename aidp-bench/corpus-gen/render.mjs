// HTML renderer + noise engine + playwright PDF. Renders ONLY values from the content model (which
// renders only GT values), so the PDF and the ground truth can never disagree.
import { barcodePng } from './barcode.mjs';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const THEMES = [
  { font: "'Helvetica Neue', Arial, sans-serif", accent: '#1a3c6e', head: '#eef2f7' },
  { font: "Georgia, 'Times New Roman', serif", accent: '#5b2120', head: '#f6efe7' },
  { font: "'Courier New', monospace", accent: '#222', head: '#eee' },
  { font: "Verdana, Geneva, sans-serif", accent: '#0b5e4f', head: '#e9f4f1' },
];
const JP_FONT = "'Hiragino Sans', 'Yu Gothic', sans-serif";
const AR_FONT = "'Geeza Pro', 'Arial', sans-serif";

function noiseCss(profile, rngLike) {
  // Deterministic-enough visuals; the exact pixels do not matter, the GT does.
  if (profile === 'none') return { bodyCls: '', layers: '' };
  const skew = profile === 'light' ? 0.4 : profile === 'medium' ? 1.1 : 2.2;
  const layers = [];
  if (profile !== 'light') {
    layers.push(`<div style="position:fixed;top:0;left:30%;width:1.5px;height:100%;background:linear-gradient(180deg,rgba(0,0,0,.10),rgba(0,0,0,.02) 40%,rgba(0,0,0,.12));transform:rotate(.6deg);z-index:50"></div>`); // crease
    layers.push(`<div style="position:fixed;top:62%;left:8%;width:120px;height:90px;border-radius:50%;background:radial-gradient(closest-side,rgba(139,90,43,.13),rgba(139,90,43,0));z-index:50"></div>`); // stain
  }
  if (profile === 'heavy') {
    layers.push(`<div style="position:fixed;top:38%;left:0;width:100%;height:14px;background:repeating-linear-gradient(90deg,rgba(0,0,0,.16) 0 3px,rgba(0,0,0,0) 3px 7px);opacity:.5;z-index:50"></div>`); // fax band
  }
  return { bodyCls: `transform:rotate(${skew}deg) scale(.985);${profile === 'heavy' ? 'filter:contrast(.82) brightness(1.04);' : ''}`, layers: layers.join('') };
}

function stampHtml(text, accent) {
  return `<div style="position:fixed;top:9%;right:7%;border:3px solid ${accent};color:${accent};opacity:.55;padding:4px 14px;font-size:22px;font-weight:bold;transform:rotate(-12deg);z-index:60;letter-spacing:2px">${esc(text)}</div>`;
}

async function stickersHtml(stickers) {
  let out = '';
  for (const s of stickers) {
    const url = await barcodePng(s.bcid, s.text, { scale: 2, height: 9 });
    out += `<div style="position:fixed;top:${s.top}%;left:${s.left}%;transform:rotate(${s.rot}deg);z-index:55;background:#fff;border:1px solid #bbb;padding:3px 6px;box-shadow:1px 2px 4px rgba(0,0,0,.25)"><img src="${url}" style="height:34px"></div>`;
  }
  return out;
}

const partyBlock = (label, p, extra = '') => `
  <div class="party"><div class="plabel">${esc(label)}</div>
    <div><b>${esc(p.name)}</b></div><div>${esc(p.street)}</div>
    <div>${esc(p.postal)} ${esc(p.city)}</div><div>${esc(p.country)}</div>
    ${p.vat ? `<div>${esc(p.vatLabel ?? 'VAT')}: ${esc(p.vat)}</div>` : ''}${extra}
  </div>`;

const kvTable = (rows) => `<table class="kv">${rows.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;
const gridTable = (cols, rows, numIdx = new Set()) => `
  <table class="grid"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${numIdx.has(i) ? 'num' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

export async function toHtml(content, themeIdx, stampMaybe) {
  const loc = content.locale;
  const t = THEMES[themeIdx % THEMES.length];
  const font = loc.lang === 'ja' ? JP_FONT : loc.lang === 'ar' ? AR_FONT : t.font;
  const noise = noiseCss(content.noiseProfile, null);
  const L = loc.labels;
  let inner = '';

  if (content.coverPage) {
    inner += `<div style="height:88vh;display:flex;flex-direction:column;justify-content:center;align-items:center">
      <div style="font-size:26px;font-weight:bold;color:${t.accent}">${esc(content.seller.name)}</div>
      <div style="margin-top:18px;font-size:15px">Document Transmittal</div>
      <div style="margin-top:8px;color:#555">Please find the enclosed document. / Anbei das Dokument.</div></div>
    <div style="page-break-after:always"></div>`;
  }

  inner += `<div class="head"><div><div class="brand">${esc(content.seller.name)}</div>
    <div class="sub">${esc(content.seller.street)}, ${esc(content.seller.postal)} ${esc(content.seller.city)}, ${esc(content.seller.country)}</div>
    ${content.seller.vat ? `<div class="sub">${esc(L.vatNo)}: ${esc(content.seller.vat)}</div>` : ''}
    ${content.seller.reg ? `<div class="sub">${esc(L.regNo)}: ${esc(content.seller.reg)}</div>` : ''}</div>
    <div class="title">${esc(content.title)}</div></div>`;

  if (content.kind === 'commercial' || content.kind === 'receipt') {
    inner += `<div class="cols"><div>${partyBlock(L.billTo, { ...content.buyer, vatLabel: L.vatNo })}</div><div>${kvTable(content.metaRows)}</div></div>`;
    const numIdx = new Set(content.itemCols.map((c, i) => (c.num ? i : -1)).filter((i) => i >= 0));
    inner += gridTable(content.itemCols.map((c) => c.label), content.rows.map((row) => content.itemCols.map((c) => row[c.k] ?? '')), numIdx);
    if (content.totalsRows.length) inner += `<div class="totals">${content.totalsRows.map(([k, v, em]) => `<div class="trow ${em ? 'em' : ''}"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div>`;
    inner += `<div class="pay"><div class="plabel">${esc(L.payment)}</div>${kvTable(content.paymentRows)}</div>`;
  } else {
    // facty: generic sections
    inner += `<div class="cols"><div>${partyBlock(L.from ?? 'From', content.seller)}</div><div>${partyBlock(L.billTo ?? 'To', content.buyer)}</div></div>`;
    for (const sec of content.sections ?? []) {
      if (sec.heading) inner += `<div class="sech">${esc(sec.heading)}</div>`;
      if (sec.paragraphs) inner += sec.paragraphs.map((p) => `<p class="para">${esc(p)}</p>`).join('');
      if (sec.table) inner += sec.table.cols.filter(Boolean).length <= 0 || sec.table.cols.every((c) => c === '')
        ? kvTable(sec.table.rows)
        : (sec.table.cols.length === 2 && sec.table.cols[0] === '' ? kvTable(sec.table.rows) : gridTable(sec.table.cols, sec.table.rows));
    }
  }

  // inline barcodes
  for (const b of content.barcodes ?? []) {
    const url = await barcodePng(b.bcid, b.text, { scale: 2, height: b.bcid === 'qrcode' ? 0 : 10, includetext: b.bcid !== 'qrcode' });
    inner += `<div class="bc ${b.place}"><img src="${url}" style="height:${b.bcid === 'qrcode' ? 86 : 44}px"></div>`;
  }
  if (content.footerNote) inner += `<div class="foot">${esc(content.footerNote)}</div>`;

  const stickers = await stickersHtml(content.stickers ?? []);
  const stamp = stampMaybe ? stampHtml(stampMaybe, t.accent) : '';

  return `<!doctype html><html dir="${content.dir}"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 14mm; }
    body { font-family: ${font}; font-size: 11px; color: #1b1b1b; ${noise.bodyCls} }
    .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid ${t.accent}; padding-bottom:8px; }
    .brand { font-size:19px; font-weight:bold; color:${t.accent}; }
    .sub { color:#555; font-size:9.5px; }
    .title { font-size:21px; font-weight:bold; color:${t.accent}; text-align:${content.dir === 'rtl' ? 'left' : 'right'}; max-width: 46%; }
    .cols { display:flex; justify-content:space-between; gap:18px; margin:14px 0; }
    .party { font-size:11px; line-height:1.45; }
    .plabel { font-weight:bold; color:${t.accent}; margin-bottom:3px; text-transform:uppercase; font-size:9.5px; letter-spacing:.6px; }
    table.kv { border-collapse:collapse; font-size:10.5px; min-width:230px; }
    table.kv td { padding:2.5px 8px; border-bottom:1px solid #e3e3e3; }
    table.kv td.k { color:#444; font-weight:bold; white-space:nowrap; }
    table.grid { width:100%; border-collapse:collapse; margin:10px 0; font-size:10px; }
    table.grid th { background:${t.head}; border:1px solid #c9c9c9; padding:4px 6px; text-align:${content.dir === 'rtl' ? 'right' : 'left'}; }
    table.grid td { border:1px solid #d9d9d9; padding:3.5px 6px; vertical-align:top; }
    table.grid td.num { text-align:right; white-space:nowrap; }
    thead { display: table-header-group; }
    .totals { margin-left:auto; width:46%; margin-top:8px; }
    .trow { display:flex; justify-content:space-between; padding:3px 8px; border-bottom:1px solid #e3e3e3; }
    .trow.em { font-weight:bold; font-size:13px; border-top:2px solid ${t.accent}; border-bottom:2px solid ${t.accent}; }
    .pay { margin-top:16px; }
    .sech { font-weight:bold; color:${t.accent}; margin:14px 0 5px; font-size:12px; }
    .para { line-height:1.55; text-align:justify; }
    .bc { margin-top:14px; } .bc.footer { text-align:center; } .bc.payment { float:right; }
    .foot { margin-top:22px; color:#555; font-size:9.5px; border-top:1px solid #ddd; padding-top:6px; }
  </style></head><body>${noise.layers}${stamp}${stickers}${inner}</body></html>`;
}

export async function attachmentHtml(att) {
  const loc = att.locale;
  let inner = `<div class="head"><div class="brand">${esc(att.title)}</div><div class="sub">Ref: ${esc(att.refDoc)}</div></div>
  <p class="para">This document provides the item-level breakdown for grouped line items in the accompanying document. Each section reconciles to the line total shown therein.</p>`;
  for (const b of att.blocks) {
    inner += `<div class="sech">${esc(b.heading)}</div><div class="sub">${esc(b.refLine)}</div>`;
    inner += gridTable(b.cols, b.rows, new Set([1, 2, 3]));
    inner += `<div class="totals"><div class="trow em"><span>${esc(b.subtotal[0])}</span><span>${esc(b.subtotal[1])}</span></div></div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 14mm; } body { font-family: Arial, sans-serif; font-size: 11px; }
    .head { display:flex; justify-content:space-between; border-bottom:3px solid #444; padding-bottom:8px; }
    .brand { font-size:17px; font-weight:bold; } .sub { color:#555; font-size:10px; margin-bottom:4px; }
    .sech { font-weight:bold; margin:14px 0 3px; } .para { line-height:1.5; }
    table.grid { width:100%; border-collapse:collapse; margin:8px 0; font-size:10px; }
    table.grid th { background:#eee; border:1px solid #c9c9c9; padding:4px 6px; text-align:left; }
    table.grid td { border:1px solid #d9d9d9; padding:3.5px 6px; } table.grid td.num { text-align:right; }
    .totals { margin-left:auto; width:46%; } .trow { display:flex; justify-content:space-between; padding:3px 8px; }
    .trow.em { font-weight:bold; border-top:2px solid #444; }
  </style></head><body>${inner}</body></html>`;
}

export async function renderPdf(page, html) {
  await page.setContent(html, { waitUntil: 'load' });
  return page.pdf({ format: 'A4', printBackground: true });
}
