/** French (fr-FR) formatting helpers: amounts, postal codes, phone numbers, dates. */

const EURO_WHOLE = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const EURO_CENTS = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Shown for a value that is not a finite number (en dash). */
const NO_AMOUNT = '\u2013';

/**
 * Amount as '1 900 €' (whole) or '1 900,50 €' (with cents; never '1 900,00 €'). A value that is not
 * finite shows an en dash.
 *
 * The amount is first rounded with `toFixed(2)`, exactly as the PDF prints amounts, so what the screen
 * shows always equals what the PDF bills (Intl alone rounds half to even and can differ by a cent).
 *
 * Intl separates thousands with a narrow no-break space (U+202F) and the euro sign with a no-break
 * space (U+00A0), so an amount never wraps across lines. Any plain space an engine would emit is
 * turned into U+00A0 for the same reason.
 */
export function formatEuro(n: number): string {
  if (!Number.isFinite(n)) {
    return NO_AMOUNT;
  }
  const rounded = Number(n.toFixed(2));
  // Zero displays as 0, never as '-0 €'.
  const amount = rounded === 0 ? 0 : rounded;
  return (Number.isInteger(amount) ? EURO_WHOLE : EURO_CENTS)
    .format(amount)
    .replace(/\u0020/g, '\u00A0');
}

/** Postal codes are stored as numbers: restore the leading zero of 01000-09999. */
export function formatPostalCode(n: number): string {
  return String(n).padStart(5, '0');
}

/** Characters allowed between the digits of a phone number: spaces (incl. no-break), dots, dashes, brackets. */
const PHONE_SEPARATORS = /[\s.\-()]/g;
/**
 * Invisible direction and zero-width characters that iOS Contacts and WhatsApp add when copying a
 * number: U+200B-U+200F, U+202A-U+202E, U+2060-U+2069, U+FEFF.
 */
const INVISIBLE_CHARACTERS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
/** '+33' or '0033', an optional trunk '0' (as in '+33 (0)6...'), then the 9 remaining digits. */
const FRENCH_INTERNATIONAL = /^(?:\+|00)330?(\d{9})$/;
const FRENCH_NATIONAL = /^0\d{9}$/;
const FRENCH_COUNTRY_PREFIX = /^(?:\+|00)33/;
/** Ten digits, whatever the first one: everything the legacy validator accepted. */
const TEN_DIGITS = /^\d{10}$/;
/** International form of any country, E.164 shape: '+' or '00', then 7 to 15 digits. */
const INTERNATIONAL = /^(?:\+|00)[1-9]\d{6,14}$/;

function withoutSeparators(value: string): string {
  return value.replace(PHONE_SEPARATORS, '');
}

/**
 * Normalises a French phone number to the 10-digit national form '0612345678'. Invisible direction
 * and zero-width characters are removed first; then spaces, dots, dashes, brackets, '+33', '0033'
 * and '(0)' are accepted. Blank input gives ''. Anything that is not recognisable as a French number
 * is returned trimmed (and cleaned of invisible characters) but otherwise untouched. Never throws.
 */
export function normalizePhone(input: string): string {
  // Defensive: the stored value can be missing at run time.
  const trimmed = typeof input === 'string' ? input.replace(INVISIBLE_CHARACTERS, '').trim() : '';
  if (trimmed === '') {
    return '';
  }

  const compact = withoutSeparators(trimmed);
  const international = FRENCH_INTERNATIONAL.exec(compact);
  if (international) {
    return '0' + international[1];
  }
  if (FRENCH_NATIONAL.test(compact)) {
    return compact;
  }
  return trimmed;
}

/**
 * The phone number is optional and used nowhere else, so only obvious garbage is refused. Valid:
 * empty; a +33 / 0033 number that normalises to the 10-digit French form; otherwise ten digits
 * (what the legacy validator accepted) or an international number of any other country
 * ('+' or '00' then 7 to 15 digits), which is kept as typed.
 */
export function isValidPhone(input: string): boolean {
  const normalized = normalizePhone(input);
  if (normalized === '') {
    return true;
  }
  const compact = withoutSeparators(normalized);
  if (FRENCH_COUNTRY_PREFIX.test(compact)) {
    return FRENCH_NATIONAL.test(normalized);
  }
  return TEN_DIGITS.test(compact) || INTERNATIONAL.test(compact);
}

/** Date from a millisecond timestamp, as dd/MM/yyyy in local time. Callers handle 0 ("never"). */
export function formatDate(ms: number): string {
  const date = new Date(ms);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}

/**
 * The number typed in a French field, or `null` when it is not one. Accepts « 1 234,56 », « 1234.56 »,
 * « 1.234,56 », « 12 € », « 12 » and « ,5 ». Spaces (no-break and narrow no-break ones too, all matched by `\s`) are thousands separators and a
 * euro sign is ignored. A single `.` or `,` is the decimal mark; when both appear, the last one is.
 * A sign is kept so that the caller can refuse a negative amount. Blank input is `null`, not 0.
 */
export function parseFrenchNumber(input: string): number | null {
  if (typeof input !== 'string') {
    return null;
  }
  const compact = input.replace(/\s/g, '').replaceAll('€', '');
  if (compact === '') {
    return null;
  }
  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  const decimalMark = Math.max(lastComma, lastDot);
  let normalized = compact;
  if (decimalMark >= 0) {
    // Whatever precedes the decimal mark may carry the OTHER symbol as a thousands separator; the same
    // symbol twice (« 1,2,3 ») is not a number.
    const mark = compact[decimalMark];
    if (compact.indexOf(mark) !== decimalMark) {
      return null;
    }
    const integerPart = compact.slice(0, decimalMark).replace(/[.,]/g, '');
    normalized = `${integerPart}.${compact.slice(decimalMark + 1)}`;
  }
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(normalized)) {
    return null;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** A number as it is edited in a French field: no thousands separator, comma as decimal mark. */
export function toFieldNumber(value: number): string {
  return String(value).replace('.', ',');
}
