/**
 * AIDP-CAP: the customer's supplier list, and the ways a document prints a supplier's name.
 *
 * Resolution asks whether the right entry of the customer's own supplier list was identified. The list is
 * generated here from the seed, published with the documents, and given to the system as the customer's
 * reference data. It holds SUPPLIERS_PER_LOCALE suppliers in each of the twelve locales. A third of them have a
 * sibling: a second entry with the same name stem and a different legal entity (another legal form, a holding or
 * group company, another line of business) at another address, which is where real supplier lists go wrong.
 *
 * Every supplier has a code (the value a customer's records use for it), a legal name, a VAT or registration
 * number, an address of its own and, for most, an approved bank account (the account the customer has on file), written
 * as its country writes accounts (accountFor).
 *
 * Construction guarantees one right answer for every document: the page prints either the supplier's VAT number,
 * or a form of its name together with its address, and `resolvable` checks that no other entry of the list fits
 * the printed name and address as well. A document drawn from outside the list (an unlisted supplier) has the
 * right answer "no match".
 */
import { Rng } from '../rng.mjs';
import { LOCALES } from '../lex.mjs';
import { ibanCheckDigits } from '../data.mjs';

export const SUPPLIERS_PER_LOCALE = 15;

// Name parts per locale: stems, lines of business and legal forms, and two banks of street names with a house
// number drawn per supplier, so every entry has its own address.
const PARTS = {
  'en-US': { stems: ['Northwind', 'Crestview', 'Bluepeak', 'Harborline', 'Summit', 'Ironbridge', 'Lakeshore', 'Pinecrest', 'Redstone', 'Silverline', 'Oakmont', 'Brightwater', 'Westfield', 'Eastgate', 'Clearwater', 'Highland'],
    lines: ['Trading', 'Supplies', 'Industries', 'Foods', 'Medical', 'Logistics', 'Components', 'Packaging'], forms: ['Inc', 'LLC', 'Corp'],
    streets: ['Industrial Parkway', 'Commerce Drive', 'Madison Avenue', 'Harbor Road', 'Main Street', 'Lake Street'], streetFirst: false },
  'en-GB': { stems: ['Albion', 'Thamesview', 'Granite', 'Westbrook', 'Kingsway', 'Pennine', 'Severn', 'Cotswold', 'Mercia', 'Wessex', 'Tyneside', 'Chiltern', 'Ashdown', 'Bramley', 'Hartley', 'Langdale'],
    lines: ['Components', 'Logistics', 'Pharma', 'Engineering', 'Supplies', 'Foods', 'Packaging', 'Tools'], forms: ['Ltd', 'PLC', 'LLP'],
    streets: ['King Street', 'Riverside Way', 'Station Road', 'Mill Lane', 'High Street', 'Church Road'], streetFirst: false },
  'de-DE': { stems: ['Müller', 'Schwarzwald', 'Rheinland', 'Bayerische', 'Nordsee', 'Hanse', 'Elbtal', 'Taunus', 'Allgäuer', 'Spreewald', 'Harzer', 'Moselland', 'Weser', 'Donau', 'Odenwald', 'Isar'],
    lines: ['Industrietechnik', 'Medizintechnik', 'Logistik', 'Werkzeuge', 'Verpackung', 'Elektronik', 'Chemie', 'Handel'], forms: ['GmbH', 'AG', 'GmbH & Co. KG', 'KG'],
    streets: ['Hauptstraße', 'Industrieweg', 'Berliner Allee', 'Bahnhofstraße', 'Gewerbering', 'Am Hafen'], streetFirst: true },
  'de-CH': { stems: ['Helvetia', 'Alpina', 'Zürichsee', 'Rigi', 'Jura', 'Aare', 'Säntis', 'Pilatus', 'Gotthard', 'Limmat', 'Emmental', 'Toggenburg', 'Engadin', 'Bodensee', 'Thurgau', 'Seeland'],
    lines: ['Präzision', 'Medical', 'Handels', 'Technik', 'Logistik', 'Werkzeug', 'Pharma', 'Elektro'], forms: ['AG', 'GmbH', 'SA'],
    streets: ['Bahnhofstrasse', 'Industriestrasse', 'Seestrasse', 'Hauptstrasse', 'Gewerbestrasse', 'Dorfstrasse'], streetFirst: true },
  'ja-JP': { stems: ['山田', '東京', '大阪', '北海', '富士', '中部', '九州', '関東', '瀬戸', '信州', '常盤', '桜井', '青葉', '白鳥', '高橋', '日向'],
    lines: ['製作所', '精密機器', '商事', '物産', '化学', '電機', '工業', '医療器'], forms: ['株式会社'],
    streets: ['中央区銀座', '港区芝浦', '千代田区丸の内', '北区梅田', '中区栄', '博多区博多駅前'], streetFirst: true, ja: true },
  'fr-FR': { stems: ['Lumière', 'Provence', 'Horizon', 'Bretagne', 'Loire', 'Garonne', 'Alsace', 'Rhône', 'Normandie', 'Vendôme', 'Cévennes', 'Saône', 'Picardie', 'Aquitaine', 'Ardèche', 'Lorraine'],
    lines: ['Industrie', 'Distribution', 'Médical', 'Logistique', 'Emballage', 'Outillage', 'Chimie', 'Électronique'], forms: ['SAS', 'SARL', 'SA'],
    streets: ['Rue de la République', 'Avenue Victor Hugo', 'Boulevard Pasteur', 'Rue du Commerce', 'Avenue Jean Jaurès', 'Rue de Paris'], streetFirst: false, numFirst: true },
  'es-ES': { stems: ['Ibérica', 'Mediterráneo', 'Norte', 'Castilla', 'Cantábrico', 'Levante', 'Andalucía', 'Galicia', 'Aragón', 'Navarra', 'Duero', 'Ebro', 'Tajo', 'Sierra', 'Costa Brava', 'Montserrat'],
    lines: ['Distribuciones', 'Talleres', 'Suministros', 'Logística', 'Embalajes', 'Herramientas', 'Química', 'Electrónica'], forms: ['S.L.', 'S.A.'],
    streets: ['Calle Mayor', 'Avenida Diagonal', 'Calle de Alcalá', 'Paseo de Gracia', 'Calle Industria', 'Avenida del Puerto'], streetFirst: true, lineFirst: true },
  'sv-SE': { stems: ['Nordiska', 'Svea', 'Mälardalen', 'Vättern', 'Norrland', 'Skåne', 'Dala', 'Göta', 'Vänern', 'Kalmar', 'Uppland', 'Bergslagen', 'Halland', 'Gotland', 'Jämtland', 'Värmland'],
    lines: ['Verktyg', 'Logistik', 'Kemi', 'Industri', 'Medicinteknik', 'Förpackning', 'Elektronik', 'Handel'], forms: ['AB'],
    streets: ['Kungsgatan', 'Industrivägen', 'Storgatan', 'Hamngatan', 'Fabriksgatan', 'Järnvägsgatan'], streetFirst: true },
  'ar-AE': { stems: ['الخليج', 'الإمارات', 'النخيل', 'الصحراء', 'الواحة', 'الريان', 'الفجر', 'اللؤلؤ', 'الجزيرة', 'السلام', 'المنارة', 'الأفق', 'الرمال', 'الشروق', 'البحر', 'القمة'],
    lines: ['للتجارة', 'للمعدات الطبية', 'للتوريدات', 'للخدمات اللوجستية', 'للصناعات', 'للتغليف', 'للإلكترونيات', 'للكيماويات'], forms: ['ذ.م.م', 'ش.م.ح'],
    streets: ['شارع الشيخ زايد', 'المنطقة الصناعية', 'شارع الخليج', 'شارع المطار', 'شارع الميناء', 'شارع الاتحاد'], streetFirst: true, ar: true },
  'pt-PT': { stems: ['Atlântico', 'Lusitana', 'Tejo', 'Douro', 'Minho', 'Algarve', 'Mondego', 'Alentejo', 'Estrela', 'Sado', 'Arrábida', 'Lis', 'Vouga', 'Côa', 'Guadiana', 'Sintra'],
    lines: ['Distribuição', 'Ferramentas', 'Logística', 'Indústria', 'Embalagens', 'Química', 'Eletrónica', 'Comércio'], forms: ['Lda', 'SA'],
    streets: ['Rua Augusta', 'Avenida da Liberdade', 'Rua do Comércio', 'Avenida da República', 'Rua da Indústria', 'Rua do Porto'], streetFirst: true, lineFirst: true },
  'nl-NL': { stems: ['Van Dijk', 'Hollandse', 'Randstad', 'Zuiderzee', 'Veluwe', 'Brabantse', 'Friese', 'Maas', 'Kennemer', 'Utrechtse', 'Gelderse', 'Waddenzee', 'Twentse', 'Zeeuwse', 'Delftse', 'Haagse'],
    lines: ['Handel', 'Precisie', 'Componenten', 'Logistiek', 'Verpakking', 'Techniek', 'Chemie', 'Elektronica'], forms: ['BV', 'NV'],
    streets: ['Keizersgracht', 'Industrieweg', 'Havenstraat', 'Stationsweg', 'Kerkstraat', 'Dorpsstraat'], streetFirst: true },
  'en-IN': { stems: ['Bharat', 'Mumbai', 'Ganga', 'Deccan', 'Sahyadri', 'Kaveri', 'Narmada', 'Himalaya', 'Konkan', 'Malabar', 'Vindhya', 'Godavari', 'Indus', 'Coromandel', 'Ashoka', 'Kalinga'],
    lines: ['Components', 'Engineering Works', 'Pharma', 'Logistics', 'Packaging', 'Tools', 'Chemicals', 'Electronics'], forms: ['Pvt Ltd', 'Ltd', 'LLP'],
    streets: ['MIDC Industrial Area', 'MG Road', 'Station Road', 'Ring Road', 'Industrial Estate', 'Nehru Street'], streetFirst: false, plot: true },
};

