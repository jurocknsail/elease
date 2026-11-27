import { billingPeriod, BillingPeriod } from '../billing/period';
import { Lease } from '../models/lease';
import { Leaseholder } from '../models/leaseholder';
import { rentCallFileName, uniqueAttachmentNames } from './file-name';

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
    expect(fileName('Agi Martin', 'Studio', { year: 2026, month: 12 })).toBe(
      'agi_martin-studio-12_2026.pdf',
    );
  });

  it('strips accents (also decomposed) and turns every run of spaces, no-break ones included, into one underscore', () => {
    expect(fileName('Hélène Côté-Müller', 'Appartement à Saint-Étienne')).toBe(
      'helene_cote-muller-appartement_a_saint-etienne-01_2027.pdf',
    );
    expect(fileName('Ame\u0301lie', 'Cœur')).toBe('amelie-coeur-01_2027.pdf');
    expect(fileName('  Jean   Pierre\u00A0Dupont\u202F ', 'Local \t A')).toBe(
      'jean_pierre_dupont-local_a-01_2027.pdf',
    );
  });

  it('replaces illegal, control and invisible characters, one underscore per run, and never leaves a space', () => {
    expect(fileName('Agi / Martin', 'Garage 1\\2')).toBe('agi_martin-garage_1_2-01_2027.pdf');
    expect(fileName('A:B*C?D', 'E"F<G>H|I')).toBe('a_b_c_d-e_f_g_h_i-01_2027.pdf');
    expect(fileName('a\u0000b\nc', '"Garage"')).toBe('a_b_c-garage-01_2027.pdf');
    expect(fileName('Agi\u200B Martin\u202E', '\uFEFFGarage')).toBe(
      'agi_martin-garage-01_2027.pdf',
    );
    expect(fileName("L'Atelier (n° 5)", 'M. Dupont')).toBe(
      "l'atelier_(n°_5)-m._dupont-01_2027.pdf",
    );
  });

  it('falls back on « locataire » and « bail » when nothing is left, and never makes a hidden file', () => {
    expect(fileName('', 'Garage')).toBe('locataire-garage-01_2027.pdf');
    for (const name of ['   ', '///', '..', ' / .. / ', String.fromCharCode(0, 0x200b, 0xfeff)]) {
      expect(fileName(name, name), JSON.stringify(name)).toBe('locataire-bail-01_2027.pdf');
    }
    expect(fileName('.hidden', '..secret')).toBe('hidden-secret-01_2027.pdf');
  });

  it('caps each of the tenant and lease parts at 60 characters, without a trailing underscore', () => {
    expect(fileName('a'.repeat(100), 'b'.repeat(61))).toBe(
      `${'a'.repeat(60)}-${'b'.repeat(60)}-01_2027.pdf`,
    );
    // The 60th character is the space that becomes an underscore.
    expect(fileName(`${'a'.repeat(59)} bbb`, 'c')).toBe(`${'a'.repeat(59)}-c-01_2027.pdf`);
  });

});

describe('uniqueAttachmentNames', () => {
  it('leaves distinct names alone, and suffixes the later duplicates before the extension', () => {
    expect(uniqueAttachmentNames(['b.pdf', 'a.pdf', 'c.pdf'])).toEqual(['b.pdf', 'a.pdf', 'c.pdf']);
    expect(uniqueAttachmentNames(['a.pdf', 'a.pdf', 'a.pdf'])).toEqual([
      'a.pdf',
      'a-2.pdf',
      'a-3.pdf',
    ]);
  });

  it('compares case-insensitively and never produces a name another attachment already has', () => {
    expect(uniqueAttachmentNames(['Agi.pdf', 'agi.PDF'])).toEqual(['Agi.pdf', 'agi-2.PDF']);
    expect(uniqueAttachmentNames(['a.pdf', 'a.pdf', 'a-2.pdf'])).toEqual([
      'a.pdf',
      'a-3.pdf',
      'a-2.pdf',
    ]);
  });

  it('separates two leases of the same name of one tenant', () => {
    const names = [
      rentCallFileName(holder('Agi Martin'), lease('Garage'), JAN_2027),
      rentCallFileName(holder('Agi Martin'), lease('garage'), JAN_2027),
    ];
    expect(uniqueAttachmentNames(names)).toEqual([
      'agi_martin-garage-01_2027.pdf',
      'agi_martin-garage-01_2027-2.pdf',
    ]);
  });
});
