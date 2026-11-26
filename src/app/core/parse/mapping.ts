import { LandlordProfile } from '../models/landlord-profile';
import { AdditionalCharge, INDEX_TYPES, IndexType, Lease } from '../models/lease';
import { Leaseholder } from '../models/leaseholder';
import type { RemoteObject } from './parse-client';

/*
 * Pure mapping between the Back4App JSON (as `toJSON()` returns it, with the Parse envelope) and the
 * app models. The stored layout is the legacy one: nothing is renamed, retyped or restructured.
 * `isSelected` and `indexing` stay in the database but are neither read nor written.
 */

type Json = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function additionalChargesFromParse(value: unknown): AdditionalCharge[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): AdditionalCharge[] => {
    const amount = isObject(entry) ? finite(entry['amount']) : undefined;
    return isObject(entry) && typeof entry['title'] === 'string' && amount !== undefined
      ? [{ title: entry['title'], amount }]
      : [];
  });
}

export function leaseFromParse(json: Json): Lease {
  const indexType: IndexType | undefined = INDEX_TYPES.find((type) => type === json['indexType']);
  const lastSentPeriod = optionalText(json['lastSentPeriod']);
  const referenceIndexQuarter = optionalText(json['referenceIndexQuarter']);
  const referenceIndexValue = finite(json['referenceIndexValue']);
  const revisionReminderSentFor = optionalText(json['revisionReminderSentFor']);

  return {
    ...(typeof json['objectId'] === 'string' ? { objectId: json['objectId'] } : {}),
    isPro: json['isPro'] === true,
    name: text(json['name']),
    lot: finite(json['lot']) ?? null,
    streetNumber: finite(json['streetNumber']) ?? 0,
    streetName: text(json['streetName']),
    optionalAddressInfo: text(json['optionalAddressInfo']),
    postalCode: finite(json['postalCode']) ?? 0,
    city: text(json['city']),
    price: finite(json['price']) ?? 0,
    charge: finite(json['charge']) ?? null,
    additionalCharges: additionalChargesFromParse(json['additionalCharges']),
    lastSendDate: finite(json['lastSendDate']) ?? 0,
    renewalDate: finite(json['renewalDate']) ?? null,
    ...(lastSentPeriod !== undefined ? { lastSentPeriod } : {}),
    ...(indexType !== undefined ? { indexType } : {}),
    ...(referenceIndexQuarter !== undefined ? { referenceIndexQuarter } : {}),
    ...(referenceIndexValue !== undefined ? { referenceIndexValue } : {}),
    ...(revisionReminderSentFor !== undefined ? { revisionReminderSentFor } : {}),
  };
}

/**
 * The fields of a `Lease` object, with the legacy names and types. `charge`, `renewalDate` and `lot`
 * are `null` when the lease has no value: `null` is never sent to the server, see `writeLeaseFields`.
 * The new fields are present only when defined; `isSelected` and `indexing` never appear.
 */
export function leaseToParseFields(lease: Lease): Json {
  return {
    isPro: lease.isPro,
    name: lease.name,
    lot: lease.lot,
    streetNumber: lease.streetNumber,
    streetName: lease.streetName,
    optionalAddressInfo: lease.optionalAddressInfo,
    postalCode: lease.postalCode,
    city: lease.city,
    lastSendDate: lease.lastSendDate,
    renewalDate: lease.renewalDate,
    price: lease.price,
    charge: lease.charge,
    additionalCharges: lease.additionalCharges.map(({ title, amount }) => ({ title, amount })),
    ...(lease.lastSentPeriod !== undefined ? { lastSentPeriod: lease.lastSentPeriod } : {}),
    ...(lease.indexType !== undefined ? { indexType: lease.indexType } : {}),
    ...(lease.referenceIndexQuarter !== undefined
      ? { referenceIndexQuarter: lease.referenceIndexQuarter }
      : {}),
    ...(lease.referenceIndexValue !== undefined
      ? { referenceIndexValue: lease.referenceIndexValue }
      : {}),
    ...(lease.revisionReminderSentFor !== undefined
      ? { revisionReminderSentFor: lease.revisionReminderSentFor }
      : {}),
  };
}

