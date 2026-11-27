'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Noon UTC of a calendar day: the same Paris date in winter and in summer, whatever TZ the tests run in. */
function noon(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

/** A lease as leases.leaseFromParse returns it. */
function lease(overrides) {
  return Object.assign(
    {
      objectId: 'lease1',
      isPro: false,
      name: 'Bail test',
      price: 1000,
      charge: null,
      additionalCharges: [],
      lastSendDate: 0,
      renewalDate: null,
    },
    overrides || {},
  );
}

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
}

module.exports = { noon, lease, fixture };
