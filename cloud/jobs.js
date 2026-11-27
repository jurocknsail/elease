'use strict';

/*
 * Back4App Cloud Jobs: sendMonthlyReminder and sendRevisionReminder.
 *
 * Both e-mail the OWNER only (From = To = the owner's address, never a tenant's). Safety switches, the same
 * for both jobs (params of the job request):
 *   onlyUser  username: only that owner is processed. During development ALWAYS pass "julien".
 *             Present but not a non-empty string: the job fails (never silently widened to everyone).
 *   dryRun, force, sandbox: real booleans only (absent = false); any other value fails the job.
 *   dryRun    true: build the messages, return them, send nothing and write nothing.
 *             Anything else (absent, false): the e-mails are REALLY sent.
 *   force     (monthly only) true: act even before the 25th (Europe/Paris).
 *   sandbox   true: Mailjet SandboxMode (the request is validated, nothing is delivered); the revision
 *             job then writes no mark.
 *
 * The job bodies runMonthlyReminder / runRevisionReminder are plain async functions over injected `deps`
 * ({ queryLeaseholders, getOwner, sendMail, fetchObservations, saveReminderMark, now }), so that they are
 * tested with no Parse, no Mailjet and no INSEE. defaultDeps builds the real ones.
 */

const { billingPeriod, periodKey, parisParts, ymdToIso } = require('./lib/periods');
const { revisionState, parseObservations, inseeUrl } = require('./lib/revision');
const { leasesOfHolder, ownerIdFromAcl } = require('./lib/leases');
const { buildMonthlyReminder, buildRevisionReminder } = require('./lib/reminders');

const REMINDER_DAY = 25;
const INSEE_TIMEOUT_MS = 15000;
const PAGE_SIZE = 100;

/** An optional boolean parameter: absent (undefined or null) is false; anything but a real boolean is refused. */
function readBoolean(params, name) {
  const value = params[name];
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value !== 'boolean') {
    throw new Error(name + ' doit être un booléen (true ou false), pas ' + JSON.stringify(value));
  }
  return value;
}

function readOptions(params) {
  const p = params || {};
  let onlyUser = null;
  if (p.onlyUser !== undefined && p.onlyUser !== null) {
    if (typeof p.onlyUser !== 'string' || p.onlyUser.trim() === '') {
      throw new Error("onlyUser doit être un nom d'utilisateur non vide");
    }
    onlyUser = p.onlyUser.trim();
  }
  return {
    onlyUser,
    dryRun: readBoolean(p, 'dryRun'),
    force: readBoolean(p, 'force'),
    sandbox: readBoolean(p, 'sandbox'),
  };
}

function describeError(error) {
  const message = error && error.message ? String(error.message) : String(error);
  return message.length > 200 ? message.slice(0, 200) + '…' : message;
}

/**
 * The owners to process: holders grouped by the user id with write access in their ACL, each resolved
 * through deps.getOwner and filtered by `onlyUser`. Returns { groups: [{ owner, holders }], problems }.
 * A holder with no single owner, or an owner that cannot be read, is reported and skipped.
 */
async function loadOwnerGroups(options, deps) {
  const holders = await deps.queryLeaseholders();
  const byOwner = new Map();
  let withoutOwner = 0;
  holders.forEach((holder) => {
    if (!holder.ownerId) {
      withoutOwner += 1;
      return;
    }
    if (!byOwner.has(holder.ownerId)) {
      byOwner.set(holder.ownerId, []);
    }
    byOwner.get(holder.ownerId).push(holder);
  });
  const groups = [];
  const errors = [];
  for (const entry of byOwner.entries()) {
    try {
      const owner = await deps.getOwner(entry[0]);
      if (!owner) {
        errors.push({ error: 'propriétaire introuvable' });
        continue;
      }
      if (options.onlyUser !== null && owner.username !== options.onlyUser) {
        continue;
      }
      groups.push({ owner, holders: entry[1] });
    } catch (error) {
      errors.push({ error: describeError(error) });
    }
  }
  return { groups, errors, withoutOwner };
}

