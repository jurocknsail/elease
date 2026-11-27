import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Lease } from '../../core/models/lease';
import { Leaseholder } from '../../core/models/leaseholder';
import { LeaseholderRepository } from '../../core/parse/leaseholder.repository';
import { ParseClient } from '../../core/parse/parse-client';
import { FakeParseClient, parseError, pointer } from '../../core/parse/testing/fake-parse-client';
import { BackendTimeoutError } from '../../core/parse/with-timeout';
import {
  BackupFileError,
  MAX_BACKUP_BYTES,
  applyRestore,
  backupFileName,
  exportBackup,
  parseBackup,
  planRestore,
  readBackupFile,
  restoreWarnings,
} from './backup';

/** Fictitious lease, complete, with the bookkeeping of a send. */
function lease(overrides: Partial<Lease> = {}): Lease {
  return {
    objectId: 'l1',
    isPro: true,
    name: 'Local A',
    lot: 4,
    streetNumber: 12,
    streetName: 'rue des Tests',
    optionalAddressInfo: '',
    postalCode: 13600,
    city: 'Ville-Test',
    price: 1000,
    charge: 50,
    additionalCharges: [{ title: 'Parking', amount: 35 }],
    lastSendDate: 1700000000000,
    lastSentPeriod: '2026-11',
    lastSentPeriodAt: 1700000000000,
    renewalDate: 1772323200000,
    indexType: 'ILAT',
    referenceIndexQuarter: '2025-T2',
    referenceIndexValue: 133.69,
    ...overrides,
  };
}

function holder(overrides: Partial<Leaseholder> = {}): Leaseholder {
  return {
    objectId: 'h1',
    name: 'Durand Test',
    email: 'durand@example.test',
    phone: '0102030405',
    leases: [lease()],
    ...overrides,
  };
}

const existing = (): Leaseholder[] => [
  holder(),
  holder({
    objectId: 'h2',
    name: 'Martin Test',
    email: 'martin@example.test',
    leases: [lease({ objectId: 'l2', name: 'Local B' }), lease({ objectId: 'l3', name: 'Cave' })],
  }),
];

describe('planRestore', () => {
  it('a file equal to the existing data creates nothing and skips every holder', () => {
    const plan = planRestore(existing(), existing());
    expect(plan.toCreate).toEqual([]);
    expect(plan.skipped).toBe(2);
    expect(plan.skippedLeases).toBe(3);
  });

  it('only creates the holder that is unknown, with its leases and without any id of the file', () => {
    const unknown = holder({
      objectId: 'h9',
      name: 'Nouveau Test',
      email: 'nouveau@example.test',
      leases: [lease({ objectId: 'l9', name: 'Garage' })],
    });
    const plan = planRestore([...existing(), unknown], existing());
    expect(plan.skipped).toBe(2);
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].name).toBe('Nouveau Test');
    expect(plan.toCreate[0].objectId).toBeUndefined();
    expect(plan.toCreate[0].leases.map((l) => [l.name, l.objectId])).toEqual([
      ['Garage', undefined],
    ]);
  });

  it('keeps the bookkeeping of a restored lease', () => {
    const plan = planRestore(
      [holder({ objectId: 'h9', name: 'Autre', email: 'a@example.test' })],
      [],
    );
    expect(plan.toCreate[0].leases[0]).toMatchObject({
      lastSendDate: 1700000000000,
      lastSentPeriod: '2026-11',
      lastSentPeriodAt: 1700000000000,
    });
  });

  it('adds a lease that the file has and an existing holder lacks, to that holder only', () => {
    const file = existing();
    file[0].leases.push(lease({ objectId: 'l7', name: 'Box', lot: 7 }));
    const plan = planRestore(file, existing());
    expect(plan.skipped).toBe(1);
    expect(plan.skippedLeases).toBe(3);
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].objectId).toBe('h1');
    expect(plan.toCreate[0].leases.map((l) => l.name)).toEqual(['Box']);
  });

  it('recognises what a previous restore created (new ids, same content): no duplicate on a second run', () => {
    const restoredCopy = existing().map((h, i) => ({
      ...h,
      objectId: `new-h${i}`,
      leases: h.leases.map((l, j) => ({ ...l, objectId: `new-l${i}${j}` })),
    }));
    const plan = planRestore(existing(), restoredCopy);
    expect(plan.toCreate).toEqual([]);
    expect(plan.skipped).toBe(2);
  });

  it('does not create twice a holder listed twice in the file', () => {
    const plan = planRestore([existing()[0], existing()[0]], []);
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0].leases).toHaveLength(1);
  });
});

