'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { onLeaseSaved, readBackfillOptions } = require('../history');

/** Just enough of the Parse SDK for the trigger: objects, ACLs and saveAll. */
function fakeParse() {
  const saved = [];
  class ACL {
    constructor() {
      this.read = {};
    }
    setReadAccess(id, value) {
      this.read[id] = value;
    }
  }
  class ParseObject {
    constructor(className) {
      this.className = className;
      this.fields = {};
    }
    setACL(acl) {
      this.acl = acl;
    }
    set(fields) {
      Object.assign(this.fields, fields);
    }
  }
  ParseObject.saveAll = async (objects, options) => {
    assert.equal(options.useMasterKey, true);
    saved.push(...objects);
    return objects;
  };
  return { Parse: { Object: ParseObject, ACL }, saved };
}

function remote(json, acl) {
  return { id: json.objectId, toJSON: () => json, getACL: () => acl };
}

const base = { objectId: 'L1', name: 'Studio', price: 600, isPro: false, additionalCharges: [] };

test('a send saved by a user is logged, readable by that user only', async () => {
  const { Parse, saved } = fakeParse();
  await onLeaseSaved(
    Parse,
    {
      user: { id: 'u1' },
      original: remote(Object.assign({}, base, { lastSendDate: 0 })),
      object: remote(Object.assign({}, base, { lastSendDate: 1_790_000_000_000, lastSentPeriod: '2026-10', lastSentPeriodAt: 1_790_000_000_000 })),
    },
    5,
  );
  assert.equal(saved.length, 1);
  assert.equal(saved[0].className, 'RentCallLog');
  assert.deepEqual(saved[0].acl.read, { u1: true });
  assert.equal(saved[0].fields.period, '2026-10');
});

test('without a user, the owner comes from the lease ACL; with no owner nothing is written', async () => {
  const { Parse, saved } = fakeParse();
  const acl = { toJSON: () => ({ u2: { read: true, write: true } }) };
  await onLeaseSaved(Parse, { object: remote(base, acl) }, 5);
  assert.equal(saved[0].className, 'RentChange');
  assert.deepEqual(saved[0].acl.read, { u2: true });
  await onLeaseSaved(Parse, { object: remote(base, null) }, 5);
  assert.equal(saved.length, 1);
});

test('backfill options: onlyUser must be a name, dryRun a boolean', () => {
  assert.deepEqual(readBackfillOptions({ onlyUser: 'julien', dryRun: true }), { onlyUser: 'julien', dryRun: true });
  assert.throws(() => readBackfillOptions({ onlyUser: '' }));
  assert.throws(() => readBackfillOptions({ dryRun: 'true' }));
});
