'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const registerJobs = require('../jobs');
const { runMonthlyReminder, runRevisionReminder, createMailjetSender, readOptions } = registerJobs;
const { ownerIdFromAcl } = require('../lib/leases');
const { noon } = require('./helpers');

const JULIEN = { username: 'julien', email: 'julien@owner.test' };
const OTHER = { username: 'other-owner', email: 'other@owner.test' };
const TENANT_EMAILS = ['tenant.a@tenant.test', 'tenant.b@tenant.test', 'tenant.c@tenant.test'];

/** A holder as the real queryLeaseholders returns it (leases are Parse toJSON objects). */
function holder(ownerId, name, email, leases) {
  return { objectId: 'h-' + name, name, email, ownerId, leases };
}

function parseLease(id, overrides) {
  return Object.assign(
    { objectId: id, name: 'Bail ' + id, isPro: false, price: 500, charge: null, additionalCharges: [], lastSendDate: 0 },
    overrides || {},
  );
}

function revisableJson(id, overrides) {
  return parseLease(
    id,
    Object.assign(
      {
        name: 'Commerce',
        isPro: true,
        price: 1091.08,
        renewalDate: Date.parse('2026-02-28T23:00:00Z'), // 1 March 2026, Paris
        indexType: 'ILAT',
        referenceIndexQuarter: '2025-T2',
        referenceIndexValue: 133.69,
      },
      overrides,
    ),
  );
}

/** Fake dependencies recording every call; nothing real is reachable. */
function makeDeps(options) {
  const o = options || {};
  const calls = { sent: [], marks: [], fetches: [], queries: 0, owners: [] };
  const users = o.users || { u1: JULIEN, u2: OTHER };
  return {
    calls,
    now: () => o.now || noon(2026, 12, 25),
    async queryLeaseholders() {
      calls.queries += 1;
      return o.holders || [];
    },
    async getOwner(id) {
      calls.owners.push(id);
      return users[id] || null;
    },
    async sendMail(message, mailOptions) {
      if (o.sendFails && o.sendFails(message)) {
        throw new Error('Mailjet down');
      }
      calls.sent.push({ message, mailOptions });
    },
    async fetchObservations(type) {
      calls.fetches.push(type);
      if (o.inseeFails) {
        throw new Error('INSEE unreachable');
      }
      return o.observations || new Map();
    },
    async saveReminderMark(id, value) {
      if (o.markFails) {
        throw new Error('save failed');
      }
      calls.marks.push([id, value]);
    },
  };
}

const TWO_OWNERS = [
  holder('u1', 'Martin', TENANT_EMAILS[0], [parseLease('l1', { isPro: true, price: 1091.08 })]),
  holder('u2', 'Durand', TENANT_EMAILS[1], [parseLease('l2', { price: 300 })]),
];

// ---------------------------------------------------------------- options and ACL

test('readOptions: dryRun and force only when true; onlyUser must be a non-empty string when present', () => {
  assert.deepEqual(readOptions({}), { onlyUser: null, dryRun: false, force: false, sandbox: false });
  assert.deepEqual(readOptions(undefined), { onlyUser: null, dryRun: false, force: false, sandbox: false });
  assert.equal(readOptions({ dryRun: true }).dryRun, true);
  assert.equal(readOptions({ dryRun: false }).dryRun, false);
  assert.equal(readOptions({ onlyUser: ' julien ' }).onlyUser, 'julien');
  [' ', '', 7, true, {}].forEach((bad) => assert.throws(() => readOptions({ onlyUser: bad })));
});

test('readOptions: dryRun, force and sandbox accept real booleans only (absent is valid)', () => {
  ['dryRun', 'force', 'sandbox'].forEach((name) => {
    ['True', 'true', 'yes', 'false', '0', 1, 0, {}, []].forEach((bad) => {
      assert.throws(() => readOptions({ [name]: bad }), new RegExp(name + ' doit être un booléen'), name + '=' + JSON.stringify(bad));
    });
    assert.equal(readOptions({ [name]: true })[name], true);
    assert.equal(readOptions({ [name]: false })[name], false);
    assert.equal(readOptions({ [name]: undefined })[name], false);
    assert.equal(readOptions({ [name]: null })[name], false);
  });
});