describe('export and file name', () => {
  it('names the file after the user and the local date', () => {
    expect(backupFileName('julien', new Date(2027, 0, 5, 23, 59))).toBe(
      'elease-backup-julien-2027-01-05.json',
    );
    expect(backupFileName('a/b c', new Date(2027, 10, 15))).toBe(
      'elease-backup-a_b_c-2027-11-15.json',
    );
  });

  it('exports an array of holders with their leases, which reads back as « everything already there »', async () => {
    const blob = exportBackup(existing());
    expect(blob.type).toBe('application/json');
    const text = await blob.text();
    const raw = JSON.parse(text) as Array<Record<string, unknown>>;
    expect(Array.isArray(raw)).toBe(true);
    expect(raw[1]['name']).toBe('Martin Test');
    expect((raw[1]['leases'] as unknown[]).length).toBe(2);
    expect(text).not.toMatch(/isSelected|indexing|ACL/);

    const plan = planRestore(parseBackup(text), existing());
    expect(plan.toCreate).toEqual([]);
    expect(plan.skipped).toBe(2);
  });

  it('reads a legacy export (Parse envelope, isSelected, indexing) and ignores what it does not use', () => {
    const legacy = JSON.stringify([
      {
        objectId: 'x1',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        ACL: { u1: { read: true, write: true } },
        name: 'Ancien Test',
        email: 'ancien@example.test',
        phone: '0102030405',
        leases: [
          {
            objectId: 'y1',
            createdAt: '2024-01-01T00:00:00.000Z',
            ACL: { u1: { read: true, write: true } },
            isSelected: true,
            isPro: false,
            name: 'Studio',
            lot: 0,
            streetNumber: 3,
            streetName: 'rue A',
            optionalAddressInfo: '',
            postalCode: 13600,
            city: 'Ville-Test',
            lastSendDate: 1700000000000,
            renewalDate: 1772323200000,
            indexing: 133.69,
            price: 650,
            charge: 40,
            additionalCharges: [],
          },
        ],
      },
    ]);
    const [parsed] = parseBackup(legacy);
    expect(parsed.leases[0]).toMatchObject({ name: 'Studio', price: 650, lot: 0, charge: 40 });
    expect(JSON.stringify(parsed)).not.toMatch(/isSelected|indexing|ACL/);
  });
});

describe('reading a backup file defensively', () => {
  const valid = JSON.stringify([holder()]);
  const withLease = (patch: Record<string, unknown>) =>
    JSON.stringify([{ ...holder(), leases: [{ ...lease(), ...patch }] }]);

  it.each([
    ['not JSON', '{ oups'],
    ['not an array', '{"name":"x"}'],
    ['an empty list', '[]'],
    ['a holder that is not an object', '[1]'],
    ['a holder without a name', '[{"leases":[]}]'],
    ['leases that are not a list', '[{"name":"x","leases":"non"}]'],
    ['a price that is not a number', withLease({ price: '1000' })],
    ['a negative price', withLease({ price: -5 })],
    ['a lease without a name', withLease({ name: undefined })],
    ['a bad index family', withLease({ indexType: 'XYZ' })],
    ['a bad reference quarter', withLease({ referenceIndexQuarter: '2025-T9' })],
    ['a bad last sent period', withLease({ lastSentPeriod: 'novembre' })],
    ['a charge row without amount', withLease({ additionalCharges: [{ title: 'Parking' }] })],
  ])('refuses %s', (_label, text) => {
    expect(() => parseBackup(text)).toThrow(BackupFileError);
  });

  it('accepts the valid file', () => {
    expect(parseBackup(valid)).toHaveLength(1);
  });

  it('refuses a huge file before reading it, and creates nothing', async () => {
    const huge = new File(['x'], 'gros.json');
    Object.defineProperty(huge, 'size', { value: MAX_BACKUP_BYTES + 1 });
    await expect(readBackupFile(huge)).rejects.toThrow(/volumineux/);
  });

  it('reads a File', async () => {
    const parsed = await readBackupFile(new File([valid], 'sauvegarde.json'));
    expect(parsed[0].name).toBe('Durand Test');
  });
});

