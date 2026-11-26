import { describeBackendError, isConnectionError } from './backend-error';
import { parseError } from './testing/fake-parse-client';
import { BackendTimeoutError } from './with-timeout';

describe('describeBackendError', () => {
  it('asks for a connection when the device is offline, whatever the error', () => {
    for (const error of [new BackendTimeoutError(), parseError(100), new Error('x'), undefined]) {
      expect(describeBackendError(error, false)).toEqual({
        title: 'Connexion requise',
        message: expect.stringContaining('hors connexion'),
        retryable: true,
      });
    }
  });

  it('asks for a connection when the backend does not answer in time (Back4App hanging)', () => {
    const info = describeBackendError(new BackendTimeoutError(), true);

    expect(info.title).toBe('Connexion requise');
    expect(info.message).toContain('ne répond pas');
    expect(info.retryable).toBe(true);
  });

  it('asks for a connection on Parse code 100 (connection failed)', () => {
    const info = describeBackendError(parseError(100, 'XMLHttpRequest failed'), true);

    expect(info.title).toBe('Connexion requise');
    expect(info.message).toContain('joindre le serveur');
    expect(info.retryable).toBe(true);
  });

  it('says the session expired on code 209, and offers no retry (the login screen takes over)', () => {
    expect(describeBackendError(parseError(209), true)).toEqual({
      title: 'Session expirée',
      message: expect.stringContaining('reconnecter'),
      retryable: false,
    });
  });

  it('gives a generic, retryable message for anything else, without leaking the raw error', () => {
    const info = describeBackendError(parseError(141, 'Cloud Code: TypeError at main.js:42'), true);

    expect(info.title).toBe('Une erreur est survenue');
    expect(info.retryable).toBe(true);
    expect(info.message).not.toContain('main.js');
    expect(describeBackendError('boom', true).retryable).toBe(true);
    expect(describeBackendError(null, true).title).toBe('Une erreur est survenue');
  });
});

describe('isConnectionError', () => {
  it('is true when offline, on a timeout and on Parse code 100', () => {
    expect(isConnectionError(new Error('x'), false)).toBe(true);
    expect(isConnectionError(new BackendTimeoutError(), true)).toBe(true);
    expect(isConnectionError(parseError(100), true)).toBe(true);
  });
});