function leasesOfGroup(group) {
  const leases = [];
  group.holders.forEach((holder) => {
    leasesOfHolder(holder).forEach((entry) => leases.push(entry));
  });
  return leases;
}

/**
 * sendMonthlyReminder. Acts every day from the 25th (Europe/Paris) to the end of the month, unless `force`; it sends nothing once every lease is sent for the coming period (`lastSentPeriod` / `lastSendDate`, same rule as the app).
 * Result: counts, subjects, and in dryRun the messages.
 */
async function runMonthlyReminder(params, deps) {
  const options = readOptions(params);
  const now = deps.now();
  const today = parisParts(now);
  const result = {
    job: 'sendMonthlyReminder',
    dryRun: options.dryRun,
    onlyUser: options.onlyUser,
    today: ymdToIso(today),
    period: null,
    sent: 0,
    subjects: [],
    errors: [],
  };
  if (!options.force && today.day < REMINDER_DAY) {
    result.skipped = 'avant le ' + REMINDER_DAY + ' (utilisez force pour tester)';
    return result;
  }
  result.period = periodKey(billingPeriod(now));
  const loaded = await loadOwnerGroups(options, deps);
  result.errors = loaded.errors.slice();
  result.owners = loaded.groups.length;
  result.skippedHoldersWithoutOwner = loaded.withoutOwner;
  if (options.dryRun) {
    result.messages = [];
  }
  for (const group of loaded.groups) {
    const username = group.owner.username;
    try {
      if (!group.owner.email) {
        result.errors.push({ username, error: "pas d'adresse e-mail sur le compte" });
        continue;
      }
      const message = buildMonthlyReminder({
        owner: group.owner,
        leases: leasesOfGroup(group),
        today: now,
      });
      if (!message) {
        continue;
      }
      result.subjects.push({ username, subject: message.subject });
      if (options.dryRun) {
        result.messages.push({ username, to: message.to, subject: message.subject, text: message.text });
        continue;
      }
      await deps.sendMail(message, { sandbox: options.sandbox });
      result.sent += 1;
    } catch (error) {
      result.errors.push({ username, error: describeError(error) });
    }
  }
  return result;
}

/**
 * sendRevisionReminder (daily). For each lease whose anniversary is within 45 days and whose
 * `revisionReminderSentFor` is not already the anniversary ISO date:
 *  - index published: e-mail the proposal, then mark `revisionReminderSentFor = 'YYYY-MM-DD'`;
 *  - not published: e-mail the "pending" notice once, mark `'YYYY-MM-DD:pending'`; once the index is
 *    published the proposal is sent and the mark becomes `'YYYY-MM-DD'`.
 * The mark is written only AFTER a successful send, and nothing else is written on the lease. An INSEE
 * failure skips the lease (reported), so that a wrong "published" proposal is never sent.
 */