test('a job with a non-boolean dryRun fails and does nothing', async () => {
  const deps = makeDeps({ now: REV_NOW, holders: revisionHolders(), observations: OBS });
  await assert.rejects(runRevisionReminder({ onlyUser: 'julien', dryRun: 'true' }, deps), /dryRun/);
  await assert.rejects(runMonthlyReminder({ onlyUser: 'julien', dryRun: 'yes' }, deps), /dryRun/);
  assert.equal(deps.calls.queries, 0);
  assert.equal(deps.calls.sent.length, 0);
});

test('ownerIdFromAcl: the single user with write access', () => {
  assert.equal(ownerIdFromAcl({ abc123: { read: true, write: true } }), 'abc123');
  assert.equal(ownerIdFromAcl({ '*': { read: true }, abc123: { read: true, write: true } }), 'abc123');
  assert.equal(ownerIdFromAcl({ 'role:admin': { write: true }, abc123: { read: true, write: true } }), 'abc123');
  assert.equal(ownerIdFromAcl({ abc123: { read: true } }), null);
  assert.equal(ownerIdFromAcl({ a: { write: true }, b: { write: true } }), null);
  assert.equal(ownerIdFromAcl({ '*': { read: true, write: true } }), null);
  assert.equal(ownerIdFromAcl(null), null);
});

// ---------------------------------------------------------------- monthly

test('monthly: nothing happens before the 25th (Paris), unless forced', async () => {
  const deps = makeDeps({ now: noon(2026, 12, 24), holders: TWO_OWNERS });
  const result = await runMonthlyReminder({ onlyUser: 'julien' }, deps);
  assert.match(result.skipped, /25/);
  assert.equal(result.sent, 0);
  assert.equal(deps.calls.queries, 0);
  assert.equal(deps.calls.sent.length, 0);

  const forced = await runMonthlyReminder({ onlyUser: 'julien', force: true }, deps);
  assert.equal(forced.skipped, undefined);
  assert.equal(forced.sent, 1);
});

test('monthly: the 25th is read in Paris time (24 Dec 23:30Z is already the 25th)', async () => {
  const deps = makeDeps({ now: new Date('2026-12-24T23:30:00Z'), holders: TWO_OWNERS });
  const result = await runMonthlyReminder({ onlyUser: 'julien' }, deps);
  assert.equal(result.sent, 1);
  assert.equal(result.period, '2027-01');
  const early = makeDeps({ now: new Date('2026-12-23T23:30:00Z'), holders: TWO_OWNERS });
  assert.ok((await runMonthlyReminder({ onlyUser: 'julien' }, early)).skipped);
});

test('monthly: the reminder repeats every day from the 25th to the end of the month, for the next period', async () => {
  for (const day of [25, 26, 28, 31]) {
    const deps = makeDeps({ now: noon(2026, 12, day), holders: TWO_OWNERS });
    const result = await runMonthlyReminder({ onlyUser: 'julien' }, deps);
    assert.equal(result.skipped, undefined, 'day ' + day);
    assert.equal(result.sent, 1, 'day ' + day);
    assert.equal(result.period, '2027-01', 'day ' + day);
  }
});

test('monthly: onlyUser restricts the run to that owner', async () => {
  const deps = makeDeps({ holders: TWO_OWNERS });
  const result = await runMonthlyReminder({ onlyUser: 'julien' }, deps);
  assert.equal(result.sent, 1);
  assert.equal(deps.calls.sent.length, 1);
  assert.equal(deps.calls.sent[0].message.to, JULIEN.email);
  assert.deepEqual(result.subjects, [{ username: 'julien', subject: '1 appel de loyer à envoyer pour janvier 2027' }]);
});

