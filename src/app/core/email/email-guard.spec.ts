import { assertRecipientAllowed, effectiveSandbox, RecipientBlockedError } from './email-guard';

/** The only address an e-mail may go to outside production (a developer account, never a tenant). */
const TEST_ADDRESS = 'julien.berger1421@gmail.com';
const TENANT = 'locataire@example.test';

const dev = { production: false, sandbox: false, testRecipientEmail: TEST_ADDRESS };
const prod = { production: true, sandbox: false, testRecipientEmail: TEST_ADDRESS };

const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const NO_BREAK_SPACE = String.fromCharCode(0x00a0);
const LINE_SEPARATOR = String.fromCharCode(0x2028);

describe('assertRecipientAllowed', () => {
  describe('outside production', () => {
    it('blocks any address but the test one, naming the allowed address', () => {
      expect(() => assertRecipientAllowed(TENANT, dev)).toThrow(RecipientBlockedError);
      expect(() => assertRecipientAllowed(TENANT, dev)).toThrow(
        `[DEV] Envoi bloqué vers ${TENANT} : seul ${TEST_ADDRESS} est autorisé hors production.`,
      );
    });

    it('allows the test address, compared case-insensitively and trimmed', () => {
      expect(() => assertRecipientAllowed(TEST_ADDRESS, dev)).not.toThrow();
      expect(() => assertRecipientAllowed('JULIEN.berger1421@gmail.com', dev)).not.toThrow();
      expect(() => assertRecipientAllowed(`  ${TEST_ADDRESS}\n`, dev)).not.toThrow();
      const env = { ...dev, testRecipientEmail: 'Julien.Berger1421@Gmail.com' };
      expect(() => assertRecipientAllowed(TEST_ADDRESS, env)).not.toThrow();
    });

    it('blocks lookalikes: plus-addressing, other domain, homoglyph, Kelvin sign', () => {
      const KELVIN_SIGN = String.fromCharCode(0x212a);
      const CYRILLIC_A = String.fromCharCode(0x430);
      for (const lookalike of [
        'julien.berger1421+tenant@gmail.com',
        'julien.berger1421@gmail.com.example.test',
        'julien.berger1421@googlemail.com',
        TEST_ADDRESS.replace('a', CYRILLIC_A),
      ]) {
        expect(() => assertRecipientAllowed(lookalike, dev), lookalike).toThrow(
          RecipientBlockedError,
        );
      }
      // Case folding must not make a stranger equal: the Kelvin sign lower-cases to an ASCII k.
      const env = { production: false, sandbox: true, testRecipientEmail: 'kim@example.test' };
      expect(() => assertRecipientAllowed('KIM@EXAMPLE.TEST', env)).not.toThrow();
      expect(() => assertRecipientAllowed(`${KELVIN_SIGN}im@example.test`, env)).toThrow(
        RecipientBlockedError,
      );
    });

    it('fails closed: no test address configured, or production not exactly true', () => {
      for (const testRecipientEmail of [undefined, '', '   ']) {
        const env = { production: false, sandbox: true, testRecipientEmail };
        expect(() => assertRecipientAllowed(TEST_ADDRESS, env)).toThrow(RecipientBlockedError);
      }
      for (const production of [undefined, null, 0, '', 'true']) {
        const env = { production, testRecipientEmail: TEST_ADDRESS } as never;
        expect(() => assertRecipientAllowed(TENANT, env), String(production)).toThrow(
          RecipientBlockedError,
        );
      }
    });

    it('blocks several addresses and header injection, without echoing the value', () => {
      const injected = [
        `${TEST_ADDRESS},${TENANT}`,
        `${TENANT},${TEST_ADDRESS}`,
        `${TEST_ADDRESS};${TENANT}`,
        `${TEST_ADDRESS} ${TENANT}`,
        `${TEST_ADDRESS}\r\nBcc: ${TENANT}`,
        `Julien <${TEST_ADDRESS}>`,
        `${TEST_ADDRESS}${ZERO_WIDTH_SPACE}`,
        `${TEST_ADDRESS}${NO_BREAK_SPACE}${TENANT}`,
        `${TEST_ADDRESS}${LINE_SEPARATOR}${TENANT}`,
      ];
      for (const value of injected) {
        expect(() => assertRecipientAllowed(value, dev), JSON.stringify(value)).toThrow(
          RecipientBlockedError,
        );
      }
      try {
        assertRecipientAllowed(`${TEST_ADDRESS},${TENANT}`, dev);
        expect.unreachable('the guard must throw');
      } catch (error) {
        expect((error as Error).message).not.toContain(TENANT);
      }
    });
  });

  describe('in production', () => {
    it('allows any well-formed single address, and ignores the test address', () => {
      expect(() => assertRecipientAllowed(TENANT, prod)).not.toThrow();
      expect(() => assertRecipientAllowed(TENANT, { production: true })).not.toThrow();
      expect(() =>
        assertRecipientAllowed('  Prénom.Nom+x@sous.domaine.example.test ', prod),
      ).not.toThrow();
    });

    it('rejects a malformed recipient, a non-string and an empty value', () => {
      for (const value of [
        '',
        'locataire.example.test',
        'locataire@',
        '@example.test',
        'locataire@localhost',
        'locataire@example..test',
        'a@b@example.test',
        `${TENANT},${TEST_ADDRESS}`,
        `${TENANT};${TEST_ADDRESS}`,
        `${TENANT} ${TEST_ADDRESS}`,
        `${TENANT}\r\nBcc: ${TEST_ADDRESS}`,
        `Locataire <${TENANT}>`,
        `"${TENANT}"`,
        'mailto:a@example.test',
        `${TENANT}${ZERO_WIDTH_SPACE}`,
        `a${String.fromCharCode(1)}b@example.test`,
        `${'a'.repeat(250)}@example.test`,
      ]) {
        expect(() => assertRecipientAllowed(value, prod), JSON.stringify(value)).toThrow(
          RecipientBlockedError,
        );
      }
      for (const value of [undefined, null, 5, {}, []]) {
        expect(() => assertRecipientAllowed(value as never, prod)).toThrow(RecipientBlockedError);
      }
      expect(() => assertRecipientAllowed('  ', prod)).toThrow(/Aucune adresse e-mail/);
    });
  });
});

describe('effectiveSandbox', () => {
  it('is always true outside production, follows the flag in production, and fails closed', () => {
    expect(effectiveSandbox({ production: false, sandbox: false })).toBe(true);
    expect(effectiveSandbox({ production: true, sandbox: false })).toBe(false);
    expect(effectiveSandbox({ production: true, sandbox: true })).toBe(true);
    expect(effectiveSandbox({ production: 'true', sandbox: false } as never)).toBe(true);
  });
});
