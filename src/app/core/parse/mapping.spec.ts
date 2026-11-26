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
  it('maps a real-shaped lease: absent charge and renewalDate stay absent, lot 0 stays 0, isSelected, indexing and the Parse envelope are ignored', () => {
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
    const keys = Object.keys(lease);
    for (const key of [
      'isSelected',
      'indexing',
      'ACL',
      'createdAt',
      '__type',
      'lastSentPeriod',
      'lastSentPeriodAt',
      'indexType',
      'revisionReminderSentFor',
    ]) {
      expect(keys).not.toContain(key);
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
      lastSentPeriodAt: 1764061200000,
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
      lastSentPeriodAt: 1764061200000,
      indexType: 'ILC',
      referenceIndexQuarter: '2025-T2',
      referenceIndexValue: 133.7,
      revisionReminderSentFor: '2027-03-01:pending',
    });
  });

  it('tolerates null and malformed values, keeping only valid additional charge rows and a finite lastSentPeriodAt', () => {
    const lease = leaseFromParse({
      objectId: 'x',
      name: 'Bail',
      lot: null,
      charge: null,
      renewalDate: null,
      price: null,
      additionalCharges: [{ title: 'Eau', amount: 12 }, null, 'x', { title: 'Sans montant' }],
      indexType: 'IPC',
      referenceIndexValue: 'abc',
      lastSentPeriod: 12,
      lastSentPeriodAt: Number.NaN,
    });

    expect(lease.lot).toBeNull();
    expect(lease.charge).toBeNull();
    expect(lease.renewalDate).toBeNull();
    expect(lease.price).toBe(0);
    expect(lease.additionalCharges).toEqual([{ title: 'Eau', amount: 12 }]);
    expect(lease.indexType).toBeUndefined();
    expect(lease.referenceIndexValue).toBeUndefined();
    expect(lease.lastSentPeriod).toBeUndefined();
    expect('lastSentPeriodAt' in lease).toBe(false);
    expect(lease.streetName).toBe('');
    expect(lease.isPro).toBe(false);
    expect(leaseFromParse({ ...realShapedLease(), lastSentPeriodAt: 0 }).lastSentPeriodAt).toBe(0);
  });
});

