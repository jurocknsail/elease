import { TestBed } from '@angular/core/testing';
import Parse from 'parse';
import { environment } from '../../../environments/environment';
import { RecipientBlockedError } from '../email/email-guard';
import { MinimalEventEmitter } from './event-emitter';
import { INVALID_SESSION_TOKEN, NoSessionError, ParseClient } from './parse-client';

/**
 * The real SDK adapter, exercised offline: nothing is fetched or sent. The REST layer is stubbed and no
 * credential is configured (the environment holds placeholders in tests).
 *
 * The first test triggers the one-time SDK initialization of this module, so it must stay first.
 */
describe('ParseClient (SDK adapter)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes the SDK lazily and once, and turns single-instance mode off', async () => {
    // The browser build runs in single-instance mode by default: every object with the same id shares
    // its pending changes. Vitest runs the SDK in Node mode where it is off, so switch it on first.
    // (@types/parse does not declare this static: narrow cast.)
    (Parse.Object as unknown as { enableSingleInstance(): void }).enableSingleInstance();
    // The browser build prints a notice when it initializes under Node.
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const initialize = vi.spyOn(Parse, 'initialize');

    const client = TestBed.inject(ParseClient);
    expect(initialize).not.toHaveBeenCalled();

    const abandoned = client.objectRef('Lease', 'a');
    client.query('Lease');
    client.newObject('Lease');
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(initialize.mock.calls[0].every((argument) => typeof argument === 'string')).toBe(true);

    // The SDK's emitter comes from `require('events')`, which a browser bundle cannot resolve: without
    // ours `Parse.initialize` throws « EventEmitter is not a constructor » in the browser.
    const manager = Parse.CoreManager as unknown as { get(key: string): unknown };
    expect(manager.get('EventEmitter')).toBe(MinimalEventEmitter);

    // No automatic re-sending of a failed request (a re-sent sendEmail could deliver twice).
    const coreManager = Parse.CoreManager as unknown as { get(key: string): unknown };
    expect(coreManager.get('REQUEST_ATTEMPT_LIMIT')).toBe(1);

    // A failed save leaves its changes pending on the object. They must not leak into an unrelated
    // object that merely has the same id (e.g. markLeasesSent after a failed updateLease).
    abandoned.set('name', 'CANCELLED EDIT');
    abandoned.set('price', 999);
    const unrelated = client.objectRef('Lease', 'a');
    unrelated.set('lastSendDate', 5);

    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    const core = Parse.CoreManager as unknown as {
      getRESTController(): unknown;
      setRESTController(controller: unknown): void;
    };
    const originalController = core.getRESTController();
    core.setRESTController({
      request: (method: string, path: string, body: unknown) => {
        requests.push({ method, path, body });
        return Promise.resolve({ updatedAt: '2026-01-01T00:00:00.000Z' });
      },
      ajax: () => Promise.resolve(undefined),
    });
    try {
      await unrelated.save();
    } finally {
      core.setRESTController(originalController);
    }

    expect(requests).toEqual([
      { method: 'PUT', path: 'classes/Lease/a', body: { lastSendDate: 5 } },
    ]);
  });

  describe('cloud functions', () => {
    let originalServerUrl: string;

    beforeEach(() => {
      // Defensive: should a stub ever fail to install, the request could only reach a closed local
      // port, never a real server.
      originalServerUrl = Parse.serverURL;
      Parse.serverURL = 'http://127.0.0.1:9';
    });

    afterEach(() => {
      Parse.serverURL = originalServerUrl;
    });

    /** Replaces the SDK's REST layer so that nothing leaves the process; returns what it was asked. */
    function stubRest(respond: (path: string) => Promise<unknown>): {
      requests: Array<{ method: string; path: string; body: unknown }>;
      restore: () => void;
    } {
      const requests: Array<{ method: string; path: string; body: unknown }> = [];
      const core = Parse.CoreManager as unknown as {
        getRESTController(): unknown;
        setRESTController(controller: unknown): void;
      };
      const original = core.getRESTController();
      core.setRESTController({
        request: (method: string, path: string, body: unknown) => {
          requests.push({ method, path, body });
          return respond(path);
        },
        ajax: () => Promise.reject(new Error('no network in tests')),
      });
      return { requests, restore: () => core.setRESTController(original) };
    }

    const params = {
      senderEmail: 'proprietaire@example.test',
      recipientEmail: 'locataire@example.test',
      subject: 'Sujet',
      text: 'Texte',
      attachments: [{ ContentType: 'application/pdf', Filename: 'a.pdf', Base64Content: 'QUJD' }],
      sandbox: false,
    };

    // A dummy function name: the generic passthrough tests never use the real `sendEmail`.
    it('runs a cloud function by name with the parameters unchanged, and gives its result', async () => {
      const rest = stubRest(() => Promise.resolve({ result: { delivered: 1 } }));
      try {
        const result = await TestBed.inject(ParseClient).runCloud('echo', params);

        expect(result).toEqual({ delivered: 1 });
        expect(rest.requests).toEqual([{ method: 'POST', path: 'functions/echo', body: params }]);
      } finally {
        rest.restore();
      }
    });

    /**
     * The adapter is the last choke point for `sendEmail`: whatever the caller or the injected
     * environment says, it applies the guard of the REAL build environment (placeholders here,
     * `production` false) and forces the sandbox flag. The REST layer is stubbed; the only function
     * name used against the real adapter in these specs is this one, behind the stub and the guard.
     */
    describe.skipIf(environment.production)('sendEmail, outside production', () => {
      const testRecipient =
        (environment as { testRecipientEmail?: string }).testRecipientEmail ?? '';

      it('never lets a recipient other than the test address reach the REST layer', async () => {
        const rest = stubRest(() => Promise.resolve({ result: true }));
        try {
          const client = TestBed.inject(ParseClient);
          for (const recipientEmail of [
            'locataire@example.test',
            `${testRecipient},locataire@example.test`,
            `${testRecipient}\nBcc: locataire@example.test`,
            '',
            undefined,
          ]) {
            let call: Promise<unknown> | undefined;
            expect(
              () => (call = client.runCloud('sendEmail', { ...params, recipientEmail })),
            ).not.toThrow();
            await expect(call).rejects.toBeInstanceOf(RecipientBlockedError);
          }
          expect(rest.requests).toEqual([]);
        } finally {
          rest.restore();
        }
      });

      it('sends to the test address with the sandbox forced, even if the caller says false', async () => {
        expect(testRecipient).not.toBe('');
        const rest = stubRest(() => Promise.resolve({ result: { delivered: 0 } }));
        try {
          const callerParams = { ...params, recipientEmail: ` ${testRecipient.toUpperCase()} ` };
          const result = await TestBed.inject(ParseClient).runCloud('sendEmail', callerParams);

          expect(result).toEqual({ delivered: 0 });
          expect(rest.requests).toHaveLength(1);
          expect(rest.requests[0]).toEqual({
            method: 'POST',
            path: 'functions/sendEmail',
            body: { ...callerParams, sandbox: true },
          });
          // The caller's object is not modified.
          expect(callerParams.sandbox).toBe(false);
        } finally {
          rest.restore();
        }
      });
    });
  });

  describe('currentUserEmail', () => {
    function userWith(email: string | undefined): Parse.User {
      const user = new Parse.User();
      user.id = 'user-1';
      if (email !== undefined) {
        user.set('email', email);
      }
      return user;
    }

    it('is the e-mail of the signed-in user, as the legacy sender e-mail was', () => {
      vi.spyOn(Parse.User, 'current').mockReturnValue(
        userWith('proprietaire@example.test') as never,
      );
      expect(TestBed.inject(ParseClient).currentUserEmail()).toBe('proprietaire@example.test');
    });

    it('is null without a session or without an e-mail', () => {
      const current = vi.spyOn(Parse.User, 'current');
      current.mockReturnValue(null as never);
      expect(TestBed.inject(ParseClient).currentUserEmail()).toBeNull();

      current.mockReturnValue(userWith(undefined) as never);
      expect(TestBed.inject(ParseClient).currentUserEmail()).toBeNull();

      current.mockReturnValue(userWith('') as never);
      expect(TestBed.inject(ParseClient).currentUserEmail()).toBeNull();
    });
  });

  describe('sign-in, sign-out and the current username', () => {
    function userNamed(username: string | undefined): Parse.User {
      const user = new Parse.User();
      user.id = 'user-1';
      if (username !== undefined) {
        user.set('username', username);
      }
      return user;
    }

    it('signs in through the SDK with the credentials as given, and resolves with nothing', async () => {
      const logIn = vi.spyOn(Parse.User, 'logIn').mockResolvedValue(userNamed('julien') as never);

      await expect(
        TestBed.inject(ParseClient).logIn('julien', 'a throw-away password'),
      ).resolves.toBeUndefined();

      expect(logIn).toHaveBeenCalledTimes(1);
      expect(logIn).toHaveBeenCalledWith('julien', 'a throw-away password');
    });

    it('lets the SDK error of a failed sign-in propagate unchanged (101 wrong credentials)', async () => {
      const error = Object.assign(new Error('Invalid username/password.'), { code: 101 });
      vi.spyOn(Parse.User, 'logIn').mockRejectedValue(error);

      await expect(TestBed.inject(ParseClient).logIn('julien', 'wrong')).rejects.toBe(error);
    });

    it('signs out through the SDK, which removes the stored session before calling the server', async () => {
      const logOut = vi.spyOn(Parse.User, 'logOut').mockResolvedValue(undefined as never);

      await expect(TestBed.inject(ParseClient).logOut()).resolves.toBeUndefined();

      expect(logOut).toHaveBeenCalledTimes(1);
    });
  });

  it('builds an owner-only ACL for the signed-in user, as the legacy app did', () => {
    const user = new Parse.User();
    user.id = 'user-1';
    vi.spyOn(Parse.User, 'current').mockReturnValue(user as never);

    const acl = TestBed.inject(ParseClient).ownerAcl();

    expect(acl.toJSON()).toEqual({ 'user-1': { read: true, write: true } });
  });

  it('refuses to build an ACL without a session, with the invalid-session code', () => {
    vi.spyOn(Parse.User, 'current').mockReturnValue(null as never);
    const client = TestBed.inject(ParseClient);

    expect(() => client.ownerAcl()).toThrow(NoSessionError);
    try {
      client.ownerAcl();
    } catch (error) {
      expect((error as NoSessionError).code).toBe(INVALID_SESSION_TOKEN);
    }
  });
});
