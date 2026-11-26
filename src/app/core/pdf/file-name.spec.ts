import { billingPeriod, BillingPeriod } from '../billing/period';
import { Lease } from '../models/lease';
import { Leaseholder } from '../models/leaseholder';
import { rentCallFileName, uniqueAttachmentNames } from './file-name';
import { legacyPdfName } from './legacy-definition.fixture';

function holder(name: string): Leaseholder {
  return { name, email: 'locataire@example.test', phone: '', leases: [] };
}

function lease(name: string): Lease {
  return {
    isPro: false,
    name,
    lot: null,
    streetNumber: 1,
    streetName: 'rue des Tests',
    optionalAddressInfo: '',
    postalCode: 13600,
    city: 'La Ciotat',
    price: 500,
    charge: null,
    additionalCharges: [],
    lastSendDate: 0,
    renewalDate: null,
  };
}

const JAN_2027: BillingPeriod = { year: 2027, month: 1 };

function fileName(holderName: string, leaseName: string, p: BillingPeriod = JAN_2027): string {
  return rentCallFileName(holder(holderName), lease(leaseName), p);
}

describe('rentCallFileName', () => {
  it('lower-cases, joins words with underscores and ends with MM_YYYY.pdf', () => {
    expect(fileName('Agi Martin', 'Garage n° 13')).toBe('agi_martin-garage_n°_13-01_2027.pdf');
  });

  it('pads the month and uses the period year (March 2027, December 2026)', () => {
    expect(fileName('Agi Martin', 'Studio', { year: 2027, month: 3 })).toBe(
      'agi_martin-studio-03_2027.pdf',
    );
    expect(fileName('Agi Martin', 'Studio', { year: 2026, month: 12 })).toBe(
      'agi_martin-studio-12_2026.pdf',
    );
  });

  it('strips accents', () => {
    expect(fileName('Hélène Côté-Müller', 'Appartement à Saint-Étienne')).toBe(
      'helene_cote-muller-appartement_a_saint-etienne-01_2027.pdf',
    );
    expect(fileName('ÉLODIE', 'Lot ñandú ç')).toBe('elodie-lot_nandu_c-01_2027.pdf');
  });

  it('strips accents from decomposed (NFD) input too', () => {
    expect(fileName('Ame\u0301lie', 'Cave')).toBe('amelie-cave-01_2027.pdf');
  });

  it('spells the ligatures oe and ae', () => {
    expect(fileName('Cœur', 'Æther')).toBe('coeur-aether-01_2027.pdf');
    expect(fileName('SŒUR', 'ÆON')).toBe('soeur-aeon-01_2027.pdf');
  });

  it('turns EVERY run of spaces into one underscore (the legacy replaced only the first space)', () => {
    expect(fileName('Jean Pierre Dupont', 'Local A B')).toBe(
      'jean_pierre_dupont-local_a_b-01_2027.pdf',
    );
    expect(fileName('Jean   Pierre', 'Local \t A')).toBe('jean_pierre-local_a-01_2027.pdf');
  });

  it('treats no-break spaces and other Unicode spaces as spaces, and trims', () => {
    expect(fileName('  Agi\u00A0Martin\u202F ', '\u2003Garage\u00A013 ')).toBe(
      'agi_martin-garage_13-01_2027.pdf',
    );
  });

  it('removes invisible direction and zero-width characters', () => {
    expect(fileName('Agi\u200B Martin\u202E', '\uFEFFGarage')).toBe(
      'agi_martin-garage-01_2027.pdf',
    );
  });

  it('replaces characters that are illegal in file names, one underscore per run', () => {
    expect(fileName('Agi/Martin', 'Garage 1\\2')).toBe('agi_martin-garage_1_2-01_2027.pdf');
    expect(fileName('A:B*C?D', 'E"F<G>H|I')).toBe('a_b_c_d-e_f_g_h_i-01_2027.pdf');
    // A run mixing spaces and illegal characters is still one underscore.
    expect(fileName('Agi / Martin', 'Garage : 13')).toBe('agi_martin-garage_13-01_2027.pdf');
  });

  it('replaces control characters and drops underscores left at the ends', () => {
    expect(fileName('a\u0000b\nc', '"Garage"')).toBe('a_b_c-garage-01_2027.pdf');
  });

  it('keeps apostrophes, parentheses, dots and the degree sign', () => {
    expect(fileName("L'Atelier (n° 5)", 'M. Dupont')).toBe(
      "l'atelier_(n°_5)-m._dupont-01_2027.pdf",
    );
  });

  it('never produces an illegal character or a space, whatever the names', () => {
    const nasty = ['a/b\\c:d*e?f"g<h>i|j', 'x\u0001y\u007Fz', ' \t\n ', '..', 'Éé Œœ Ææ ß', '///'];
    for (const first of nasty) {
      for (const second of nasty) {
        const name = fileName(first, second);
        expect(name).not.toMatch(/[\\/:*?"<>|\u0000-\u001f\u007f\s]/);
        expect(name.endsWith('-01_2027.pdf')).toBe(true);
      }
    }
  });

  describe('fallbacks for a name with nothing left', () => {
    it('uses « locataire » for an empty tenant name and « bail » for an empty lease name', () => {
      expect(fileName('', 'Garage')).toBe('locataire-garage-01_2027.pdf');
      expect(fileName('Agi Martin', '')).toBe('agi_martin-bail-01_2027.pdf');
      expect(fileName('', '')).toBe('locataire-bail-01_2027.pdf');
    });

    it('also when the name is only blanks, illegal characters, invisible characters or dots', () => {
      const nothing = [
        '   ',
        ' \t\n ',
        '///',
        '\\:*?',
        String.fromCharCode(0, 1, 0x7f),
        '..',
        '...',
        '. . .',
        String.fromCharCode(0x200b, 0xfeff, 0x202e),
        ' / .. / ',
      ];
      for (const name of nothing) {
        expect(fileName(name, name), JSON.stringify(name)).toBe('locataire-bail-01_2027.pdf');
      }
    });

    it('keeps a name that merely contains dots or illegal characters', () => {
      expect(fileName('a.b', '/x/')).toBe('a.b-x-01_2027.pdf');
    });
  });

  describe('leading dots', () => {
    it('strips them from each part, so that the file is never a hidden file', () => {
      expect(fileName('.hidden', '..secret')).toBe('hidden-secret-01_2027.pdf');
      expect(fileName('. . Agi', ' ._ Garage')).toBe('agi-garage-01_2027.pdf');
      expect(fileName('..hidden', 'x').startsWith('.')).toBe(false);
    });

    it('keeps the dots inside and at the end of a name', () => {
      expect(fileName('M. Dupont', 'Local B.')).toBe('m._dupont-local_b.-01_2027.pdf');
      expect(fileName('a..b', 'c')).toBe('a..b-c-01_2027.pdf');
    });
  });

  describe('length of each part', () => {
    it('caps the tenant part and the lease part at 60 characters each', () => {
      const name = fileName('a'.repeat(100), 'b'.repeat(61));
      expect(name).toBe(`${'a'.repeat(60)}-${'b'.repeat(60)}-01_2027.pdf`);
    });

    it('keeps a part of exactly 60 characters whole', () => {
      expect(fileName('a'.repeat(60), 'b')).toBe(`${'a'.repeat(60)}-b-01_2027.pdf`);
    });

    it('drops the underscore a cut leaves at the end of a part', () => {
      // The 60th character is the space that becomes an underscore.
      expect(fileName(`${'a'.repeat(59)} bbb`, 'c')).toBe(`${'a'.repeat(59)}-c-01_2027.pdf`);
    });

    it('does not cut inside a surrogate pair', () => {
      const emoji = String.fromCodePoint(0x1f600);
      // 59 letters + a 2-unit emoji: the cut falls between its two halves.
      const cut = fileName('a'.repeat(59) + emoji + 'b', 'c');
      expect(cut).toBe(`${'a'.repeat(59)}-c-01_2027.pdf`);
      expect(cut).not.toMatch(
        /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/,
      );
      // 58 letters + the emoji is exactly 60 units: kept whole.
      expect(fileName('a'.repeat(58) + emoji + 'b', 'c')).toBe(
        `${'a'.repeat(58)}${emoji}-c-01_2027.pdf`,
      );
    });

    it('keeps the whole name within a safe length', () => {
      const name = fileName('é'.repeat(500), 'ß'.repeat(500));
      expect(name.length).toBeLessThanOrEqual(60 + 1 + 60 + 1 + '01_2027.pdf'.length);
    });
  });

  describe('accents of other scripts', () => {
    it('keeps Cyrillic letters that carry a mark (й, ё), lower-cased', () => {
      expect(fileName('Алексей Ёжиков', 'Гараж')).toBe('алексей_ёжиков-гараж-01_2027.pdf');
      expect(fileName('Йоханн', 'Ёлка')).toBe('йоханн-ёлка-01_2027.pdf');
    });

    it('composes decomposed Cyrillic input instead of dropping its mark', () => {
      // и + combining breve is the decomposed form of й.
      expect(fileName(String.fromCharCode(0x418, 0x306), 'x')).toBe(
        `${String.fromCharCode(0x439)}-x-01_2027.pdf`,
      );
    });

    it('keeps the tonos of Greek letters', () => {
      expect(fileName('Άλφα', 'x')).toBe('άλφα-x-01_2027.pdf');
    });

    it('still strips every mark stacked on a Latin letter', () => {
      expect(fileName('Nguyễn', 'A' + String.fromCharCode(0x323, 0x301))).toBe(
        'nguyen-a-01_2027.pdf',
      );
      expect(fileName('e' + String.fromCharCode(0x301, 0x323), 'x')).toBe('e-x-01_2027.pdf');
    });

    it('treats the Latin part of a mixed name and the Cyrillic part each their way', () => {
      expect(fileName('Élodie Ёлкина', 'x')).toBe('elodie_ёлкина-x-01_2027.pdf');
    });
  });

  describe('against the legacy generatePdfName', () => {
    const now = new Date(2026, 10, 26, 9, 30);

    it.each([
      ['Agi Martin', 'Garage 13', new Date(2026, 11, 25)],
      ['Dupont', 'Studio', new Date(2026, 10, 25)],
      ['Jean Dupont', 'Local', new Date(2028, 0, 25)],
      ['  Marie Curie ', ' Cave ', new Date(2027, 5, 25)],
    ])('is identical for %s / %s (plain names, at most one space)', (h, l, callDate) => {
      expect(rentCallFileName(holder(h), lease(l), billingPeriod(callDate))).toBe(
        legacyPdfName(holder(h), lease(l), now, callDate),
      );
    });

    it('differs only by the documented fixes (accents, every space, illegal characters)', () => {
      const callDate = new Date(2026, 11, 25);
      // Legacy: accents kept, only the first space replaced.
      expect(legacyPdfName(holder('Hélène Côté'), lease('Garage n° 13'), now, callDate)).toBe(
        'hélène_côté-garage_n° 13-01_2027.pdf',
      );
      expect(rentCallFileName(holder('Hélène Côté'), lease('Garage n° 13'), JAN_2027)).toBe(
        'helene_cote-garage_n°_13-01_2027.pdf',
      );
    });
  });
});

describe('uniqueAttachmentNames', () => {
  it('leaves distinct names alone, in the same order', () => {
    expect(uniqueAttachmentNames(['b.pdf', 'a.pdf', 'c.pdf'])).toEqual(['b.pdf', 'a.pdf', 'c.pdf']);
    expect(uniqueAttachmentNames([])).toEqual([]);
  });

  it('suffixes the later ones before the extension: name-2.pdf, name-3.pdf', () => {
    expect(uniqueAttachmentNames(['a.pdf', 'a.pdf'])).toEqual(['a.pdf', 'a-2.pdf']);
    expect(uniqueAttachmentNames(['a.pdf', 'a.pdf', 'a.pdf'])).toEqual([
      'a.pdf',
      'a-2.pdf',
      'a-3.pdf',
    ]);
  });

  it('compares names case-insensitively and keeps the case of each', () => {
    expect(uniqueAttachmentNames(['Agi.pdf', 'agi.PDF'])).toEqual(['Agi.pdf', 'agi-2.PDF']);
  });

  it('works on a name without extension and on a name with several dots', () => {
    expect(uniqueAttachmentNames(['x', 'x'])).toEqual(['x', 'x-2']);
    expect(uniqueAttachmentNames(['m._dupont.pdf', 'm._dupont.pdf'])).toEqual([
      'm._dupont.pdf',
      'm._dupont-2.pdf',
    ]);
  });

  it('keeps the order and the first occurrence of each name', () => {
    expect(uniqueAttachmentNames(['b.pdf', 'a.pdf', 'b.pdf', 'a.pdf'])).toEqual([
      'b.pdf',
      'a.pdf',
      'b-2.pdf',
      'a-2.pdf',
    ]);
  });

  it('never produces a name that another attachment already has', () => {
    expect(uniqueAttachmentNames(['a.pdf', 'a.pdf', 'a-2.pdf'])).toEqual([
      'a.pdf',
      'a-3.pdf',
      'a-2.pdf',
    ]);
    expect(uniqueAttachmentNames(['a-2.pdf', 'a.pdf', 'a.pdf', 'a-2.pdf'])).toEqual([
      'a-2.pdf',
      'a.pdf',
      'a-3.pdf',
      'a-2-2.pdf',
    ]);
  });

  it('is idempotent and does not change its input', () => {
    const input = ['a.pdf', 'A.pdf', 'b.pdf', 'a.pdf', 'a-2.PDF'];
    const copy = [...input];
    const once = uniqueAttachmentNames(input);
    expect(input).toEqual(copy);
    expect(uniqueAttachmentNames(once)).toEqual(once);
    expect(new Set(once.map((name) => name.toLowerCase())).size).toBe(once.length);
  });

  it('separates two leases of the same name of one tenant', () => {
    const names = [
      rentCallFileName(holder('Agi Martin'), lease('Garage'), JAN_2027),
      rentCallFileName(holder('Agi Martin'), lease('garage'), JAN_2027),
    ];
    expect(names[0]).toBe(names[1]);
    expect(uniqueAttachmentNames(names)).toEqual([
      'agi_martin-garage-01_2027.pdf',
      'agi_martin-garage-01_2027-2.pdf',
    ]);
  });
});