async function runRevisionReminder(params, deps) {
  const options = readOptions(params);
  const now = deps.now();
  const result = {
    job: 'sendRevisionReminder',
    dryRun: options.dryRun,
    onlyUser: options.onlyUser,
    today: ymdToIso(parisParts(now)),
    sent: 0,
    sentPending: 0,
    alreadySent: 0,
    inseeFailures: [],
    subjects: [],
    errors: [],
  };
  const loaded = await loadOwnerGroups(options, deps);
  result.errors = loaded.errors.slice();
  result.owners = loaded.groups.length;
  result.skippedHoldersWithoutOwner = loaded.withoutOwner;
  if (options.dryRun) {
    result.messages = [];
  }

  const observationCache = new Map();
  function observationsFor(indexType) {
    if (!observationCache.has(indexType)) {
      observationCache.set(
        indexType,
        Promise.resolve()
          .then(() => deps.fetchObservations(indexType))
          .then(
            (map) => ({ ok: true, map }),
            (error) => ({ ok: false, error: describeError(error) }),
          ),
      );
    }
    return observationCache.get(indexType);
  }

  for (const group of loaded.groups) {
    const username = group.owner.username;
    if (!group.owner.email) {
      result.errors.push({ username, error: "pas d'adresse e-mail sur le compte" });
      continue;
    }
    for (const entry of leasesOfGroup(group)) {
      const lease = entry.lease;
      try {
        const first = revisionState(lease, now, undefined);
        if (first.kind !== 'upcoming') {
          continue; // incomplete (silently) or anniversary too far
        }
        const iso = ymdToIso(first.anniversary);
        const mark = lease.revisionReminderSentFor;
        if (mark === iso) {
          result.alreadySent += 1;
          continue;
        }
        if (!lease.objectId && !options.dryRun) {
          result.errors.push({ username, lease: lease.name, error: 'bail sans identifiant' });
          continue;
        }
        const observed = await observationsFor(lease.indexType);
        if (!observed.ok) {
          result.inseeFailures.push({ username, lease: lease.name, indexType: lease.indexType });
          continue;
        }
        const state = revisionState(lease, now, observed.map);
        const published = state.kind === 'upcoming' && state.newIndex !== undefined;
        if (!published && mark === iso + ':pending') {
          result.alreadySent += 1;
          continue;
        }
        const newMark = published ? iso : iso + ':pending';
        const message = buildRevisionReminder({
          owner: group.owner,
          holderName: entry.holderName,
          lease,
          today: now,
          newIndex: published ? state.newIndex : undefined,
        });
        result.subjects.push({ username, subject: message.subject, pending: !published });
        if (options.dryRun) {
          result.messages.push({
            username,
            to: message.to,
            subject: message.subject,
            text: message.text,
            wouldMark: newMark,
          });
          continue;
        }
        await deps.sendMail(message, { sandbox: options.sandbox });
        if (published) {
          result.sent += 1;
        } else {
          result.sentPending += 1;
        }
        if (options.sandbox) {
          // A sandbox run is not a real reminder: it must not suppress the real one for this anniversary.
          continue;
        }
        try {
          await deps.saveReminderMark(lease.objectId, newMark);
        } catch (error) {
          result.errors.push({
            username,
            lease: lease.name,
            error: 'e-mail envoyé mais repère non enregistré (risque de doublon demain) : ' + describeError(error),
          });
        }
      } catch (error) {
        result.errors.push({ username, lease: lease.name, error: describeError(error) });
      }
    }
  }
  return result;
}

/** Mailjet sender (node-mailjet v3, required lazily so that tests and dry runs never load it). */
function createMailjetSender(env) {
  const source = env || process.env;
  return async function sendMail(message, options) {
    const publicKey = source.MJ_APIKEY_PUBLIC;
    const privateKey = source.MJ_APIKEY_PRIVATE;
    let mailjet;
    if (publicKey && privateKey) {
      mailjet = require('node-mailjet').connect(publicKey, privateKey);
    } else if (typeof global !== 'undefined' && global.eleaseMailjet) {
      // Client already created by the deployed main.js (see main.append.js): the keys stay where they are.
      mailjet = global.eleaseMailjet;
    } else {
      throw new Error('Clés Mailjet absentes (variables MJ_APIKEY_PUBLIC / MJ_APIKEY_PRIVATE)');
    }
    const body = {
      Messages: [
        {
          From: { Email: message.to },
          To: [{ Email: message.to }],
          Subject: message.subject,
          TextPart: message.text,
        },
      ],
    };
    if (options && options.sandbox) {
      body.SandboxMode = true;
    }
    const response = await mailjet.post('send', { version: 'v3.1' }).request(body);
    const first = response && response.body && response.body.Messages && response.body.Messages[0];
    if (first && first.Status && first.Status !== 'success') {
      throw new Error('Mailjet a refusé le message (statut ' + first.Status + ')');
    }
  };
}

