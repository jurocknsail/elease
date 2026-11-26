import { Injectable, InjectionToken, inject } from '@angular/core';
import { APP_ENV } from '../app-env';
import { AuthService } from '../auth/auth.service';
import { SessionErrorHandler } from '../auth/session-error';
import { periodKey, type BillingPeriod } from '../billing/period';
import type { LandlordProfile } from '../models/landlord-profile';
import { uniqueAttachmentNames } from '../pdf/file-name';
import { LeaseholderRepository } from '../parse/leaseholder.repository';
import { INVALID_SESSION_TOKEN, NoSessionError, ParseClient } from '../parse/parse-client';
import { BackendTimeoutError, withTimeout } from '../parse/with-timeout';
import { assertRecipientAllowed, effectiveSandbox, RecipientBlockedError } from './email-guard';
import { rentCallBody, rentCallSubject, type EmailGroup } from './rent-call-email';

/**
 * How long a send may take before the sender stops waiting. Longer than the 20 s of an ordinary
 * Back4App call: an e-mail carries its PDFs as base64 (several hundred kilobytes) and the cloud
 * function waits for the mail service.
 */
export const SEND_TIMEOUT_MS = 60_000;

/** Same bound for recording the send in the database, so that `send` always settles. */
export const RECORD_TIMEOUT_MS = 60_000;

/** The time stamped on the leases of a send. Specs replace it to be deterministic. */
export const SEND_CLOCK = new InjectionToken<() => number>('SEND_CLOCK', {
  providedIn: 'root',
  factory: () => () => Date.now(),
});

/** What happened to the e-mail of one recipient address. */
export interface SendResult {
  /** The address of the group, as given to `send`. */
  email: string;
  holderNames: string[];
  /**
   * True when the cloud function accepted the e-mail (see `simulated`). When false, read
   * `uncertain` before offering anything.
   */
  ok: boolean;
  /**
   * True when nothing was really delivered: the Mailjet sandbox was in force (always the case
   * outside production). The screen must not present such a send as delivered.
   */
  simulated: boolean;
  /** Why it failed (French, for the user). Only on failure. */
  error?: string;
  /**
   * The Parse error code of the failure, when it carries one (e.g. 209: the session expired, send
   * the user to the login screen).
   */
  errorCode?: number;
  /** Ids of the leases whose PDFs this e-mail carries. */
  leaseIds: string[];
  /**
   * Only on failure. Absent (false): the e-mail was definitely NOT sent, sending it again is safe.
   * True: it MAY have been delivered (no answer in time, connection lost, unreadable answer). It was
   * not recorded as sent and is not retried: never offer a plain « Réessayer », the user must check
   * the mailbox before sending it again.
   */
  uncertain?: boolean;
  /** Only on success: the e-mail went out but the send could not be recorded. Never send it again. */
  warning?: string;
}

const UNCERTAIN_MESSAGE =
  "Délai dépassé : l'e-mail a peut-être été envoyé. Vérifiez votre boîte avant de renvoyer.";
const INTERRUPTED_MESSAGE =
  "Connexion interrompue : l'e-mail a peut-être été envoyé. Vérifiez votre boîte avant de renvoyer.";
const NO_EMAIL_MESSAGE = "Votre compte n'a pas d'adresse e-mail : envoi impossible.";
const RECORD_WARNING =
  "E-mail envoyé, mais l'état d'envoi n'a pas pu être enregistré : ne le renvoyez pas.";
const NO_PDF_MESSAGE = "Aucun appel de loyer à joindre : rien n'a été envoyé.";
const FAILURE_PREFIX = "L'envoi a échoué";
const MAX_DETAIL_LENGTH = 200;

/**
 * Parse error codes after which the e-mail may nevertheless have been delivered: the request left,
 * but its outcome is unknown. -1 and 1: server-side error (other cause, internal error); 100:
 * connection lost; 107: unreadable answer (a gateway answering with an HTML page); 124: the request
 * timed out. Any other code is an answer of the server itself: 141 (the cloud function reported an
 * error) and 209 (invalid session, refused before the function runs) count as definite failures.
 */
const AMBIGUOUS_CODES: ReadonlySet<number> = new Set([-1, 1, 100, 107, 124]);

/** The Parse error code carried by a rejection, if any. */
function errorCodeOf(error: unknown): number | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'number' && Number.isInteger(code) ? code : undefined;
}

/**
 * Whether the e-mail may have gone out although the call failed. True for the ambiguous codes and
 * for every rejection that carries no usable code (a network error, a string, an unknown value):
 * only a failure known to come from the server's answer is a definite failure.
 */
function mayHaveBeenSent(error: unknown): boolean {
  const code = errorCodeOf(error);
  return code === undefined || AMBIGUOUS_CODES.has(code);
}

function failureMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null | undefined)?.message;
  const detail = typeof message === 'string' ? message.trim().slice(0, MAX_DETAIL_LENGTH) : '';
  return detail === '' ? `${FAILURE_PREFIX}.` : `${FAILURE_PREFIX} : ${detail}`;
}