const localeOf = (id) => LOCALES.find((l) => l.id === id);

function legalName(p, stem, line, form) {
  if (p.ja) return `${form}${stem}${line}`;
  if (p.ar) return `شركة ${stem} ${line} ${form}`;
  return p.lineFirst ? `${line} ${stem} ${form}` : `${stem} ${line} ${form}`;
}
function streetOf(r, p) {
  const s = r.pick(p.streets);
  const n = r.int(1, 240);
  if (p.ja) return `${s}${r.int(1, 9)}-${r.int(1, 30)}-${r.int(1, 20)}`;
  if (p.plot) return `Plot ${n}, ${s}`;
  if (p.numFirst) return `${n} ${s}`;
  return p.streetFirst ? `${s} ${n}` : `${n} ${s}`;
}
/**
 * A bank account as the supplier's own country writes it. Where the country uses IBANs the account is an IBAN of that
 * country's length and layout, with valid check digits (ISO 13616) and a bank code in the BIC of the same country;
 * the United States, India and Japan do not use IBANs, so their suppliers print a domestic account number and a SWIFT
 * code. The account is printed in groups of four, as banks print IBANs, and kept without spaces where a ledger keeps it.
 */
const IBAN_BBAN = {
  DE: (r) => r.digits(18), CH: (r) => r.digits(17), FR: (r) => r.digits(23), ES: (r) => r.digits(20), PT: (r) => r.digits(21),
  SE: (r) => r.digits(20), AE: (r) => r.digits(19),
  GB: (r) => `${letters(r, 4)}${r.digits(14)}`, NL: (r) => `${letters(r, 4)}${r.digits(10)}`,
};
const DOMESTIC = { US: (r) => r.digits(12), IN: (r) => r.digits(14), JP: (r) => r.digits(7) };
function letters(r, n) { let s = ''; for (let i = 0; i < n; i++) s += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[r.int(0, 25)]; return s; }
export const usesIban = (cc) => cc in IBAN_BBAN;
export function accountFor(r, cc) {
  const bic = `${letters(r, 4)}${cc}${letters(r, 1)}${r.digits(1)}`;
  if (DOMESTIC[cc]) return { account: DOMESTIC[cc](r), bic, iban: false };
  const bban = IBAN_BBAN[cc](r);
  const compact = `${cc}${ibanCheckDigits(cc, bban)}${bban}`;
  return { account: compact.replace(/(.{4})/g, '$1 ').trim(), bic, iban: true };
}
export const compactAccount = (a) => String(a ?? '').replace(/\s+/g, '');

