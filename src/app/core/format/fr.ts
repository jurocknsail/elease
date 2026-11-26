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

/**
 * Amount as '1 900 €' (whole) or '1 900,50 €' (with cents; never '1 900,00 €').
 *
 * Intl separates thousands with a narrow no-break space (U+202F) and the euro sign with a no-break
 * space (U+00A0), so an amount never wraps across lines. Any plain space an engine would emit is
 * turned into U+00A0 for the same reason.
 */
export function formatEuro(n: number): string {
  // Anything below half a cent displays as 0, never as '-0 €'.
  const amount = Math.abs(n) < 0.005 ? 0 : n;
  const hasCents = EURO_CENTS.formatToParts(amount).some(
    (part) => part.type === 'fraction' && part.value !== '00',
  );
  return (hasCents ? EURO_CENTS : EURO_WHOLE).format(amount).replace(/\u0020/g, '\u00A0');
}

/** Postal codes are stored as numbers: restore the leading zero of 01000-09999. */
export function formatPostalCode(n: number): string {
  return String(n).padStart(5, '0');
}

/** Characters allowed between the digits of a phone number: spaces (incl. no-break), dots, dashes, brackets. */
const PHONE_SEPARATORS = /[\s.\-()]/g;
/** '+33' or '0033', an optional trunk '0' (as in '+33 (0)6...'), then the 9 remaining digits. */
const FRENCH_INTERNATIONAL = /^(?:\+|00)330?(\d{9})$/;
const FRENCH_NATIONAL = /^0\d{9}$/;

/**
 * Normalises a French phone number to the 10-digit national form '0612345678'. Spaces, dots,
 * dashes, brackets, '+33', '0033' and '(0)' are accepted. Blank input gives ''. Anything that is
 * not recognisable as a French number is returned trimmed but otherwise untouched. Never throws.
 */
export function normalizePhone(input: string): string {
  // Defensive: the stored value can be missing at run time.
  const trimmed = typeof input === 'string' ? input.trim() : '';
  if (trimmed === '') {
    return '';
  }

  const compact = trimmed.replace(PHONE_SEPARATORS, '');
  const international = FRENCH_INTERNATIONAL.exec(compact);
  if (international) {
    return '0' + international[1];
  }
  if (FRENCH_NATIONAL.test(compact)) {
    return compact;
  }
  return trimmed;
}

/** A phone number is optional: empty is valid, otherwise it must normalise to 10 digits starting with 0. */
export function isValidPhone(input: string): boolean {
  const normalized = normalizePhone(input);
  return normalized === '' || FRENCH_NATIONAL.test(normalized);
}

/** Date from a millisecond timestamp, as dd/MM/yyyy in local time. Callers handle 0 ("never"). */
export function formatDate(ms: number): string {
  const date = new Date(ms);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}
