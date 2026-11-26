import { periodLabel, type BillingPeriod } from '../billing/period';
import type { LandlordProfile } from '../models/landlord-profile';
import type { Lease } from '../models/lease';
import type { Leaseholder } from '../models/leaseholder';

/** A rent call ready to be attached to an e-mail. */
export interface GeneratedPdf {
  lease: Lease;
  /** Attachment name, e.g. 'agi_martin-garage-01_2027.pdf'. */
  fileName: string;
  /** The PDF, base64-encoded without a `data:` prefix. */
  base64: string;
}

/** What one e-mail carries: its PDFs, and the tenants it is addressed to. */
export interface EmailGroup {
  holderNames: string[];
  pdfs: GeneratedPdf[];
}

/** Subject of the e-mail of a billing period, e.g. 'Appel de loyer — janvier 2027'. */
export function rentCallSubject(p: BillingPeriod): string {
  return `Appel de loyer — ${periodLabel(p)}`;
}

/**
 * Body of the e-mail. For the default landlord profile it is exactly the body of the legacy app,
 * line breaks and spelling included (main:src/app/services/parse-service.service.ts:352-357); only
 * the signature comes from the profile.
 */
export function rentCallBody(profile: LandlordProfile): string {
  return (
    'Bonjour,\n\nMerci de trouver ci-joint le(s) appel(s) de loyer(s) pour la prochaine période.\nBonne reception,\n\n' +
    profile.emailSignature
  );
}

/**
 * Groups the PDFs by recipient, so that tenants sharing one address get ONE e-mail with all their
 * PDFs (the legacy grouping, `ParseService.addLeaseholderPDF`).
 *
 * - The key is the trimmed, lower-cased address, and is the address the e-mail goes to.
 * - Entries are in order of first appearance; `holderNames` lists each name once.
 * - A holder WITHOUT an address is never dropped and never mixed with the others: it is kept under
 *   the empty key `''`. The sender refuses that group before any call (an address is required) and
 *   returns a failed result naming those tenants, so the user sees them in the send summary and
 *   no e-mail goes to an empty recipient.
 */
export function groupByEmail(
  items: ReadonlyArray<{ holder: Leaseholder; pdf: GeneratedPdf }>,
): Map<string, EmailGroup> {
  const groups = new Map<string, EmailGroup>();
  for (const { holder, pdf } of items) {
    const key = typeof holder.email === 'string' ? holder.email.trim().toLowerCase() : '';
    let group = groups.get(key);
    if (!group) {
      group = { holderNames: [], pdfs: [] };
      groups.set(key, group);
    }
    if (!group.holderNames.includes(holder.name)) {
      group.holderNames.push(holder.name);
    }
    group.pdfs.push(pdf);
  }
  return groups;
}