test('monthly: without onlyUser every owner gets their own mail (scheduled run)', async () => {
  const deps = makeDeps({ holders: TWO_OWNERS });
  const result = await runMonthlyReminder({}, deps);
  assert.equal(result.sent, 2);
  assert.deepEqual(deps.calls.sent.map((c) => c.message.to).sort(), [JULIEN.email, OTHER.email]);
});

test('monthly: an invalid onlyUser fails the job instead of widening it', async () => {
  const deps = makeDeps({ holders: TWO_OWNERS });
  await assert.rejects(runMonthlyReminder({ onlyUser: '' }, deps));
  assert.equal(deps.calls.sent.length, 0);
});

test('monthly: dryRun returns the messages and sends or writes nothing', async () => {
  const deps = makeDeps({ holders: TWO_OWNERS });
  const result = await runMonthlyReminder({ onlyUser: 'julien', dryRun: true }, deps);
  assert.equal(deps.calls.sent.length, 0);
  assert.equal(deps.calls.marks.length, 0);
  assert.equal(result.sent, 0);
  assert.equal(result.dryRun, true);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].to, JULIEN.email);
  assert.match(result.messages[0].subject, /^1 appel de loyer à envoyer pour janvier 2027$/);
});

test('monthly: From = To = owner address; no tenant address anywhere', async () => {
  const deps = makeDeps({ holders: TWO_OWNERS });
  const result = await runMonthlyReminder({}, deps);
  const everything = JSON.stringify([deps.calls.sent, result]);
  TENANT_EMAILS.forEach((email) => assert.ok(!everything.includes(email), email));
  deps.calls.sent.forEach((c) => assert.deepEqual(Object.keys(c.message).sort(), ['subject', 'text', 'to']));
  const dry = await runMonthlyReminder({ dryRun: true }, makeDeps({ holders: TWO_OWNERS }));
  TENANT_EMAILS.forEach((email) => assert.ok(!JSON.stringify(dry).includes(email), email));
});

test('monthly: one owner failing does not stop the others', async () => {
  const deps = makeDeps({ holders: TWO_OWNERS, sendFails: (m) => m.to === JULIEN.email });
  const result = await runMonthlyReminder({}, deps);
  assert.equal(result.sent, 1);
  assert.equal(deps.calls.sent[0].message.to, OTHER.email);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].username, 'julien');
  assert.match(result.errors[0].error, /Mailjet down/);
});

test('monthly: an owner that cannot be read does not stop the others', async () => {
  const deps = makeDeps({ holders: TWO_OWNERS, users: { u2: OTHER } });
  const result = await runMonthlyReminder({}, deps);
  assert.equal(result.sent, 1);
  assert.equal(result.errors.length, 1);
});

test('monthly: no mail when everything is sent, when there is no lease, or no owner address', async () => {
  const sent = parseLease('l1', { lastSentPeriod: '2027-01' });
  const deps = makeDeps({
    holders: [holder('u1', 'Martin', TENANT_EMAILS[0], [sent]), holder('u2', 'Vide', TENANT_EMAILS[1], [])],
  });
  assert.equal((await runMonthlyReminder({}, deps)).sent, 0);
  assert.equal(deps.calls.sent.length, 0);

  const noAddress = makeDeps({ holders: TWO_OWNERS, users: { u1: { username: 'julien', email: '' }, u2: OTHER } });
  const result = await runMonthlyReminder({}, noAddress);
  assert.equal(result.sent, 1);
  assert.equal(result.errors.length, 1);
});

test('monthly: holders without a single owner or with unloaded leases are skipped', async () => {
  const deps = makeDeps({
    holders: [
      holder(null, 'Orphelin', TENANT_EMAILS[0], [parseLease('x')]),
      holder('u1', 'Martin', TENANT_EMAILS[1], [{ __type: 'Pointer', className: 'Lease', objectId: 'p1' }, { objectId: 'bare' }]),
    ],
  });
  const result = await runMonthlyReminder({}, deps);
  assert.equal(result.sent, 0);
  assert.equal(result.skippedHoldersWithoutOwner, 1);
});