/** The real dependencies, built on the Parse SDK of the cloud code. */
function defaultDeps(Parse) {
  let sender = null;
  return {
    now: () => new Date(),

    async queryLeaseholders() {
      const result = [];
      for (let skip = 0; ; skip += PAGE_SIZE) {
        const query = new Parse.Query('Leaseholder');
        query.include('leases');
        query.ascending('createdAt');
        query.limit(PAGE_SIZE);
        query.skip(skip);
        const page = await query.find({ useMasterKey: true });
        page.forEach((holder) => {
          const acl = holder.getACL();
          result.push({
            objectId: holder.id,
            name: holder.get('name'),
            ownerId: ownerIdFromAcl(acl ? acl.toJSON() : null),
            leases: (holder.get('leases') || []).map((l) => (l && l.toJSON ? l.toJSON() : l)),
          });
        });
        if (page.length < PAGE_SIZE) {
          return result;
        }
      }
    },

    async getOwner(ownerId) {
      const user = await new Parse.Query(Parse.User).get(ownerId, { useMasterKey: true });
      return { username: user.get('username'), email: user.get('email') };
    },

    async sendMail(message, options) {
      if (!sender) {
        sender = createMailjetSender(process.env);
      }
      await sender(message, options);
    },

    async fetchObservations(indexType) {
      const url = inseeUrl(indexType);
      let text;
      if (Parse.Cloud && typeof Parse.Cloud.httpRequest === 'function') {
        const response = await Parse.Cloud.httpRequest({
          url,
          headers: { Accept: 'application/xml' },
          timeout: INSEE_TIMEOUT_MS,
        });
        text = response.text;
      } else if (typeof fetch === 'function') {
        const response = await fetch(url, { headers: { Accept: 'application/xml' } });
        if (!response.ok) {
          throw new Error('INSEE HTTP ' + response.status);
        }
        text = await response.text();
      } else {
        throw new Error('Aucun client HTTP disponible');
      }
      return parseObservations(text);
    },

    /** Writes ONLY the reminder mark of one lease: nothing else on the object changes. */
    async saveReminderMark(leaseId, value) {
      const lease = new Parse.Object('Lease');
      lease.id = leaseId;
      lease.set('revisionReminderSentFor', value);
      await lease.save(null, { useMasterKey: true });
    },
  };
}

function logResult(name, result) {
  const subjects = result.subjects.map((s) => s.subject).join(' | ');
  console.log(
    '[' + name + '] ' + (result.dryRun ? 'dryRun ' : '') + 'envoyés=' + (result.sent + (result.sentPending || 0)) +
      ' erreurs=' + result.errors.length + (subjects ? ' sujets=' + subjects : ''),
  );
}

/** Registers the jobs on `Parse.Cloud` (the two reminders and the combined `sendReminders`). The job result is the JSON of the run summary. */
function registerJobs(Parse, deps) {
  const actual = deps || defaultDeps(Parse);
  Parse.Cloud.job('sendMonthlyReminder', async (request) => {
    const result = await runMonthlyReminder(request.params, actual);
    logResult('sendMonthlyReminder', result);
    return JSON.stringify(result);
  });
  Parse.Cloud.job('sendRevisionReminder', async (request) => {
    const result = await runRevisionReminder(request.params, actual);
    logResult('sendRevisionReminder', result);
    return JSON.stringify(result);
  });
  // The free Back4App plan allows ONE scheduled job: this one runs both reminders (daily at 09:00 Paris).
  // A failure of one reminder never prevents the other; the result holds both summaries.
  Parse.Cloud.job('sendReminders', async (request) => {
    const result = {};
    for (const [key, run] of [
      ['monthly', runMonthlyReminder],
      ['revision', runRevisionReminder],
    ]) {
      try {
        result[key] = await run(request.params, actual);
        logResult(key === 'monthly' ? 'sendMonthlyReminder' : 'sendRevisionReminder', result[key]);
      } catch (error) {
        result[key] = { failed: describeError(error) };
        console.log('[sendReminders] ' + key + ' en échec : ' + describeError(error));
      }
    }
    return JSON.stringify(result);
  });
}

module.exports = registerJobs;
module.exports.registerJobs = registerJobs;
module.exports.runMonthlyReminder = runMonthlyReminder;
module.exports.runRevisionReminder = runRevisionReminder;
module.exports.createMailjetSender = createMailjetSender;
module.exports.defaultDeps = defaultDeps;
module.exports.readOptions = readOptions;

// In Back4App's cloud code `Parse` is a global: `require('./jobs')` from main.js registers the jobs.
if (typeof Parse !== 'undefined' && Parse && Parse.Cloud && typeof Parse.Cloud.job === 'function') {
  registerJobs(Parse);
}
