'use strict';

/*
 * Reading what Back4App stores (as Parse `toJSON()` returns it). Port of leaseFromParse of
 * src/app/core/parse/mapping.ts, reduced to the fields the jobs use. The tenant's e-mail is never read.
 */

const INDEX_TYPES = ['IRL', 'ILC', 'ILAT'];

function text(value) {
  return typeof value === 'string' ? value : '';
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalText(value) {
  return typeof value === 'string' ? value : undefined;
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function additionalChargesFromParse(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const result = [];
  value.forEach((entry) => {
    const amount = isObject(entry) ? finite(entry.amount) : undefined;
    if (isObject(entry) && typeof entry.title === 'string' && amount !== undefined) {
      result.push({ title: entry.title, amount });
    }
  });
  return result;
}

function leaseFromParse(json) {
  const lease = {
    objectId: typeof json.objectId === 'string' ? json.objectId : undefined,
    isPro: json.isPro === true,
    name: text(json.name),
    price: finite(json.price) === undefined ? 0 : finite(json.price),
    charge: finite(json.charge) === undefined ? null : finite(json.charge),
    additionalCharges: additionalChargesFromParse(json.additionalCharges),
    lastSendDate: finite(json.lastSendDate) === undefined ? 0 : finite(json.lastSendDate),
    renewalDate: finite(json.renewalDate) === undefined ? null : finite(json.renewalDate),
  };
  const optional = {
    lastSentPeriod: optionalText(json.lastSentPeriod),
    lastSentPeriodAt: finite(json.lastSentPeriodAt),
    indexType: INDEX_TYPES.indexOf(json.indexType) >= 0 ? json.indexType : undefined,
    referenceIndexQuarter: optionalText(json.referenceIndexQuarter),
    referenceIndexValue: finite(json.referenceIndexValue),
    revisionReminderSentFor: optionalText(json.revisionReminderSentFor),
  };
  Object.keys(optional).forEach((key) => {
    if (optional[key] !== undefined) {
      lease[key] = optional[key];
    }
  });
  return lease;
}

/**
 * The leases of a holder, as { holderName, lease }. Entries that were not loaded (a bare Pointer, or an
 * object with no price: `include('leases')` was not applied) are dropped, never turned into a 0 € lease.
 */
function leasesOfHolder(holder) {
  const result = [];
  (Array.isArray(holder.leases) ? holder.leases : []).forEach((entry) => {
    if (
      isObject(entry) &&
      entry.__type !== 'Pointer' &&
      typeof entry.objectId === 'string' &&
      typeof entry.price === 'number'
    ) {
      result.push({ holderName: text(holder.name), lease: leaseFromParse(entry) });
    }
  });
  return result;
}

/**
 * The owner of an object: the single user id that has write access in its ACL (JSON form, as
 * `acl.toJSON()` returns it: { '*': {...}, '<userId>': { read: true, write: true } }). Public and role
 * entries are ignored. Returns null when there is no such user or more than one (ambiguous: skipped).
 */
function ownerIdFromAcl(acl) {
  if (!isObject(acl)) {
    return null;
  }
  const writers = Object.keys(acl).filter(
    (key) => key !== '*' && key.indexOf('role:') !== 0 && isObject(acl[key]) && acl[key].write === true,
  );
  return writers.length === 1 ? writers[0] : null;
}

module.exports = { INDEX_TYPES, leaseFromParse, leasesOfHolder, ownerIdFromAcl };