test('monthly: sandbox is passed through to the sender', async () => {
  const deps = makeDeps({ holders: TWO_OWNERS });
  await runMonthlyReminder({ onlyUser: 'julien', sandbox: true }, deps);
  assert.deepEqual(deps.calls.sent[0].mailOptions, { sandbox: true });
});

// ---------------------------------------------------------------- revision

const REV_NOW = noon(2026, 1, 15); // 45 days before 1 March 2026
const OBS = new Map([['2026-Q2', 136.42]]);

function revisionHolders(leaseOverrides) {
  return [holder('u1', 'Martin', TENANT_EMAILS[0], [revisableJson('l1', leaseOverrides)])];
}

test('revision: published index sends the proposal, then marks only revisionReminderSentFor, after the send', async () => {
  const order = [];
  const deps = makeDeps({ now: REV_NOW, holders: revisionHolders(), observations: OBS });
  const send = deps.sendMail;
  const save = deps.saveReminderMark;
  deps.sendMail = async (m, o) => {
    order.push('send');
    await send(m, o);
  };
  deps.saveReminderMark = async (id, value) => {
    order.push('mark');
    await save(id, value);
  };
  const result = await runRevisionReminder({ onlyUser: 'julien' }, deps);
  assert.deepEqual(order, ['send', 'mark']);
  assert.deepEqual(deps.calls.marks, [['l1', '2026-03-01']]);
  assert.equal(result.sent, 1);
  assert.equal(deps.calls.sent[0].message.to, JULIEN.email);
  assert.equal(deps.calls.sent[0].message.subject, 'Révision du loyer — Commerce — 01/03/2026');
  assert.ok(deps.calls.sent[0].message.text.includes('1 113,36 €'));
  assert.deepEqual(deps.calls.fetches, ['ILAT']);
});

test('revision: a sandbox run sends in sandbox mode and writes no mark', async () => {
  const deps = makeDeps({ now: REV_NOW, holders: revisionHolders(), observations: OBS });
  const result = await runRevisionReminder({ onlyUser: 'julien', sandbox: true }, deps);
  assert.equal(result.sent, 1);
  assert.deepEqual(deps.calls.sent[0].mailOptions, { sandbox: true });
  assert.deepEqual(deps.calls.marks, []);
});

test('revision: a failed send writes no mark', async () => {
  const deps = makeDeps({ now: REV_NOW, holders: revisionHolders(), observations: OBS, sendFails: () => true });
  const result = await runRevisionReminder({ onlyUser: 'julien' }, deps);
  assert.equal(deps.calls.marks.length, 0);
  assert.equal(result.sent, 0);
  assert.equal(result.errors.length, 1);
});

test('revision: a failed mark after the send is reported loudly, the job goes on', async () => {
  const deps = makeDeps({ now: REV_NOW, holders: revisionHolders(), observations: OBS, markFails: true });
  const result = await runRevisionReminder({ onlyUser: 'julien' }, deps);
  assert.equal(result.sent, 1);
  assert.match(result.errors[0].error, /doublon/);
});

test('revision: not published yet sends the pending notice once, marked :pending', async () => {
  const deps = makeDeps({ now: REV_NOW, holders: revisionHolders(), observations: new Map() });
  const result = await runRevisionReminder({ onlyUser: 'julien' }, deps);
  assert.equal(result.sentPending, 1);
  assert.equal(result.sent, 0);
  assert.deepEqual(deps.calls.marks, [['l1', '2026-03-01:pending']]);
  assert.ok(deps.calls.sent[0].message.text.includes('30/09/2026'));

  // The next day: still unpublished and already announced: nothing more.
  const again = makeDeps({
    now: noon(2026, 1, 16),
    holders: revisionHolders({ revisionReminderSentFor: '2026-03-01:pending' }),
    observations: new Map(),
  });
  const second = await runRevisionReminder({ onlyUser: 'julien' }, again);
  assert.equal(again.calls.sent.length, 0);
  assert.equal(again.calls.marks.length, 0);
  assert.equal(second.alreadySent, 1);
});

