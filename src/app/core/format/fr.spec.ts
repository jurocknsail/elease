import { formatDate, formatEuro, formatPostalCode, isValidPhone, normalizePhone } from './fr';

/** Intl uses narrow no-break (U+202F) and no-break (U+00A0) spaces: compare with plain spaces. */
function plain(text: string): string {
  return text.replace(/[\u00A0\u202F]/g, ' ');
}

describe('formatEuro', () => {
  it('has no decimals for whole amounts', () => {
    expect(plain(formatEuro(1900))).toBe('1 900 €');
    expect(plain(formatEuro(300))).toBe('300 €');
    expect(plain(formatEuro(8420))).toBe('8 420 €');
    expect(plain(formatEuro(0))).toBe('0 €');
  });

  it('always has two decimals when there are cents', () => {
    expect(plain(formatEuro(1900.5))).toBe('1 900,50 €');
    expect(plain(formatEuro(246.8))).toBe('246,80 €');
    expect(plain(formatEuro(1653.8))).toBe('1 653,80 €');
    expect(plain(formatEuro(1234567.891))).toBe('1 234 567,89 €');
  });

  it('absorbs floating-point noise instead of showing it', () => {
    expect(plain(formatEuro(0.1 + 0.2 + 0.3))).toBe('0,60 €');
    expect(plain(formatEuro(1653.8000000000002))).toBe('1 653,80 €');
    expect(plain(formatEuro(1899.999))).toBe('1 900 €');
    expect(plain(formatEuro(1900.001))).toBe('1 900 €');
  });

  it('formats negative amounts and never shows a negative zero', () => {
    expect(plain(formatEuro(-12.5))).toBe('-12,50 €');
    expect(plain(formatEuro(-1900))).toBe('-1 900 €');
    expect(plain(formatEuro(-0.001))).toBe('0 €');
    expect(plain(formatEuro(-0))).toBe('0 €');
  });

  it('only uses non-breaking spaces, so an amount never wraps across lines', () => {
    const wholeAmount = formatEuro(1900);
    const withCents = formatEuro(1234567.5);

    expect(wholeAmount).not.toContain('\u0020');
    expect(withCents).not.toContain('\u0020');
    expect(wholeAmount).toMatch(/^1[\u00A0\u202F]900[\u00A0\u202F]€$/);
    expect(withCents).toMatch(/^1[\u00A0\u202F]234[\u00A0\u202F]567,50[\u00A0\u202F]€$/);
  });
});

describe('formatPostalCode', () => {
  it('pads to five digits (codes 01000 to 09999 are stored as numbers without their zero)', () => {
    expect(formatPostalCode(1000)).toBe('01000');
    expect(formatPostalCode(6000)).toBe('06000');
    expect(formatPostalCode(9999)).toBe('09999');
    expect(formatPostalCode(0)).toBe('00000');
  });

  it('leaves five-digit codes untouched', () => {
    expect(formatPostalCode(13600)).toBe('13600');
    expect(formatPostalCode(75001)).toBe('75001');
    expect(formatPostalCode(97400)).toBe('97400');
  });
});

describe('formatDate', () => {
  it('is dd/MM/yyyy, zero-padded, in local time', () => {
    expect(formatDate(new Date(2026, 0, 5).getTime())).toBe('05/01/2026');
    expect(formatDate(new Date(2026, 9, 25).getTime())).toBe('25/10/2026');
    expect(formatDate(new Date(2027, 11, 1).getTime())).toBe('01/12/2027');
  });

  it('keeps the local calendar day from the first to the last millisecond of the day', () => {
    expect(formatDate(new Date(2026, 11, 31, 0, 0, 0, 0).getTime())).toBe('31/12/2026');
    expect(formatDate(new Date(2026, 11, 31, 23, 59, 59, 999).getTime())).toBe('31/12/2026');
    expect(formatDate(new Date(2027, 0, 1, 0, 0, 0, 0).getTime())).toBe('01/01/2027');
  });

  it('handles a leap day', () => {
    expect(formatDate(new Date(2028, 1, 29, 12).getTime())).toBe('29/02/2028');
  });
});