/**
 * Sends the rent calls by e-mail through the Cloud Code function `sendEmail` (Back4App, Mailjet), the
 * same one as the legacy app, with the same parameters.
 *
 * - One e-mail per recipient address, all started together; one result per address, in the order of
 *   the groups. `send` never rejects and never hangs: each cloud call is bounded by `SEND_TIMEOUT_MS`.
 * - The recipient guard (`assertRecipientAllowed`) runs here, before EVERY call: outside production
 *   an e-mail can only go to the test address, with the Mailjet sandbox forced. A blocked group
 *   fails with the guard message and nothing is sent.
 * - The send is recorded on the leases (`markLeasesSent`, one call per successful group) only after
 *   the cloud function answered, and never for a failed or uncertain group.
 * - A send whose outcome is unknown is UNCERTAIN (the mail may have been delivered): no answer in
 *   time, a lost connection, an unreadable answer or any failure without a definite server answer.
 *   It is reported, not recorded, never retried here, and must not be offered as a plain retry.
 *   Only a failure the server answered itself (e.g. the cloud function's own error, an invalid
 *   session) is a plain failure.
 * - If recording fails after the mail went out, the group stays `ok` with a `warning`: the mail HAS
 *   gone, so it is never turned into an invitation to send again.
 *
 * Nothing is logged: no address, body or PDF ever reaches the console.
 */
@Injectable({ providedIn: 'root' })
export class RentCallSender {
  private readonly client = inject(ParseClient);
  private readonly leaseholders = inject(LeaseholderRepository);
  private readonly env = inject(APP_ENV);
  private readonly now = inject(SEND_CLOCK);
  private readonly auth = inject(AuthService);
  private readonly session = inject(SessionErrorHandler);

  async send(
    groups: ReadonlyMap<string, EmailGroup>,
    p: BillingPeriod,
    profile: LandlordProfile,
  ): Promise<SendResult[]> {
    // One send date for the whole action, read once.
    const at = this.now();
    const user = this.auth.user();
    const entries = [...groups.entries()];
    const outcomes = await Promise.allSettled(
      entries.map(([email, group]) => this.sendGroup(email, group, p, profile, at)),
    );
    const results = outcomes.map((outcome, index) => {
      if (outcome.status === 'fulfilled') {
        return outcome.value;
      }
      // Only reachable for a malformed group, before anything was sent.
      const [email, group] = entries[index];
      return {
        email,
        holderNames: Array.isArray(group?.holderNames) ? [...group.holderNames] : [],
        ok: false,
        simulated: effectiveSandbox(this.env),
        error: failureMessage(outcome.reason),
        leaseIds: [],
      };
    });
    this.redirectOnExpiredSession(results, user);
    return results;
  }

  /**
   * An expired session (Parse 209) refused a send, or there was none: sign out and go to the login
   * screen, ONCE for the whole send whatever the number of groups. The results are returned unchanged.
   * Only the send step reports a 209 here: a failure to record a send that went out (`ok` with a
   * `warning`) carries no code and never redirects. Skipped when the user who started the send is no
   * longer the signed-in one (a 209 for an old session must not end a new one).
   */
  private redirectOnExpiredSession(results: readonly SendResult[], startedBy: unknown): void {
    if (
      results.some((result) => result.errorCode === INVALID_SESSION_TOKEN) &&
      this.auth.user() === startedBy
    ) {
      this.session.handle(new NoSessionError());
    }
  }

  private async sendGroup(
    email: string,
    group: EmailGroup,
    p: BillingPeriod,
    profile: LandlordProfile,
    at: number,
  ): Promise<SendResult> {
    const leaseIds = [
      ...new Set(group.pdfs.flatMap((pdf) => (pdf.lease.objectId ? [pdf.lease.objectId] : []))),
    ];
    const base = {
      email,
      holderNames: [...group.holderNames],
      simulated: effectiveSandbox(this.env),
      leaseIds,
    };

    try {
      assertRecipientAllowed(email, this.env);
    } catch (error) {
      return {
        ...base,
        ok: false,
        error: error instanceof RecipientBlockedError ? error.message : failureMessage(error),
      };
    }
    if (group.pdfs.length === 0) {
      return { ...base, ok: false, error: NO_PDF_MESSAGE };
    }
    if (!this.client.currentUser()) {
      const noSession = new NoSessionError();
      return { ...base, ok: false, error: noSession.message, errorCode: noSession.code };
    }
    const senderEmail = this.client.currentUserEmail();
    if (!senderEmail) {
      return { ...base, ok: false, error: NO_EMAIL_MESSAGE };
    }

    const fileNames = uniqueAttachmentNames(group.pdfs.map((pdf) => pdf.fileName));
    const params = {
      senderEmail,
      recipientEmail: email.trim(),
      subject: rentCallSubject(p),
      text: rentCallBody(profile),
      attachments: group.pdfs.map((pdf, index) => ({
        ContentType: 'application/pdf',
        Filename: fileNames[index],
        Base64Content: pdf.base64,
      })),
      sandbox: effectiveSandbox(this.env),
    };

    try {
      await withTimeout(this.client.runCloud('sendEmail', params), SEND_TIMEOUT_MS);
    } catch (error) {
      if (error instanceof RecipientBlockedError) {
        // Refused by the cloud seam before any request: nothing went out.
        return { ...base, ok: false, error: error.message };
      }
      if (error instanceof BackendTimeoutError) {
        return { ...base, ok: false, uncertain: true, error: UNCERTAIN_MESSAGE };
      }
      const code = errorCodeOf(error);
      const withCode = code === undefined ? {} : { errorCode: code };
      if (mayHaveBeenSent(error)) {
        return { ...base, ok: false, uncertain: true, error: INTERRUPTED_MESSAGE, ...withCode };
      }
      return { ...base, ok: false, error: failureMessage(error), ...withCode };
    }

    // The e-mail HAS gone out: nothing below may turn this result into a failure.
    if (leaseIds.length === 0) {
      return { ...base, ok: true, warning: RECORD_WARNING };
    }
    try {
      await withTimeout(
        this.leaseholders.markLeasesSent(leaseIds, periodKey(p), at),
        RECORD_TIMEOUT_MS,
      );
    } catch {
      return { ...base, ok: true, warning: RECORD_WARNING };
    }
    return { ...base, ok: true };
  }
}