/**
 * The supplier list, deterministic from the seed. Entries come in groups: most groups hold one supplier, a third
 * hold two siblings that share the name stem. Codes are unique across the list.
 */
export function supplierList(seed) {
  const r = new Rng(`${seed}:suppliers`);
  const out = [];
  const usedCodes = new Set();
  const usedNames = new Set();
  const usedStreets = new Set();
  for (const loc of LOCALES) {
    const p = PARTS[loc.id];
    const stems = r.shuffle(p.stems);
    let si = 0;
    let n = 0;
    while (n < SUPPLIERS_PER_LOCALE) {
      const stem = stems[si++ % stems.length];
      const group = `${loc.id}:${stem}`;
      const size = n + 2 <= SUPPLIERS_PER_LOCALE && r.chance(0.34) ? 2 : 1;
      const line0 = r.pick(p.lines);
      for (let k = 0; k < size; k++) {
        // A sibling keeps the stem and changes the legal entity: another legal form, a holding or group
        // company, or another line of business.
        let line = line0, form = r.pick(p.forms);
        if (k === 1) {
          const how = r.pick(['form', 'holding', 'line']);
          if (how === 'line') line = r.pick(p.lines.filter((x) => x !== line0));
          else if (how === 'holding') line = p.ja ? `${line0}ホールディングス` : p.ar ? `${line0} القابضة` : `${line0} ${loc.lang === 'de' ? 'Holding' : loc.lang === 'fr' ? 'Groupe' : loc.lang === 'nl' ? 'Groep' : loc.lang === 'sv' ? 'Holding' : loc.lang === 'es' || loc.lang === 'pt' ? 'Grupo' : 'Group'}`;
          else form = p.forms.length > 1 ? r.pick(p.forms.filter((x) => x !== out[out.length - 1].form)) : form;
          if (how === 'form' && p.forms.length === 1) line = r.pick(p.lines.filter((x) => x !== line0));
        }
        const name = legalName(p, stem, line, form);
        if (usedNames.has(name)) continue;
        usedNames.add(name);
        let code;
        do code = `SUP-${r.digits(5)}`; while (usedCodes.has(code));
        usedCodes.add(code);
        const [city, postal] = r.pick(loc.cities);
        const approved = r.chance(0.6);
        let street;
        do street = streetOf(r, p); while (usedStreets.has(`${loc.id}:${street}`)); // every supplier has its own address
        usedStreets.add(`${loc.id}:${street}`);
        const acct = accountFor(r, loc.cc);
        out.push({
          code, locale: loc.id, group, stem, line, form, name,
          vat: loc.vat(r), vat_field: loc.vatField ?? 'VAT No',
          street, postal, city, country: loc.country, cc: loc.cc,
          approved_account: approved ? acct.account : '', approved_bic: approved ? acct.bic : '', account_is_iban: acct.iban,
        });
        n++;
      }
    }
  }
  return out;
}

