import { TestBed } from '@angular/core/testing';
import { LandlordProfileRepository } from '../parse/landlord-profile.repository';
import { LeaseholderRepository } from '../parse/leaseholder.repository';
import { ParseClient } from '../parse/parse-client';
import { FakeParseClient, parseError, pointer } from '../parse/testing/fake-parse-client';
import { BackendTimeoutError } from '../parse/with-timeout';
import { AuthService, LOGIN_TIMEOUT_MS, LOGOUT_TIMEOUT_MS } from './auth.service';

// Throw-away test credentials: nothing real, nothing reaches a server.
const PASSWORD = 'correct horse battery staple';

function setup(options: { signedIn?: boolean } = {}) {
  const fake = new FakeParseClient();
  fake.addAccount('julien', PASSWORD, { id: 'user-julien', email: 'julien@example.test' });
  if (!options.signedIn) {
    fake.userId = null;
  }
  TestBed.configureTestingModule({ providers: [{ provide: ParseClient, useValue: fake }] });
  return { fake, auth: TestBed.inject(AuthService) };
}

describe('AuthService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('session restore', () => {
    it('has no user when the SDK holds no session', () => {
      const { auth } = setup();
      expect(auth.user()).toBeNull();
    });

    it('restores the user of the stored session, with the e-mail', () => {
      const { fake, auth } = setup({ signedIn: true });
      fake.userName = 'julien';
      fake.userEmail = 'julien@example.test';

      expect(auth.user()).toEqual({ username: 'julien', email: 'julien@example.test' });
    });

    it('reads the session lazily: nothing is asked of the client before `user` is read', () => {
      const { fake, auth } = setup({ signedIn: true });
      const spy = vi.spyOn(fake, 'currentUsername');
      expect(spy).not.toHaveBeenCalled();

      auth.user();
      auth.user();

      // Once: the answer is kept until the session changes.
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('counts an unreadable stored session as no session', () => {
      const { fake, auth } = setup({ signedIn: true });
      vi.spyOn(fake, 'currentUsername').mockImplementation(() => {
        throw new SyntaxError('Unexpected token in stored user');
      });

      expect(auth.user()).toBeNull();
    });
  });

  describe('login', () => {
    it('signs in and exposes the user', async () => {
      const { fake, auth } = setup();
      expect(auth.user()).toBeNull();

      await auth.login('julien', PASSWORD);

      expect(auth.user()).toEqual({ username: 'julien', email: 'julien@example.test' });
      expect(fake.callsOf('login')).toHaveLength(1);
      expect(fake.callsOf('login')[0].username).toBe('julien');
    });

    it('never records or exposes the password anywhere but the call to the client', async () => {
      const { fake, auth } = setup();
      await auth.login('julien', PASSWORD);

      expect(JSON.stringify(fake.calls)).not.toContain(PASSWORD);
      expect(JSON.stringify(auth.user())).not.toContain(PASSWORD);
    });

    it('rejects with the original Parse error 101 for a wrong password and stays signed out', async () => {
      const { auth } = setup();

      const error = await auth.login('julien', 'wrong').catch((e: unknown) => e);

      expect(error).toMatchObject({ code: 101 });
      expect(String((error as Error).message)).not.toContain('wrong');
      expect(auth.user()).toBeNull();
    });

    it('gives up with a BackendTimeoutError after 20 s when the server hangs', async () => {
      vi.useFakeTimers();
      const { fake, auth } = setup();
      fake.hangWhen((call) => call.op === 'login');

      const outcome = auth.login('julien', PASSWORD).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(LOGIN_TIMEOUT_MS - 1);
      expect(auth.user()).toBeNull();
      await vi.advanceTimersByTimeAsync(1);

      expect(await outcome).toBeInstanceOf(BackendTimeoutError);
      expect(LOGIN_TIMEOUT_MS).toBe(20000);
      expect(auth.user()).toBeNull();
    });

    it('passes a network failure (code 100) through unchanged', async () => {
      const { fake, auth } = setup();
      const failure = parseError(100, 'XMLHttpRequest failed');
      fake.failWhen((call) => call.op === 'login', failure);

      await expect(auth.login('julien', PASSWORD)).rejects.toBe(failure);
      expect(auth.user()).toBeNull();
    });
  });

  describe('logout', () => {
    it('signs out: no user, and the client session is gone', async () => {
      const { fake, auth } = setup();
      await auth.login('julien', PASSWORD);

      await auth.logout();

      expect(auth.user()).toBeNull();
      expect(fake.userId).toBeNull();
      expect(fake.callsOf('logout')).toHaveLength(1);
    });

    it('clears the leaseholders held in memory, so another account never sees them', async () => {
      const { fake, auth } = setup({ signedIn: true });
      fake.seed('Leaseholder', 'h1', {
        name: 'Locataire du compte A',
        email: 'a@example.test',
        phone: '',
        leases: [pointer('Lease', 'l1')],
      });
      fake.seed('Lease', 'l1', { name: 'Bail A', price: 100 });
      const holders = TestBed.inject(LeaseholderRepository);
      await holders.load();
      expect(holders.leaseholders()).toHaveLength(1);

      await auth.logout();

      expect(holders.leaseholders()).toEqual([]);
    });

    it('lets the repositories register for the sign-out, and unregister', async () => {
      const { auth } = setup({ signedIn: true });
      const kept = vi.fn();
      const removed = vi.fn();
      auth.onLogout(kept);
      auth.onLogout(removed)();

      await auth.logout();

      expect(kept).toHaveBeenCalledTimes(1);
      expect(removed).not.toHaveBeenCalled();
    });

    it('clears everything before the first await, even when a listener throws', () => {
      const { fake, auth } = setup({ signedIn: true });
      expect(auth.user()).not.toBeNull();
      const later = vi.fn();
      auth.onLogout(() => {
        throw new Error('boom');
      });
      auth.onLogout(later);
      fake.hangWhen((call) => call.op === 'logout');

      void auth.logout();

      // No tick has passed: the user is already gone and the other listener has run.
      expect(auth.user()).toBeNull();
      expect(later).toHaveBeenCalledTimes(1);
    });

    it('still signs out, and resolves, when the server call fails', async () => {
      const { fake, auth } = setup({ signedIn: true });
      expect(auth.user()).not.toBeNull();
      fake.failWhen((call) => call.op === 'logout', parseError(100, 'XMLHttpRequest failed'));

      await expect(auth.logout()).resolves.toBeUndefined();

      expect(auth.user()).toBeNull();
      expect(fake.userId).toBeNull();
    });

    it('does not wait more than 3 s for a hanging server', async () => {
      vi.useFakeTimers();
      const { fake, auth } = setup({ signedIn: true });
      expect(auth.user()).not.toBeNull();
      fake.hangWhen((call) => call.op === 'logout');

      const done = vi.fn();
      void auth.logout().then(done);
      await vi.advanceTimersByTimeAsync(LOGOUT_TIMEOUT_MS - 1);
      expect(done).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      expect(done).toHaveBeenCalledTimes(1);
      expect(auth.user()).toBeNull();
    });

    it('lets a different account sign in afterwards', async () => {
      const { fake, auth } = setup();
      fake.addAccount('autre', 'another pass', { email: 'autre@example.test' });
      await auth.login('julien', PASSWORD);
      await auth.logout();

      await auth.login('autre', 'another pass');

      expect(auth.user()).toEqual({ username: 'autre', email: 'autre@example.test' });
    });
  });

  it('also clears the landlord profile repository (nothing is cached for a signed-out user)', async () => {
    const { auth } = setup({ signedIn: true });
    const profile = TestBed.inject(LandlordProfileRepository);
    const reset = vi.spyOn(profile, 'reset');

    await auth.logout();

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
