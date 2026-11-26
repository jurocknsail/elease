import { safeReturnUrl } from './return-url';

describe('safeReturnUrl', () => {
  it.each([
    '/appels',
    '/locataires/abc123',
    '/appels/envoi?periode=2027-01',
    '/locataires?q=dupont#top',
    '/',
  ])('accepts the internal path %s', (url) => {
    expect(safeReturnUrl(url)).toBe(url);
  });

  it.each([
    ['another origin', 'https://evil.example/appels'],
    ['a protocol-relative address', '//evil.example/appels'],
    ['a protocol-relative address with a backslash', '/\\evil.example'],
    ['a backslash', '/appels\\..\\x'],
    ['a javascript: address', 'javascript:alert(1)'],
    ['a relative path', 'appels'],
    ['an empty string', ''],
    ['the login page', '/login'],
    ['the login page with a query', '/login?returnUrl=%2Fappels'],
    ['a tab character', '/\t/evil.example'],
    ['a newline', '/appels\nSet-Cookie: x'],
    ['a NUL character', '/appels' + String.fromCharCode(0)],
    ['a DEL character', '/appels' + String.fromCharCode(127)],
    ['an absurdly long value', '/' + 'a'.repeat(2001)],
  ])('rejects %s', (_label, url) => {
    expect(safeReturnUrl(url)).toBeNull();
  });

  it('rejects anything that is not a string', () => {
    expect(safeReturnUrl(null)).toBeNull();
    expect(safeReturnUrl(undefined)).toBeNull();
    expect(safeReturnUrl(42)).toBeNull();
    expect(safeReturnUrl(['/appels'])).toBeNull();
    expect(safeReturnUrl({ toString: () => '/appels' })).toBeNull();
  });
});