test('revision: pending then published re-sends the proposal once, marked with the plain date', async () => {
  const deps = makeDeps({
    now: noon(2026, 1, 20),
    holders: revisionHolders({ revisionReminderSentFor: '2026-03-01:pending' }),
    observations: OBS,
  });
  const result = await runRevisionReminder({ onlyUser: 'julien' }, deps);
  assert.equal(result.sent, 1);
  assert.ok(deps.calls.sent[0].message.text.includes('1 091,08 € → 1 113,36 €'));
  assert.deepEqual(deps.calls.marks, [['l1', '2026-03-01']]);

  const done = makeDeps({
    now: noon(2026, 1, 21),
    holders: revisionHolders({ revisionReminderSentFor: '2026-03-01' }),
    observations: OBS,
  });
  const next = await runRevisionReminder({ onlyUser: 'julien' }, done);
  assert.equal(done.calls.sent.length, 0);
  assert.equal(done.calls.fetches.length, 0);
  assert.equal(next.alreadySent, 1);
});

test('revision: a mark for a previous anniversary does not block this one', async () => {
  const deps = makeDeps({
    now: REV_NOW,
    holders: revisionHolders({ revisionReminderSentFor: '2025-03-01' }),
    observations: OBS,
  });
  assert.equal((await runRevisionReminder({ onlyUser: 'julien' }, deps)).sent, 1);
});

test('revision: INSEE failure skips the lease, reports it, sends and writes nothing', async () => {
  const deps = makeDeps({ now: REV_NOW, holders: revisionHolders(), inseeFails: true });
  const result = await runRevisionReminder({ onlyUser: 'julien' }, deps);
  assert.equal(deps.calls.sent.length, 0);
  assert.equal(deps.calls.marks.length, 0);
  assert.deepEqual(result.inseeFailures, [{ username: 'julien', lease: 'Commerce', indexType: 'ILAT' }]);
});

test('revision: the INSEE answer is fetched once per index type', async () => {
  const deps = makeDeps({
    now: REV_NOW,
    observations: OBS,
    holders: [
      holder('u1', 'Martin', TENANT_EMAILS[0], [revisableJson('l1'), revisableJson('l2', { name: 'Atelier' })]),
    ],
  });
  const result = await runRevisionReminder({ onlyUser: 'julien' }, deps);
  assert.equal(result.sent, 2);
  assert.deepEqual(deps.calls.fetches, ['ILAT']);
});

test('revision: incomplete leases and far anniversaries are skipped silently, without any INSEE call', async () => {
  const deps = makeDeps({
    now: REV_NOW,
    observations: OBS,
    holders: [
      holder('u1', 'Martin', TENANT_EMAILS[0], [
        revisableJson('l1', { renewalDate: undefined }),
        revisableJson('l2', { indexType: undefined }),
        revisableJson('l3', { renewalDate: Date.parse('2026-06-30T22:00:00Z') }),
      ]),
    ],
  });
  const result = await runRevisionReminder({ onlyUser: 'julien' }, deps);
  assert.equal(deps.calls.fetches.length, 0);
  assert.equal(deps.calls.sent.length, 0);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.inseeFailures, []);
});

test('revision: dryRun returns the messages and the mark it would write, sends and writes nothing', async () => {
  const deps = makeDeps({ now: REV_NOW, holders: revisionHolders(), observations: OBS });
  const result = await runRevisionReminder({ onlyUser: 'julien', dryRun: true }, deps);
  assert.equal(deps.calls.sent.length, 0);
  assert.equal(deps.calls.marks.length, 0);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].to, JULIEN.email);
  assert.equal(result.messages[0].wouldMark, '2026-03-01');
});

