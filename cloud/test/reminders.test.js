'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMonthlyReminder, buildRevisionReminder, MONTHLY_LINK } = require('../lib/reminders');
const { noon, lease } = require('./helpers');

const OWNER = { email: 'owner@example.test', username: 'julien' };
const NBSP = ' ';

test('monthly: null when every lease is already sent for the period', () => {
  // 25 Nov 2026 bills December 2026.
  const sent = lease({ lastSentPeriod: '2026-12', lastSendDate: noon(2026, 11, 25).getTime(), lastSentPeriodAt: noon(2026, 11, 25).getTime() });
  assert.equal(buildMonthlyReminder({ owner: OWNER, leases: [{ holderName: 'A', lease: sent }], today: noon(2026, 11, 25) }), null);
  assert.equal(buildMonthlyReminder({ owner: OWNER, leases: [], today: noon(2026, 11, 25) }), null);
});

test('monthly: subject, lines and Σ cents total for two leases to send', () => {
  const pro = lease({ name: 'Commerce', isPro: true, price: 1091.08 });
  const home = lease({ name: 'Studio', price: 300 });
  const sent = lease({ name: 'Garage', price: 80, lastSentPeriod: '2027-01' });
  const message = buildMonthlyReminder({
    owner: OWNER,
    leases: [
      { holderName: 'Martin', lease: pro },
      { holderName: 'Durand', lease: home },
      { holderName: 'Petit', lease: sent },
    ],
    today: noon(2026, 12, 25),
  });
  assert.equal(message.to, OWNER.email);
  assert.equal(message.subject, '2 appels de loyer à envoyer pour janvier 2027');
  assert.ok(message.text.includes(`- Commerce (Martin) : 1${NBSP}309,30${NBSP}€`), message.text);
  assert.ok(message.text.includes(`- Studio (Durand) : 300${NBSP}€`), message.text);
  assert.ok(!message.text.includes('Garage'));
  assert.ok(message.text.includes(`Total : 1${NBSP}609,30${NBSP}€`), message.text);
  assert.ok(message.text.includes(MONTHLY_LINK));
  assert.equal(MONTHLY_LINK, 'https://e-lease-app.smarthomeserver.online/appels');
});

test('monthly: the total adds rounded cents (3 x 1091.08 pro = 3 927,90 €)', () => {
  const leases = [1, 2, 3].map((i) => ({ holderName: 'T' + i, lease: lease({ name: 'P' + i, isPro: true, price: 1091.08 }) }));
  const message = buildMonthlyReminder({ owner: OWNER, leases, today: noon(2026, 12, 25) });
  assert.equal(message.subject, '3 appels de loyer à envoyer pour janvier 2027');
  assert.ok(message.text.includes(`Total : 3${NBSP}927,90${NBSP}€`), message.text);
  assert.ok(!message.text.includes('927,89'));
});

test('monthly: singular subject for one lease', () => {
  const message = buildMonthlyReminder({
    owner: OWNER,
    leases: [{ holderName: 'Martin', lease: lease({ price: 500 }) }],
    today: noon(2026, 11, 25),
  });
  assert.equal(message.subject, '1 appel de loyer à envoyer pour décembre 2026');
});

test('monthly: the period follows the Paris date', () => {
  // 2026-12-31T23:30:00Z is 1 January in Paris: the period billed is February.
  const message = buildMonthlyReminder({
    owner: OWNER,
    leases: [{ holderName: 'M', lease: lease() }],
    today: new Date('2026-12-31T23:30:00Z'),
  });
  assert.equal(message.subject, '1 appel de loyer à envoyer pour février 2027');
});

test('monthly: amounts use U+00A0 only, never U+202F', () => {
  const message = buildMonthlyReminder({
    owner: OWNER,
    leases: [{ holderName: 'M', lease: lease({ price: 1234.5 }) }],
    today: noon(2026, 11, 25),
  });
  assert.ok(message.text.includes(`1${NBSP}234,50${NBSP}€`));
  assert.ok(!message.text.includes(' '));
});

const REVISABLE = lease({
  isPro: true,
  name: 'Commerce',
  price: 1091.08,
  renewalDate: Date.parse('2026-02-28T23:00:00Z'), // 1 March 2026, Paris
  indexType: 'ILAT',
  referenceIndexQuarter: '2025-T2',
  referenceIndexValue: 133.69,
});

test('revision: published index shows the proposal', () => {
  const message = buildRevisionReminder({
    owner: OWNER,
    holderName: 'Martin',
    lease: REVISABLE,
    today: noon(2026, 1, 15),
    newIndex: 136.42,
  });
  assert.equal(message.to, OWNER.email);
  assert.equal(message.subject, 'Révision du loyer — Commerce — 01/03/2026');
  assert.ok(message.text.includes(`1${NBSP}091,08${NBSP}€ → 1${NBSP}113,36${NBSP}€`), message.text);
  assert.ok(message.text.includes('ILAT T2 2026'), message.text);
  assert.ok(message.text.includes('133,69 (T2 2025) → 136,42 (T2 2026)'), message.text);
  assert.ok(message.text.includes('Martin'));
  assert.ok(message.text.includes('dans 45 jours'));
  assert.ok(message.text.includes('https://e-lease-app.smarthomeserver.online/locataires'));
  assert.ok(!message.text.includes(' '));
});

test('revision: unpublished index gives the expected publication date', () => {
  const message = buildRevisionReminder({
    owner: OWNER,
    holderName: 'Martin',
    lease: REVISABLE,
    today: noon(2026, 1, 15),
  });
  assert.equal(message.subject, 'Révision du loyer — Commerce — 01/03/2026');
  assert.ok(message.text.includes('pas encore publié'), message.text);
  assert.ok(message.text.includes('30/09/2026'), message.text);
  assert.ok(!message.text.includes('→ 1'), message.text);
  assert.ok(message.text.includes(`1${NBSP}091,08${NBSP}€`));
});

test('revision: an explicit publication date is honoured', () => {
  const message = buildRevisionReminder({
    owner: OWNER,
    holderName: 'Martin',
    lease: REVISABLE,
    today: noon(2026, 1, 15),
    publication: { year: 2026, month: 10, day: 5 },
  });
  assert.ok(message.text.includes('05/10/2026'), message.text);
});

test('revision: throws when no revision is in view', () => {
  assert.throws(() =>
    buildRevisionReminder({ owner: OWNER, holderName: 'M', lease: REVISABLE, today: noon(2026, 1, 14), newIndex: 136.42 }),
  );
  assert.throws(() =>
    buildRevisionReminder({ owner: OWNER, holderName: 'M', lease: lease(), today: noon(2026, 1, 14) }),
  );
});
