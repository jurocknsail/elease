import { Injectable, InjectionToken, inject } from '@angular/core';
import { APP_ENV } from '../app-env';
import { periodKey, type BillingPeriod } from '../billing/period';
import type { LandlordProfile } from '../models/landlord-profile';
import { uniqueAttachmentNames } from '../pdf/file-name';
import { LeaseholderRepository } from '../parse/leaseholder.repository';
import { NoSessionError, ParseClient } from '../parse/parse-client';
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
  /** True when the e-mail left. False means it did NOT, unless `uncertain` is set. */
  ok: boolean;
  /** Why it failed (French, for the user). Only on failure. */
  error?: string;
  /** Ids of the leases whose PDFs this e-mail carries. */
  leaseIds: string[];
  /**
   * The cloud function did not answer in time: the e-mail MAY have been delivered. It was not
   * recorded as sent and is not retried; the user must check the mailbox before sending again.
   */
  uncertain?: boolean;
  /** Only on success: the e-mail went out but the send could not be recorded. Never send it again. */
  warning?: string;
}

const UNCERTAIN_MESSAGE =
  "Délai dépassé : l'e-mail a peut-être été envoyé. Vérifiez votre boîte avant de renvoyer.";
const RECORD_WARNING =
  "E-mail envoyé, mais l'état d'envoi n'a pas pu être enregistré : ne le renvoyez pas.";
const NO_PDF_MESSAGE = "Aucun appel de loyer à joindre : rien n'a été envoyé.";
const FAILURE_PREFIX = "L'envoi a échoué";
const MAX_DETAIL_LENGTH = 200;

function failureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message.trim().slice(0, MAX_DETAIL_LENGTH) : '';
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
 * - A send that times out is UNCERTAIN (the mail may have been delivered): reported, not recorded,
 *   never retried here.
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

  async send(
    groups: ReadonlyMap<string, EmailGroup>,
    p: BillingPeriod,
    profile: LandlordProfile,
  ): Promise<SendResult[]> {
    // One send date for the whole action, read once.
    const at = this.now();
    const entries = [...groups.entries()];
    const outcomes = await Promise.allSettled(
      entries.map(([email, group]) => this.sendGroup(email, group, p, profile, at)),
    );
    return outcomes.map((outcome, index) => {
      if (outcome.status === 'fulfilled') {
        return outcome.value;
      }
      // Only reachable for a malformed group, before anything was sent.
      const [email, group] = entries[index];
      return {
        email,
        holderNames: Array.isArray(group?.holderNames) ? [...group.holderNames] : [],
        ok: false,
        error: failureMessage(outcome.reason),
        leaseIds: [],
      };
    });
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
    const base = { email, holderNames: [...group.holderNames], leaseIds };

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
    const senderEmail = this.client.currentUserEmail();
    if (!senderEmail) {
      return { ...base, ok: false, error: new NoSessionError().message };
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
      if (error instanceof BackendTimeoutError) {
        return { ...base, ok: false, uncertain: true, error: UNCERTAIN_MESSAGE };
      }
      return { ...base, ok: false, error: failureMessage(error) };
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
