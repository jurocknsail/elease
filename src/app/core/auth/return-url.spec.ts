import { safeReturnUrl } from './return-url';

describe('safeReturnUrl', () => {
  it('accepts internal paths, query and fragment included', () => {
    for (const url of ['/appels', '/locataires/abc123', '/appels/envoi?periode=2027-01', '/']) {
      expect(safeReturnUrl(url), url).toBe(url);
    }
  });

  it('rejects other origins, protocol-relative and javascript: addresses, the login page, control characters and non-strings', () => {
    for (const url of [
      'https://evil.example/appels',
      '//evil.example/appels',
      '/\\evil.example',
      'javascript:alert(1)',
      'appels',
      '',
      '/login',
      '/login?returnUrl=%2Fappels',
      '/appels\nSet-Cookie: x',
      '/appels' + String.fromCharCode(0),
      '/' + 'a'.repeat(2001),
    ]) {
      expect(safeReturnUrl(url), JSON.stringify(url)).toBeNull();
    }
    for (const value of [null, undefined, 42, ['/appels'], { toString: () => '/appels' }]) {
      expect(safeReturnUrl(value)).toBeNull();
    }
  });
});
