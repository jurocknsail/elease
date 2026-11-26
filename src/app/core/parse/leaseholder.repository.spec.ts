import { TestBed } from '@angular/core/testing';
import { Lease } from '../models/lease';
import { LeaseholderRepository } from './leaseholder.repository';
import { ParseClient } from './parse-client';
import {
  FakeCall,
  FakeOp,
  FakeParseClient,
  parseError,
  pointer,
} from './testing/fake-parse-client';
import { BackendTimeoutError } from './with-timeout';

const OWNER_ACL = { 'user-1': { read: true, write: true } };
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

/** Stored shape of a legacy lease, including the fields the new app ignores. */
function storedLease(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    isSelected: true,
    isPro: true,
    name: 'Local test',
    lot: 0,
    streetNumber: 12,
    streetName: 'rue des Tests',
    optionalAddressInfo: '',
    postalCode: 13600,
    city: 'La Ciotat',
    lastSendDate: 0,
    price: 1000,
    indexing: 133.69,
    additionalCharges: [],
    ...overrides,
  };
}

function newLease(overrides: Partial<Lease> = {}): Lease {
  return {
    isPro: false,
    name: 'Studio',
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

function setup() {
  const fake = new FakeParseClient();
  // Two holders: h1 has leases a and b (plus a pointer to a lease deleted long ago), h2 has none.
  fake.seed('Lease', 'a', storedLease({ name: 'Bail A', price: 1000 }));
  fake.seed(
    'Lease',
    'b',
    storedLease({ name: 'Bail B', price: 2000, charge: 80, renewalDate: 1772323200000 }),
  );
  fake.seed('Lease', 'c', storedLease({ name: 'Bail C' }));
  fake.seed('Leaseholder', 'h1', {
    name: 'Julien Berger',
    email: 'julien.berger1421@gmail.com',
    phone: '0600000000',
    leases: [pointer('Lease', 'a'), pointer('Lease', 'gone'), pointer('Lease', 'b')],
  });
  fake.seed('Leaseholder', 'h2', {
    name: 'Autre Locataire',
    email: 'autre@example.com',
    phone: '',
    leases: [pointer('Lease', 'c')],
  });
  fake.seed('Leaseholder', 'h3', {
    name: 'Sans Bail',
    email: 'sans@example.com',
    phone: '',
    leases: [],
  });
  TestBed.configureTestingModule({ providers: [{ provide: ParseClient, useValue: fake }] });
  return { fake, repo: TestBed.inject(LeaseholderRepository) };
}

async function loaded() {
  const context = setup();
  await context.repo.load();
  forgetCalls(context.fake);
  return context;
}

/** Forgets the calls made so far so that assertions only see what the tested operation did. */
function forgetCalls(fake: FakeParseClient): void {
  fake.calls.length = 0;
}

function saveOps(call: FakeCall | undefined): readonly FakeOp[] {
  return call?.ops ?? [];
}

function keysOf(ops: readonly FakeOp[]): string[] {
  return ops.map((op) => op.key).sort();
}

function leaseNames(repo: LeaseholderRepository, holderId: string): string[] {
  return repo
    .leaseholders()
    .find((h) => h.objectId === holderId)!
    .leases.map((l) => l.name);
}

describe('LeaseholderRepository', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('load', () => {
    it('loads every holder with its included leases and exposes them through a read-only signal', async () => {
      const { fake, repo } = setup();
      expect(repo.leaseholders()).toEqual([]);

      await repo.load();

      const holders = repo.leaseholders();
      expect(holders.map((h) => h.name)).toEqual(['Julien Berger', 'Autre Locataire', 'Sans Bail']);
      // The pointer to a deleted lease is skipped, the others are mapped.
      expect(holders[0].leases.map((l) => l.objectId)).toEqual(['a', 'b']);
      expect(holders[0].leases[0]).toMatchObject({
        name: 'Bail A',
        price: 1000,
        lot: 0,
        charge: null,
        renewalDate: null,
      });
      expect(holders[2].leases).toEqual([]);
      // Mapped objects carry no trace of the ignored legacy fields.
      expect(Object.keys(holders[0].leases[0])).not.toContain('isSelected');
      expect(Object.keys(holders[0].leases[0])).not.toContain('indexing');

      expect(fake.callsOf('find', 'Leaseholder')).toHaveLength(1);
      expect('set' in repo.leaseholders).toBe(false);
      expect('update' in repo.leaseholders).toBe(false);
    });

    it('rejects with a BackendTimeoutError after 20 s when Back4App hangs and keeps the previous state', async () => {
      const { fake, repo } = setup();
      await repo.load();
      const before = repo.leaseholders();

      vi.useFakeTimers();
      fake.hangWhen((call) => call.op === 'find');
      const outcome = repo.load().then(
        () => 'resolved',
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(19999);
      expect(await Promise.race([outcome, Promise.resolve('pending')])).toBe('pending');
      await vi.advanceTimersByTimeAsync(1);

      expect(await outcome).toBeInstanceOf(BackendTimeoutError);
      expect(repo.leaseholders()).toBe(before);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('lets Parse errors propagate unchanged and keeps the previous state', async () => {
      const { fake, repo } = setup();
      await repo.load();
      const before = repo.leaseholders();
      const error = parseError(209, 'invalid session token');
      fake.failWhen((call) => call.op === 'find', error);

      await expect(repo.load()).rejects.toBe(error);
      expect(repo.leaseholders()).toBe(before);
    });
  });

  describe('createLeaseholder', () => {
    it('saves name, email, phone and an empty lease list with an owner-only ACL, then adds it to the state', async () => {
      const { fake, repo } = await loaded();

      const created = await repo.createLeaseholder({
        name: 'Nouveau Locataire',
        email: 'nouveau@example.com',
        phone: '0611223344',
      });

      const call = fake.callsOf('save', 'Leaseholder')[0];
      expect(saveOps(call)).toEqual([
        { kind: 'set', key: 'name', value: 'Nouveau Locataire' },
        { kind: 'set', key: 'email', value: 'nouveau@example.com' },
        { kind: 'set', key: 'phone', value: '0611223344' },
        { kind: 'set', key: 'leases', value: [] },
      ]);
      expect(call.acl).toEqual(OWNER_ACL);
      expect(created).toEqual({
        objectId: expect.any(String),
        name: 'Nouveau Locataire',
        email: 'nouveau@example.com',
        phone: '0611223344',
        leases: [],
      });
      expect(repo.leaseholders().map((h) => h.objectId)).toContain(created.objectId);
      expect(repo.leaseholders()).toHaveLength(4);
    });

    it('fails with code 209 and saves nothing when there is no session', async () => {
      const { fake, repo } = await loaded();
      fake.userId = null;

      await expect(
        repo.createLeaseholder({ name: 'X', email: 'x@example.com', phone: '' }),
      ).rejects.toMatchObject({ code: 209 });
      expect(fake.callsOf('save')).toEqual([]);
      expect(repo.leaseholders()).toHaveLength(3);
    });
  });

  describe('updateContact', () => {
    it('writes only name, email and phone and refreshes the state from the saved object', async () => {
      const { fake, repo } = await loaded();

      await repo.updateContact('h1', {
        name: 'Julien B.',
        email: 'julien.berger1421@gmail.com',
        phone: '0699999999',
      });

      const call = fake.callsOf('save', 'Leaseholder')[0];
      expect(keysOf(saveOps(call))).toEqual(['email', 'name', 'phone']);
      const holder = repo.leaseholders().find((h) => h.objectId === 'h1')!;
      expect(holder).toMatchObject({ name: 'Julien B.', phone: '0699999999' });
      // Leases are untouched, on the server and in the state.
      expect(holder.leases.map((l) => l.objectId)).toEqual(['a', 'b']);
      expect(fake.record('Leaseholder', 'h1')?.attrs['leases']).toHaveLength(3);
      expect(repo.leaseholders().find((h) => h.objectId === 'h2')?.name).toBe('Autre Locataire');
    });

    it('leaves the state unchanged and rethrows the Parse error when the save fails', async () => {
      const { fake, repo } = await loaded();
      const before = repo.leaseholders();
      const error = parseError(141, 'cloud validation');
      fake.failWhen((call) => call.op === 'save', error);

      await expect(
        repo.updateContact('h1', { name: 'X', email: 'x@example.com', phone: '' }),
      ).rejects.toBe(error);
      expect(repo.leaseholders()).toBe(before);
    });

    it('is time-limited like every Parse call', async () => {
      const { fake, repo } = await loaded();
      vi.useFakeTimers();
      fake.hangWhen((call) => call.op === 'save');
      const outcome = repo
        .updateContact('h1', { name: 'X', email: 'x@example.com', phone: '' })
        .then(
          () => 'resolved',
          (error: unknown) => error,
        );

      await vi.advanceTimersByTimeAsync(20000);

      expect(await outcome).toBeInstanceOf(BackendTimeoutError);
      expect(repo.leaseholders().find((h) => h.objectId === 'h1')?.name).toBe('Julien Berger');
    });
  });

  describe('addLease', () => {
    it('saves the lease with the legacy fields and an owner ACL, then links it with an atomic add on the holder', async () => {
      const { fake, repo } = await loaded();

      const created = await repo.addLease('h3', newLease({ lastSendDate: 0 }));

      const leaseSave = fake.callsOf('save', 'Lease')[0];
      expect(keysOf(saveOps(leaseSave))).toEqual(LEGACY_KEYS);
      expect(saveOps(leaseSave).every((op) => op.kind === 'set')).toBe(true);
      expect(leaseSave.acl).toEqual(OWNER_ACL);

      const holderSave = fake.callsOf('save', 'Leaseholder')[0];
      expect(saveOps(holderSave)).toEqual([
        { kind: 'addUnique', key: 'leases', value: pointer('Lease', created.objectId!) },
      ]);
      // Linked after the lease exists.
      expect(fake.calls.indexOf(leaseSave)).toBeLessThan(fake.calls.indexOf(holderSave));

      expect(created).toMatchObject({ name: 'Studio', lot: 3, charge: 50, postalCode: 1000 });
      expect(created.objectId).toBeDefined();
      expect(repo.leaseholders().find((h) => h.objectId === 'h3')?.leases).toEqual([created]);
      expect(fake.record('Leaseholder', 'h3')?.attrs['leases']).toEqual([
        pointer('Lease', created.objectId!),
      ]);
    });

    it('appends to the existing pointers instead of rewriting the array', async () => {
      const { fake, repo } = await loaded();

      const created = await repo.addLease('h1', newLease());

      expect(fake.record('Leaseholder', 'h1')?.attrs['leases']).toEqual([
        pointer('Lease', 'a'),
        pointer('Lease', 'gone'),
        pointer('Lease', 'b'),
        pointer('Lease', created.objectId!),
      ]);
      expect(leaseNames(repo, 'h1')).toEqual(['Bail A', 'Bail B', 'Studio']);
    });

    it('does not store anything for absent charge, renewalDate and lot, and never writes isSelected or indexing', async () => {
      const { fake, repo } = await loaded();

      await repo.addLease(
        'h3',
        newLease({ charge: null, renewalDate: null, lot: null, additionalCharges: [] }),
      );

      const ops = saveOps(fake.callsOf('save', 'Lease')[0]);
      expect(keysOf(ops)).toEqual(
        LEGACY_KEYS.filter((key) => !['charge', 'renewalDate', 'lot'].includes(key)),
      );
      expect(ops.some((op) => op.kind === 'set' && op.value === null)).toBe(false);
      expect(keysOf(ops)).not.toContain('isSelected');
      expect(keysOf(ops)).not.toContain('indexing');
    });

    it('writes the new fields only when they are defined', async () => {
      const { fake, repo } = await loaded();

      await repo.addLease(
        'h3',
        newLease({
          lastSendDate: 1761393600000,
          lastSentPeriod: '2026-11',
          indexType: 'ILC',
          referenceIndexQuarter: '2025-T2',
          referenceIndexValue: 133.7,
        }),
      );

      expect(keysOf(saveOps(fake.callsOf('save', 'Lease')[0]))).toEqual(
        [
          ...LEGACY_KEYS,
          'indexType',
          'lastSentPeriod',
          'referenceIndexQuarter',
          'referenceIndexValue',
        ].sort(),
      );
    });

    it('removes the new lease again, leaves the state unchanged and rethrows when linking fails', async () => {
      const { fake, repo } = await loaded();
      const before = repo.leaseholders();
      const error = parseError(100, 'network');
      fake.failWhen((call) => call.op === 'save' && call.className === 'Leaseholder', error);

      await expect(repo.addLease('h3', newLease())).rejects.toBe(error);

      expect(
        fake
          .recordsOf('Lease')
          .map((r) => r.id)
          .sort(),
      ).toEqual(['a', 'b', 'c']);
      expect(fake.record('Leaseholder', 'h3')?.attrs['leases']).toEqual([]);
      expect(repo.leaseholders()).toBe(before);
    });

    it('does not delete the lease after a timeout, because the link may still land', async () => {
      const { fake, repo } = await loaded();
      vi.useFakeTimers();
      fake.hangWhen((call) => call.op === 'save' && call.className === 'Leaseholder');
      const outcome = repo.addLease('h3', newLease()).then(
        () => 'resolved',
        (error: unknown) => error,
      );

      await vi.advanceTimersByTimeAsync(20000);

      expect(await outcome).toBeInstanceOf(BackendTimeoutError);
      expect(fake.callsOf('destroy')).toEqual([]);
    });

    it('still rethrows the original error when the clean-up fails too', async () => {
      const { fake, repo } = await loaded();
      const error = parseError(100, 'network');
      fake.failWhen((call) => call.op === 'save' && call.className === 'Leaseholder', error);
      fake.failWhen((call) => call.op === 'destroy', parseError(100, 'still down'));

      await expect(repo.addLease('h3', newLease())).rejects.toBe(error);
    });
  });

  describe('updateLease', () => {
    it('writes all legacy fields on the existing object, without isSelected or indexing, and refreshes the state', async () => {
      const { fake, repo } = await loaded();

      await repo.updateLease({
        ...repo.leaseholders()[0].leases[0],
        name: 'Bail A renommé',
        price: 1111.11,
        charge: 90,
        renewalDate: 1772323200000,
        indexType: 'ILAT',
        referenceIndexQuarter: '2025-T2',
        referenceIndexValue: 133.69,
      });

      const call = fake.callsOf('save', 'Lease')[0];
      expect(call.id).toBe('a');
      expect(keysOf(saveOps(call))).toEqual(
        [...LEGACY_KEYS, 'indexType', 'referenceIndexQuarter', 'referenceIndexValue'].sort(),
      );
      expect(call.acl).toBeUndefined();
      // The ignored legacy fields stay in the database untouched.
      const stored = fake.record('Lease', 'a')!.attrs;
      expect(stored['isSelected']).toBe(true);
      expect(stored['indexing']).toBe(133.69);
      expect(stored['name']).toBe('Bail A renommé');

      const lease = repo.leaseholders()[0].leases[0];
      expect(lease).toMatchObject({
        objectId: 'a',
        name: 'Bail A renommé',
        price: 1111.11,
        charge: 90,
        indexType: 'ILAT',
        referenceIndexValue: 133.69,
      });
      // Other leases untouched.
      expect(repo.leaseholders()[0].leases[1].name).toBe('Bail B');
    });

    it('removes a cleared charge from the server instead of storing null', async () => {
      const { fake, repo } = await loaded();
      const bailB = repo.leaseholders()[0].leases[1];
      expect(bailB.charge).toBe(80);

      await repo.updateLease({ ...bailB, charge: null, renewalDate: null });

      const ops = saveOps(fake.callsOf('save', 'Lease')[0]);
      expect(ops).toContainEqual({ kind: 'unset', key: 'charge' });
      expect(ops).toContainEqual({ kind: 'unset', key: 'renewalDate' });
      expect(ops.some((op) => op.kind === 'set' && op.value === null)).toBe(false);
      expect('charge' in fake.record('Lease', 'b')!.attrs).toBe(false);
      expect(repo.leaseholders()[0].leases[1].charge).toBeNull();
    });

    it('does not write anything for an absent charge that stays absent', async () => {
      const { fake, repo } = await loaded();

      await repo.updateLease({ ...repo.leaseholders()[0].leases[0], name: 'Autre nom' });

      const keys = keysOf(saveOps(fake.callsOf('save', 'Lease')[0]));
      expect(keys).not.toContain('charge');
      expect(keys).not.toContain('renewalDate');
      expect(fake.record('Lease', 'a')!.attrs['lot']).toBe(0);
    });

    it('rejects a lease without objectId before any remote call', async () => {
      const { fake, repo } = await loaded();

      await expect(repo.updateLease(newLease())).rejects.toThrow();
      expect(fake.calls).toEqual([]);
    });

    it('leaves the state unchanged and rethrows when the save fails', async () => {
      const { fake, repo } = await loaded();
      const before = repo.leaseholders();
      const error = parseError(209, 'invalid session token');
      fake.failWhen((call) => call.op === 'save', error);

      await expect(repo.updateLease({ ...before[0].leases[0], name: 'X' })).rejects.toBe(error);
      expect(repo.leaseholders()).toBe(before);
    });
  });

  describe('deleteLease', () => {
    it('unlinks the pointer from the holder first, then destroys the lease, then updates the state', async () => {
      const { fake, repo } = await loaded();

      await repo.deleteLease('h1', 'a');

      const unlink = fake.callsOf('save', 'Leaseholder')[0];
      expect(saveOps(unlink)).toEqual([
        { kind: 'remove', key: 'leases', value: pointer('Lease', 'a') },
      ]);
      const destroy = fake.callsOf('destroy', 'Lease')[0];
      expect(destroy.id).toBe('a');
      expect(fake.calls.indexOf(unlink)).toBeLessThan(fake.calls.indexOf(destroy));
      expect(fake.record('Lease', 'a')).toBeUndefined();
      expect(fake.record('Leaseholder', 'h1')?.attrs['leases']).toEqual([
        pointer('Lease', 'gone'),
        pointer('Lease', 'b'),
      ]);
      expect(leaseNames(repo, 'h1')).toEqual(['Bail B']);
    });

    it('re-links the lease and rethrows when destroying it fails, so nothing is orphaned', async () => {
      const { fake, repo } = await loaded();
      const before = repo.leaseholders();
      const error = parseError(100, 'network');
      fake.failWhen((call) => call.op === 'destroy', error);

      await expect(repo.deleteLease('h1', 'a')).rejects.toBe(error);

      expect(fake.record('Lease', 'a')).toBeDefined();
      expect(fake.record('Leaseholder', 'h1')?.attrs['leases']).toContainEqual(
        pointer('Lease', 'a'),
      );
      expect(repo.leaseholders()).toBe(before);
    });

    it('does not put the pointer back after a timeout, and a retry finishes the job', async () => {
      const { fake, repo } = await loaded();
      vi.useFakeTimers();
      fake.hangWhen((call) => call.op === 'destroy');
      const outcome = repo.deleteLease('h1', 'a').then(
        () => 'resolved',
        (error: unknown) => error,
      );

      await vi.advanceTimersByTimeAsync(20000);

      expect(await outcome).toBeInstanceOf(BackendTimeoutError);
      expect(fake.callsOf('save', 'Leaseholder')).toHaveLength(1);
      vi.useRealTimers();

      // The destroy never reached the server: the retry unlinks (nothing left to remove) and deletes.
      await repo.deleteLease('h1', 'a');
      expect(fake.record('Lease', 'a')).toBeUndefined();
      expect(leaseNames(repo, 'h1')).toEqual(['Bail B']);
    });

    it('counts an already deleted lease as deleted', async () => {
      const { fake, repo } = await loaded();

      await repo.deleteLease('h1', 'gone');

      expect(fake.record('Leaseholder', 'h1')?.attrs['leases']).toEqual([
        pointer('Lease', 'a'),
        pointer('Lease', 'b'),
      ]);
      expect(leaseNames(repo, 'h1')).toEqual(['Bail A', 'Bail B']);
    });

    it('does not destroy the lease when unlinking fails', async () => {
      const { fake, repo } = await loaded();
      const error = parseError(209, 'invalid session token');
      fake.failWhen((call) => call.op === 'save', error);

      await expect(repo.deleteLease('h1', 'a')).rejects.toBe(error);
      expect(fake.callsOf('destroy')).toEqual([]);
      expect(fake.record('Lease', 'a')).toBeDefined();
    });
  });

  describe('deleteLeaseholder', () => {
    it('deletes the holder together with its leases, and only those', async () => {
      const { fake, repo } = await loaded();

      await repo.deleteLeaseholder('h1');

      // Leases first, then the holder.
      const destroys = fake.callsOf('destroy');
      expect(destroys.map((c) => `${c.className}:${c.id}`)).toEqual([
        'Lease:a',
        'Lease:gone',
        'Lease:b',
        'Leaseholder:h1',
      ]);
      expect(fake.record('Lease', 'a')).toBeUndefined();
      expect(fake.record('Lease', 'b')).toBeUndefined();
      expect(fake.record('Leaseholder', 'h1')).toBeUndefined();
      // Another holder and its lease are intact.
      expect(fake.record('Lease', 'c')).toBeDefined();
      expect(repo.leaseholders().map((h) => h.objectId)).toEqual(['h2', 'h3']);
    });

    it('deletes a holder without leases', async () => {
      const { repo } = await loaded();

      await repo.deleteLeaseholder('h3');

      expect(repo.leaseholders().map((h) => h.objectId)).toEqual(['h1', 'h2']);
    });

    it('keeps the holder, and rethrows the Parse error unchanged, when one of its leases cannot be deleted', async () => {
      const { fake, repo } = await loaded();
      const before = repo.leaseholders();
      const error = parseError(100, 'network');
      fake.failWhen((call) => call.op === 'destroy' && call.id === 'b', error);

      await expect(repo.deleteLeaseholder('h1')).rejects.toBe(error);

      expect(fake.record('Leaseholder', 'h1')).toBeDefined();
      expect(fake.callsOf('destroy', 'Leaseholder')).toEqual([]);
      expect(repo.leaseholders()).toBe(before);

      // A retry succeeds although lease a is already gone: a missing lease counts as deleted.
      await repo.deleteLeaseholder('h1');
      expect(fake.record('Leaseholder', 'h1')).toBeUndefined();
      expect(fake.record('Lease', 'b')).toBeUndefined();
    });
  });

  describe('deleteLeaseholder when the holder is already gone', () => {
    it('counts it as deleted and drops it from the state', async () => {
      const { fake, repo } = await loaded();
      fake.remove('Leaseholder', 'h3'); // deleted elsewhere, or by a previous attempt that timed out

      await expect(repo.deleteLeaseholder('h3')).resolves.toBeUndefined();

      expect(repo.leaseholders().map((h) => h.objectId)).toEqual(['h1', 'h2']);
    });
  });

  describe('markLeasesSent', () => {
    it('sets lastSendDate and lastSentPeriod, saves, and refreshes the state', async () => {
      const { fake, repo } = await loaded();
      const sentAt = Date.UTC(2026, 10, 25, 9, 0, 0);

      await repo.markLeasesSent(['a'], '2026-12', sentAt);

      const saves = fake.callsOf('save', 'Lease');
      expect(saves).toHaveLength(1);
      expect(saves[0].id).toBe('a');
      expect(saveOps(saves[0])).toEqual([
        { kind: 'set', key: 'lastSendDate', value: sentAt },
        { kind: 'set', key: 'lastSentPeriod', value: '2026-12' },
      ]);
      expect(fake.record('Lease', 'a')?.attrs).toMatchObject({
        lastSendDate: sentAt,
        lastSentPeriod: '2026-12',
      });
      const [a, b] = repo.leaseholders()[0].leases;
      expect(a).toMatchObject({ objectId: 'a', lastSendDate: sentAt, lastSentPeriod: '2026-12' });
      expect(b.lastSendDate).toBe(0);
      expect(b.lastSentPeriod).toBeUndefined();
    });

    it('handles several leases independently: successes are saved and reflected, then the first failure is thrown', async () => {
      const { fake, repo } = await loaded();
      const error = parseError(100, 'network');
      fake.failWhen((call) => call.op === 'save' && call.id === 'b', error);

      await expect(repo.markLeasesSent(['a', 'b', 'c'], '2026-12', 5)).rejects.toBe(error);

      expect(fake.record('Lease', 'a')?.attrs['lastSentPeriod']).toBe('2026-12');
      expect(fake.record('Lease', 'c')?.attrs['lastSentPeriod']).toBe('2026-12');
      expect(fake.record('Lease', 'b')?.attrs['lastSentPeriod']).toBeUndefined();
      expect(repo.leaseholders()[0].leases.map((l) => l.lastSentPeriod)).toEqual([
        '2026-12',
        undefined,
      ]);
      expect(repo.leaseholders()[1].leases.map((l) => l.lastSentPeriod)).toEqual(['2026-12']);
    });

    it('does nothing for an empty list', async () => {
      const { fake, repo } = await loaded();

      await repo.markLeasesSent([], '2026-12', 5);

      expect(fake.calls).toEqual([]);
    });
  });
});