/** The suppliers that are NOT on the list: same locales and name parts, drawn so no name equals a listed one. */
export function unlistedSupplier(r, locId, list) {
  const p = PARTS[locId];
  const loc = localeOf(locId);
  const names = new Set(list.map((s) => s.name));
  const streets = new Set(list.filter((s) => s.locale === locId).map((s) => s.street));
  for (;;) {
    const stem = r.pick(p.stems), line = r.pick(p.lines), form = r.pick(p.forms);
    const name = legalName(p, stem, line, form);
    if (names.has(name)) continue;
    const [city, postal] = r.pick(loc.cities);
    const street = streetOf(r, p);
    if (streets.has(street)) continue; // its address is no listed supplier's, so an address lookup cannot find it
    return { code: '', locale: locId, group: `${locId}:${stem}:unlisted`, stem, line, form, name, vat: loc.vat(r), vat_field: loc.vatField ?? 'VAT No',
      street, postal, city, country: loc.country, cc: loc.cc, approved_account: '', approved_bic: '', account_is_iban: usesIban(loc.cc) };
  }
}

/**
 * The name as the document prints it. Kinds, with the share of documents that draw each (cap-composition.mjs):
 *   legal      the legal name exactly as listed
 *   no-form    the legal form left off ("Northwind Trading")
 *   upper      the legal name in capital letters
 *   short      the stem and line of business without the legal form, punctuation changed (a trading name)
 *   punct      the legal form written another way ("Inc." for "Inc", "GmbH & Co KG" for "GmbH & Co. KG")
 * Japanese and Arabic names keep their script; their variants drop or move the legal form.
 */