describe('normalizePhone', () => {
  it.each([
    ['+33 6 12 34 56 78'],
    ['06.12.34.56.78'],
    ['0612345678'],
    ['06 12 34 56 78'],
    ['+33 (0)6 12 34 56 78'],
    ['0033612345678'],
  ])('%s becomes 0612345678', (input) => {
    expect(normalizePhone(input)).toBe('0612345678');
  });

  it('accepts the other usual separators and prefix spellings', () => {
    expect(normalizePhone('06-12-34-56-78')).toBe('0612345678');
    expect(normalizePhone('+33612345678')).toBe('0612345678');
    expect(normalizePhone('+33(0)612345678')).toBe('0612345678');
    expect(normalizePhone('+33.6.12.34.56.78')).toBe('0612345678');
    expect(normalizePhone('0033 6 12 34 56 78')).toBe('0612345678');
    expect(normalizePhone('0033 (0)6 12 34 56 78')).toBe('0612345678');
    expect(normalizePhone('+33 1 23 45 67 89')).toBe('0123456789');
  });

  it('accepts no-break spaces (copied from a web page or a contact card)', () => {
    expect(normalizePhone('06\u00A012\u00A034\u00A056\u00A078')).toBe('0612345678');
    expect(normalizePhone('+33\u202F6\u202F12\u202F34\u202F56\u202F78')).toBe('0612345678');
  });

  it('trims the input', () => {
    expect(normalizePhone('  0612345678  ')).toBe('0612345678');
    expect(normalizePhone('\t06 12 34 56 78\n')).toBe('0612345678');
  });

  it('turns empty or blank input into an empty string', () => {
    expect(normalizePhone('')).toBe('');
    expect(normalizePhone('   ')).toBe('');
    expect(normalizePhone(' \u00A0 ')).toBe('');
  });

  it('returns what it does not recognise trimmed but otherwise untouched, and never throws', () => {
    expect(normalizePhone('12')).toBe('12');
    expect(normalizePhone('  +44 20 7946 0958 ')).toBe('+44 20 7946 0958');
    expect(normalizePhone('06 12 34')).toBe('06 12 34');
    expect(normalizePhone('abc')).toBe('abc');
    expect(normalizePhone('06 12 34 56 78 poste 12')).toBe('06 12 34 56 78 poste 12');
    expect(normalizePhone('+33 6 12 34 56')).toBe('+33 6 12 34 56');
    expect(normalizePhone('+')).toBe('+');
    expect(normalizePhone('06 12 34 56 789')).toBe('06 12 34 56 789');
  });

  it('is idempotent', () => {
    for (const input of ['+33 6 12 34 56 78', '0612345678', '12', '', '+44 20 7946 0958']) {
      expect(normalizePhone(normalizePhone(input))).toBe(normalizePhone(input));
    }
  });

  it('does not throw when the stored value is missing at run time', () => {
    expect(normalizePhone(undefined as unknown as string)).toBe('');
    expect(normalizePhone(null as unknown as string)).toBe('');
  });
});

describe('isValidPhone', () => {
  it('accepts an empty phone number (the field is optional)', () => {
    expect(isValidPhone('')).toBe(true);
    expect(isValidPhone('   ')).toBe(true);
  });

  it('accepts the usual French spellings', () => {
    expect(isValidPhone('0612345678')).toBe(true);
    expect(isValidPhone('06 12 34 56 78')).toBe(true);
    expect(isValidPhone('06.12.34.56.78')).toBe(true);
    expect(isValidPhone('+33 6 12 34 56 78')).toBe(true);
    expect(isValidPhone('+33 (0)6 12 34 56 78')).toBe(true);
    expect(isValidPhone('0033612345678')).toBe(true);
    expect(isValidPhone('04 42 01 02 03')).toBe(true);
  });

  it('rejects what is not a 10-digit number starting with 0 once normalised', () => {
    expect(isValidPhone('12')).toBe(false);
    expect(isValidPhone('abc')).toBe(false);
    expect(isValidPhone('06 12 34')).toBe(false);
    expect(isValidPhone('06 12 34 56 789')).toBe(false);
    expect(isValidPhone('1234567890')).toBe(false);
    expect(isValidPhone('+44 20 7946 0958')).toBe(false);
    expect(isValidPhone('+33 6 12 34 56')).toBe(false);
    expect(isValidPhone('06 12 34 56 78 poste 12')).toBe(false);
  });
});
