import { formatDate, formatEuro, formatPostalCode, isValidPhone, normalizePhone } from './fr';

/** Intl uses narrow no-break (U+202F) and no-break (U+00A0) spaces: compare with plain spaces. */
function plain(text: string): string {
  return text.replace(/[\u00A0\u202F]/g, ' ');
}

describe('formatEuro', () => {
  it('has no decimals for whole amounts and two decimals when there are cents', () => {
    expect(plain(formatEuro(1900))).toBe('1 900 €');
    expect(plain(formatEuro(0))).toBe('0 €');
    expect(plain(formatEuro(1900.5))).toBe('1 900,50 €');
    expect(plain(formatEuro(1234567.891))).toBe('1 234 567,89 €');
  });

  it('absorbs floating-point noise, never shows a negative zero, and a dash for a non-finite value', () => {
    expect(plain(formatEuro(0.1 + 0.2 + 0.3))).toBe('0,60 €');
    expect(plain(formatEuro(1653.8000000000002))).toBe('1 653,80 €');
    expect(plain(formatEuro(1899.999))).toBe('1 900 €');
    expect(plain(formatEuro(-12.5))).toBe('-12,50 €');
    expect(plain(formatEuro(-0.001))).toBe('0 €');
    expect(formatEuro(Number.NaN)).toBe('–');
    expect(formatEuro(Number.POSITIVE_INFINITY)).toBe('–');
  });

  it('rounds like toFixed(2), the way the PDF prints amounts', () => {
    // 1.005 is stored as 1.00499999999999989...: toFixed(2) gives '1.00'.
    expect(plain(formatEuro(1.005))).toBe('1 €');
    // Exact half cents: toFixed rounds up, Intl alone would round half to even.
    expect(plain(formatEuro(0.125))).toBe('0,13 €');
    expect(plain(formatEuro(-0.125))).toBe('-0,13 €');
    expect(plain(formatEuro(2.675))).toBe('2,67 €');
  });

  it('only uses non-breaking spaces, so an amount never wraps across lines', () => {
    const withCents = formatEuro(1234567.5);

    expect(withCents).not.toContain(' ');
    expect(withCents).toMatch(/^1[\u00A0\u202F]234[\u00A0\u202F]567,50[\u00A0\u202F]€$/);
  });
});

describe('formatPostalCode', () => {
  it('pads codes stored as numbers to five digits and leaves five-digit codes untouched', () => {
    expect(formatPostalCode(1000)).toBe('01000');
    expect(formatPostalCode(9999)).toBe('09999');
    expect(formatPostalCode(13600)).toBe('13600');
  });
});

describe('formatDate', () => {
  it('is dd/MM/yyyy, zero-padded, in local time, from the first to the last millisecond of the day', () => {
    expect(formatDate(new Date(2026, 0, 5).getTime())).toBe('05/01/2026');
    expect(formatDate(new Date(2026, 11, 31, 23, 59, 59, 999).getTime())).toBe('31/12/2026');
    expect(formatDate(new Date(2027, 0, 1, 0, 0, 0, 0).getTime())).toBe('01/01/2027');
    expect(formatDate(new Date(2028, 1, 29, 12).getTime())).toBe('29/02/2028');
  });
});

describe('normalizePhone', () => {
  it('turns the usual French spellings, separators and prefixes into ten digits', () => {
    for (const input of [
      '+33 6 12 34 56 78',
      '06.12.34.56.78',
      '0612345678',
      '06-12-34-56-78',
      '+33 (0)6 12 34 56 78',
      '0033612345678',
      '  06 12 34 56 78\n',
    ]) {
      expect(normalizePhone(input), input).toBe('0612345678');
    }
  });

  it('accepts no-break spaces and removes invisible bidi and zero-width characters (copied from Contacts or WhatsApp)', () => {
    expect(normalizePhone('06\u00A012\u00A034\u00A056\u00A078')).toBe('0612345678');
    expect(normalizePhone('\u202A+33 6 12 34 56 78\u202C')).toBe('0612345678');
    expect(normalizePhone('06\u200B12\u200D34\u200C56\u206078')).toBe('0612345678');
    expect(isValidPhone('\u202A+33 6 12 34 56 78\u202C')).toBe(true);
    // An unrecognised number is only cleaned of those characters.
    expect(normalizePhone('\u202A+44 20 7946 0958\u202C')).toBe('+44 20 7946 0958');
  });

  it('returns what it does not recognise trimmed but untouched, blank as empty, and never throws', () => {
    expect(normalizePhone('  +44 20 7946 0958 ')).toBe('+44 20 7946 0958');
    expect(normalizePhone('06 12 34 56 789')).toBe('06 12 34 56 789');
    expect(normalizePhone('+33 6 12 34 56')).toBe('+33 6 12 34 56');
    expect(normalizePhone(' \u00A0 ')).toBe('');
    expect(normalizePhone(undefined as unknown as string)).toBe('');
    expect(normalizePhone(null as unknown as string)).toBe('');
  });
});

describe('isValidPhone', () => {
  it('accepts an empty number, ten digits whatever the first, French and foreign international forms', () => {
    for (const value of [
      '',
      '   ',
      '1234567890',
      '04 42 01 02 03',
      '+33 6 12 34 56 78',
      '0033612345678',
      '+44 20 7946 0958',
      '+1 (415) 555-0132',
    ]) {
      expect(isValidPhone(value), value).toBe(true);
    }
  });

  it('rejects obvious garbage, and a +33 or 0033 number that is not a full French number', () => {
    for (const value of [
      '12',
      'abc',
      '06 12 34',
      '12345678901',
      '06 12 34 56 78 poste 12',
      '+',
      '+33 6 12 34 56',
      '+33 6 12 34 56 789',
      '0033 6 12 34 56',
    ]) {
      expect(isValidPhone(value), value).toBe(false);
    }
  });
});
