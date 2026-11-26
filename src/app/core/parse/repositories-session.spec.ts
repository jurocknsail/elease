import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { Lease } from '../models/lease';
import { LandlordProfileRepository } from './landlord-profile.repository';
import { LeaseholderRepository } from './leaseholder.repository';
import { ParseClient } from './parse-client';
import { FakeParseClient, parseError, pointer } from './testing/fake-parse-client';
import { DEFAULT_LANDLORD_PROFILE } from '../models/landlord-profile';

/**
 * Review focus: an expired or invalid session (Parse 209) must send the user to the login screen,
 * whichever remote call notices it, while the screen that asked still gets the original error (so it
 * stops its spinner). Any other error leaves the session alone.
 */

const LEASE: Lease = {
  isPro: false,
  name: 'Studio',
  lot: 0,
  streetNumber: 4,
  streetName: 'rue A',
  optionalAddressInfo: '',
  postalCode: 13600,
  city: 'La Ciotat',
  price: 500,
  charge: null,
  additionalCharges: [],
  lastSendDate: 0,
  renewalDate: null,
  objectId: 'a',
};

function setup() {
  const fake = new FakeParseClient();
  fake.userName = 'julien';
  fake.seed('Lease', 'a', { name: 'Studio', price: 500, postalCode: 13600, lot: 0 });
  fake.seed('Leaseholder', 'h1', {
    name: 'Locataire',
    email: 'locataire@example.test',
    phone: '',
    leases: [pointer('Lease', 'a')],
  });
  const router = { navigate: vi.fn().mockResolvedValue(true), url: '/locataires' };
  TestBed.configureTestingModule({
    providers: [
      { provide: ParseClient, useValue: fake },
      { provide: Router, useValue: router },
    ],
  });
  return {
    fake,
    router,
    auth: TestBed.inject(AuthService),
    holders: TestBed.inject(LeaseholderRepository),
    profile: TestBed.inject(LandlordProfileRepository),
  };
}

type Operation = [name: string, run: (ctx: ReturnType<typeof setup>) => Promise<unknown>];

const OPERATIONS: Operation[] = [
  ['LeaseholderRepository.load', ({ holders }) => holders.load()],
  [
    'LeaseholderRepository.createLeaseholder',
    ({ holders }) => holders.createLeaseholder({ name: 'N', email: 'n@example.test', phone: '' }),
  ],
  [
    'LeaseholderRepository.updateContact',
    ({ holders }) => holders.updateContact('h1', { name: 'N', email: 'n@example.test', phone: '' }),
  ],
  ['LeaseholderRepository.addLease', ({ holders }) => holders.addLease('h1', LEASE)],
  [
    'LeaseholderRepository.updateLease',
    ({ holders }) => holders.updateLease({ ...LEASE, price: 600 }),
  ],
  ['LeaseholderRepository.deleteLease', ({ holders }) => holders.deleteLease('h1', 'a')],
  ['LeaseholderRepository.deleteLeaseholder', ({ holders }) => holders.deleteLeaseholder('h1')],
  ['LandlordProfileRepository.get', ({ profile }) => profile.get()],
  [
    'LandlordProfileRepository.save',
    ({ profile }) => profile.save({ ...DEFAULT_LANDLORD_PROFILE, name: 'Autre' }),
  ],
];

describe('expired session (Parse code 209) in the repositories', () => {
  describe.each(OPERATIONS)('%s', (_name, run) => {
    it('signs out, goes to /login, and still throws the original error', async () => {
      const context = setup();
      const expired = parseError(209, 'invalid session token');
      context.fake.failWhen(() => true, expired, false);
      expect(context.auth.user()).not.toBeNull();

      await expect(run(context)).rejects.toBe(expired);

      expect(context.auth.user()).toBeNull();
      expect(context.fake.userId).toBeNull();
      expect(context.router.navigate).toHaveBeenCalledWith(['/login'], {
        queryParams: { returnUrl: '/locataires' },
      });
    });

    it('leaves the session alone for any other error', async () => {
      const context = setup();
      // Any non-session error, 141 (Cloud Code failure) here: unlike 101 it never counts as "already gone".
      const other = parseError(141, 'Cloud Code script failed.');
      context.fake.failWhen(() => true, other, false);

      await expect(run(context)).rejects.toBe(other);

      expect(context.auth.user()).not.toBeNull();
      expect(context.fake.userId).not.toBeNull();
      expect(context.router.navigate).not.toHaveBeenCalled();
    });
  });

  it('treats a missing session (no current user) like an expired one', async () => {
    const context = setup();
    context.fake.userId = null;

    const error = await context.holders
      .createLeaseholder({ name: 'N', email: 'n@example.test', phone: '' })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 209 });
    expect(context.router.navigate).toHaveBeenCalledWith(['/login'], expect.anything());
  });
});