/** Index fields the user edits: clearing one in the app clears it on the server. */
const CLEARABLE_INDEX_FIELDS = [
  'indexType',
  'referenceIndexQuarter',
  'referenceIndexValue',
] as const;

/**
 * Fields recorded by a send (`markLeasesSent`) or by the cloud job, never by an edit: an in-memory
 * copy may be stale, and writing it back would erase what another device or the job recorded.
 */
const BOOKKEEPING_FIELDS: readonly string[] = [
  'lastSendDate',
  'lastSentPeriod',
  'revisionReminderSentFor',
];

export interface WriteLeaseOptions {
  /** Write the bookkeeping fields too. Only creating a lease does (restore keeps them). */
  bookkeeping: boolean;
  /**
   * The lease as the user started from it (the one in the repository state). When given, only the
   * fields that differ from it are written, and a field is removed only if the base had a value and
   * the lease has none: that is the proof the user cleared it. Without it, every field is written
   * and nothing is ever removed.
   */
  base?: Lease;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Applies `leaseToParseFields(lease)` to a Parse object without altering what is stored for absent
 * values: a `null` field (no charge, no renewal date, no lot) is never sent, so a missing value does
 * not become `0`, a date or an explicit `null`; it is only removed (`unset`) when the base proves the
 * user cleared it. Lot 0 and charge 0 are real values and are written as such. The editable index
 * fields are cleared the same way. Returns whether anything was set or removed.
 */
export function writeLeaseFields(
  target: Pick<RemoteObject, 'set' | 'unset'>,
  lease: Lease,
  options: WriteLeaseOptions,
): boolean {
  const { base } = options;
  const baseFields = base ? leaseToParseFields(base) : undefined;
  let written = false;

  for (const [key, value] of Object.entries(leaseToParseFields(lease))) {
    if (!options.bookkeeping && BOOKKEEPING_FIELDS.includes(key)) {
      continue;
    }
    const before = baseFields?.[key];
    if (baseFields && sameValue(value, before)) {
      continue;
    }
    if (value !== null) {
      target.set(key, value);
      written = true;
    } else if (baseFields && before != null) {
      target.unset(key);
      written = true;
    }
  }

  if (base) {
    for (const key of CLEARABLE_INDEX_FIELDS) {
      if (lease[key] === undefined && base[key] !== undefined) {
        target.unset(key);
        written = true;
      }
    }
  }
  return written;
}

/** A lease entry that was actually loaded (`include`), not a bare or dangling pointer. */
function isLoadedObject(value: unknown): value is Json {
  return isObject(value) && value['__type'] !== 'Pointer' && typeof value['objectId'] === 'string';
}

export function leaseholderFromParse(json: Json): Leaseholder {
  const leases = Array.isArray(json['leases'])
    ? json['leases'].filter(isLoadedObject).map(leaseFromParse)
    : [];
  return {
    ...(typeof json['objectId'] === 'string' ? { objectId: json['objectId'] } : {}),
    name: text(json['name']),
    email: text(json['email']),
    phone: text(json['phone']),
    leases,
  };
}

export function landlordProfileFromParse(json: Json): LandlordProfile {
  return {
    ...(typeof json['objectId'] === 'string' ? { objectId: json['objectId'] } : {}),
    name: text(json['name']),
    addressLines: Array.isArray(json['addressLines'])
      ? json['addressLines'].filter((line): line is string => typeof line === 'string')
      : [],
    issueCity: text(json['issueCity']),
    legalNotice: text(json['legalNotice']),
    emailSignature: text(json['emailSignature']),
  };
}

export function landlordProfileToParseFields(profile: LandlordProfile): Json {
  return {
    name: profile.name,
    addressLines: [...profile.addressLines],
    issueCity: profile.issueCity,
    legalNotice: profile.legalNotice,
    emailSignature: profile.emailSignature,
  };
}
