import { DEFAULT_LANDLORD_PROFILE, LandlordProfile } from '../models/landlord-profile';
import { Lease } from '../models/lease';
import {
  landlordProfileFromParse,
  landlordProfileToParseFields,
  leaseFromParse,
  leaseToParseFields,
  leaseholderFromParse,
  writeLeaseFields,
} from './mapping';
import { RemoteObject } from './parse-client';

/** A lease as `toJSON()` returns it for one of the real accounts: no charge, no renewal date, lot 0. */
function realShapedLease(): Record<string, unknown> {
  return {
    __type: 'Object',
    className: 'Lease',
    objectId: 'lease-1',
    createdAt: '2025-01-10T09:00:00.000Z',
    updatedAt: '2026-10-25T09:00:00.000Z',
    ACL: { 'user-1': { read: true, write: true } },
    isSelected: true,
    isPro: true,
    name: 'Local test',
    lot: 0,
    streetNumber: 12,
    streetName: 'rue des Tests',
    optionalAddressInfo: '',
    postalCode: 13600,
    city: 'La Ciotat',
    lastSendDate: 1761393600000,
    price: 1091.08,
    indexing: 133.69,
  };
}

const LEGACY_KEYS = [
  'additionalCharges',
  'charge',
  'city',
  'isPro',
  'lastSendDate',
  'lot',
  'name',
  'optionalAddressInfo',
  'postalCode',
  'price',
  'renewalDate',
  'streetName',
  'streetNumber',
];

function baseLease(overrides: Partial<Lease> = {}): Lease {
  return {
    isPro: false,
    name: 'Appartement',
    lot: 3,
    streetNumber: 4,
    streetName: 'rue A',
    optionalAddressInfo: 'Bat. B',
    postalCode: 1000,
    city: 'Bourg',
    price: 500,
    charge: 50,
    additionalCharges: [{ title: 'Parking', amount: 25 }],
    lastSendDate: 0,
    renewalDate: 1767225600000,
    ...overrides,
  };
}

describe('leaseFromParse', () => {
  it('maps a real-shaped lease with missing charge and renewalDate, lot 0, isSelected and indexing', () => {
    const lease = leaseFromParse(realShapedLease());

    expect(lease.objectId).toBe('lease-1');
    expect(lease.charge).toBeNull();
    expect(lease.renewalDate).toBeNull();
    expect(lease.lot).toBe(0);
    expect(lease.additionalCharges).toEqual([]);
    expect(lease.isPro).toBe(true);
    expect(lease.price).toBe(1091.08);
    expect(lease.postalCode).toBe(13600);
    expect(lease.lastSendDate).toBe(1761393600000);
  });

  it('ignores isSelected and indexing, and the Parse envelope', () => {
    const lease = leaseFromParse(realShapedLease());
    const keys = Object.keys(lease);

    for (const ignored of [
      'isSelected',
      'indexing',
      'ACL',
      'createdAt',
      'updatedAt',
      '__type',
      'className',
    ]) {
      expect(keys).not.toContain(ignored);
    }
  });

  it('keeps the new optional fields undefined (absent) when the object has none', () => {
    const lease = leaseFromParse(realShapedLease());

    for (const key of [
      'lastSentPeriod',
      'indexType',
      'referenceIndexQuarter',
      'referenceIndexValue',
      'revisionReminderSentFor',
    ]) {
      expect(key in lease).toBe(false);
    }
  });

  it('maps a fully filled lease, new fields included', () => {
    const lease = leaseFromParse({
      ...realShapedLease(),
      isPro: false,
      lot: 7,
      charge: 123.5,
      renewalDate: 1772323200000,
      additionalCharges: [{ title: 'Garage', amount: 50 }],
      lastSentPeriod: '2026-12',
      indexType: 'ILC',
      referenceIndexQuarter: '2025-T2',
      referenceIndexValue: 133.7,
      revisionReminderSentFor: '2027-03-01:pending',
    });

    expect(lease).toMatchObject({
      isPro: false,
      lot: 7,
      charge: 123.5,
      renewalDate: 1772323200000,
      additionalCharges: [{ title: 'Garage', amount: 50 }],
      lastSentPeriod: '2026-12',
      indexType: 'ILC',
      referenceIndexQuarter: '2025-T2',
      referenceIndexValue: 133.7,
      revisionReminderSentFor: '2027-03-01:pending',
    });
  });

  it('tolerates null, NaN-like and malformed values', () => {
    const lease = leaseFromParse({
      objectId: 'x',
      name: 'Bail',
      lot: null,
      charge: null,
      renewalDate: null,
      price: null,
      additionalCharges: 'oops',
      indexType: 'IPC',
      referenceIndexValue: 'abc',
      lastSentPeriod: 12,
    });

    expect(lease.lot).toBeNull();
    expect(lease.charge).toBeNull();
    expect(lease.renewalDate).toBeNull();
    expect(lease.price).toBe(0);
    expect(lease.additionalCharges).toEqual([]);
    expect(lease.indexType).toBeUndefined();
    expect(lease.referenceIndexValue).toBeUndefined();
    expect(lease.lastSentPeriod).toBeUndefined();
    expect(lease.streetName).toBe('');
    expect(lease.isPro).toBe(false);
  });

  it('drops malformed additional charge rows but keeps valid ones', () => {
    const lease = leaseFromParse({
      objectId: 'x',
      additionalCharges: [{ title: 'Eau', amount: 12 }, null, 'x', { title: 'Sans montant' }],
    });

    expect(lease.additionalCharges).toEqual([{ title: 'Eau', amount: 12 }]);
  });
});