describe('LeaseholderRepository.markLeasesSent after a delivered e-mail', () => {
  const run = ({ holders }: ReturnType<typeof setup>) =>
    holders.markLeasesSent(['a'], '2027-01', 1_700_000_000_000);

  it('rethrows a 209 but neither signs out nor redirects, so the send screen can show its warning', async () => {
    const context = setup();
    const expired = parseError(209, 'invalid session token');
    context.fake.failWhen(() => true, expired, false);

    await expect(run(context)).rejects.toBe(expired);

    expect(context.auth.user()).not.toBeNull();
    expect(context.fake.userId).not.toBeNull();
    expect(context.router.navigate).not.toHaveBeenCalled();
  });
});

describe('a stale session error (Parse code 209) never signs out the NEXT session', () => {
  /** Holds the next query until `release()`, then makes it fail with `error`. */
  function holdThenFail(fake: FakeParseClient, error: unknown) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = fake.query.bind(fake);
    vi.spyOn(fake, 'query').mockImplementation((className) => {
      const query = original(className);
      query.find = async () => {
        await gate;
        throw error;
      };
      return query;
    });
    return release;
  }

  it.each([
    ['LeaseholderRepository.load', ({ holders }: ReturnType<typeof setup>) => holders.load()],
    ['LandlordProfileRepository.get', ({ profile }: ReturnType<typeof setup>) => profile.get()],
  ])(
    '%s: A asks, A signs out, B signs in, then the 209 meant for A arrives',
    async (_name, run) => {
      const context = setup();
      const { fake, auth, router } = context;
      fake.addAccount('autre', 'another pass');
      const expired = parseError(209, 'invalid session token');
      const release = holdThenFail(fake, expired);

      const asking = run(context).catch((error: unknown) => error);
      await auth.logout();
      await auth.login('autre', 'another pass');
      release();

      // The original error still reaches the caller...
      expect(await asking).toBe(expired);
      // ...but B stays signed in, and nothing was redirected (an existing ?returnUrl= is kept).
      expect(auth.user()?.username).toBe('autre');
      expect(fake.userId).not.toBeNull();
      expect(router.navigate).not.toHaveBeenCalled();
    },
  );

  it('still signs out for a 209 that belongs to the current session', async () => {
    const context = setup();
    const { fake, auth, router, holders } = context;
    const release = holdThenFail(fake, parseError(209));

    const asking = holders.load().catch((error: unknown) => error);
    release();
    await asking;

    expect(auth.user()).toBeNull();
    expect(router.navigate).toHaveBeenCalledTimes(1);
  });
});

describe('sign-out and the repositories', () => {
  /** Delays the answer of the next query until `release` is called. */
  function delayQuery(fake: FakeParseClient) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = fake.query.bind(fake);
    vi.spyOn(fake, 'query').mockImplementation((className) => {
      const query = original(className);
      const find = query.find.bind(query);
      query.find = async () => {
        await gate;
        return find();
      };
      return query;
    });
    return release;
  }

  it('forgets the leaseholders at sign-out and keeps them out when an old answer arrives later', async () => {
    const { fake, auth, holders } = setup();
    await holders.load();
    expect(holders.leaseholders()).toHaveLength(1);

    await auth.logout();
    expect(holders.leaseholders()).toEqual([]);

    // A load started before the sign-out answers afterwards: it belongs to the previous account.
    fake.userId = 'user-1';
    const release = delayQuery(fake);
    const loading = holders.load();
    await auth.logout();
    release();
    await loading;
    expect(holders.leaseholders()).toEqual([]);
  });

  it('does not add a holder created under the previous session to the state of the next one', async () => {
    const { fake, auth, holders } = setup();
    const original = fake.newObject.bind(fake);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(fake, 'newObject').mockImplementation((className) => {
      const object = original(className);
      const save = object.save.bind(object);
      object.save = async () => {
        await gate;
        return save();
      };
      return object;
    });

    const creating = holders.createLeaseholder({ name: 'N', email: 'n@example.test', phone: '' });
    await auth.logout();
    release();
    await creating;

    expect(holders.leaseholders()).toEqual([]);
  });

  it('does not hand the previous user pending profile request to the next user', async () => {
    const { fake, auth, profile } = setup();
    fake.hangWhen((call) => call.op === 'find' && call.className === 'LandlordProfile');
    void profile.get().catch(() => undefined);

    await auth.logout();
    fake.userId = 'user-2';
    await profile.get();

    // Two lookups: the second user's request was not folded into the first one's.
    expect(fake.callsOf('find', 'LandlordProfile')).toHaveLength(2);
  });
});
