'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REMINDER_DAYS_BEFORE,
  INSEE_SERIES,
  nextAnniversary,
  targetQuarter,
  toInseePeriod,
  proposeRent,
  probablePublication,
  revisionState,
  inseeUrl,
  parseObservations,
} = require('../lib/revision');
const { parisParts } = require('../lib/periods');
const { noon, lease, fixture } = require('./helpers');

const ymd = (d) => [d.year, d.month, d.day];

/** Fictitious lease: ILAT, rent 1091.08, reference 2025-T2 = 133.69, anniversary on 1 March 2026 (Paris midnight). */
function revisable(overrides) {
  return lease(
    Object.assign(
      {
        isPro: true,
        name: 'Commerce',
        price: 1091.08,
        renewalDate: Date.parse('2026-02-28T23:00:00Z'),
        indexType: 'ILAT',
        referenceIndexQuarter: '2025-T2',
        referenceIndexValue: 133.69,
      },
      overrides,
    ),
  );
}

const OBS = new Map([['2026-Q2', 136.42]]);

test('uses the INSEE series of the spec and a 45-day reminder', () => {
  assert.equal(REMINDER_DAYS_BEFORE, 45);
  assert.deepEqual(INSEE_SERIES, { IRL: '001515333', ILC: '001532540', ILAT: '001617112' });
  assert.equal(
    inseeUrl('ILAT'),
    'https://api.insee.fr/series/BDM/V1/data/SERIES_BDM/001617112?lastNObservations=12',
  );
  assert.throws(() => inseeUrl('XYZ'));
});

test('proposeRent rounds to the cent', () => {
  assert.equal(proposeRent(1091.08, 133.69, 136.42), 1113.36);
  assert.equal(proposeRent(600, 145.47, 145.47), 600);
});

test('target quarter is one year later; INSEE names it Q', () => {
  assert.equal(targetQuarter('2025-T2'), '2026-T2');
  assert.equal(targetQuarter('2025-T4'), '2026-T4');
  assert.equal(toInseePeriod('2026-T2'), '2026-Q2');
  assert.throws(() => targetQuarter('2025-Q2'));
});

test('probable publication: IRL the 15th after the quarter end, ILC/ILAT the last day of the 3rd month after', () => {
  assert.deepEqual(ymd(probablePublication('IRL', '2026-T2')), [2026, 7, 15]);
  assert.deepEqual(ymd(probablePublication('IRL', '2026-T4')), [2027, 1, 15]);
  assert.deepEqual(ymd(probablePublication('ILAT', '2026-T2')), [2026, 9, 30]);
  assert.deepEqual(ymd(probablePublication('ILC', '2026-T3')), [2026, 12, 31]);
  assert.deepEqual(ymd(probablePublication('ILC', '2026-T4')), [2027, 3, 31]);
  assert.deepEqual(ymd(probablePublication('ILAT', '2027-T1')), [2027, 6, 30]);
});

test('nextAnniversary: the renewal date itself while it is today or later', () => {
  const renewal = Date.parse('2026-02-28T23:00:00Z'); // 1 March 2026, Paris midnight
  assert.deepEqual(ymd(parisParts(renewal)), [2026, 3, 1]);
  assert.deepEqual(ymd(nextAnniversary(renewal, noon(2026, 1, 15))), [2026, 3, 1]);
  // Same day, any time of day.
  assert.deepEqual(ymd(nextAnniversary(renewal, new Date('2026-03-01T17:00:00Z'))), [2026, 3, 1]);
});

test('nextAnniversary rolls a past date forward', () => {
  const renewal = Date.parse('2024-02-29T23:00:00Z'); // 1 March 2024
  assert.deepEqual(ymd(nextAnniversary(renewal, noon(2026, 1, 15))), [2026, 3, 1]);
  assert.deepEqual(ymd(nextAnniversary(renewal, noon(2026, 3, 2))), [2027, 3, 1]);
  const january = Date.parse('2026-01-04T23:00:00Z'); // 5 January 2026
  assert.deepEqual(ymd(nextAnniversary(january, noon(2026, 12, 20))), [2027, 1, 5]);
});

test('nextAnniversary: a 29 February falls on the 28th in common years', () => {
  const renewal = Date.parse('2024-02-28T23:00:00Z'); // 29 February 2024
  assert.deepEqual(ymd(parisParts(renewal)), [2024, 2, 29]);
  assert.deepEqual(ymd(nextAnniversary(renewal, noon(2029, 1, 1))), [2029, 2, 28]);
  assert.deepEqual(ymd(nextAnniversary(renewal, noon(2032, 1, 1))), [2032, 2, 29]);
});

test('nextAnniversary reads the renewal date in Paris: UTC midnight and Paris midnight agree', () => {
  assert.deepEqual(ymd(nextAnniversary(Date.parse('2026-03-01T00:00:00Z'), noon(2026, 1, 15))), [2026, 3, 1]);
  assert.deepEqual(ymd(nextAnniversary(Date.parse('2026-02-28T23:00:00Z'), noon(2026, 1, 15))), [2026, 3, 1]);
  // 31 January 23:30 UTC is 1 February in Paris.
  assert.deepEqual(ymd(nextAnniversary(Date.parse('2027-01-31T23:30:00Z'), noon(2027, 1, 1))), [2027, 2, 1]);
  assert.equal(nextAnniversary(NaN, noon(2026, 1, 1)), null);
});

