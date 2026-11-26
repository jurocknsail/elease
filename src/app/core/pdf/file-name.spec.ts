import { billingPeriod, BillingPeriod } from '../billing/period';
import { Lease } from '../models/lease';
import { Leaseholder } from '../models/leaseholder';
import { rentCallFileName } from './file-name';
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
