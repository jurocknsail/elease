import { TestBed } from '@angular/core/testing';
import { APP_ENV, type AppEnv } from '../app-env';
import { periodKey } from '../billing/period';
import { DEFAULT_LANDLORD_PROFILE, type LandlordProfile } from '../models/landlord-profile';
import type { Lease } from '../models/lease';
import type { Leaseholder } from '../models/leaseholder';
import { LeaseholderRepository } from '../parse/leaseholder.repository';
import { AuthService } from '../auth/auth.service';
import { SessionErrorHandler } from '../auth/session-error';
import { ParseClient } from '../parse/parse-client';
import { FakeParseClient, parseError, pointer } from '../parse/testing/fake-parse-client';
import { assertRecipientAllowed, RecipientBlockedError } from './email-guard';
import {
  groupByEmail,
  rentCallBody,
  rentCallSubject,
  type EmailGroup,
  type GeneratedPdf,
} from './rent-call-email';
import {
  RECORD_TIMEOUT_MS,
  RentCallSender,
  SEND_CLOCK,
  SEND_TIMEOUT_MS,
  type SendResult,
} from './rent-call-sender';

/** The only address an e-mail may go to outside production (a developer account, never a tenant). */
const TEST_ADDRESS = 'julien.berger1421@gmail.com';
const A = 'a@example.test';
const B = 'b@example.test';
const C = 'c@example.test';

const DEV: AppEnv = { production: false, sandbox: false, testRecipientEmail: TEST_ADDRESS };
const PROD: AppEnv = { production: true, sandbox: false, testRecipientEmail: TEST_ADDRESS };

const PERIOD = { year: 2027, month: 1 };
const AT = 1_800_000_000_000;

const UNCERTAIN_MESSAGE =
  "Délai dépassé : l'e-mail a peut-être été envoyé. Vérifiez votre boîte avant de renvoyer.";
const RECORD_WARNING =
  "E-mail envoyé, mais l'état d'envoi n'a pas pu être enregistré : ne le renvoyez pas.";

function lease(id: string | undefined, name = 'Studio'): Lease {
  return {
    objectId: id,
    isPro: false,
    name,
    lot: null,
    streetNumber: 1,
    streetName: 'rue des Tests',
    optionalAddressInfo: '',
    postalCode: 13600,
    city: 'La Ciotat',
    price: 500,
    charge: null,
    additionalCharges: [],
    lastSendDate: 0,
    renewalDate: null,
  };
}

function pdf(id: string | undefined, fileName = `${id}.pdf`): GeneratedPdf {
  return { lease: lease(id), fileName, base64: `base64-${id}` };
}

function group(holderNames: string[], ...pdfs: GeneratedPdf[]): EmailGroup {
  return { holderNames, pdfs };
}

function holder(name: string, email: string): Leaseholder {
  return { objectId: `h-${name}`, name, email, phone: '', leases: [] };
}

type MarkLeasesSent = LeaseholderRepository['markLeasesSent'];

/** The sender over a fake Parse client and a stubbed repository: no SDK, no network, no e-mail. */
function setup(env: AppEnv = PROD, now: (() => number) | null = () => AT) {
  const fake = new FakeParseClient();
  const markLeasesSent = vi.fn<MarkLeasesSent>(() => Promise.resolve());
  // The expired-session redirect is observed, never performed.
  const handleSession = vi.fn((_error: unknown) => true);
  TestBed.configureTestingModule({
    providers: [
      { provide: ParseClient, useValue: fake },
      { provide: LeaseholderRepository, useValue: { markLeasesSent } },
      { provide: SessionErrorHandler, useValue: { handle: handleSession } },
      { provide: APP_ENV, useValue: env },
      // `null`: keep the default clock of the application.
      ...(now ? [{ provide: SEND_CLOCK, useValue: now }] : []),
    ],
  });
  return { fake, markLeasesSent, handleSession, sender: TestBed.inject(RentCallSender) };
}

function cloudCalls(fake: FakeParseClient) {
  return fake.callsOf('cloud');
}

/** Makes the cloud call to `recipient` fail. */
function failFor(fake: FakeParseClient, recipient: string, error: unknown): void {
  fake.failWhen(
    (call) => call.op === 'cloud' && call.params?.['recipientEmail'] === recipient,
    error,
  );
}

function hangFor(fake: FakeParseClient, recipient: string): void {
  fake.hangWhen((call) => call.op === 'cloud' && call.params?.['recipientEmail'] === recipient);
}

function byEmail(results: SendResult[], email: string): SendResult {
  const found = results.find((result) => result.email === email);
  if (!found) {
    throw new Error('no result for the recipient');
  }
  return found;
}

