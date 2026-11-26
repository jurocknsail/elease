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
 * Applies `leaseToParseFields(lease)` to a Parse object without altering what is stored for absent
 * values: a `null` field (no charge, no renewal date, no lot) is never written, so a missing value
 * does not become `0`, a date or an explicit `null`; it is only removed (`unset`) when the object
 * currently holds a value. Lot 0 and charge 0 are real values and are written as such. The reminder
 * bookkeeping fields (`lastSentPeriod`, `revisionReminderSentFor`) are written when defined and never
 * removed, so a stale copy cannot erase what a send or a cloud job recorded.
 */
export function writeLeaseFields(
  target: Pick<RemoteObject, 'get' | 'set' | 'unset'>,
  lease: Lease,
): void {
  for (const [key, value] of Object.entries(leaseToParseFields(lease))) {
    if (value === null) {
      if (target.get(key) != null) {
        target.unset(key);
      }
    } else {
      target.set(key, value);
    }
  }
  for (const key of CLEARABLE_INDEX_FIELDS) {
    if (lease[key] === undefined && target.get(key) != null) {
      target.unset(key);
    }
  }
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