describe('applyRestore', () => {
  function setup() {
    const fake = new FakeParseClient();
    TestBed.configureTestingModule({
      providers: [
        { provide: ParseClient, useValue: fake },
        provideRouter([{ path: 'login', children: [] }]),
      ],
    });
    return { fake, repository: TestBed.inject(LeaseholderRepository) };
  }

  it('creates holders and leases with the owner ACL, keeps the bookkeeping, never writes isSelected or indexing', async () => {
    const { fake, repository } = setup();
    const file = parseBackup(
      JSON.stringify([{ ...holder(), leases: [{ ...lease(), isSelected: true, indexing: 99 }] }]),
    );
    const report = await applyRestore(planRestore(file, []), repository);

    expect(report).toMatchObject({ holdersCreated: 1, leasesCreated: 1, failures: [] });
    expect(report.ok).toBe(true);
    const saves = fake.callsOf('save');
    expect(saves.map((s) => s.className)).toEqual(['Leaseholder', 'Lease', 'Leaseholder']);
    expect(saves[0].acl).toEqual({ 'user-1': { read: true, write: true } });
    expect(saves[1].acl).toEqual({ 'user-1': { read: true, write: true } });
    const leaseKeys = (saves[1].ops ?? []).map((op) => ('key' in op ? op.key : ''));
    expect(leaseKeys).not.toContain('isSelected');
    expect(leaseKeys).not.toContain('indexing');
    expect(leaseKeys).not.toContain('objectId');
    const stored = fake.recordsOf('Lease')[0].attrs;
    expect(stored).toMatchObject({
      lastSendDate: 1700000000000,
      lastSentPeriod: '2026-11',
      lastSentPeriodAt: 1700000000000,
      name: 'Local A',
    });
    expect(fake.recordsOf('Leaseholder')[0].attrs['leases']).toEqual([
      pointer('Lease', fake.recordsOf('Lease')[0].id),
    ]);
  });

  it('after a restore, restoring the same file again finds nothing to create', async () => {
    const { repository } = setup();
    const file = existing();
    await applyRestore(planRestore(file, []), repository);
    await repository.load();
    const again = planRestore(file, repository.leaseholders());
    expect(again.toCreate).toEqual([]);
    expect(again.skipped).toBe(2);
  });

  it('adds the missing lease to the existing holder instead of creating a second holder', async () => {
    const { fake, repository } = setup();
    fake.seed('Leaseholder', 'h1', {
      name: 'Durand Test',
      email: 'durand@example.test',
      phone: '',
      leases: [],
    });
    await repository.load();
    const report = await applyRestore(
      planRestore([holder()], repository.leaseholders()),
      repository,
    );
    expect(report).toMatchObject({ holdersCreated: 0, leasesCreated: 1, ok: true });
    expect(fake.recordsOf('Leaseholder')).toHaveLength(1);
  });

  it('reports what succeeded and what failed when one holder cannot be created, and never says ok', async () => {
    const { fake, repository } = setup();
    fake.failWhen(
      (call) => call.op === 'save' && call.className === 'Leaseholder' && call.id === undefined,
      parseError(141, 'boom'),
    );
    const file = [
      holder({ objectId: 'a', name: 'Premier Test', email: 'p@example.test' }),
      holder({
        objectId: 'b',
        name: 'Second Test',
        email: 's@example.test',
        leases: [lease({ objectId: 'l5', name: 'Local 5' })],
      }),
    ];
    const report = await applyRestore(planRestore(file, []), repository);

    expect(report.ok).toBe(false);
    expect(report.holdersCreated).toBe(1);
    expect(report.leasesCreated).toBe(1);
    expect(report.failures).toHaveLength(1);
    expect(report.failures[0]).toMatchObject({ holder: 'Premier Test' });
    expect(report.leasesNotCreated).toBe(1);
    expect(fake.recordsOf('Leaseholder').map((r) => r.attrs['name'])).toEqual(['Second Test']);
  });

  it('reports a lease that cannot be added, flags a time-out as uncertain, and carries on', async () => {
    const { fake, repository } = setup();
    fake.failWhen(
      (call) => call.op === 'save' && call.className === 'Lease',
      new BackendTimeoutError(),
    );
    const file = [
      holder({
        leases: [lease({ objectId: 'a', name: 'Un' }), lease({ objectId: 'b', name: 'Deux' })],
      }),
    ];
    const report = await applyRestore(planRestore(file, []), repository);

    expect(report.ok).toBe(false);
    expect(report.holdersCreated).toBe(1);
    expect(report.leasesCreated).toBe(1);
    expect(report.failures).toEqual([
      expect.objectContaining({ holder: 'Durand Test', lease: 'Un', uncertain: true }),
    ]);
  });

  it('stops at an expired session instead of failing every remaining object', async () => {
    const { fake, repository } = setup();
    fake.failWhen((call) => call.op === 'save', parseError(209), false);
    const file = [
      holder({ objectId: 'a' }),
      holder({ objectId: 'b', name: 'Autre', email: 'o@example.test' }),
    ];
    const report = await applyRestore(planRestore(file, []), repository);

    expect(report.ok).toBe(false);
    expect(report.stopped).toBe(true);
    expect(fake.callsOf('save').length).toBeLessThanOrEqual(2);
  });
});

describe('restoreWarnings', () => {
  it('warns about another account, and about a file that matches nothing of existing data', () => {
    const file = [holder({ objectId: 'zz', name: 'Inconnu', email: 'i@example.test', leases: [] })];
    const plan = planRestore(file, existing());
    const warnings = restoreWarnings({
      fileName: 'elease-backup-christine-2027-01-05.json',
      username: 'julien',
      fileHolders: file,
      existing: existing(),
      plan,
    });
    expect(warnings.join(' ')).toMatch(/christine/);
    expect(warnings.join(' ')).toMatch(/aucun/i);
  });

  it('has nothing to say for an ordinary backup of this account', () => {
    const plan = planRestore(existing(), existing());
    expect(
      restoreWarnings({
        fileName: 'elease-backup-julien-2027-01-05.json',
        username: 'julien',
        fileHolders: existing(),
        existing: existing(),
        plan,
      }),
    ).toEqual([]);
  });
});
