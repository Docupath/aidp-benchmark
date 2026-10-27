/**
 * AIDP-CAP: the marks a person or a rubber stamp adds to a page, drawn as images.
 *
 * Handwriting is drawn from openly licensed handwriting typefaces (SIL Open Font License; the licences are in
 * fonts/), one letter at a time, each letter tilted, lifted and sized a little differently, in pen colours, so no two
 * notes look alike and none comes from a person. A stamp is a bordered word in stamp ink, tilted, with the gaps a worn
 * rubber stamp leaves. A signature is a name in a flowing script with a stroke beneath it. A tick is a drawn stroke.
 *
 * Every mark is an image, never text, so a page that carries one holds no text for it: the system has to read the
 * picture. Each image is drawn deterministically from the document's seed. (A real hand varies more than a typeface
 * can, which the paper states as a limit of this construction.)
 */
import { Rng } from '../rng.mjs';
import { faceCss, PAGE_FONTS } from './fonts.mjs';

const HAND = ['Caveat-Variable.ttf', 'Kalam-Regular.ttf', 'PatrickHand-Regular.ttf', 'ShadowsIntoLight.ttf', 'IndieFlower-Regular.ttf', 'GochiHand-Regular.ttf', 'CoveredByYourGrace.ttf', 'GloriaHallelujah.ttf', 'ReenieBeanie.ttf', 'NothingYouCouldDo.ttf'];
const SCRIPT = ['MrsSaintDelafield-Regular.ttf', 'LaBelleAurore.ttf', 'DawningofaNewDay.ttf', 'Zeyada.ttf', 'Cedarville-Cursive.ttf'];
const JA = 'Yomogi-Regular.ttf';
const AR = 'ArefRuqaaInk-Regular.ttf';

const ALL = [...HAND, ...SCRIPT, JA, AR];
const familyOf = (file) => `h${ALL.indexOf(file)}`;
const faces = () => faceCss(Object.fromEntries(ALL.map((f) => [familyOf(f), f])));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function handFont(lang, pick) {
  if (lang === 'ja') return JA;
  if (lang === 'ar') return AR;
  return HAND[pick % HAND.length];
}

function noteHtml(m, lang, r) {
  const file = handFont(lang, m.font);
  const size = (lang === 'ja' ? 17 : lang === 'ar' ? 20 : 21) + r.int(0, 6);
  const chars = [...m.text].map((ch) => (ch === ' '
    ? `<span style="display:inline-block;width:${0.28 + r.next() * 0.1}em"></span>`
    : `<span style="display:inline-block;transform:translateY(${((r.next() - 0.5) * 2.6).toFixed(2)}px) rotate(${((r.next() - 0.5) * 8).toFixed(2)}deg) scale(${(0.93 + r.next() * 0.14).toFixed(3)})">${esc(ch)}</span>`)).join('');
  return `<div id="mark" style="display:inline-block;padding:6px 10px;font-family:${familyOf(file)};font-size:${size}px;color:${m.ink};transform:rotate(${((r.next() - 0.5) * 5).toFixed(2)}deg);filter:blur(.2px);white-space:nowrap" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">${chars}</div>`;
}

function stampHtml(m, r) {
  // the gaps a worn stamp leaves: small specks of paper showing through the ink
  const specks = Array.from({ length: 70 }, () => `<circle cx="${(r.next() * 100).toFixed(1)}%" cy="${(r.next() * 100).toFixed(1)}%" r="${(0.4 + r.next() * 1.2).toFixed(2)}" fill="#fff"/>`).join('');
  return `<div id="mark" style="display:inline-block;padding:8px">
    <div style="position:relative;display:inline-block;border:3px solid ${m.ink};border-radius:5px;padding:5px 14px;color:${m.ink};font:900 21px 'AIDP Sans', 'AIDP Japanese', 'AIDP Arabic';letter-spacing:2px;opacity:.9;white-space:nowrap">${esc(m.text)}
      <svg style="position:absolute;inset:0;width:100%;height:100%" preserveAspectRatio="none">${specks}</svg></div></div>`;
}

function signatureHtml(m, lang, r) {
  const file = lang === 'ja' ? JA : lang === 'ar' ? AR : SCRIPT[m.font % SCRIPT.length];
  const size = lang === 'ja' || lang === 'ar' ? 24 : 34 + r.int(0, 6);
  const w = 160 + r.int(0, 60);
  const flourish = `M4 ${30 + r.int(0, 6)} C ${w * 0.3} ${44 + r.int(0, 8)}, ${w * 0.6} ${18 + r.int(0, 8)}, ${w} ${34 + r.int(0, 8)}`;
  return `<div id="mark" style="display:inline-block;position:relative;padding:4px 12px 10px 8px">
    <div style="font-family:${familyOf(file)};font-size:${size}px;color:${m.ink};transform:rotate(${((r.next() - 0.5) * 6).toFixed(2)}deg);white-space:nowrap">${esc(m.text)}</div>
    <svg width="${w}" height="50" style="position:absolute;left:4px;top:${size * 0.55}px"><path d="${flourish}" stroke="${m.ink}" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg></div>`;
}

function tickHtml(m, r) {
  const a = 2 + r.next() * 3, b = 9 + r.next() * 3, c = 18 + r.next() * 4;
  return `<div id="mark" style="display:inline-block;padding:2px"><svg width="24" height="22"><path d="M${a.toFixed(1)} ${(11 + r.next() * 2).toFixed(1)} L ${b.toFixed(1)} ${(18 + r.next() * 2).toFixed(1)} L ${c.toFixed(1)} ${(3 + r.next() * 2).toFixed(1)}" stroke="${m.ink}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
}

/**
 * Draws a document's marks with the browser page given, returning { id: PNG data URL }. Deterministic from the
 * document's seed and each mark's id.
 */
export async function drawMarks(page, d, seed) {
  const out = {};
  const lang = d.content.locale.lang;
  for (const m of d.cap.marks) {
    const r = new Rng(`${seed}:mark:${d.id}:${m.id}`);
    const body = m.kind === 'note' ? noteHtml(m, lang, r) : m.kind === 'stamp' ? stampHtml(m, r) : m.kind === 'signature' ? signatureHtml(m, lang, r) : tickHtml(m, r);
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${faces()}${faceCss(PAGE_FONTS)} body{margin:0;background:transparent}</style></head><body>${body}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    const el = await page.$('#mark');
    const png = await el.screenshot({ omitBackground: true, scale: 'device' });
    out[m.id] = `data:image/png;base64,${png.toString('base64')}`;
  }
  return out;
}