describe('leaseToParseFields', () => {
  it('writes exactly the legacy fields, never isSelected nor indexing', () => {
    const fields = leaseToParseFields(leaseFromParse(realShapedLease()));

    expect(Object.keys(fields).sort()).toEqual(LEGACY_KEYS);
    expect('isSelected' in fields).toBe(false);
    expect('indexing' in fields).toBe(false);
  });

  it('round-trips the legacy fields unchanged', () => {
    const json: Record<string, unknown> = {
      ...realShapedLease(),
      charge: 80,
      renewalDate: 1772323200000,
      lot: 5,
    };
    const fields = leaseToParseFields(leaseFromParse(json));

    for (const key of LEGACY_KEYS.filter((k) => k !== 'additionalCharges')) {
      expect(fields[key], key).toEqual(json[key]);
    }
    expect(fields['additionalCharges']).toEqual([]);
  });

  it('reports absent charge, renewalDate and lot as null, and keeps lot 0 as 0', () => {
    const fields = leaseToParseFields(leaseFromParse({ ...realShapedLease(), lot: undefined }));
    expect(fields['charge']).toBeNull();
    expect(fields['renewalDate']).toBeNull();
    expect(fields['lot']).toBeNull();

    expect(leaseToParseFields(leaseFromParse(realShapedLease()))['lot']).toBe(0);
  });

  it('adds the new fields only when they are defined', () => {
    expect(Object.keys(leaseToParseFields(baseLease())).sort()).toEqual(LEGACY_KEYS);

    const fields = leaseToParseFields(
      baseLease({
        lastSentPeriod: '2026-12',
        indexType: 'IRL',
        referenceIndexQuarter: '2025-T2',
        referenceIndexValue: 143.5,
        revisionReminderSentFor: '2027-03-01',
      }),
    );
    expect(Object.keys(fields).sort()).toEqual(
      [
        ...LEGACY_KEYS,
        'indexType',
        'lastSentPeriod',
        'referenceIndexQuarter',
        'referenceIndexValue',
        'revisionReminderSentFor',
      ].sort(),
    );
    expect(fields['lastSentPeriod']).toBe('2026-12');
    expect(fields['referenceIndexValue']).toBe(143.5);
  });

  it('copies additional charges so the lease is not shared with the Parse object', () => {
    const lease = baseLease();
    const fields = leaseToParseFields(lease);

    expect(fields['additionalCharges']).toEqual(lease.additionalCharges);
    expect(fields['additionalCharges']).not.toBe(lease.additionalCharges);
  });
});

describe('writeLeaseFields', () => {
  /** Minimal writable object recording what is sent. */
  function target(initial: Record<string, unknown> = {}) {
    const values = { ...initial };
    const log: Array<[string, string, unknown?]> = [];
    const object = {
      get: (key: string) => values[key],
      set: (key: string, value: unknown) => {
        log.push(['set', key, value]);
        values[key] = value;
      },
      unset: (key: string) => {
        log.push(['unset', key]);
        delete values[key];
      },
    };
    return { object: object as unknown as Pick<RemoteObject, 'get' | 'set' | 'unset'>, log };
  }

  it('never sends null: an absent charge, renewalDate or lot stays absent', () => {
    const { object, log } = target();
    writeLeaseFields(object, baseLease({ charge: null, renewalDate: null, lot: null }));

    const keys = log.map(([, key]) => key);
    expect(keys).not.toContain('charge');
    expect(keys).not.toContain('renewalDate');
    expect(keys).not.toContain('lot');
    expect(log.some(([, , value]) => value === null)).toBe(false);
  });

  it('removes a stored value that the lease no longer has', () => {
    const { object, log } = target({ charge: 50, renewalDate: 1767225600000, lot: 2 });
    writeLeaseFields(object, baseLease({ charge: null, renewalDate: null, lot: null }));

    expect(
      log
        .filter(([op]) => op === 'unset')
        .map(([, key]) => key)
        .sort(),
    ).toEqual(['charge', 'lot', 'renewalDate']);
  });

  it('leaves an explicit stored null untouched', () => {
    const { object, log } = target({ charge: null });
    writeLeaseFields(object, baseLease({ charge: null }));

    expect(log.map(([, key]) => key)).not.toContain('charge');
  });

  it('keeps lot 0 and charge 0 as real values', () => {
    const { object, log } = target();
    writeLeaseFields(object, baseLease({ lot: 0, charge: 0 }));

    expect(log).toContainEqual(['set', 'lot', 0]);
    expect(log).toContainEqual(['set', 'charge', 0]);
  });

  it('clears the editable index fields but never the bookkeeping ones', () => {
    const { object, log } = target({
      indexType: 'IRL',
      referenceIndexQuarter: '2025-T2',
      referenceIndexValue: 143.5,
      lastSentPeriod: '2026-12',
      revisionReminderSentFor: '2027-03-01',
    });
    writeLeaseFields(object, baseLease());

    expect(
      log
        .filter(([op]) => op === 'unset')
        .map(([, key]) => key)
        .sort(),
    ).toEqual(['indexType', 'referenceIndexQuarter', 'referenceIndexValue']);
  });
});

