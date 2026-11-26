import { legacyPeriodMonth, type BillingPeriod } from '../billing/period';
import type { Lease } from '../models/lease';
import type { Leaseholder } from '../models/leaseholder';

/** Zero-width and direction marks that copy-pasting from iOS Contacts or WhatsApp leaves in names. */
const INVISIBLE_CHARACTERS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

/**
 * Combining diacritical marks that follow a Latin letter: what is left of an accent once the letter is
 * decomposed (NFD). Marks that follow a letter of another script are kept: the Cyrillic й and ё are
 * и and е plus a mark, and dropping it would change the letter.
 */
const LATIN_ACCENTS = /(\p{Script=Latin})[\u0300-\u036F]+/gu;

/**
 * A run of spaces (any Unicode space, tabs, line breaks), of characters no common file system
 * accepts in a name (/ \ : * ? " < > |), or of control characters.
 */
const SEPARATORS_AND_ILLEGAL = /[\s/\\:*?"<>|\u0000-\u001F\u007F]+/g;

/** The longest a tenant name or a lease name may be in a file name. */
const MAX_PART_LENGTH = 60;

const HOLDER_FALLBACK = 'locataire';
const LEASE_FALLBACK = 'bail';

/** The first `max` UTF-16 units of `text`, without the half of a surrogate pair a cut would leave. */
function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  const last = text.charCodeAt(max - 1);
  const cutInsidePair = last >= 0xd800 && last <= 0xdbff;
  return text.slice(0, cutInsidePair ? max - 1 : max);
}

/**
 * One name as it appears in a file name: lower-case, no Latin accents, one underscore per run of
 * spaces, no leading dot (no hidden file), at most 60 characters, and `fallback` when nothing is left.
 */
function fileNamePart(name: string, fallback: string): string {
  const part = truncate(
    name
      .replace(INVISIBLE_CHARACTERS, '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(LATIN_ACCENTS, '$1')
      .replace(/œ/g, 'oe')
      .replace(/æ/g, 'ae')
      .replace(SEPARATORS_AND_ILLEGAL, '_')
      .normalize('NFC')
      .replace(/^[_.]+/, ''),
    MAX_PART_LENGTH,
  ).replace(/_+$/, '');
  return part === '' ? fallback : part;
}

/**
 * Name of the PDF of a rent call, also used as the e-mail attachment name:
 * `<tenant>-<lease>-MM_YYYY.pdf`, e.g. 'agi_martin-garage_n°_13-01_2027.pdf'.
 *
 * Same pattern as the legacy `generatePdfName` (main:src/app/tab-send/tab-send.page.ts:369-371), with
 * documented fixes: Latin accents are stripped (`œ` and `æ` spelled `oe` and `ae`; letters of other
 * scripts such as the Cyrillic й keep theirs), EVERY run of spaces becomes an underscore (the legacy
 * replaced only the first space), characters that are illegal in file names are replaced by an
 * underscore (the legacy kept them), leading dots are dropped (no hidden file), each name is cut at
 * 60 characters, and a name with nothing left becomes « locataire » (tenant) or « bail » (lease).
 */
export function rentCallFileName(leaseholder: Leaseholder, lease: Lease, p: BillingPeriod): string {
  const period = legacyPeriodMonth(p).replace('/', '_');
  return `${fileNamePart(leaseholder.name, HOLDER_FALLBACK)}-${fileNamePart(lease.name, LEASE_FALLBACK)}-${period}.pdf`;
}

/**
 * Makes the names of the attachments of ONE e-mail distinct: the second attachment of a name (compared
 * case-insensitively) becomes `name-2.pdf`, the third `name-3.pdf`, the suffix going before the
 * extension. The order is kept, the first of each name keeps it, and a suffixed name never collides
 * with another attachment's name. Idempotent. Without it two leases of the same name of one tenant
 * would be attached under the same name, which mail clients show as one file or overwrite on saving.
 */
export function uniqueAttachmentNames(names: readonly string[]): string[] {
  // Every name that exists or has been handed out, so that a suffixed name never takes another's.
  const taken = new Set(names.map((name) => name.toLowerCase()));
  const placed = new Set<string>();
  return names.map((name) => {
    if (!placed.has(name.toLowerCase())) {
      placed.add(name.toLowerCase());
      return name;
    }
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : '';
    for (let n = 2; ; n += 1) {
      const candidate = `${stem}-${n}${extension}`;
      if (!taken.has(candidate.toLowerCase())) {
        taken.add(candidate.toLowerCase());
        placed.add(candidate.toLowerCase());
        return candidate;
      }
    }
  });
}