test('upcoming exactly 45 days before, with the proposal when the index is published', () => {
  const state = revisionState(revisable(), noon(2026, 1, 15), OBS);
  assert.equal(state.kind, 'upcoming');
  assert.equal(state.days, 45);
  assert.equal(state.targetQuarter, '2026-T2');
  assert.equal(state.newIndex, 136.42);
  assert.equal(state.proposedRent, 1113.36);
  assert.deepEqual(ymd(state.anniversary), [2026, 3, 1]);
  assert.equal(state.publication, undefined);
});

test('nothing 46 days before', () => {
  assert.deepEqual(revisionState(revisable(), noon(2026, 1, 14), OBS), { kind: 'none' });
});

test('the day count is a calendar count in Paris, whatever the hour', () => {
  const days = (iso) => revisionState(revisable(), new Date(iso), OBS);
  assert.equal(days('2026-01-14T23:30:00Z').days, 45); // 15 Jan 00:30 Paris
  assert.equal(days('2026-01-15T22:30:00Z').days, 45); // 15 Jan 23:30 Paris
  assert.equal(days('2026-01-15T23:30:00Z').days, 44); // 16 Jan 00:30 Paris
  assert.deepEqual(days('2026-01-14T22:30:00Z'), { kind: 'none' }); // 14 Jan 23:30 Paris: 46 days
});

test('unpublished index: upcoming with the probable publication, no proposal', () => {
  [undefined, new Map(), new Map([['2026-Q1', 136.64]])].forEach((observations) => {
    const state = revisionState(revisable(), noon(2026, 2, 1), observations);
    assert.equal(state.kind, 'upcoming');
    assert.equal(state.newIndex, undefined);
    assert.equal(state.proposedRent, undefined);
    assert.deepEqual(ymd(state.publication), [2026, 9, 30]);
  });
});

test('incomplete variants', () => {
  const today = noon(2026, 2, 1);
  [
    { renewalDate: null },
    { renewalDate: NaN },
    { indexType: undefined },
    { indexType: 'XYZ' },
    { referenceIndexQuarter: undefined },
    { referenceIndexQuarter: '2025-Q2' },
    { referenceIndexValue: undefined },
    { referenceIndexValue: 0 },
    { referenceIndexValue: -3 },
    { price: 0 },
    { price: NaN },
  ].forEach((overrides) => {
    assert.deepEqual(revisionState(revisable(overrides), today, OBS), { kind: 'incomplete' }, JSON.stringify(overrides));
  });
});

test('an observation that is not a positive number is not a publication', () => {
  const state = revisionState(revisable(), noon(2026, 2, 1), new Map([['2026-Q2', 0]]));
  assert.equal(state.newIndex, undefined);
});

test('after applying a revision (renewal one year on) nothing is due before the next window', () => {
  const applied = revisable({
    price: 1113.36,
    referenceIndexQuarter: '2026-T2',
    referenceIndexValue: 136.42,
    renewalDate: Date.parse('2027-02-28T23:00:00Z'),
  });
  assert.deepEqual(revisionState(applied, noon(2026, 2, 1), OBS), { kind: 'none' });
  const next = revisionState(applied, noon(2027, 1, 20), new Map([['2027-Q2', 140]]));
  assert.equal(next.kind, 'upcoming');
  assert.equal(next.targetQuarter, '2027-T2');
});

test('parseObservations reads the synthetic ILAT fixture', () => {
  const observations = parseObservations(fixture('insee-ilat.xml'));
  assert.equal(observations.size, 12);
  assert.equal(observations.get('2026-Q2'), 138.01);
  assert.equal(observations.get('2025-Q2'), 133.69);
  assert.equal(observations.get('2023-Q3'), 129.02);
});

test('parseObservations reads the other fixtures too', () => {
  assert.equal(parseObservations(fixture('insee-ilc.xml')).get('2026-Q1'), 138.12);
  assert.equal(parseObservations(fixture('insee-irl.xml')).size, 12);
});

test('parseObservations copes with attribute order, quotes, prefixes and ignores comments and bad entries', () => {
  const xml = `<m:Root>
    <!-- <Obs TIME_PERIOD="2030-Q1" OBS_VALUE="999"/> -->
    <Series>
      <Obs OBS_VALUE='140.5' TIME_PERIOD='2026-Q3' />
      <ss:Obs OBS_STATUS="A" TIME_PERIOD="2026-Q4" OBS_VALUE="141.25"></ss:Obs>
      <Obs TIME_PERIOD="2026-Q5" OBS_VALUE="1"/>
      <Obs TIME_PERIOD="2026-Q1" OBS_VALUE=""/>
      <Obs TIME_PERIOD="2026-Q2" OBS_VALUE="abc"/>
      <Obs TIME_PERIOD="2025-Q4" OBS_VALUE="-2"/>
      <Obs OBS_VALUE="3"/>
    </Series>
  </m:Root>`;
  const observations = parseObservations(xml);
  assert.deepEqual([...observations.entries()], [
    ['2026-Q3', 140.5],
    ['2026-Q4', 141.25],
  ]);
});

test('parseObservations refuses an answer with no usable observation', () => {
  assert.throws(() => parseObservations('<html>Service unavailable</html>'));
  assert.throws(() => parseObservations(''));
  assert.throws(() => parseObservations(undefined));
  assert.throws(() => parseObservations('<Series><Obs TIME_PERIOD="x" OBS_VALUE="1"/></Series>'));
});
