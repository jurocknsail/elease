import { legacyPeriodMonth, type BillingPeriod } from '../billing/period';
import type { Lease } from '../models/lease';
import type { Leaseholder } from '../models/leaseholder';

/** Zero-width and direction marks that copy-pasting from iOS Contacts or WhatsApp leaves in names. */
const INVISIBLE_CHARACTERS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

/** Combining diacritical marks: what is left of an accent once the letter is decomposed (NFD). */
const COMBINING_ACCENTS = /[\u0300-\u036F]/g;

/**
 * A run of spaces (any Unicode space, tabs, line breaks), of characters no common file system
 * accepts in a name (/ \ : * ? " < > |), or of control characters.
 */
const SEPARATORS_AND_ILLEGAL = /[\s/\\:*?"<>|\u0000-\u001F\u007F]+/g;

/** One name as it appears in a file name: lower-case, no accents, one underscore per run of spaces. */
function fileNamePart(name: string): string {
  return name
    .replace(INVISIBLE_CHARACTERS, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_ACCENTS, '')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(SEPARATORS_AND_ILLEGAL, '_')
    .replace(/^_+|_+$/g, '')
    .normalize('NFC');
}

/**
 * Name of the PDF of a rent call, also used as the e-mail attachment name:
 * `<tenant>-<lease>-MM_YYYY.pdf`, e.g. 'agi_martin-garage_n°_13-01_2027.pdf'.
 *
 * Same pattern as the legacy `generatePdfName` (main:src/app/tab-send/tab-send.page.ts:369-371), with
 * three documented fixes: accents are stripped (`œ` and `æ` spelled `oe` and `ae`), EVERY run of
 * spaces becomes an underscore (the legacy replaced only the first space), and characters that are
 * illegal in file names are replaced by an underscore (the legacy kept them).
 */
export function rentCallFileName(leaseholder: Leaseholder, lease: Lease, p: BillingPeriod): string {
  const period = legacyPeriodMonth(p).replace('/', '_');
  return `${fileNamePart(leaseholder.name)}-${fileNamePart(lease.name)}-${period}.pdf`;
}