test('revision: onlyUser filters; another owner is untouched, and one failing owner does not stop the next', async () => {
  const holders = [
    holder('u1', 'Martin', TENANT_EMAILS[0], [revisableJson('l1')]),
    holder('u2', 'Durand', TENANT_EMAILS[1], [revisableJson('l2')]),
  ];
  const only = makeDeps({ now: REV_NOW, holders, observations: OBS });
  await runRevisionReminder({ onlyUser: 'julien' }, only);
  assert.deepEqual(only.calls.sent.map((c) => c.message.to), [JULIEN.email]);
  assert.deepEqual(only.calls.marks, [['l1', '2026-03-01']]);

  const all = makeDeps({ now: REV_NOW, holders, observations: OBS, sendFails: (m) => m.to === JULIEN.email });
  const result = await runRevisionReminder({}, all);
  assert.deepEqual(all.calls.sent.map((c) => c.message.to), [OTHER.email]);
  assert.deepEqual(all.calls.marks, [['l2', '2026-03-01']]);
  assert.equal(result.errors.length, 1);
});

test('revision: no tenant address anywhere, From = To = owner', async () => {
  const deps = makeDeps({ now: REV_NOW, holders: revisionHolders(), observations: OBS });
  const result = await runRevisionReminder({ onlyUser: 'julien' }, deps);
  const everything = JSON.stringify([deps.calls, result]);
  TENANT_EMAILS.forEach((email) => assert.ok(!everything.includes(email), email));
  assert.equal(deps.calls.sent[0].message.to, JULIEN.email);
});

// ---------------------------------------------------------------- wiring

test('registerJobs registers the reminder jobs and returns the run summary as JSON', async () => {
  const registered = {};
  const fakeParse = { Cloud: { job: (name, fn) => (registered[name] = fn) } };
  const deps = makeDeps({ holders: TWO_OWNERS });
  registerJobs(fakeParse, deps);
  assert.deepEqual(Object.keys(registered).sort(), ['sendMonthlyReminder', 'sendReminders', 'sendRevisionReminder']);
  const output = await registered.sendMonthlyReminder({ params: { onlyUser: 'julien', dryRun: true } });
  assert.equal(JSON.parse(output).messages.length, 1);
  assert.equal(deps.calls.sent.length, 0);
});

test('sendReminders runs both reminders; one failing never stops the other', async () => {
  const registered = {};
  const fakeParse = { Cloud: { job: (name, fn) => (registered[name] = fn) } };
  const deps = makeDeps({ holders: TWO_OWNERS });
  registerJobs(fakeParse, deps);
  const both = JSON.parse(await registered.sendReminders({ params: { onlyUser: 'julien', dryRun: true } }));
  assert.equal(both.monthly.messages.length, 1);
  assert.equal(both.revision.dryRun, true);
  assert.equal(deps.calls.sent.length, 0);

  // an invalid parameter makes both bodies fail: both are reported, nothing is thrown
  const failed = JSON.parse(await registered.sendReminders({ params: { onlyUser: 'julien', dryRun: 'yes' } }));
  assert.ok(failed.monthly.failed);
  assert.ok(failed.revision.failed);

  // the monthly body failing (unreadable holders) leaves the revision reminder running
  const broken = makeDeps({ holders: TWO_OWNERS });
  broken.queryLeaseholders = async () => {
    throw new Error('boom');
  };
  const registeredBroken = {};
  registerJobs({ Cloud: { job: (name, fn) => (registeredBroken[name] = fn) } }, broken);
  const partial = JSON.parse(await registeredBroken.sendReminders({ params: { onlyUser: 'julien', dryRun: true } }));
  assert.ok(partial.monthly.failed || partial.monthly.errors.length > 0);
  assert.ok(partial.revision);
});

test('the real mail sender refuses to run without Mailjet keys (no network is reached)', async () => {
  const send = createMailjetSender({});
  await assert.rejects(send({ to: 'a@b.test', subject: 's', text: 't' }, {}), /MJ_APIKEY/);
});