describe('leaseholderFromParse', () => {
  it('maps the contact and its included leases, skipping unresolved pointers', () => {
    const holder = leaseholderFromParse({
      objectId: 'holder-1',
      name: 'Julien Berger',
      email: 'julien.berger1421@gmail.com',
      phone: '0600000000',
      leases: [
        { ...realShapedLease(), objectId: 'lease-1' },
        { __type: 'Pointer', className: 'Lease', objectId: 'deleted-lease' },
        { ...realShapedLease(), objectId: 'lease-2', name: 'Garage' },
      ],
    });

    expect(holder.objectId).toBe('holder-1');
    expect(holder.name).toBe('Julien Berger');
    expect(holder.email).toBe('julien.berger1421@gmail.com');
    expect(holder.phone).toBe('0600000000');
    expect(holder.leases.map((l) => l.objectId)).toEqual(['lease-1', 'lease-2']);
  });

  it('gives an empty lease list when the field is missing, null or not an array', () => {
    for (const leases of [undefined, null, 'x']) {
      const holder = leaseholderFromParse({
        objectId: 'h',
        name: 'A',
        email: 'a@example.com',
        leases,
      });
      expect(holder.leases).toEqual([]);
      expect(holder.phone).toBe('');
    }
  });
});

describe('landlord profile mapping', () => {
  it('maps a stored profile', () => {
    const profile = landlordProfileFromParse({
      objectId: 'profile-1',
      name: 'SCI TEST',
      addressLines: ['1 RUE A', '75001 PARIS'],
      issueCity: 'PARIS',
      legalNotice: 'Mentions',
      emailSignature: 'Sig',
      user: { __type: 'Pointer', className: '_User', objectId: 'user-1' },
    });

    expect(profile).toEqual<LandlordProfile>({
      objectId: 'profile-1',
      name: 'SCI TEST',
      addressLines: ['1 RUE A', '75001 PARIS'],
      issueCity: 'PARIS',
      legalNotice: 'Mentions',
      emailSignature: 'Sig',
    });
  });

  it('falls back to empty values for missing fields', () => {
    expect(landlordProfileFromParse({ objectId: 'p', addressLines: 'x' })).toEqual<LandlordProfile>(
      {
        objectId: 'p',
        name: '',
        addressLines: [],
        issueCity: '',
        legalNotice: '',
        emailSignature: '',
      },
    );
  });

  it('writes exactly the five profile fields, as copies', () => {
    const fields = landlordProfileToParseFields({ ...DEFAULT_LANDLORD_PROFILE, objectId: 'p' });

    expect(Object.keys(fields).sort()).toEqual([
      'addressLines',
      'emailSignature',
      'issueCity',
      'legalNotice',
      'name',
    ]);
    expect(fields['addressLines']).toEqual(DEFAULT_LANDLORD_PROFILE.addressLines);
    expect(fields['addressLines']).not.toBe(DEFAULT_LANDLORD_PROFILE.addressLines);
  });
});

describe('DEFAULT_LANDLORD_PROFILE', () => {
  it('holds the values that were hard-coded in the legacy app', () => {
    expect(DEFAULT_LANDLORD_PROFILE).toEqual({
      name: 'SCI LA CHARINE',
      addressLines: ['41 CHEMIN DES BAGNOLS', '13600 LA CIOTAT'],
      issueCity: 'LA CIOTAT',
      legalNotice:
        'SCI LA CHARINE au capital de 2000 euros, inscrite au RCS de MARSEILLE sous le n° 507 834 117.',
      emailSignature: 'Pierre MARGERIT',
    });
  });
});
