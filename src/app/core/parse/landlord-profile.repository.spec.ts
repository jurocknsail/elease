import { TestBed } from '@angular/core/testing';
import { DEFAULT_LANDLORD_PROFILE, LandlordProfile } from '../models/landlord-profile';
import { LandlordProfileRepository } from './landlord-profile.repository';
import { ParseClient } from './parse-client';
import { FakeParseClient, parseError, pointer } from './testing/fake-parse-client';

const OWNER_ACL = { 'user-1': { read: true, write: true } };

function setup() {
  const fake = new FakeParseClient();
  TestBed.configureTestingModule({ providers: [{ provide: ParseClient, useValue: fake }] });
  return { fake, repo: TestBed.inject(LandlordProfileRepository) };
}

describe('LandlordProfileRepository', () => {
  describe('get', () => {
    it('creates a profile from the defaults, with an owner ACL and a user pointer, when none exists', async () => {
      const { fake, repo } = setup();

      const profile = await repo.get();

      expect(profile).toEqual({ ...DEFAULT_LANDLORD_PROFILE, objectId: expect.any(String) });
      const saves = fake.callsOf('save', 'LandlordProfile');
      expect(saves).toHaveLength(1);
      expect(saves[0].acl).toEqual(OWNER_ACL);
      const stored = fake.record('LandlordProfile', profile.objectId!)!;
      expect(stored.attrs).toEqual({
        name: 'SCI LA CHARINE',
        addressLines: ['41 CHEMIN DES BAGNOLS', '13600 LA CIOTAT'],
        issueCity: 'LA CIOTAT',
        legalNotice:
          'SCI LA CHARINE au capital de 2000 euros, inscrite au RCS de MARSEILLE sous le n° 507 834 117.',
        emailSignature: 'Pierre MARGERIT',
        user: pointer('_User', 'user-1'),
      });
    });

    it('never hands out the default object itself', async () => {
      const { repo } = setup();

      const profile = await repo.get();
      profile.addressLines.push('mutated');

      expect(DEFAULT_LANDLORD_PROFILE.addressLines).toEqual([
        '41 CHEMIN DES BAGNOLS',
        '13600 LA CIOTAT',
      ]);
    });

    it('returns the existing profile of the user without creating another one', async () => {
      const { fake, repo } = setup();
      fake.seed('LandlordProfile', 'mine', {
        name: 'SCI TEST',
        addressLines: ['1 RUE A', '75001 PARIS'],
        issueCity: 'PARIS',
        legalNotice: 'Mentions',
        emailSignature: 'Signature',
        user: pointer('_User', 'user-1'),
      });
      fake.seed('LandlordProfile', 'other', {
        name: 'SCI AUTRE',
        addressLines: [],
        issueCity: '',
        legalNotice: '',
        emailSignature: '',
        user: pointer('_User', 'user-2'),
      });

      const profile = await repo.get();

      expect(profile).toEqual<LandlordProfile>({
        objectId: 'mine',
        name: 'SCI TEST',
        addressLines: ['1 RUE A', '75001 PARIS'],
        issueCity: 'PARIS',
        legalNotice: 'Mentions',
        emailSignature: 'Signature',
      });
      expect(fake.callsOf('save')).toEqual([]);
    });

    it('queries the own profile by user pointer, oldest first, one result', async () => {
      const { fake, repo } = setup();

      await repo.get();

      const finds = fake.callsOf('find', 'LandlordProfile');
      expect(finds).toHaveLength(1);
      expect(finds[0].query).toEqual({
        include: [],
        order: 'createdAt',
        limit: 1,
        where: [['user', pointer('_User', 'user-1')]],
      });
    });

    it('takes the oldest profile when duplicates exist', async () => {
      const { fake, repo } = setup();
      const attrs = (name: string) => ({
        name,
        addressLines: [],
        issueCity: '',
        legalNotice: '',
        emailSignature: '',
        user: pointer('_User', 'user-1'),
      });
      // The newer one is stored first on purpose: only the creation date tells them apart.
      fake.seed('LandlordProfile', 'newer', attrs('SCI RÉCENTE'), { createdAt: 500 });
      fake.seed('LandlordProfile', 'older', attrs('SCI ANCIENNE'), { createdAt: 5 });

      const profile = await repo.get();

      expect(profile.objectId).toBe('older');
      expect(profile.name).toBe('SCI ANCIENNE');
      expect(fake.callsOf('save')).toEqual([]);
    });

    it('creates only one profile when called twice at the same time', async () => {
      const { fake, repo } = setup();

      const [first, second] = await Promise.all([repo.get(), repo.get()]);

      expect(first.objectId).toBe(second.objectId);
      expect(fake.recordsOf('LandlordProfile')).toHaveLength(1);
    });

    it('queries again on the next call instead of serving a stale copy', async () => {
      const { fake, repo } = setup();
      const created = await repo.get();
      fake.record('LandlordProfile', created.objectId!)!.attrs['issueCity'] = 'MARSEILLE';

      expect((await repo.get()).issueCity).toBe('MARSEILLE');
    });

    it('fails with code 209 without creating anything when there is no session', async () => {
      const { fake, repo } = setup();
      fake.userId = null;

      await expect(repo.get()).rejects.toMatchObject({ code: 209 });
      expect(fake.recordsOf('LandlordProfile')).toEqual([]);
    });

    it('lets Parse errors propagate unchanged and can be retried', async () => {
      const { fake, repo } = setup();
      const error = parseError(100, 'network');
      fake.failWhen((call) => call.op === 'find', error);

      await expect(repo.get()).rejects.toBe(error);
      await expect(repo.get()).resolves.toMatchObject({ name: 'SCI LA CHARINE' });
    });
  });

  describe('save', () => {
    it('updates the existing profile with the five fields only', async () => {
      const { fake, repo } = setup();
      const profile = await repo.get();
      fake.calls.length = 0;

      await repo.save({
        ...profile,
        name: 'SCI TEST',
        addressLines: ['1 RUE A', '75001 PARIS'],
        issueCity: 'PARIS',
        legalNotice: 'Nouvelles mentions',
        emailSignature: 'Autre signature',
      });

      const saves = fake.callsOf('save', 'LandlordProfile');
      expect(saves).toHaveLength(1);
      expect(saves[0].id).toBe(profile.objectId);
      expect(saves[0].ops?.map((op) => op.key).sort()).toEqual([
        'addressLines',
        'emailSignature',
        'issueCity',
        'legalNotice',
        'name',
      ]);
      expect(fake.recordsOf('LandlordProfile')).toHaveLength(1);
      expect(fake.record('LandlordProfile', profile.objectId!)!.attrs).toMatchObject({
        name: 'SCI TEST',
        addressLines: ['1 RUE A', '75001 PARIS'],
        emailSignature: 'Autre signature',
        user: pointer('_User', 'user-1'),
      });
    });

    it('creates the profile, with an owner ACL and a user pointer, when none exists yet', async () => {
      const { fake, repo } = setup();

      await repo.save({ ...DEFAULT_LANDLORD_PROFILE, name: 'SCI NOUVELLE' });

      const saves = fake.callsOf('save', 'LandlordProfile');
      expect(saves).toHaveLength(1);
      expect(saves[0].acl).toEqual(OWNER_ACL);
      const [stored] = fake.recordsOf('LandlordProfile');
      expect(stored.attrs).toMatchObject({
        name: 'SCI NOUVELLE',
        user: pointer('_User', 'user-1'),
      });
    });

    it('lets Parse errors propagate unchanged', async () => {
      const { fake, repo } = setup();
      const profile = await repo.get();
      const error = parseError(209, 'invalid session token');
      fake.failWhen((call) => call.op === 'save', error);

      await expect(repo.save(profile)).rejects.toBe(error);
    });
  });
});