test('the real mail sender reuses the Mailjet client shared by main.js when no keys are set', async () => {
  const requests = [];
  global.eleaseMailjet = {
    post: () => ({
      request: async (body) => {
        requests.push(body);
        return { body: { Messages: [{ Status: 'success' }] } };
      },
    }),
  };
  try {
    await createMailjetSender({})({ to: 'a@b.test', subject: 's', text: 't' }, { sandbox: true });
  } finally {
    delete global.eleaseMailjet;
  }
  assert.equal(requests.length, 1);
  assert.equal(requests[0].SandboxMode, true);
  assert.deepEqual(requests[0].Messages[0].To, [{ Email: 'a@b.test' }]);
  assert.deepEqual(requests[0].Messages[0].From, { Email: 'a@b.test' });
});

// ---------------------------------------------------------------- real dependencies over a fake Parse SDK

function fakeParse(pages, httpText) {
  const log = { sets: [], saves: [], queryOptions: [], http: [] };
  class FakeObject {
    constructor(className) {
      this.className = className;
    }
    set(key, value) {
      log.sets.push([this.className, this.id, key, value]);
    }
    async save(attrs, options) {
      log.saves.push([this.className, this.id, attrs, options]);
    }
  }
  class FakeQuery {
    constructor(target) {
      this.target = target;
      this.skipped = 0;
    }
    include() {}
    ascending() {}
    limit() {}
    skip(n) {
      this.skipped = n;
    }
    async find(options) {
      log.queryOptions.push(options);
      return pages[this.skipped / 100] || [];
    }
    async get(id, options) {
      log.queryOptions.push(options);
      return { get: (key) => ({ username: 'julien', email: 'julien@owner.test' })[key] };
    }
  }
  const Parse = {
    Object: FakeObject,
    Query: FakeQuery,
    User: 'User',
    Cloud: {
      job() {},
      async httpRequest(options) {
        log.http.push(options);
        return { text: httpText };
      },
    },
  };
  return { Parse, log };
}

test('defaultDeps: reads with the master key and takes the owner from the holder ACL', async () => {
  const stored = {
    id: 'h1',
    get: (key) => ({ name: 'Martin', leases: [{ toJSON: () => ({ objectId: 'l1', price: 10 }) }] })[key],
    getACL: () => ({ toJSON: () => ({ u1: { read: true, write: true } }) }),
  };
  const { Parse, log } = fakeParse([[stored]]);
  const deps = registerJobs.defaultDeps(Parse);
  const holders = await deps.queryLeaseholders();
  assert.deepEqual(holders, [
    { objectId: 'h1', name: 'Martin', ownerId: 'u1', leases: [{ objectId: 'l1', price: 10 }] },
  ]);
  assert.deepEqual(await deps.getOwner('u1'), { username: 'julien', email: 'julien@owner.test' });
  log.queryOptions.forEach((o) => assert.deepEqual(o, { useMasterKey: true }));
  assert.equal(log.queryOptions.length, 2);
});

test('defaultDeps.saveReminderMark sets ONLY revisionReminderSentFor, with the master key', async () => {
  const { Parse, log } = fakeParse([]);
  await registerJobs.defaultDeps(Parse).saveReminderMark('l1', '2026-03-01:pending');
  assert.deepEqual(log.sets, [['Lease', 'l1', 'revisionReminderSentFor', '2026-03-01:pending']]);
  assert.deepEqual(log.saves, [['Lease', 'l1', null, { useMasterKey: true }]]);
});

test('defaultDeps.fetchObservations calls the keyless BDM URL and parses the answer', async () => {
  const xml = '<Series><Obs TIME_PERIOD="2026-Q2" OBS_VALUE="136.42"/></Series>';
  const { Parse, log } = fakeParse([], xml);
  const observations = await registerJobs.defaultDeps(Parse).fetchObservations('ILAT');
  assert.equal(observations.get('2026-Q2'), 136.42);
  assert.equal(log.http.length, 1);
  assert.equal(
    log.http[0].url,
    'https://api.insee.fr/series/BDM/V1/data/SERIES_BDM/001617112?lastNObservations=12',
  );
  assert.ok(!JSON.stringify(log.http[0]).toLowerCase().includes('key'));
});