describe('leaseToParseFields', () => {
  it('round-trips the real-shaped lease: the legacy fields unchanged, absent ones null, lot 0 kept, never isSelected nor indexing', () => {
    const json = realShapedLease();
    const fields = leaseToParseFields(leaseFromParse(json));

    expect(Object.keys(fields).sort()).toEqual(LEGACY_KEYS);
    for (const key of [
      'isPro',
      'name',
      'lot',
      'streetNumber',
      'streetName',
      'optionalAddressInfo',
      'postalCode',
      'city',
      'lastSendDate',
      'price',
    ]) {
      expect(fields[key], key).toEqual(json[key]);
    }
    expect(fields['lot']).toBe(0);
    expect(fields['charge']).toBeNull();
    expect(fields['renewalDate']).toBeNull();
    expect(fields['additionalCharges']).toEqual([]);
    expect(leaseToParseFields(leaseFromParse({ ...json, lot: undefined }))['lot']).toBeNull();
  });

  it('adds the new fields only when they are defined', () => {
    expect(Object.keys(leaseToParseFields(baseLease())).sort()).toEqual(LEGACY_KEYS);

    const fields = leaseToParseFields(
      baseLease({
        lastSentPeriod: '2026-12',
        lastSentPeriodAt: 1764061200000,
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
        'lastSentPeriodAt',
        'referenceIndexQuarter',
        'referenceIndexValue',
        'revisionReminderSentFor',
      ].sort(),
    );
    expect(fields['lastSentPeriodAt']).toBe(1764061200000);
  });
});

describe('writeLeaseFields', () => {
  const BOOKKEEPING = [
    'lastSendDate',
    'lastSentPeriod',
    'lastSentPeriodAt',
    'revisionReminderSentFor',
  ];

  /** Minimal writable object recording what is sent. */
  function target() {
    const log: Array<[string, string, unknown?]> = [];
    const object: Pick<RemoteObject, 'set' | 'unset'> = {
      set: (key: string, value: unknown) => {
        log.push(['set', key, value]);
      },
      unset: (key: string) => {
        log.push(['unset', key]);
      },
    };
    return { object, log };
  }

  const keysSet = (log: Array<[string, string, unknown?]>) =>
    log.filter(([op]) => op === 'set').map(([, key]) => key);
  const keysUnset = (log: Array<[string, string, unknown?]>) =>
    log.filter(([op]) => op === 'unset').map(([, key]) => key);

  describe('on creation (no base lease)', () => {
    it('never sends null nor removes anything: absent charge, renewalDate and lot are not stored, 0 stays a real value', () => {
      const { object, log } = target();
      writeLeaseFields(object, baseLease({ charge: null, renewalDate: null, lot: null }), {
        bookkeeping: true,
      });

      expect(keysSet(log)).not.toContain('charge');
      expect(keysSet(log)).not.toContain('renewalDate');
      expect(keysSet(log)).not.toContain('lot');
      expect(keysUnset(log)).toEqual([]);
      expect(log.some(([, , value]) => value === null)).toBe(false);

      const zero = target();
      writeLeaseFields(zero.object, baseLease({ lot: 0, charge: 0 }), { bookkeeping: true });
      expect(zero.log).toContainEqual(['set', 'lot', 0]);
      expect(zero.log).toContainEqual(['set', 'charge', 0]);
    });

    it('writes the bookkeeping fields only when asked to', () => {
      const lease = baseLease({
        lastSendDate: 1761393600000,
        lastSentPeriod: '2026-11',
        lastSentPeriodAt: 1761393600000,
        revisionReminderSentFor: '2027-03-01',
      });

      const withBookkeeping = target();
      writeLeaseFields(withBookkeeping.object, lease, { bookkeeping: true });
      expect(keysSet(withBookkeeping.log)).toEqual(expect.arrayContaining(BOOKKEEPING));

      const without = target();
      writeLeaseFields(without.object, lease, { bookkeeping: false });
      for (const key of BOOKKEEPING) {
        expect(keysSet(without.log)).not.toContain(key);
      }
      expect(keysSet(without.log)).toContain('name');
    });
  });

  describe('against the base lease the user started from', () => {
    it('writes only the fields that differ (additional charges by value), and reports whether it wrote', () => {
      const base = baseLease();

      const changed = target();
      expect(
        writeLeaseFields(
          changed.object,
          { ...base, price: 600, additionalCharges: [{ title: 'Parking', amount: 30 }] },
          { bookkeeping: false, base },
        ),
      ).toBe(true);
      expect(changed.log).toEqual([
        ['set', 'price', 600],
        ['set', 'additionalCharges', [{ title: 'Parking', amount: 30 }]],
      ]);

      const same = target();
      expect(
        writeLeaseFields(
          same.object,
          { ...base, additionalCharges: [{ title: 'Parking', amount: 25 }] },
          { bookkeeping: false, base },
        ),
      ).toBe(false);
      expect(same.log).toEqual([]);
    });

    it('removes a field only when the base had a value and the lease has none, and leaves absent ones alone', () => {
      const base = baseLease({
        charge: 50,
        renewalDate: 1767225600000,
        lot: 2,
        indexType: 'IRL',
        referenceIndexQuarter: '2025-T2',
        referenceIndexValue: 143.5,
      });
      const cleared = target();
      writeLeaseFields(
        cleared.object,
        {
          ...base,
          charge: null,
          renewalDate: null,
          lot: null,
          indexType: undefined,
          referenceIndexQuarter: undefined,
          referenceIndexValue: undefined,
        },
        { bookkeeping: false, base },
      );
      expect(keysUnset(cleared.log).sort()).toEqual([
        'charge',
        'indexType',
        'lot',
        'referenceIndexQuarter',
        'referenceIndexValue',
        'renewalDate',
      ]);
      expect(keysSet(cleared.log)).toEqual([]);

      // The base never had them (another device may have written them since): leave them alone.
      const absentBase = baseLease({ charge: null, renewalDate: null, lot: null });
      const absent = target();
      writeLeaseFields(
        absent.object,
        { ...absentBase, name: 'Autre' },
        {
          bookkeeping: false,
          base: absentBase,
        },
      );
      expect(absent.log).toEqual([['set', 'name', 'Autre']]);
    });

    it('never writes nor unsets the bookkeeping fields, even if they differ from the stale base', () => {
      const base = baseLease({ lastSendDate: 0, lastSentPeriod: '2026-11', lastSentPeriodAt: 5 });
      const { lastSentPeriodAt: dropped, ...withoutAt } = base;
      expect(dropped).toBe(5);

      const { object, log } = target();
      writeLeaseFields(
        object,
        {
          ...withoutAt,
          price: 1,
          lastSendDate: 99,
          lastSentPeriod: '2025-01',
          revisionReminderSentFor: '2025-01-01',
        },
        { bookkeeping: false, base },
      );

      expect(log).toEqual([['set', 'price', 1]]);
    });
  });
});

describe('leaseholderFromParse', () => {
  it('maps the contact and its included leases, skipping unresolved pointers, and tolerates a missing lease list', () => {
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

    expect(holder).toMatchObject({
      objectId: 'holder-1',
      name: 'Julien Berger',
      email: 'julien.berger1421@gmail.com',
      phone: '0600000000',
    });
    expect(holder.leases.map((l) => l.objectId)).toEqual(['lease-1', 'lease-2']);

    for (const leases of [undefined, null, 'x']) {
      const bare = leaseholderFromParse({
        objectId: 'h',
        name: 'A',
        email: 'a@example.com',
        leases,
      });
      expect(bare.leases).toEqual([]);
      expect(bare.phone).toBe('');
    }
  });
});

describe('landlord profile mapping', () => {
  it('maps a stored profile, with empty values for missing fields', () => {
    expect(
      landlordProfileFromParse({
        objectId: 'profile-1',
        name: 'SCI TEST',
        addressLines: ['1 RUE A', '75001 PARIS'],
        issueCity: 'PARIS',
        legalNotice: 'Mentions',
        emailSignature: 'Sig',
        user: { __type: 'Pointer', className: '_User', objectId: 'user-1' },
      }),
    ).toEqual<LandlordProfile>({
      objectId: 'profile-1',
      name: 'SCI TEST',
      addressLines: ['1 RUE A', '75001 PARIS'],
      issueCity: 'PARIS',
      legalNotice: 'Mentions',
      emailSignature: 'Sig',
    });
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
    expect(fields['addressLines']).not.toBe(DEFAULT_LANDLORD_PROFILE.addressLines);
  });
});
