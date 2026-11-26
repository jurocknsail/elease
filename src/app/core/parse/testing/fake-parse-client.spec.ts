import { BackendTimeoutError, withTimeout } from '../with-timeout';
import { FakeParseClient, parseError } from './fake-parse-client';

/** The cloud-function half of the in-memory Parse stand-in. Nothing here touches the SDK or the network. */
describe('FakeParseClient cloud functions', () => {
  const params = { recipientEmail: 'locataire@example.test', sandbox: true, attachments: [] };

  it('records each call with its function name and a copy of its parameters', async () => {
    const fake = new FakeParseClient();
    const mutable = { ...params, attachments: [{ Filename: 'a.pdf' }] };

    await fake.runCloud('sendEmail', mutable);
    mutable.attachments.push({ Filename: 'added-later.pdf' });

    const calls = fake.callsOf('cloud');
    expect(calls).toHaveLength(1);
    expect(calls[0].functionName).toBe('sendEmail');
    expect(calls[0].params).toEqual({ ...params, attachments: [{ Filename: 'a.pdf' }] });
  });

  it('resolves with the configured result', async () => {
    const fake = new FakeParseClient();
    fake.cloudResult = { sent: 1 };
    await expect(fake.runCloud('sendEmail', params)).resolves.toEqual({ sent: 1 });
  });

  it('fails one matching call only, by default', async () => {
    const fake = new FakeParseClient();
    const error = parseError(141, 'Mailjet refused');
    fake.failWhen(
      (call) => call.op === 'cloud' && call.params?.['recipientEmail'] === 'b@example.test',
      error,
    );

    await expect(fake.runCloud('sendEmail', { recipientEmail: 'a@example.test' })).resolves.toBe(
      undefined,
    );
    await expect(fake.runCloud('sendEmail', { recipientEmail: 'b@example.test' })).rejects.toBe(
      error,
    );
    await expect(fake.runCloud('sendEmail', { recipientEmail: 'b@example.test' })).resolves.toBe(
      undefined,
    );
    expect(fake.callsOf('cloud')).toHaveLength(3);
  });

  it('can make a call never settle (the backend hanging)', async () => {
    vi.useFakeTimers();
    try {
      const fake = new FakeParseClient();
      fake.hangWhen((call) => call.op === 'cloud');

      const outcome = withTimeout(fake.runCloud('sendEmail', params), 1000).catch(
        (e: unknown) => e,
      );
      await vi.advanceTimersByTimeAsync(1000);

      expect(await outcome).toBeInstanceOf(BackendTimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not mix cloud calls with object calls', async () => {
    const fake = new FakeParseClient();
    await fake.runCloud('sendEmail', params);
    expect(fake.callsOf('save')).toEqual([]);
    expect(fake.callsOf('find')).toEqual([]);
  });

  it('gives the signed-in e-mail, or null without a session', () => {
    const fake = new FakeParseClient();
    fake.userEmail = 'proprietaire@example.test';
    expect(fake.currentUserEmail()).toBe('proprietaire@example.test');

    fake.userId = null;
    expect(fake.currentUserEmail()).toBeNull();
  });
  describe('sessions', () => {
    it('signs in a registered account and then answers as that user', async () => {
      const fake = new FakeParseClient();
      fake.userId = null;
      fake.addAccount('julien', 'secret', { email: 'julien@example.test' });
      expect(fake.currentUsername()).toBeNull();

      await fake.logIn('julien', 'secret');

      expect(fake.currentUsername()).toBe('julien');
      expect(fake.currentUserEmail()).toBe('julien@example.test');
      expect(fake.ownerAcl().toJSON()).toEqual({ 'user-julien': { read: true, write: true } });
    });

    it('rejects an unknown user or a wrong password with Parse error 101 and records no password', async () => {
      const fake = new FakeParseClient();
      fake.userId = null;
      fake.addAccount('julien', 'secret');

      await expect(fake.logIn('julien', 'nope')).rejects.toMatchObject({ code: 101 });
      await expect(fake.logIn('inconnu', 'secret')).rejects.toMatchObject({ code: 101 });

      expect(fake.currentUsername()).toBeNull();
      expect(fake.callsOf('login').map((call) => call.username)).toEqual(['julien', 'inconnu']);
      expect(JSON.stringify(fake.calls)).not.toContain('secret');
      expect(JSON.stringify(fake.calls)).not.toContain('nope');
    });

    it('removes the session before the server answers, so a failing sign-out still signs out', async () => {
      const fake = new FakeParseClient();
      fake.failWhen((call) => call.op === 'logout', parseError(100, 'offline'));

      await expect(fake.logOut()).rejects.toMatchObject({ code: 100 });

      expect(fake.currentUsername()).toBeNull();
      expect(fake.currentUser()).toBeNull();
      expect(fake.callsOf('logout')).toHaveLength(1);
    });
  });
});
