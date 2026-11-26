/** A throw-away origin: a value that parses to another origin is not an internal path. */
const BASE = 'https://app.invalid';

/**
 * The address to come back to after signing in, or null when it cannot be trusted. Only an internal
 * path of this app is accepted (`/locataires?x=1`): no other origin, no protocol-relative `//host`,
 * no backslash tricks, no control characters, and never the login page itself (a loop).
 */
export function safeReturnUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2000) {
    return null;
  }
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return null;
  }
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return null;
    }
  }
  let parsed: URL;
  try {
    parsed = new URL(value, BASE);
  } catch {
    return null;
  }
  if (parsed.origin !== BASE || parsed.pathname === '/login') {
    return null;
  }
  return value;
}