describe('RentCallSender', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('one e-mail per recipient address', () => {
    it('calls the cloud function sendEmail once per address, and gives one result per address in order', async () => {
      const { fake, sender } = setup();
      const groups = new Map([
        [A, group(['Agi'], pdf('la1'))],
        [B, group(['Bob'], pdf('lb1'))],
        [C, group(['Cléo'], pdf('lc1'))],
      ]);

      const results = await sender.send(groups, PERIOD, DEFAULT_LANDLORD_PROFILE);

      expect(cloudCalls(fake).map((call) => call.functionName)).toEqual([
        'sendEmail',
        'sendEmail',
        'sendEmail',
      ]);
      expect(cloudCalls(fake).map((call) => call.params?.['recipientEmail'])).toEqual([A, B, C]);
      expect(results.map((result) => result.email)).toEqual([A, B, C]);
      expect(results.every((result) => result.ok)).toBe(true);
    });

    it('sends ONE e-mail with all the PDFs to two tenants sharing an address', async () => {
      const { fake, markLeasesSent, sender } = setup();
      const groups = groupByEmail([
        { holder: holder('Agi Martin', 'Famille@Example.test'), pdf: pdf('l1') },
        { holder: holder('Bob Martin', 'famille@example.test'), pdf: pdf('l2') },
      ]);

      const results = await sender.send(groups, PERIOD, DEFAULT_LANDLORD_PROFILE);

      expect(cloudCalls(fake)).toHaveLength(1);
      const attachments = cloudCalls(fake)[0].params?.['attachments'] as Array<{
        Filename: string;
      }>;
      expect(attachments.map((a) => a.Filename)).toEqual(['l1.pdf', 'l2.pdf']);
      expect(results).toEqual([
        {
          email: 'famille@example.test',
          holderNames: ['Agi Martin', 'Bob Martin'],
          ok: true,
          simulated: false,
          leaseIds: ['l1', 'l2'],
        },
      ]);
      expect(markLeasesSent).toHaveBeenCalledTimes(1);
      expect(markLeasesSent).toHaveBeenCalledWith(['l1', 'l2'], '2027-01', AT);
    });

    it('sends nothing for an empty map', async () => {
      const { fake, markLeasesSent, sender } = setup();
      await expect(sender.send(new Map(), PERIOD, DEFAULT_LANDLORD_PROFILE)).resolves.toEqual([]);
      expect(cloudCalls(fake)).toEqual([]);
      expect(markLeasesSent).not.toHaveBeenCalled();
    });
  });

  describe('what is sent to the cloud function (legacy parameter names)', () => {
    it('sends exactly senderEmail, recipientEmail, subject, text, attachments and sandbox', async () => {
      const { fake, sender } = setup(PROD);
      fake.userEmail = 'proprietaire@example.test';
      const profile: LandlordProfile = {
        ...DEFAULT_LANDLORD_PROFILE,
        emailSignature: 'Jeanne TEST',
      };

      await sender.send(
        new Map([
          [
            A,
            group(
              ['Agi'],
              pdf('la1', 'agi-studio-01_2027.pdf'),
              pdf('la2', 'agi-cave-01_2027.pdf'),
            ),
          ],
        ]),
        PERIOD,
        profile,
      );

      expect(cloudCalls(fake)).toHaveLength(1);
      expect(cloudCalls(fake)[0].params).toEqual({
        senderEmail: 'proprietaire@example.test',
        recipientEmail: A,
        subject: 'Appel de loyer — janvier 2027',
        text: rentCallBody(profile),
        attachments: [
          {
            ContentType: 'application/pdf',
            Filename: 'agi-studio-01_2027.pdf',
            Base64Content: 'base64-la1',
          },
          {
            ContentType: 'application/pdf',
            Filename: 'agi-cave-01_2027.pdf',
            Base64Content: 'base64-la2',
          },
        ],
        sandbox: false,
      });
      expect(cloudCalls(fake)[0].params?.['subject']).toBe(rentCallSubject(PERIOD));
    });

    it('trims the recipient it sends to', async () => {
      const { fake, sender } = setup(PROD);
      await sender.send(
        new Map([[`  ${A}\n`, group(['Agi'], pdf('la1'))]]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );
      expect(cloudCalls(fake)[0].params?.['recipientEmail']).toBe(A);
    });

    it('gives two attachments of the same name distinct names', async () => {
      const { fake, sender } = setup();
      await sender.send(
        new Map([
          [
            A,
            group(
              ['Agi'],
              pdf('l1', 'agi-garage-01_2027.pdf'),
              pdf('l2', 'agi-garage-01_2027.pdf'),
              pdf('l3', 'AGI-GARAGE-01_2027.PDF'),
            ),
          ],
        ]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );
      const attachments = cloudCalls(fake)[0].params?.['attachments'] as Array<{
        Filename: string;
        Base64Content: string;
      }>;
      expect(attachments.map((a) => a.Filename)).toEqual([
        'agi-garage-01_2027.pdf',
        'agi-garage-01_2027-2.pdf',
        'AGI-GARAGE-01_2027-3.PDF',
      ]);
      // Each name goes with its own PDF.
      expect(attachments.map((a) => a.Base64Content)).toEqual([
        'base64-l1',
        'base64-l2',
        'base64-l3',
      ]);
    });

    it('does not change the groups it is given', async () => {
      const { sender } = setup();
      const names = ['Agi'];
      const first = group(names, pdf('l1', 'x.pdf'), pdf('l2', 'x.pdf'));
      const groups = new Map([[A, first]]);

      await sender.send(groups, PERIOD, DEFAULT_LANDLORD_PROFILE);

      expect(first.pdfs.map((p) => p.fileName)).toEqual(['x.pdf', 'x.pdf']);
      expect(first.holderNames).toBe(names);
    });
  });

  describe('sandbox', () => {
    it('is true on every call outside production, whatever the build flag says', async () => {
      const { fake, sender } = setup(DEV);
      // Two keys that both pass the development guard (same address, different case).
      const groups = new Map([
        [TEST_ADDRESS, group(['Julien'], pdf('l1'))],
        [TEST_ADDRESS.toUpperCase(), group(['Julien'], pdf('l2'))],
      ]);

      const results = await sender.send(groups, PERIOD, DEFAULT_LANDLORD_PROFILE);

      expect(results.every((result) => result.ok)).toBe(true);
      expect(cloudCalls(fake)).toHaveLength(2);
      expect(cloudCalls(fake).map((call) => call.params?.['sandbox'])).toEqual([true, true]);
    });

    it('follows the build flag in production', async () => {
      for (const sandbox of [true, false]) {
        TestBed.resetTestingModule();
        const { fake, sender } = setup({ production: true, sandbox });
        await sender.send(
          new Map([[A, group(['Agi'], pdf('l1'))]]),
          PERIOD,
          DEFAULT_LANDLORD_PROFILE,
        );
        expect(cloudCalls(fake)[0].params?.['sandbox'], String(sandbox)).toBe(sandbox);
      }
    });
  });

  describe('the recipient guard runs inside the sender, before EVERY call', () => {
    it('outside production, blocks any address but the test one: ok false, the guard message, no cloud call', async () => {
      const { fake, markLeasesSent, sender } = setup(DEV);
      let guardMessage = '';
      try {
        assertRecipientAllowed(A, DEV);
      } catch (error) {
        guardMessage = (error as Error).message;
      }
      expect(guardMessage).toContain('[DEV]');

      const results = await sender.send(
        new Map([[A, group(['Agi'], pdf('la1'))]]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );

      expect(results).toEqual([
        {
          email: A,
          holderNames: ['Agi'],
          ok: false,
          simulated: true,
          error: guardMessage,
          leaseIds: ['la1'],
        },
      ]);
      expect(cloudCalls(fake)).toEqual([]);
      expect(markLeasesSent).not.toHaveBeenCalled();
    });

    it('lets the test address through and blocks the others of the same send', async () => {
      const { fake, markLeasesSent, sender } = setup(DEV);
      const results = await sender.send(
        new Map([
          [A, group(['Agi'], pdf('la1'))],
          [TEST_ADDRESS, group(['Julien'], pdf('lj1'))],
          [B, group(['Bob'], pdf('lb1'))],
        ]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );

      expect(results.map((result) => [result.email, result.ok])).toEqual([
        [A, false],
        [TEST_ADDRESS, true],
        [B, false],
      ]);
      expect(cloudCalls(fake).map((call) => call.params?.['recipientEmail'])).toEqual([
        TEST_ADDRESS,
      ]);
      expect(markLeasesSent).toHaveBeenCalledTimes(1);
      expect(markLeasesSent).toHaveBeenCalledWith(['lj1'], '2027-01', AT);
    });

    it('blocks a list of addresses even when it starts with the test address', async () => {
      const { fake, sender } = setup(DEV);
      const results = await sender.send(
        new Map([
          [`${TEST_ADDRESS},${A}`, group(['Agi'], pdf('l1'))],
          [`${TEST_ADDRESS}\nBcc: ${A}`, group(['Bob'], pdf('l2'))],
        ]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );
      expect(results.map((result) => result.ok)).toEqual([false, false]);
      expect(cloudCalls(fake)).toEqual([]);
    });

    it('blocks everything when the build has no test address', async () => {
      const { fake, sender } = setup({ production: false, sandbox: true });
      const results = await sender.send(
        new Map([[TEST_ADDRESS, group(['Julien'], pdf('l1'))]]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );
      expect(results[0].ok).toBe(false);
      expect(cloudCalls(fake)).toEqual([]);
    });

    it('in production, refuses a malformed recipient (several addresses, line break)', async () => {
      const { fake, markLeasesSent, sender } = setup(PROD);
      const results = await sender.send(
        new Map([
          [`${A},${B}`, group(['Agi'], pdf('l1'))],
          [`${A}\nBcc: ${B}`, group(['Bob'], pdf('l2'))],
          ['pas une adresse', group(['Cléo'], pdf('l3'))],
        ]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );
      expect(results.map((result) => result.ok)).toEqual([false, false, false]);
      expect(
        results.every((result) => typeof result.error === 'string' && result.error !== ''),
      ).toBe(true);
      expect(cloudCalls(fake)).toEqual([]);
      expect(markLeasesSent).not.toHaveBeenCalled();
    });

    it('is not skipped by a tenant without an address: it is reported, nothing goes to an empty recipient', async () => {
      for (const env of [DEV, PROD]) {
        TestBed.resetTestingModule();
        const { fake, markLeasesSent, sender } = setup(env);
        const groups = groupByEmail([
          { holder: holder('Sans Mail', ''), pdf: pdf('l1') },
          { holder: holder('Blanc', '  '), pdf: pdf('l2') },
        ]);

        const results = await sender.send(groups, PERIOD, DEFAULT_LANDLORD_PROFILE);

        expect(results).toEqual([
          {
            email: '',
            holderNames: ['Sans Mail', 'Blanc'],
            ok: false,
            simulated: !env.production,
            error: 'Aucune adresse e-mail renseignée.',
            leaseIds: ['l1', 'l2'],
          },
        ]);
        expect(cloudCalls(fake)).toEqual([]);
        expect(markLeasesSent).not.toHaveBeenCalled();
      }
    });
  });

  describe('a failure in one group does not stop the others', () => {
    it('gives A ok and B an error, records only A, and resolves', async () => {
      const { fake, markLeasesSent, sender } = setup();
      failFor(fake, B, parseError(141, 'Mailjet refused the message'));

      const results = await sender.send(
        new Map([
          [A, group(['Agi'], pdf('la1'), pdf('la2'))],
          [B, group(['Bob'], pdf('lb1'))],
        ]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );

      expect(results).toHaveLength(2);
      expect(byEmail(results, A)).toEqual({
        email: A,
        holderNames: ['Agi'],
        ok: true,
        simulated: false,
        leaseIds: ['la1', 'la2'],
      });
      const failed = byEmail(results, B);
      expect(failed.ok).toBe(false);
      expect(failed.leaseIds).toEqual(['lb1']);
      expect(failed.uncertain).toBeUndefined();
      expect(failed.warning).toBeUndefined();
      expect(failed.error).toContain("L'envoi a échoué");
      expect(failed.error).toContain('Mailjet refused the message');

      expect(markLeasesSent).toHaveBeenCalledTimes(1);
      expect(markLeasesSent).toHaveBeenCalledWith(['la1', 'la2'], '2027-01', AT);
    });

    it('records nothing when every group fails', async () => {
      const { fake, markLeasesSent, sender } = setup();
      failFor(fake, A, new Error('down'));
      failFor(fake, B, new Error('down'));

      const results = await sender.send(
        new Map([
          [A, group(['Agi'], pdf('la1'))],
          [B, group(['Bob'], pdf('lb1'))],
        ]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );

      expect(results.map((result) => result.ok)).toEqual([false, false]);
      expect(markLeasesSent).not.toHaveBeenCalled();
    });

    it('never retries a failed send', async () => {
      const { fake, sender } = setup();
      failFor(fake, A, new Error('down'));
      await sender.send(
        new Map([[A, group(['Agi'], pdf('la1'))]]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );
      expect(cloudCalls(fake)).toHaveLength(1);
    });

    it('survives a throw while the cloud call is being started', async () => {
      const { fake, markLeasesSent, sender } = setup();
      vi.spyOn(fake, 'runCloud').mockImplementation(() => {
        throw new Error('SDK not ready');
      });
      const results = await sender.send(
        new Map([[A, group(['Agi'], pdf('la1'))]]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );
      expect(results[0].ok).toBe(false);
      expect(markLeasesSent).not.toHaveBeenCalled();
    });

    it('reports a malformed group as failed and still sends the others', async () => {
      const { fake, markLeasesSent, sender } = setup();
      const broken = { holderNames: ['Cassé'] } as unknown as EmailGroup;

      const results = await sender.send(
        new Map([
          [A, broken],
          [B, group(['Bob'], pdf('lb1'))],
        ]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );

      expect(byEmail(results, A).ok).toBe(false);
      expect(byEmail(results, A).holderNames).toEqual(['Cassé']);
      expect(byEmail(results, B).ok).toBe(true);
      expect(cloudCalls(fake)).toHaveLength(1);
      expect(markLeasesSent).toHaveBeenCalledTimes(1);
    });

    it('refuses a group without any PDF: nothing is sent', async () => {
      const { fake, sender } = setup();
      const results = await sender.send(
        new Map([[A, group(['Agi'])]]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );
      expect(results[0].ok).toBe(false);
      expect(cloudCalls(fake)).toEqual([]);
    });

    it('refuses to send without a session: nothing is sent, and the result carries the session code', async () => {
      const { fake, markLeasesSent, sender } = setup();
      fake.userId = null;

      const [result] = await sender.send(
        new Map([[A, group(['Agi'], pdf('la1'))]]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );

      expect(result).toEqual({
        email: A,
        holderNames: ['Agi'],
        ok: false,
        simulated: false,
        error: 'Session expirée : veuillez vous reconnecter.',
        errorCode: 209,
        leaseIds: ['la1'],
      });
      expect(cloudCalls(fake)).toEqual([]);
      expect(markLeasesSent).not.toHaveBeenCalled();
    });

    it('says so when the signed-in account has no e-mail address: nothing is sent, not a session error', async () => {
      const { fake, markLeasesSent, sender } = setup();
      for (const email of [null, '']) {
        fake.userEmail = email;
        const [result] = await sender.send(
          new Map([[A, group(['Agi'], pdf('la1'))]]),
          PERIOD,
          DEFAULT_LANDLORD_PROFILE,
        );
        expect(result.ok).toBe(false);
        expect(result.error).toBe("Votre compte n'a pas d'adresse e-mail : envoi impossible.");
        expect(result.errorCode).toBeUndefined();
        expect(result.uncertain).toBeUndefined();
      }
      expect(cloudCalls(fake)).toEqual([]);
      expect(markLeasesSent).not.toHaveBeenCalled();
    });
  });

  describe('a send that does not answer (the e-mail may have been delivered)', () => {
    it('answers after 60 seconds, not before, with an uncertain result and no record', async () => {
      vi.useFakeTimers();
      const { fake, markLeasesSent, sender } = setup();
      hangFor(fake, B);

      let results: SendResult[] | undefined;
      void sender
        .send(
          new Map([
            [A, group(['Agi'], pdf('la1'))],
            [B, group(['Bob'], pdf('lb1'))],
          ]),
          PERIOD,
          DEFAULT_LANDLORD_PROFILE,
        )
        .then((value) => (results = value));

      expect(SEND_TIMEOUT_MS).toBe(60_000);
      await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS - 1);
      expect(results).toBeUndefined();

      await vi.advanceTimersByTimeAsync(1);
      expect(results).toBeDefined();
      expect(byEmail(results!, A).ok).toBe(true);
      expect(byEmail(results!, B)).toEqual({
        email: B,
        holderNames: ['Bob'],
        ok: false,
        simulated: false,
        uncertain: true,
        error: UNCERTAIN_MESSAGE,
        leaseIds: ['lb1'],
      });
      expect(markLeasesSent).toHaveBeenCalledTimes(1);
      expect(markLeasesSent).toHaveBeenCalledWith(['la1'], '2027-01', AT);
    });

    it('never retries it, however long one waits', async () => {
      vi.useFakeTimers();
      const { fake, sender } = setup();
      hangFor(fake, A);

      const done = sender.send(
        new Map([[A, group(['Agi'], pdf('la1'))]]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );
      await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
      await done;
      await vi.advanceTimersByTimeAsync(10 * SEND_TIMEOUT_MS);

      expect(cloudCalls(fake)).toHaveLength(1);
    });

    it('does not mark an answer of the cloud function as uncertain', async () => {
      const { fake, sender } = setup();
      failFor(fake, A, parseError(141, 'Mailjet refused the message'));
      const [result] = await sender.send(
        new Map([[A, group(['Agi'], pdf('la1'))]]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );
      expect(result.ok).toBe(false);
      expect(result.uncertain).toBeUndefined();
    });
  });

  describe('a failure that may have delivered the e-mail is never a plain failure', () => {
    const INTERRUPTED_MESSAGE =
      "Connexion interrompue : l'e-mail a peut-être été envoyé. Vérifiez votre boîte avant de renvoyer.";

    async function sendOneFailing(error: unknown) {
      const { fake, markLeasesSent, sender } = setup();
      failFor(fake, A, error);
      const results = await sender.send(
        new Map([[A, group(['Agi'], pdf('la1'))]]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );
      // Exactly one attempt, never recorded, never retried.
      expect(cloudCalls(fake)).toHaveLength(1);
      expect(markLeasesSent).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
      return results[0];
    }

    it.each([
      ['107 (unreadable answer, e.g. a gateway page)', parseError(107, 'invalid JSON'), 107],
      ['100 (connection lost)', parseError(100, 'XMLHttpRequest failed'), 100],
      ['124 (request timed out)', parseError(124, 'Request timed out'), 124],
      ['-1 (other cause)', parseError(-1, 'unknown'), -1],
      ['1 (internal server error)', parseError(1, 'server error'), 1],
      ['an error without a code', new Error('network'), undefined],
      ['a code that is not an integer', parseError(Number.NaN, 'odd'), undefined],
      [
        'a code that is not a number',
        Object.assign(new Error('reset'), { code: 'ECONNRESET' }),
        undefined,
      ],
      ['a string (unparseable 2xx body)', 'Unexpected token < in JSON', undefined],
      ['null', null, undefined],
      ['undefined', undefined, undefined],
    ])('is uncertain after %s', async (_label, error, code) => {
      const result = await sendOneFailing(error);

      expect(result).toEqual({
        email: A,
        holderNames: ['Agi'],
        ok: false,
        simulated: false,
        uncertain: true,
        error: INTERRUPTED_MESSAGE,
        leaseIds: ['la1'],
        ...(code === undefined ? {} : { errorCode: code }),
      });
    });

    it.each([
      ['141 (the cloud function reported an error)', 141],
      ['209 (invalid session, refused before the function runs)', 209],
      ['119 (operation forbidden)', 119],
      ['142 (validation error)', 142],
    ])('is a plain failure after %s, with its code', async (_label, code) => {
      const result = await sendOneFailing(parseError(code, 'refused by the server'));

      expect(result.ok).toBe(false);
      expect(result.uncertain).toBeUndefined();
      expect(result.errorCode).toBe(code);
      expect(result.error).toBe("L'envoi a échoué : refused by the server");
    });

    it('keeps the message of a send that timed out, without a code', async () => {
      vi.useFakeTimers();
      const { fake, sender } = setup();
      hangFor(fake, A);
      const done = sender.send(
        new Map([[A, group(['Agi'], pdf('la1'))]]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );
      await vi.advanceTimersByTimeAsync(SEND_TIMEOUT_MS);
      const [result] = await done;
      expect(result.uncertain).toBe(true);
      expect(result.error).toBe(UNCERTAIN_MESSAGE);
      expect(result.errorCode).toBeUndefined();
    });

    it('is a plain failure when the cloud seam itself refuses the recipient (nothing went out)', async () => {
      const result = await sendOneFailing(new RecipientBlockedError('[DEV] Envoi bloqué'));
      expect(result.ok).toBe(false);
      expect(result.uncertain).toBeUndefined();
      expect(result.error).toBe('[DEV] Envoi bloqué');
    });

    it('leaves the other groups alone', async () => {
      const { fake, markLeasesSent, sender } = setup();
      failFor(fake, B, parseError(107, 'invalid JSON'));
      const results = await sender.send(
        new Map([
          [A, group(['Agi'], pdf('la1'))],
          [B, group(['Bob'], pdf('lb1'))],
        ]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );
      expect(byEmail(results, A).ok).toBe(true);
      expect(byEmail(results, B).uncertain).toBe(true);
      expect(markLeasesSent).toHaveBeenCalledTimes(1);
      expect(markLeasesSent).toHaveBeenCalledWith(['la1'], '2027-01', AT);
    });
  });

  describe('error codes', () => {
    it('carries the Parse code of a failure, so the screen can send the user to the login on 209', async () => {
      const { fake, sender } = setup();
      failFor(fake, A, parseError(209, 'invalid session token'));
      const [result] = await sender.send(
        new Map([[A, group(['Agi'], pdf('la1'))]]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );
      expect(result.errorCode).toBe(209);
    });

    it('has no code for a failure that carries none, and none on success', async () => {
      const { fake, sender } = setup();
      failFor(fake, B, new RecipientBlockedError('refusé'));
      const results = await sender.send(
        new Map([
          [A, group(['Agi'], pdf('la1'))],
          [B, group(['Bob'], pdf('lb1'))],
          ['pas une adresse', group(['Cléo'], pdf('lc1'))],
        ]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );
      expect(results.map((result) => 'errorCode' in result)).toEqual([false, false, false]);
    });
  });

  describe('simulated: nothing is really delivered', () => {
    it('is true on every result outside production, sent or blocked', async () => {
      const { sender } = setup(DEV);
      const results = await sender.send(
        new Map([
          [TEST_ADDRESS, group(['Julien'], pdf('l1'))],
          [A, group(['Agi'], pdf('l2'))],
        ]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );
      expect(results.map((result) => [result.ok, result.simulated])).toEqual([
        [true, true],
        [false, true],
      ]);
    });

    it('follows the sandbox flag in production, on every kind of result', async () => {
      for (const sandbox of [true, false]) {
        TestBed.resetTestingModule();
        const { fake, sender } = setup({ production: true, sandbox });
        failFor(fake, B, parseError(141, 'refused'));
        failFor(fake, C, parseError(107, 'invalid JSON'));
        const results = await sender.send(
          new Map<string, EmailGroup>([
            [A, group(['Agi'], pdf('la1'))],
            [B, group(['Bob'], pdf('lb1'))],
            [C, group(['Cléo'], pdf('lc1'))],
            ['pas une adresse', group(['Dan'], pdf('ld1'))],
            ['d@example.test', { holderNames: ['Eve'] } as unknown as EmailGroup],
          ]),
          PERIOD,
          DEFAULT_LANDLORD_PROFILE,
        );
        expect(results.map((result) => result.ok)).toEqual([true, false, false, false, false]);
        expect(
          results.map((result) => result.simulated),
          String(sandbox),
        ).toEqual(results.map(() => sandbox));
      }
    });
  });

  describe('recording the send', () => {
    it('is one markLeasesSent per successful group, with its lease ids, the period key and one shared timestamp', async () => {
      let tick = 0;
      const clock = vi.fn(() => 1000 + 1000 * tick++);
      const { markLeasesSent, sender } = setup(PROD, clock);

      await sender.send(
        new Map([
          [A, group(['Agi'], pdf('la1'), pdf('la2'))],
          [B, group(['Bob'], pdf('lb1'))],
        ]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );

      expect(markLeasesSent).toHaveBeenCalledTimes(2);
      expect(markLeasesSent).toHaveBeenCalledWith(['la1', 'la2'], periodKey(PERIOD), 1000);
      expect(markLeasesSent).toHaveBeenCalledWith(['lb1'], periodKey(PERIOD), 1000);
      expect(clock).toHaveBeenCalledTimes(1);
    });

    it('stamps the leases with the system clock when no clock is provided', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(AT);
      const { markLeasesSent, sender } = setup(PROD, null);

      expect(TestBed.inject(SEND_CLOCK)()).toBe(AT);
      await sender.send(
        new Map([[A, group(['Agi'], pdf('la1'))]]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );

      expect(markLeasesSent).toHaveBeenCalledWith(['la1'], '2027-01', AT);
    });

    it('records after the e-mail went out, never before', async () => {
      const { fake, markLeasesSent, sender } = setup();
      const order: string[] = [];
      markLeasesSent.mockImplementation(() => {
        order.push(`record:${cloudCalls(fake).length}`);
        return Promise.resolve();
      });
      await sender.send(
        new Map([[A, group(['Agi'], pdf('la1'))]]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );
      expect(order).toEqual(['record:1']);
    });

    it('lists each lease once even if a PDF is repeated', async () => {
      const { markLeasesSent, sender } = setup();
      const results = await sender.send(
        new Map([[A, group(['Agi'], pdf('la1'), pdf('la1', 'copie.pdf'), pdf('la2'))]]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );
      expect(results[0].leaseIds).toEqual(['la1', 'la2']);
      expect(markLeasesSent).toHaveBeenCalledWith(['la1', 'la2'], '2027-01', AT);
    });

    describe('when the record fails AFTER the e-mail went out', () => {
      it('is ok with a warning, never an error, and the other groups carry on', async () => {
        const { fake, markLeasesSent, sender } = setup();
        markLeasesSent.mockImplementation((ids) =>
          ids.includes('la1') ? Promise.reject(new Error('save failed')) : Promise.resolve(),
        );

        const results = await sender.send(
          new Map([
            [A, group(['Agi'], pdf('la1'))],
            [B, group(['Bob'], pdf('lb1'))],
          ]),
          PERIOD,
          DEFAULT_LANDLORD_PROFILE,
        );

        expect(byEmail(results, A)).toEqual({
          email: A,
          holderNames: ['Agi'],
          ok: true,
          simulated: false,
          warning: RECORD_WARNING,
          leaseIds: ['la1'],
        });
        expect(byEmail(results, B)).toEqual({
          email: B,
          holderNames: ['Bob'],
          ok: true,
          simulated: false,
          leaseIds: ['lb1'],
        });
        expect(markLeasesSent).toHaveBeenCalledTimes(2);
        // No resend: one cloud call per address, nothing more.
        expect(cloudCalls(fake)).toHaveLength(2);
      });

      it('does not throw when the repository throws instead of rejecting', async () => {
        const { markLeasesSent, sender } = setup();
        markLeasesSent.mockImplementation(() => {
          throw new Error('boom');
        });
        const [result] = await sender.send(
          new Map([[A, group(['Agi'], pdf('la1'))]]),
          PERIOD,
          DEFAULT_LANDLORD_PROFILE,
        );
        expect(result.ok).toBe(true);
        expect(result.warning).toBe(RECORD_WARNING);
      });

      it('does not hang when the record never answers', async () => {
        vi.useFakeTimers();
        const { fake, markLeasesSent, sender } = setup();
        markLeasesSent.mockImplementation(() => new Promise<void>(() => undefined));

        let results: SendResult[] | undefined;
        void sender
          .send(new Map([[A, group(['Agi'], pdf('la1'))]]), PERIOD, DEFAULT_LANDLORD_PROFILE)
          .then((value) => (results = value));

        await vi.advanceTimersByTimeAsync(RECORD_TIMEOUT_MS - 1);
        expect(results).toBeUndefined();
        await vi.advanceTimersByTimeAsync(1);

        expect(results?.[0]).toMatchObject({ ok: true, warning: RECORD_WARNING });
        expect(cloudCalls(fake)).toHaveLength(1);
      });

      it('warns when a lease has no id to record the send on', async () => {
        const { markLeasesSent, sender } = setup();
        const [result] = await sender.send(
          new Map([[A, group(['Agi'], pdf(undefined, 'sans-id.pdf'))]]),
          PERIOD,
          DEFAULT_LANDLORD_PROFILE,
        );
        expect(result).toEqual({
          email: A,
          holderNames: ['Agi'],
          ok: true,
          simulated: false,
          warning: RECORD_WARNING,
          leaseIds: [],
        });
        expect(markLeasesSent).not.toHaveBeenCalled();
      });
    });

    it('marks the leases of the successful groups only, end to end with the real repository', async () => {
      const fake = new FakeParseClient();
      fake.seed('Lease', 'la', { name: 'Bail A', price: 500, lastSendDate: 0 });
      fake.seed('Lease', 'lb', { name: 'Bail B', price: 600, lastSendDate: 0 });
      fake.seed('Leaseholder', 'ha', {
        name: 'Agi',
        email: A,
        phone: '',
        leases: [pointer('Lease', 'la')],
      });
      fake.seed('Leaseholder', 'hb', {
        name: 'Bob',
        email: B,
        phone: '',
        leases: [pointer('Lease', 'lb')],
      });
      TestBed.configureTestingModule({
        providers: [
          { provide: ParseClient, useValue: fake },
          { provide: APP_ENV, useValue: PROD },
          { provide: SEND_CLOCK, useValue: () => AT },
        ],
      });
      const repository = TestBed.inject(LeaseholderRepository);
      await repository.load();
      failFor(fake, B, parseError(141, 'Mailjet refused'));

      const results = await TestBed.inject(RentCallSender).send(
        new Map([
          [
            A,
            group(['Agi'], {
              lease: repository.leaseholders()[0].leases[0],
              fileName: 'a.pdf',
              base64: 'QQ==',
            }),
          ],
          [
            B,
            group(['Bob'], {
              lease: repository.leaseholders()[1].leases[0],
              fileName: 'b.pdf',
              base64: 'Qg==',
            }),
          ],
        ]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );

      expect(results.map((result) => result.ok)).toEqual([true, false]);
      expect(fake.record('Lease', 'la')?.attrs).toMatchObject({
        lastSendDate: AT,
        lastSentPeriod: '2027-01',
        lastSentPeriodAt: AT,
      });
      expect(fake.record('Lease', 'lb')?.attrs).toMatchObject({ lastSendDate: 0 });
      expect(fake.record('Lease', 'lb')?.attrs['lastSentPeriod']).toBeUndefined();
    });
  });

  describe('privacy', () => {
    it('prints nothing: no address, body or PDF reaches the console', async () => {
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation(() => undefined),
      );
      const { fake, markLeasesSent, sender } = setup(PROD);
      failFor(fake, B, new Error('down'));
      markLeasesSent.mockRejectedValueOnce(new Error('save failed'));

      await sender.send(
        new Map([
          [A, group(['Agi'], pdf('la1'))],
          [B, group(['Bob'], pdf('lb1'))],
          [`${A},${B}`, group(['Cléo'], pdf('lc1'))],
        ]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );

      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    });
  });
  describe('an expired session (Parse 209) while sending', () => {
    it('sends the user to the login screen ONCE for the whole send, whatever the number of groups', async () => {
      const { fake, handleSession, sender } = setup();
      failFor(fake, A, parseError(209, 'invalid session token'));
      failFor(fake, B, parseError(209, 'invalid session token'));

      const results = await sender.send(
        new Map([
          [A, group(['Alice'], pdf('l1'))],
          [B, group(['Bruno'], pdf('l2'))],
        ]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );

      expect(handleSession).toHaveBeenCalledTimes(1);
      expect(handleSession.mock.calls[0][0]).toMatchObject({ code: 209 });
      // The results are returned unchanged.
      expect(results.map((r) => [r.email, r.ok, r.errorCode])).toEqual([
        [A, false, 209],
        [B, false, 209],
      ]);
      expect(results.every((r) => !r.uncertain)).toBe(true);
    });

    it('also does it when there is no session at all (no cloud call is made)', async () => {
      const { fake, handleSession, sender } = setup();
      fake.userId = null;

      const results = await sender.send(
        new Map([[A, group(['Alice'], pdf('l1'))]]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );

      expect(cloudCalls(fake)).toEqual([]);
      expect(results[0].errorCode).toBe(209);
      expect(handleSession).toHaveBeenCalledTimes(1);
    });

    it('does it for a 209 in one group even when the other group went out', async () => {
      const { fake, handleSession, markLeasesSent, sender } = setup();
      failFor(fake, B, parseError(209));

      const results = await sender.send(
        new Map([
          [A, group(['Alice'], pdf('l1'))],
          [B, group(['Bruno'], pdf('l2'))],
        ]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );

      expect(byEmail(results, A).ok).toBe(true);
      expect(byEmail(results, B).errorCode).toBe(209);
      expect(markLeasesSent).toHaveBeenCalledTimes(1);
      expect(handleSession).toHaveBeenCalledTimes(1);
    });

    it('does NOT redirect when only recording the send fails with 209 after the mail went out: still ok with the warning', async () => {
      const { handleSession, markLeasesSent, sender } = setup();
      markLeasesSent.mockRejectedValue(parseError(209, 'invalid session token'));

      const results = await sender.send(
        new Map([[A, group(['Alice'], pdf('l1'))]]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );

      expect(results[0]).toMatchObject({ ok: true, warning: RECORD_WARNING });
      expect(results[0].errorCode).toBeUndefined();
      expect(handleSession).not.toHaveBeenCalled();
    });

    it.each([
      ['a definite non-session failure (141)', parseError(141, 'script error')],
      ['a timeout-like failure (100)', parseError(100, 'XMLHttpRequest failed')],
    ])('does not redirect for %s', async (_label, error) => {
      const { fake, handleSession, sender } = setup();
      failFor(fake, A, error);

      await sender.send(
        new Map([[A, group(['Alice'], pdf('l1'))]]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );

      expect(handleSession).not.toHaveBeenCalled();
    });

    it('does not sign out a session that started after the send did (a stale 209)', async () => {
      const { fake, handleSession, sender } = setup();
      fake.addAccount('autre', 'another pass');
      const auth = TestBed.inject(AuthService);
      failFor(fake, A, parseError(209, 'invalid session token'));
      // The 209 comes back only after the user signed out and another account signed in.
      const original = fake.runCloud.bind(fake);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.spyOn(fake, 'runCloud').mockImplementation(async (name, params) => {
        await gate;
        return original(name, params);
      });

      const sending = sender.send(
        new Map([[A, group(['Alice'], pdf('l1'))]]),
        PERIOD,
        DEFAULT_LANDLORD_PROFILE,
      );
      await auth.logout();
      await auth.login('autre', 'another pass');
      release();
      const results = await sending;

      expect(results[0].errorCode).toBe(209);
      expect(handleSession).not.toHaveBeenCalled();
    });
  });
});
