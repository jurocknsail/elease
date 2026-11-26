import { DEFAULT_LANDLORD_PROFILE } from '../models/landlord-profile';
import type { Lease } from '../models/lease';
import type { Leaseholder } from '../models/leaseholder';
import { groupByEmail, rentCallBody, rentCallSubject, type GeneratedPdf } from './rent-call-email';

/**
 * Text of the mail body of the legacy app, copied verbatim from
 * main:src/app/services/parse-service.service.ts (the `text` of `sendEmail`, lines 352-357): the
 * typo « reception » and the line breaks are part of it. Frozen here, not in the application code.
 */
const LEGACY_BODY = `Bonjour,

Merci de trouver ci-joint le(s) appel(s) de loyer(s) pour la prochaine période.
Bonne reception,

Pierre MARGERIT`;

function lease(id: string, name = 'Studio'): Lease {
  return {
    objectId: id,
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

function holder(name: string, email: string): Leaseholder {
  return { objectId: `h-${name}`, name, email, phone: '', leases: [] };
}

function pdf(id: string, fileName = `${id}.pdf`): GeneratedPdf {
  return { lease: lease(id), fileName, base64: `base64-${id}` };
}

describe('rentCallSubject', () => {
  it('names the billed month with its accent: « Appel de loyer — février 2027 »', () => {
    expect(rentCallSubject({ year: 2027, month: 1 })).toBe('Appel de loyer — janvier 2027');
    expect(rentCallSubject({ year: 2027, month: 2 })).toBe('Appel de loyer — février 2027');
  });
});

describe('rentCallBody', () => {
  it('is, for the default landlord profile, exactly the body of the legacy mail', () => {
    expect(rentCallBody(DEFAULT_LANDLORD_PROFILE)).toBe(LEGACY_BODY);
  });

  it('is the plan text followed by the signature of the profile, with no trace of the legacy one', () => {
    const body = rentCallBody({ ...DEFAULT_LANDLORD_PROFILE, emailSignature: 'Jeanne TEST' });
    expect(body).toBe(
      'Bonjour,\n\nMerci de trouver ci-joint le(s) appel(s) de loyer(s) pour la prochaine période.\nBonne reception,\n\nJeanne TEST',
    );
    expect(body).not.toContain('MARGERIT');
  });
});

describe('groupByEmail', () => {
  it('makes one entry per address in order of first appearance, merging holders that share one', () => {
    const groups = groupByEmail([
      { holder: holder('Agi Martin', 'Famille@Example.TEST'), pdf: pdf('l1') },
      { holder: holder('Bob', 'bob@example.test'), pdf: pdf('l2') },
      { holder: holder('Bob Martin', '  famille@example.test\n'), pdf: pdf('l3') },
      { holder: holder('Agi Martin', 'famille@example.test'), pdf: pdf('l4') },
    ]);

    expect([...groups.keys()]).toEqual(['famille@example.test', 'bob@example.test']);
    const family = groups.get('famille@example.test');
    expect(family?.holderNames).toEqual(['Agi Martin', 'Bob Martin']);
    expect(family?.pdfs.map((p) => p.lease.objectId)).toEqual(['l1', 'l3', 'l4']);
    expect(groups.get('bob@example.test')?.pdfs.map((p) => p.lease.objectId)).toEqual(['l2']);
  });

  it('never drops a holder without an address: they stay under the empty key, apart from real addresses', () => {
    const groups = groupByEmail([
      { holder: holder('Agi', 'agi@example.test'), pdf: pdf('l1') },
      { holder: holder('Sans Mail', ''), pdf: pdf('l2') },
      { holder: holder('Blanc', '   '), pdf: pdf('l3') },
      { holder: holder('Absent', undefined as unknown as string), pdf: pdf('l4') },
    ]);

    expect([...groups.keys()]).toEqual(['agi@example.test', '']);
    expect(groups.get('agi@example.test')?.holderNames).toEqual(['Agi']);
    const missing = groups.get('');
    expect(missing?.holderNames).toEqual(['Sans Mail', 'Blanc', 'Absent']);
    expect(missing?.pdfs.map((p) => p.lease.objectId)).toEqual(['l2', 'l3', 'l4']);
  });
});
