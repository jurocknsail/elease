'use strict';

/*
 * Lease history (statistics): an afterSave trigger on `Lease` appends to `RentCallLog` / `RentChange`
 * (see lib/history.js), and a one-shot job `backfillLeaseHistory` gives every existing lease its
 * starting point. Loaded from main.js with `require('./history');`, after `require('./jobs');`.
 *
 * The rows are written with the master key, readable only by the owner of the lease, never writable
 * by a client (beforeSave refuses any save without the master key). A failure is logged and never
 * blocks the save of the lease (afterSave runs after the lease is stored).
 */

const { leaseFromParse, leasesOfHolder, ownerIdFromAcl } = require('./lib/leases');
const { SEND_CLASS, CHANGE_CLASS, historyRows, baselineRows } = require('./lib/history');

const PAGE_SIZE = 100;

function readBoolean(params, name) {
  const value = params[name];
  if (value === undefined) {
    return false;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`Paramètre « ${name} » : true ou false attendu.`);
  }
  return value;
}

function readBackfillOptions(params) {
  const p = params || {};
  if (p.onlyUser !== undefined && (typeof p.onlyUser !== 'string' || p.onlyUser.trim() === '')) {
    throw new Error('Paramètre « onlyUser » : nom d’utilisateur attendu.');
  }
  return {
    onlyUser: p.onlyUser === undefined ? null : p.onlyUser.trim(),
    dryRun: readBoolean(p, 'dryRun'),
  };
}

/**
 * The owner of a saved lease: the signed-in user who saved it, otherwise the single writer of its ACL.
 */
function ownerOf(request) {
  if (request.user && request.user.id) {
    return request.user.id;
  }
  const acl = request.object.getACL();
  return ownerIdFromAcl(acl ? acl.toJSON() : null);
}

function writeRows(Parse, className, rows, ownerId) {
  if (rows.length === 0) {
    return Promise.resolve([]);
  }
  const objects = rows.map((fields) => {
    const object = new Parse.Object(className);
    const acl = new Parse.ACL();
    acl.setReadAccess(ownerId, true);
    object.setACL(acl);
    object.set(fields);
    return object;
  });
  return Parse.Object.saveAll(objects, { useMasterKey: true });
}

async function onLeaseSaved(Parse, request, now) {
  const ownerId = ownerOf(request);
  if (!ownerId) {
    console.log('[history] bail ' + request.object.id + ' sans propriétaire : historique ignoré');
    return;
  }
  const after = leaseFromParse(request.object.toJSON());
  const before = request.original ? leaseFromParse(request.original.toJSON()) : null;
  const rows = historyRows(before, after, now);
  await writeRows(Parse, SEND_CLASS, rows.sends, ownerId);
  await writeRows(Parse, CHANGE_CLASS, rows.changes, ownerId);
}

/**
 * backfillLeaseHistory: for every lease without history yet, a 'baseline' change (its current amounts)
 * and its last send as a 'baseline' send. Idempotent: a lease that already has a row of a class gets
 * none of that class. `onlyUser` limits it to one owner; `dryRun` counts without writing.
 */
async function runBackfill(Parse, params, now) {
  const options = readBackfillOptions(params);
  let onlyUserId = null;
  if (options.onlyUser !== null) {
    const user = await new Parse.Query(Parse.User)
      .equalTo('username', options.onlyUser)
      .first({ useMasterKey: true });
    if (!user) {
      throw new Error('Utilisateur introuvable : ' + options.onlyUser);
    }
    onlyUserId = user.id;
  }
  const result = { dryRun: options.dryRun, leases: 0, sends: 0, changes: 0, skipped: 0 };
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const query = new Parse.Query('Leaseholder');
    query.include('leases');
    query.ascending('createdAt');
    query.limit(PAGE_SIZE);
    query.skip(skip);
    const page = await query.find({ useMasterKey: true });
    for (const holder of page) {
      const acl = holder.getACL();
      const ownerId = ownerIdFromAcl(acl ? acl.toJSON() : null);
      if (!ownerId) {
        result.skipped += 1;
        continue;
      }
      if (onlyUserId !== null && ownerId !== onlyUserId) {
        continue;
      }
      const entries = leasesOfHolder({
        name: holder.get('name'),
        leases: (holder.get('leases') || []).map((l) => (l && l.toJSON ? l.toJSON() : l)),
      });
      for (const entry of entries) {
        const leaseId = entry.lease.objectId;
        const has = {
          send: (await new Parse.Query(SEND_CLASS).equalTo('leaseId', leaseId).count({ useMasterKey: true })) > 0,
          change: (await new Parse.Query(CHANGE_CLASS).equalTo('leaseId', leaseId).count({ useMasterKey: true })) > 0,
        };
        const rows = baselineRows(entry.lease, now, has);
        result.leases += 1;
        result.sends += rows.sends.length;
        result.changes += rows.changes.length;
        if (!options.dryRun) {
          await writeRows(Parse, SEND_CLASS, rows.sends, ownerId);
          await writeRows(Parse, CHANGE_CLASS, rows.changes, ownerId);
        }
      }
    }
    if (page.length < PAGE_SIZE) {
      return result;
    }
  }
}

function registerHistory(Parse) {
  Parse.Cloud.afterSave('Lease', async (request) => {
    try {
      await onLeaseSaved(Parse, request, Date.now());
    } catch (error) {
      console.log('[history] échec pour le bail ' + request.object.id + ' : ' + (error && error.message));
    }
  });

  [SEND_CLASS, CHANGE_CLASS].forEach((className) => {
    Parse.Cloud.beforeSave(className, (request) => {
      if (!request.master) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Historique en lecture seule.');
      }
    });
    Parse.Cloud.beforeDelete(className, (request) => {
      if (!request.master) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Historique en lecture seule.');
      }
    });
  });

  Parse.Cloud.job('backfillLeaseHistory', async (request) => {
    const result = await runBackfill(Parse, request.params, Date.now());
    console.log('[backfillLeaseHistory] ' + JSON.stringify(result));
    return JSON.stringify(result);
  });
}

module.exports = registerHistory;
module.exports.registerHistory = registerHistory;
module.exports.onLeaseSaved = onLeaseSaved;
module.exports.runBackfill = runBackfill;
module.exports.readBackfillOptions = readBackfillOptions;

if (typeof Parse !== 'undefined' && Parse && Parse.Cloud && typeof Parse.Cloud.afterSave === 'function') {
  registerHistory(Parse);
}
