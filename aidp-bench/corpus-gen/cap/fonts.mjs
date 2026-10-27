/**
 * AIDP-CAP's typefaces. Every page and every mark is drawn with openly licensed fonts shipped in fonts/ (SIL Open Font
 * License; each licence beside its font), never with the fonts of the machine that draws it, so the same seed draws
 * the same pages, page breaks and positions on any machine with the same browser. The browser fetches them from a
 * host name that exists only inside the drawing (serveFonts answers it from fonts/).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts');
const HOST = 'https://aidp-fonts.invalid';

/** family -> file: the page fonts, then the handwriting typefaces */
export const PAGE_FONTS = {
  'AIDP Sans': 'NotoSans-Variable.ttf', 'AIDP Serif': 'NotoSerif-Variable.ttf', 'AIDP Mono': 'NotoSansMono-Variable.ttf',
  'AIDP Japanese': 'NotoSansJP-Variable.ttf', 'AIDP Arabic': 'NotoNaskhArabic-Variable.ttf',
};
export function faceCss(families) {
  return Object.entries(families).map(([fam, file]) => `@font-face{font-family:'${fam}';src:url('${HOST}/${file}') format('truetype');font-weight:100 900;}`).join('');
}
/** Answers the drawing's font requests from fonts/; any other request outside the page is refused. */
export async function serveFonts(page) {
  await page.route(`${HOST}/**`, (route) => {
    const file = path.join(FONT_DIR, path.basename(new URL(route.request().url()).pathname));
    if (!file.startsWith(FONT_DIR) || !fs.existsSync(file)) return route.fulfill({ status: 404 });
    return route.fulfill({ status: 200, contentType: 'font/ttf', body: fs.readFileSync(file) });
  });
}
/** The fonts and their SHA-256 fingerprints, for the manifest. */
export function fontRecord() {
  return Object.fromEntries(fs.readdirSync(FONT_DIR).filter((f) => f.endsWith('.ttf')).sort()
    .map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(FONT_DIR, f))).digest('hex')]));
}
