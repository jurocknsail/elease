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

  it('shows an en dash for a value that is not a finite number', () => {
    expect(formatEuro(Number.NaN)).toBe('\u2013');
    expect(formatEuro(Number.POSITIVE_INFINITY)).toBe('\u2013');
    expect(formatEuro(Number.NEGATIVE_INFINITY)).toBe('\u2013');
  });

  it('rounds like toFixed(2), the way the PDF prints amounts', () => {
    // 1.005 is stored as 1.00499999999999989...: toFixed(2) gives '1.00'.
    expect((1.005).toFixed(2)).toBe('1.00');
    expect(plain(formatEuro(1.005))).toBe('1 €');
    // Exact half cents: toFixed rounds up, Intl alone would round half to even.
    expect((0.125).toFixed(2)).toBe('0.13');
    expect(plain(formatEuro(0.125))).toBe('0,13 €');
    expect(plain(formatEuro(-0.125))).toBe('-0,13 €');
    expect(plain(formatEuro(8.345))).toBe('8,35 €');
    expect(plain(formatEuro(2.675))).toBe('2,67 €');
  });

  it('always agrees with toFixed(2) on a few hundred values', () => {
    /** The expected text built from toFixed(2) alone: grouped integer part, comma, no ',00'. */
    function fromToFixed(value: number): string {
      const fixed = value.toFixed(2);
      const negative = fixed.startsWith('-') && Number(fixed) !== 0;
      const [integer, decimals] = fixed.replace('-', '').split('.');
      const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
      return (negative ? '-' : '') + grouped + (decimals === '00' ? '' : ',' + decimals) + ' €';
    }

    const values: number[] = [];
    for (let k = -200; k <= 200; k++) {
      values.push(k * 0.005, k * 1.005, k * 12.345, k * 1234.5678);
    }
    let seed = 12345;
    for (let i = 0; i < 200; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      values.push((seed / 2147483648) * 20000 - 10000);
    }
    values.push(0.1 + 0.2, 0.1 + 0.2 + 0.3, 1653.8000000000002, 1234 * 0.2 + 1234 + 123 + 50);

    expect(values.length).toBeGreaterThan(600);
    for (const value of values) {
      expect(plain(formatEuro(value))).toBe(fromToFixed(value));
    }
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

  it('removes invisible bidi and zero-width characters (numbers copied from Contacts or WhatsApp)', () => {
    expect(normalizePhone('\u202A+33 6 12 34 56 78\u202C')).toBe('0612345678');
    expect(normalizePhone('\u200E+33 6 12 34 56 78\u200F')).toBe('0612345678');
    expect(normalizePhone('\u2066+33 6 12 34 56 78\u2069')).toBe('0612345678');
    expect(normalizePhone('\uFEFF06 12 34 56 78\u200B')).toBe('0612345678');
    expect(normalizePhone('06\u200B12\u200D34\u200C56\u206078')).toBe('0612345678');
    expect(normalizePhone('\u202D\u202E\u202B0612345678')).toBe('0612345678');
    expect(normalizePhone('\u200B')).toBe('');
    expect(isValidPhone('\u202A+33 6 12 34 56 78\u202C')).toBe(true);
  });

  it('also cleans an unrecognised number of those characters, and nothing else', () => {
    expect(normalizePhone('\u202A+44 20 7946 0958\u202C')).toBe('+44 20 7946 0958');
    expect(normalizePhone('\u200B12\u200B')).toBe('12');
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
    expect(normalizePhone('+33 6 12 34 56 7')).toBe('+33 6 12 34 56 7');
    expect(normalizePhone('+33 6 12 34 56 789')).toBe('+33 6 12 34 56 789');
    expect(normalizePhone('0033 6 12 34 56 7')).toBe('0033 6 12 34 56 7');
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

  it('accepts what the legacy validator accepted: ten digits, whatever the first one', () => {
    expect(isValidPhone('1234567890')).toBe(true);
    expect(isValidPhone('0000000000')).toBe(true);
    expect(isValidPhone('12 34 56 78 90')).toBe(true);
  });

  it('accepts foreign numbers in international form, kept as typed', () => {
    expect(isValidPhone('+44 20 7946 0958')).toBe(true);
    expect(isValidPhone('0044 20 7946 0958')).toBe(true);
    expect(isValidPhone('+32 470 12 34 56')).toBe(true);
    expect(isValidPhone('+1 (415) 555-0132')).toBe(true);
    expect(normalizePhone('+32 470 12 34 56')).toBe('+32 470 12 34 56');
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

  it('rejects obvious garbage', () => {
    expect(isValidPhone('12')).toBe(false);
    expect(isValidPhone('abc')).toBe(false);
    expect(isValidPhone('06 12 34')).toBe(false);
    expect(isValidPhone('06 12 34 56 789')).toBe(false);
    expect(isValidPhone('06 12 34 56 78 poste 12')).toBe(false);
    expect(isValidPhone('+')).toBe(false);
    expect(isValidPhone('+0 123 456 789')).toBe(false);
    expect(isValidPhone('123456789')).toBe(false);
    expect(isValidPhone('12345678901')).toBe(false);
  });

  it('requires a +33 or 0033 number to be a full French number', () => {
    expect(isValidPhone('+33 6 12 34 56')).toBe(false); // 8 digits after +33
    expect(isValidPhone('+33 6 12 34 56 7')).toBe(false); // 8 digits after +33
    expect(isValidPhone('+33 6 12 34 56 789')).toBe(false); // 10 digits after +33
    expect(isValidPhone('0033 6 12 34 56')).toBe(false);
    expect(isValidPhone('0033 6 12 34 56 789')).toBe(false);
    expect(isValidPhone('+33 6 12 34 56 78')).toBe(true);
    expect(isValidPhone('+33 (0)6 12 34 56 78')).toBe(true);
  });
});
