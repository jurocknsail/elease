import type { AppEnv } from '../app-env';

/** What the guard reads of the environment. */
export type GuardEnvironment = Pick<AppEnv, 'production' | 'testRecipientEmail'>;

/** An e-mail must not be sent to this recipient. The message is meant for the user (French). */
export class RecipientBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecipientBlockedError';
  }
}

const MAX_ADDRESS_LENGTH = 254;

const ASCII_ONLY = /^[\x00-\x7F]*$/;

/**
 * Characters that never belong to ONE plain address: white space and separators of every kind
 * (a no-break space, a line separator), control and invisible characters (zero-width, bidi marks),
 * list separators (comma, semicolon), display-name and quoting syntax (< > " ( ) [ ] \ :) and `@`.
 */
const FORBIDDEN = String.raw`\s\p{C}\p{Z}@,;:<>"()\[\]\\`;

/**
 * Exactly one `local@domain.tld`: a list of addresses, a display name, a line break (a way to
 * inject a header) or an empty label cannot match.
 */
const SINGLE_ADDRESS = new RegExp(
  `^[^${FORBIDDEN}]+@[^${FORBIDDEN}.]+(?:\\.[^${FORBIDDEN}.]+)+$`,
  'u',
);

/**
 * Whether `value` (trimmed) is exactly one plain address, the shape the sender accepts in every
 * environment. The contact form uses it too: Angular's `Validators.email` accepts `a@b`, which the
 * sender then refuses, so a tenant saved with it could never receive a rent call.
 */
export function isSingleEmailAddress(value: string): boolean {
  const address = typeof value === 'string' ? value.trim() : '';
  return address.length > 0 && address.length <= MAX_ADDRESS_LENGTH && SINGLE_ADDRESS.test(address);
}

/**
 * Throws a `RecipientBlockedError` when an e-mail must not go to `recipient`. Called by the sender
 * before EVERY e-mail, not only by the screen.
 *
 * - In every environment the recipient must be one plain address (trimmed): no list, no display
 *   name, no line break. A tenant record with `a@b.fr, c@d.fr` must never send to both, and a value
 *   with a line break must never reach a header.
 * - Outside production only `env.testRecipientEmail` is allowed, compared trimmed and
 *   case-insensitively (both ASCII only). Anything but `production === true` counts as outside production. This is the
 *   guard of the legacy app (`ParseService.sendEmail`, commit 27f6267), kept as it was.
 */
export function assertRecipientAllowed(recipient: string, env: GuardEnvironment): void {
  const address = typeof recipient === 'string' ? recipient.trim() : '';

  if (address === '') {
    throw new RecipientBlockedError('Aucune adresse e-mail renseignée.');
  }
  if (!isSingleEmailAddress(address)) {
    throw new RecipientBlockedError('Adresse e-mail invalide : un seul destinataire est autorisé.');
  }

  if (env.production === true) {
    return;
  }
  const testRecipient =
    typeof env.testRecipientEmail === 'string' ? env.testRecipientEmail.trim() : '';
  // Both addresses must be plain ASCII before they are compared case-insensitively: Unicode case
  // folding turns some other characters into ASCII letters (the Kelvin sign into `k`), which would
  // let a look-alike pass for the test address.
  const sameAddress =
    ASCII_ONLY.test(address) &&
    ASCII_ONLY.test(testRecipient) &&
    address.toLowerCase() === testRecipient.toLowerCase();
  if (testRecipient === '' || !sameAddress) {
    throw new RecipientBlockedError(
      `[DEV] Envoi bloqué vers ${address} : seul ${testRecipient === '' ? '(aucune adresse de test)' : testRecipient} est autorisé hors production.`,
    );
  }
}

/**
 * Mailjet sandbox flag to send with an e-mail: always true outside production (nothing is
 * delivered), the build's `sandbox` flag in production. Anything but `production === true` counts as
 * outside production.
 */
export function effectiveSandbox(env: Pick<AppEnv, 'production' | 'sandbox'>): boolean {
  return env.production === true ? env.sandbox : true;
}
