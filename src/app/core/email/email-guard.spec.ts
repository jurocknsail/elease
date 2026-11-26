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
    it('blocks any address but the test one, with a RecipientBlockedError', () => {
      expect(() => assertRecipientAllowed(TENANT, dev)).toThrow(RecipientBlockedError);
      expect(() => assertRecipientAllowed(TENANT, dev)).toThrow(/Envoi bloqué/);
    });

    it('allows the test address, compared case-insensitively and trimmed', () => {
      expect(() => assertRecipientAllowed(TEST_ADDRESS, dev)).not.toThrow();
      expect(() => assertRecipientAllowed('JULIEN.berger1421@gmail.com', dev)).not.toThrow();
      expect(() => assertRecipientAllowed(`  ${TEST_ADDRESS}\n`, dev)).not.toThrow();
    });

    it('is case-insensitive on the configured address too', () => {
      const env = { ...dev, testRecipientEmail: 'Julien.Berger1421@Gmail.com' };
      expect(() => assertRecipientAllowed(TEST_ADDRESS, env)).not.toThrow();
    });

    it('blocks lookalikes: prefix, suffix, plus-addressing, other domain', () => {
      for (const lookalike of [
        'xjulien.berger1421@gmail.com',
        'julien.berger1421@gmail.com.example.test',
        'julien.berger1421+tenant@gmail.com',
        'julien.berger1421@gmail.co',
        'julien.berger1421@googlemail.com',
      ]) {
        expect(() => assertRecipientAllowed(lookalike, dev), lookalike).toThrow(
          RecipientBlockedError,
        );
      }
    });

    it('blocks everything when no test address is configured, even the developer address', () => {
      for (const testRecipientEmail of [undefined, '', '   ']) {
        const env = { production: false, sandbox: true, testRecipientEmail };
        expect(() => assertRecipientAllowed(TEST_ADDRESS, env)).toThrow(RecipientBlockedError);
        expect(() => assertRecipientAllowed(TENANT, env)).toThrow(RecipientBlockedError);
      }
    });

    it('names the allowed address and says nothing was sent', () => {
      expect(() => assertRecipientAllowed(TENANT, dev)).toThrow(
        `[DEV] Envoi bloqué vers ${TENANT} : seul ${TEST_ADDRESS} est autorisé hors production.`,
      );
      expect(() => assertRecipientAllowed(TENANT, { production: false })).toThrow(
        `[DEV] Envoi bloqué vers ${TENANT} : seul (aucune adresse de test) est autorisé hors production.`,
      );
    });

    it('treats anything but production === true as outside production (fails closed)', () => {
      for (const production of [undefined, null, 0, '', 'true', 'false']) {
        const env = { production, testRecipientEmail: TEST_ADDRESS } as never;
        expect(() => assertRecipientAllowed(TENANT, env), String(production)).toThrow(
          RecipientBlockedError,
        );
      }
    });

    describe('look-alike characters (case folding must not make a stranger equal)', () => {
      const KELVIN_SIGN = String.fromCharCode(0x212a);
      const CYRILLIC_A = String.fromCharCode(0x430);

      it('blocks a Cyrillic homoglyph of the test address', () => {
        const homoglyph = TEST_ADDRESS.replace('a', CYRILLIC_A);
        expect(homoglyph).not.toBe(TEST_ADDRESS);
        expect(() => assertRecipientAllowed(homoglyph, dev)).toThrow(RecipientBlockedError);
      });

      it('blocks a Kelvin sign, which lower-cases to an ASCII k, in place of a k', () => {
        const env = { production: false, sandbox: true, testRecipientEmail: 'kim@example.test' };
        expect(() => assertRecipientAllowed('KIM@EXAMPLE.TEST', env)).not.toThrow();
        expect(() => assertRecipientAllowed(`${KELVIN_SIGN}im@example.test`, env)).toThrow(
          RecipientBlockedError,
        );
        expect(() => assertRecipientAllowed(`${KELVIN_SIGN}IM@example.test`, env)).toThrow(
          RecipientBlockedError,
        );
      });

      it('blocks everything when the configured test address itself is not ASCII', () => {
        const env = {
          production: false,
          sandbox: true,
          testRecipientEmail: `${KELVIN_SIGN}im@example.test`,
        };
        expect(() => assertRecipientAllowed('kim@example.test', env)).toThrow(
          RecipientBlockedError,
        );
        expect(() => assertRecipientAllowed(`${KELVIN_SIGN}im@example.test`, env)).toThrow(
          RecipientBlockedError,
        );
      });

      it('blocks the test address with any one character swapped for a non-ASCII look-alike', () => {
        const lookAlikes = [0x212a, 0x0130, 0x0131, 0xff4a, 0x430, 0x435, 0x3b1, 0x17f].map(
          (code) => String.fromCharCode(code),
        );
        for (let position = 0; position < TEST_ADDRESS.length; position += 1) {
          for (const lookAlike of lookAlikes) {
            const variant =
              TEST_ADDRESS.slice(0, position) + lookAlike + TEST_ADDRESS.slice(position + 1);
            expect(
              () => assertRecipientAllowed(variant, dev),
              `${position}:${lookAlike.charCodeAt(0)}`,
            ).toThrow(RecipientBlockedError);
          }
        }
      });

      it('keeps the message of the other blocked recipients', () => {
        const env = { production: false, sandbox: true, testRecipientEmail: 'kim@example.test' };
        expect(() => assertRecipientAllowed(`${KELVIN_SIGN}im@example.test`, env)).toThrow(
          `[DEV] Envoi bloqué vers ${KELVIN_SIGN}im@example.test : seul kim@example.test est autorisé hors production.`,
        );
      });
    });

    describe('several addresses and header injection', () => {
      const injected = [
        `${TEST_ADDRESS},${TENANT}`,
        `${TENANT},${TEST_ADDRESS}`,
        `${TEST_ADDRESS};${TENANT}`,
        `${TEST_ADDRESS} ${TENANT}`,
        `${TEST_ADDRESS}\n${TENANT}`,
        `${TEST_ADDRESS}\r\nBcc: ${TENANT}`,
        `${TEST_ADDRESS}\tx`,
        `Julien <${TEST_ADDRESS}>`,
        `<${TEST_ADDRESS}>`,
        `"${TEST_ADDRESS}"`,
        `mailto:${TEST_ADDRESS}`,
        `${TEST_ADDRESS}${ZERO_WIDTH_SPACE}`,
        `${TEST_ADDRESS}${NO_BREAK_SPACE}${TENANT}`,
        `${TEST_ADDRESS}${LINE_SEPARATOR}${TENANT}`,
      ];

      it.each(injected.map((value) => [JSON.stringify(value), value]))(
        'blocks %s',
        (_label, value) => {
          expect(() => assertRecipientAllowed(value, dev)).toThrow(RecipientBlockedError);
        },
      );

      it('blocks them even when the configured test address is itself such a list', () => {
        const list = `${TEST_ADDRESS},${TENANT}`;
        const env = { production: false, sandbox: true, testRecipientEmail: list };
        expect(() => assertRecipientAllowed(list, env)).toThrow(RecipientBlockedError);
        expect(() => assertRecipientAllowed(TEST_ADDRESS, env)).toThrow(RecipientBlockedError);
      });

      it('does not echo a malformed value in the message', () => {
        try {
          assertRecipientAllowed(`${TEST_ADDRESS},${TENANT}`, dev);
          expect.unreachable('the guard must throw');
        } catch (error) {
          expect(error).toBeInstanceOf(RecipientBlockedError);
          expect((error as Error).message).not.toContain(TENANT);
        }
      });
    });
  });

  describe('in production', () => {
    it('allows any well-formed single address, and ignores the test address', () => {
      expect(() => assertRecipientAllowed(TENANT, prod)).not.toThrow();
      expect(() => assertRecipientAllowed(TENANT, { production: true })).not.toThrow();
      expect(() => assertRecipientAllowed(TEST_ADDRESS, prod)).not.toThrow();
      expect(() =>
        assertRecipientAllowed('  Prénom.Nom+x@sous.domaine.example.test ', prod),
      ).not.toThrow();
      expect(() => assertRecipientAllowed("o'brien@example.test", prod)).not.toThrow();
      expect(() => assertRecipientAllowed('élodie@exemple.test', prod)).not.toThrow();
    });

    it.each([
      ['empty', ''],
      ['blank', '   '],
      ['no at sign', 'locataire.example.test'],
      ['no domain', 'locataire@'],
      ['no local part', '@example.test'],
      ['domain without dot', 'locataire@localhost'],
      ['dot at the end of the domain', 'locataire@example.'],
      ['two dots in a row', 'locataire@example..test'],
      ['two at signs', 'a@b@example.test'],
      ['comma list', `${TENANT},${TEST_ADDRESS}`],
      ['semicolon list', `${TENANT};${TEST_ADDRESS}`],
      ['space list', `${TENANT} ${TEST_ADDRESS}`],
      ['newline', `${TENANT}\nBcc: ${TEST_ADDRESS}`],
      ['carriage return and line feed', `${TENANT}\r\nBcc: ${TEST_ADDRESS}`],
      ['tab', `${TENANT}\tx`],
      ['display name', `Locataire <${TENANT}>`],
      ['comma in the local part', 'a,b@example.test'],
      ['comma in the domain', 'a@example.test,b'],
      ['semicolon in the local part', 'a;b@example.test'],
      ['angle brackets', '<a@example.test>'],
      ['closing angle bracket', 'a@example.test>'],
      ['colon', 'a:b@example.test'],
      ['mailto scheme', 'mailto:a@example.test'],
      ['IP literal', 'a@[1.2.3.4]'],
      ['quoted', `"${TENANT}"`],
      ['zero-width space', `${TENANT}${ZERO_WIDTH_SPACE}`],
      ['no-break space inside', `a${NO_BREAK_SPACE}b@example.test`],
      ['control character', `a${String.fromCharCode(1)}b@example.test`],
      ['too long', `${'a'.repeat(250)}@example.test`],
    ])('rejects a malformed recipient: %s', (_label, value) => {
      expect(() => assertRecipientAllowed(value, prod)).toThrow(RecipientBlockedError);
    });

    it('rejects values that are not strings', () => {
      for (const value of [undefined, null, 5, {}, []]) {
        expect(() => assertRecipientAllowed(value as never, prod)).toThrow(RecipientBlockedError);
      }
    });

    it('says when there is no address at all', () => {
      expect(() => assertRecipientAllowed('  ', prod)).toThrow(/Aucune adresse e-mail/);
    });
  });
});

describe('effectiveSandbox', () => {
  it('is always true outside production, whatever the flag says', () => {
    expect(effectiveSandbox({ production: false, sandbox: false })).toBe(true);
    expect(effectiveSandbox({ production: false, sandbox: true })).toBe(true);
  });

  it('follows the flag in production', () => {
    expect(effectiveSandbox({ production: true, sandbox: false })).toBe(false);
    expect(effectiveSandbox({ production: true, sandbox: true })).toBe(true);
  });

  it('is true unless production is exactly true (fails closed)', () => {
    for (const production of [undefined, null, 0, '', 'true']) {
      expect(effectiveSandbox({ production, sandbox: false } as never), String(production)).toBe(
        true,
      );
    }
  });
});