export function printedName(s, kind) {
  const p = PARTS[s.locale];
  if (kind === 'legal') return s.name;
  if (kind === 'upper') return p.ja || p.ar ? s.name : s.name.toUpperCase();
  if (kind === 'no-form' || kind === 'short') {
    if (p.ja) return `${s.stem}${s.line}`;
    if (p.ar) return `${s.stem} ${s.line}`;
    const base = p.lineFirst ? `${s.line} ${s.stem}` : `${s.stem} ${s.line}`;
    return kind === 'short' ? base.replace(/\s+(Group|Holding|Groupe|Groep|Grupo)$/, '') : base;
  }
  if (kind === 'punct') {
    if (p.ja) return `${s.stem}${s.line}(株)`;
    if (p.ar) return s.name.replace(/^شركة /, '');
    const alt = { Inc: 'Inc.', LLC: 'L.L.C.', Corp: 'Corp.', Ltd: 'Limited', PLC: 'plc', LLP: 'L.L.P.', GmbH: 'G.m.b.H.', AG: 'A.G.',
      'GmbH & Co. KG': 'GmbH & Co KG', KG: 'K.G.', SA: 'S.A.', SAS: 'S.A.S.', SARL: 'S.à r.l.', 'S.L.': 'SL', 'S.A.': 'SA', AB: '(publ) AB',
      Lda: 'Lda.', BV: 'B.V.', NV: 'N.V.', 'Pvt Ltd': 'Private Limited' }[s.form] ?? s.form;
    return s.name.slice(0, s.name.length - s.form.length) + alt;
  }
  throw new Error(`unknown name kind ${kind}`);
}

const fold = (x) => String(x ?? '').normalize('NFKC').toLowerCase().replace(/[.,()&'’\-]/g, ' ').replace(/\s+/g, ' ').trim();
const LEGAL_WORDS = new Set(['inc', 'llc', 'l l c', 'corp', 'ltd', 'limited', 'plc', 'llp', 'gmbh', 'g m b h', 'ag', 'a g', 'co', 'kg', 'k g', 'sa', 's a', 'sas', 'sarl', 's à r l', 'sl', 's l', 'ab', 'publ', 'lda', 'bv', 'b v', 'nv', 'n v', 'pvt', 'private', '株式会社', '株', 'ذ م م', 'ش م ح', 'شركة']);
const nameCore = (x) => fold(x).split(' ').filter((w) => w && !LEGAL_WORDS.has(w)).join(' ');

/**
 * Whether a printed form of a supplier, with what else the page prints, picks out exactly one list entry. The
 * generator keeps only documents for which it does: either the VAT number is printed (it is unique in the
 * list), or no other entry has the same name core at the same address.
 */
export function resolvable(list, s, { name, vatPrinted, street, city }) {
  if (vatPrinted) return list.filter((x) => x.vat === s.vat).length <= (s.code ? 1 : 0);
  const core = nameCore(name);
  const rivals = list.filter((x) => x.code !== s.code && (nameCore(x.name).includes(core) || core.includes(nameCore(x.name)))
    && fold(x.street) === fold(street) && fold(x.city) === fold(city));
  return rivals.length === 0;
}

/** The list as the customer files it: one CSV row per supplier. */
export function supplierCsv(list) {
  const cols = ['Supplier Code', 'Supplier Name', 'VAT Number', 'Street', 'Postal Code', 'City', 'Country Code', 'Approved Account', 'Approved BIC'];
  const q = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(','), ...list.map((s) => [s.code, s.name, s.vat, s.street, s.postal, s.city, s.cc, compactAccount(s.approved_account), s.approved_bic].map(q).join(','))].join('\n') + '\n';
}
