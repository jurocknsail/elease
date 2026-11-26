import { TestBed } from '@angular/core/testing';
import Parse from 'parse';
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
      sandbox: true,
    };

    it('runs a cloud function by name with the parameters unchanged, and gives its result', async () => {
      const rest = stubRest(() => Promise.resolve({ result: { delivered: 1 } }));
      try {
        const result = await TestBed.inject(ParseClient).runCloud('sendEmail', params);

        expect(result).toEqual({ delivered: 1 });
        expect(rest.requests).toEqual([
          { method: 'POST', path: 'functions/sendEmail', body: params },
        ]);
      } finally {
        rest.restore();
      }
    });

    it('lets the error of the cloud function propagate unchanged', async () => {
      const error = Object.assign(new Error('refused'), { code: 141 });
      const rest = stubRest(() => Promise.reject(error));
      try {
        await expect(TestBed.inject(ParseClient).runCloud('sendEmail', params)).rejects.toBe(error);
      } finally {
        rest.restore();
      }
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
