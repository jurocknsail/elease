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
  it('names the billed month: « Appel de loyer — janvier 2027 »', () => {
    expect(rentCallSubject({ year: 2027, month: 1 })).toBe('Appel de loyer — janvier 2027');
  });

  it('follows the period (December, February: labels with an accent)', () => {
    expect(rentCallSubject({ year: 2026, month: 12 })).toBe('Appel de loyer — décembre 2026');
    expect(rentCallSubject({ year: 2027, month: 2 })).toBe('Appel de loyer — février 2027');
  });
});

describe('rentCallBody', () => {
  it('is, for the default landlord profile, exactly the body of the legacy mail', () => {
    expect(rentCallBody(DEFAULT_LANDLORD_PROFILE)).toBe(LEGACY_BODY);
  });

  it('is the plan text followed by the signature of the profile', () => {
    expect(rentCallBody({ ...DEFAULT_LANDLORD_PROFILE, emailSignature: 'Jeanne TEST' })).toBe(
      'Bonjour,\n\nMerci de trouver ci-joint le(s) appel(s) de loyer(s) pour la prochaine période.\nBonne reception,\n\nJeanne TEST',
    );
  });

  it('prints nothing of the legacy signature once the profile has another', () => {
    expect(
      rentCallBody({ ...DEFAULT_LANDLORD_PROFILE, emailSignature: 'Jeanne TEST' }),
    ).not.toContain('MARGERIT');
  });
});

describe('groupByEmail', () => {
  it('makes one entry per e-mail address, in order of first appearance', () => {
    const groups = groupByEmail([
      { holder: holder('Agi', 'agi@example.test'), pdf: pdf('l1') },
      { holder: holder('Bob', 'bob@example.test'), pdf: pdf('l2') },
      { holder: holder('Agi', 'agi@example.test'), pdf: pdf('l3') },
    ]);

    expect([...groups.keys()]).toEqual(['agi@example.test', 'bob@example.test']);
    expect(groups.get('agi@example.test')?.pdfs.map((p) => p.lease.objectId)).toEqual(['l1', 'l3']);
    expect(groups.get('bob@example.test')?.pdfs.map((p) => p.lease.objectId)).toEqual(['l2']);
  });

  it('merges two holders sharing an address into ONE entry with all their PDFs and both names', () => {
    const groups = groupByEmail([
      { holder: holder('Agi Martin', 'famille@example.test'), pdf: pdf('l1') },
      { holder: holder('Bob Martin', 'famille@example.test'), pdf: pdf('l2') },
      { holder: holder('Agi Martin', 'famille@example.test'), pdf: pdf('l3') },
    ]);

    expect(groups.size).toBe(1);
    const group = groups.get('famille@example.test');
    expect(group?.holderNames).toEqual(['Agi Martin', 'Bob Martin']);
    expect(group?.pdfs.map((p) => p.lease.objectId)).toEqual(['l1', 'l2', 'l3']);
  });

  it('keys by the trimmed, lower-cased address', () => {
    const groups = groupByEmail([
      { holder: holder('Agi', 'Famille@Example.TEST'), pdf: pdf('l1') },
      { holder: holder('Bob', '  famille@example.test\n'), pdf: pdf('l2') },
    ]);
    expect([...groups.keys()]).toEqual(['famille@example.test']);
    expect(groups.get('famille@example.test')?.holderNames).toEqual(['Agi', 'Bob']);
  });

  it('lists a holder name once, in order of appearance', () => {
    const groups = groupByEmail([
      { holder: holder('B', 'x@example.test'), pdf: pdf('l1') },
      { holder: holder('A', 'x@example.test'), pdf: pdf('l2') },
      { holder: holder('B', 'x@example.test'), pdf: pdf('l3') },
      { holder: holder('A', 'x@example.test'), pdf: pdf('l4') },
    ]);
    expect(groups.get('x@example.test')?.holderNames).toEqual(['B', 'A']);
  });

  it('keeps every PDF object as given', () => {
    const first = pdf('l1');
    const groups = groupByEmail([{ holder: holder('Agi', 'agi@example.test'), pdf: first }]);
    expect(groups.get('agi@example.test')?.pdfs[0]).toBe(first);
  });

  it('is empty without items', () => {
    expect(groupByEmail([]).size).toBe(0);
  });

  describe('holders without an e-mail address', () => {
    it('are never dropped: they stay in the map under the empty key, so that the sender reports them', () => {
      const groups = groupByEmail([
        { holder: holder('Agi', 'agi@example.test'), pdf: pdf('l1') },
        { holder: holder('Sans Mail', ''), pdf: pdf('l2') },
        { holder: holder('Blanc', '   '), pdf: pdf('l3') },
        { holder: holder('Absent', undefined as unknown as string), pdf: pdf('l4') },
      ]);

      expect([...groups.keys()]).toEqual(['agi@example.test', '']);
      const missing = groups.get('');
      expect(missing?.holderNames).toEqual(['Sans Mail', 'Blanc', 'Absent']);
      expect(missing?.pdfs.map((p) => p.lease.objectId)).toEqual(['l2', 'l3', 'l4']);
    });

    it('never end up in the group of a real address', () => {
      const groups = groupByEmail([
        { holder: holder('Agi', 'agi@example.test'), pdf: pdf('l1') },
        { holder: holder('Sans Mail', ''), pdf: pdf('l2') },
      ]);
      expect(groups.get('agi@example.test')?.holderNames).toEqual(['Agi']);
      expect(groups.get('agi@example.test')?.pdfs).toHaveLength(1);
    });
  });
});
