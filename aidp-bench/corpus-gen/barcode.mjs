// Real, scannable barcodes via bwip-js, returned as PNG data URLs for embedding in the HTML.
// They are real symbols, so a reader that decodes barcodes is tested on what a scanner would see.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const bwipjs = require('bwip-js');

const cache = new Map();
export async function barcodePng(bcid, text, opts = {}) {
  const key = `${bcid}|${text}|${JSON.stringify(opts)}`;
  if (cache.has(key)) return cache.get(key);
  const matrix = bcid === 'qrcode' || bcid === 'datamatrix';
  const png = await bwipjs.toBuffer({
    bcid, text,
    scale: opts.scale ?? 2,
    ...(matrix ? {} : { height: opts.height && opts.height > 0 ? opts.height : 10 }),
    includetext: matrix ? false : (opts.includetext ?? true),
    textxalign: 'center',
    ...opts.extra,
  });
  const url = `data:image/png;base64,${png.toString('base64')}`;
  cache.set(key, url);
  return url;
}

/** EAN-13 with a valid check digit computed from a 12-digit base. */
export function ean13(base12) {
  const d = base12.slice(0, 12).padStart(12, '0');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (+d[i]) * (i % 2 === 0 ? 1 : 3);
  return d + String((10 - (sum % 10)) % 10);
}

/** GS1-128 AI string: (01) GTIN-14, (10) lot, (17) expiry YYMMDD, (21) serial. */
export function gs1(parts) {
  let s = '';
  if (parts.gtin) s += `(01)${parts.gtin.padStart(14, '0')}`;
  if (parts.expiry) s += `(17)${parts.expiry}`;
  if (parts.lot) s += `(10)${parts.lot}`;
  if (parts.serial) s += `(21)${parts.serial}`;
  return s;
}
