import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { ParseClient } from '../parse/parse-client';
import { FakeParseClient, parseError } from '../parse/testing/fake-parse-client';
import { BackendTimeoutError } from '../parse/with-timeout';
import { AuthService } from './auth.service';
import { handleSessionError, isSessionError, SessionErrorHandler } from './session-error';

function fakeRouter(url = '/appels') {
  return { navigate: vi.fn().mockResolvedValue(true), url };
}

describe('isSessionError', () => {
  it('is true only for Parse code 209 (INVALID_SESSION_TOKEN)', () => {
    expect(isSessionError({ code: 209 })).toBe(true);
    expect(isSessionError(parseError(209))).toBe(true);
    expect(isSessionError({ code: 101 })).toBe(false);
    expect(isSessionError({ code: '209' })).toBe(false);
    expect(isSessionError(new BackendTimeoutError())).toBe(false);
    expect(isSessionError(new Error('boom'))).toBe(false);
    expect(isSessionError(null)).toBe(false);
    expect(isSessionError(undefined)).toBe(false);
    expect(isSessionError('209')).toBe(false);
  });
});

describe('handleSessionError', () => {
  it('logs out and goes to /login on code 209, and says it handled the error', () => {
    const router = fakeRouter();
    const logout = vi.fn().mockResolvedValue(undefined);

    const handled = handleSessionError({ code: 209 }, router as unknown as Router, logout);

    expect(handled).toBe(true);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(router.navigate.mock.calls[0][0]).toEqual(['/login']);
    // Logout first: /login sends a signed-in user away, so it must not see the old session.
    expect(logout.mock.invocationCallOrder[0]).toBeLessThan(
      router.navigate.mock.invocationCallOrder[0],
    );
  });

  it('does nothing for code 101, a timeout or an unknown error', () => {
    for (const error of [{ code: 101 }, new BackendTimeoutError(), new Error('x'), null, 209]) {
      const router = fakeRouter();
      const logout = vi.fn();

      expect(handleSessionError(error, router as unknown as Router, logout)).toBe(false);
      expect(logout).not.toHaveBeenCalled();
      expect(router.navigate).not.toHaveBeenCalled();
    }
  });

  it('brings the user back to the page they were on after signing in again', () => {
    const router = fakeRouter('/locataires/abc?tab=baux');

    handleSessionError({ code: 209 }, router as unknown as Router, vi.fn());

    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/locataires/abc?tab=baux' },
    });
  });

  it('still navigates, and never throws, when the logout fails', async () => {
    const router = fakeRouter();
    const logout = vi.fn().mockRejectedValue(new Error('offline'));

    expect(handleSessionError({ code: 209 }, router as unknown as Router, logout)).toBe(true);
    // The rejected logout must not become an unhandled rejection.
    await Promise.resolve();
    expect(router.navigate).toHaveBeenCalledTimes(1);

    const throwing = vi.fn(() => {
      throw new Error('sync failure');
    });
    expect(handleSessionError({ code: 209 }, router as unknown as Router, throwing)).toBe(true);
    expect(router.navigate).toHaveBeenCalledTimes(2);
  });
});

describe('SessionErrorHandler', () => {
  function setup() {
    const fake = new FakeParseClient();
    const router = fakeRouter('/reglages');
    TestBed.configureTestingModule({
      providers: [
        { provide: ParseClient, useValue: fake },
        { provide: Router, useValue: router },
      ],
    });
    return { fake, router, handler: TestBed.inject(SessionErrorHandler) };
  }

  it('signs the real session out and goes to /login on 209', () => {
    const { fake, router, handler } = setup();
    const auth = TestBed.inject(AuthService);
    expect(auth.user()).not.toBeNull();

    expect(handler.handle(parseError(209))).toBe(true);

    expect(auth.user()).toBeNull();
    expect(fake.userId).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/reglages' },
    });
  });
});
