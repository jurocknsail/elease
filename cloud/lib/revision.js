'use strict';

const { parisParts, daysInMonth, calendarDays, ymdNumber } = require('./periods');

/*
 * Annual rent revision: when to remind, which index applies, what the new rent is. Mechanical port of
 * src/app/core/revision/revision.ts and of the observation parser of src/app/core/insee/insee.service.ts,
 * with the same test values. `today` is always a parameter (a Date); calendar dates are Europe/Paris
 * { year, month (1-12), day } objects, see periods.js.
 */

/** The owner is reminded this many days before the anniversary. */
const REMINDER_DAYS_BEFORE = 45;

/** INSEE BDM series: IRL (housing), ILC (shops and crafts), ILAT (offices and other activities). */
const INSEE_SERIES = { IRL: '001515333', ILC: '001532540', ILAT: '001617112' };

const INSEE_BASE_URL = 'https://api.insee.fr/series/BDM/V1/data/SERIES_BDM';
const LAST_OBSERVATIONS = 12;

const QUARTER = /^(\d{4})-T([1-4])$/;
const INSEE_PERIOD = /^\d{4}-Q[1-4]$/;

function parseQuarter(quarter) {
  const match = QUARTER.exec(quarter);
  if (!match) {
    throw new Error('Trimestre invalide : ' + quarter);
  }
  return { year: Number(match[1]), n: Number(match[2]) };
}

function isUsable(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function hasSeries(indexType) {
  return typeof indexType === 'string' && Object.prototype.hasOwnProperty.call(INSEE_SERIES, indexType);
}

/** The same day and month in `year`; a 29 February becomes the 28th in a common year. */
function inYear(year, month, day) {
  return { year, month, day: Math.min(day, daysInMonth(year, month)) };
}

/**
 * The anniversary in view: `renewalDate` (read in Europe/Paris) itself while it is today or later, else
 * its day and month in the first year where the date is today or later. Returns a calendar date, or null
 * when `renewalDate` or `today` is not a usable instant.
 *
 * A date already past is rolled forward silently: no proposal for a missed anniversary.
 */
function nextAnniversary(renewalDate, today) {
  const start = parisParts(renewalDate);
  const now = parisParts(today);
  if (!start || !now) {
    return null;
  }
  if (ymdNumber(start) >= ymdNumber(now)) {
    return start;
  }
  let candidate = inYear(now.year, start.month, start.day);
  if (ymdNumber(candidate) < ymdNumber(now)) {
    candidate = inYear(now.year + 1, start.month, start.day);
  }
  return candidate;
}

/** The same quarter one year later: '2025-T2' becomes '2026-T2'. */
function targetQuarter(referenceQuarter) {
  const q = parseQuarter(referenceQuarter);
  return `${q.year + 1}-T${q.n}`;
}

/** INSEE's name of a quarter: '2026-T2' becomes '2026-Q2'. */
function toInseePeriod(quarter) {
  const q = parseQuarter(quarter);
  return `${q.year}-Q${q.n}`;
}

/** The new rent, rounded to the cent: rent x new index / reference index. */
function proposeRent(price, refValue, newValue) {
  return Math.round(((price * newValue) / refValue) * 100) / 100;
}

/**
 * When INSEE probably publishes the index of quarter `quarter`: IRL the 15th of the month after the
 * quarter end; ILC and ILAT the last day of the 3rd month after the quarter end. A calendar date.
 */
function probablePublication(type, quarter) {
  const q = parseQuarter(quarter);
  // Month number (1-12) of the month right after the quarter end, rolled over the year end.
  function monthAfter(offset) {
    const index = q.n * 3 + offset; // 1-based month, may exceed 12
    return { year: q.year + Math.floor((index - 1) / 12), month: ((index - 1) % 12) + 1 };
  }
  if (type === 'IRL') {
    const m = monthAfter(1);
    return { year: m.year, month: m.month, day: 15 };
  }
  const m = monthAfter(3);
  return { year: m.year, month: m.month, day: daysInMonth(m.year, m.month) };
}

/**
 * Where the revision of `lease` stands on `today`:
 *  - { kind: 'incomplete' }: something needed is missing or unusable;
 *  - { kind: 'none' }: the anniversary is more than REMINDER_DAYS_BEFORE days away;
 *  - { kind: 'upcoming', anniversary, days, targetQuarter, newIndex?, proposedRent?, publication? }.
 * `observations` maps INSEE periods ('2026-Q2') to values (a Map, or undefined while not known).
 */
function revisionState(lease, today, observations) {
  const { renewalDate, indexType, referenceIndexQuarter, referenceIndexValue, price } = lease;
  if (
    renewalDate == null ||
    !Number.isFinite(renewalDate) ||
    !hasSeries(indexType) ||
    typeof referenceIndexQuarter !== 'string' ||
    !QUARTER.test(referenceIndexQuarter) ||
    !isUsable(referenceIndexValue) ||
    !isUsable(price)
  ) {
    return { kind: 'incomplete' };
  }
  const now = parisParts(today);
  if (!now) {
    throw new RangeError('today invalide');
  }
  const anniversary = nextAnniversary(renewalDate, today);
  if (!anniversary) {
    return { kind: 'incomplete' };
  }
  const days = calendarDays(now, anniversary);
  if (days > REMINDER_DAYS_BEFORE) {
    return { kind: 'none' };
  }
  const target = targetQuarter(referenceIndexQuarter);
  const published = observations ? observations.get(toInseePeriod(target)) : undefined;
  if (!isUsable(published)) {
    return {
      kind: 'upcoming',
      anniversary,
      days,
      targetQuarter: target,
      publication: probablePublication(indexType, target),
    };
  }
  const proposedRent = proposeRent(price, referenceIndexValue, published);
  if (!Number.isFinite(proposedRent)) {
    return { kind: 'incomplete' };
  }
  return {
    kind: 'upcoming',
    anniversary,
    days,
    targetQuarter: target,
    newIndex: published,
    proposedRent,
  };
}

/** URL of the INSEE BDM answer for an index family (public statistics: no key). */
function inseeUrl(indexType) {
  if (!hasSeries(indexType)) {
    throw new Error('Type d\'indice inconnu');
  }
  return `${INSEE_BASE_URL}/${INSEE_SERIES[indexType]}?lastNObservations=${LAST_OBSERVATIONS}`;
}

const OBS_TAG = /<(?:[\w.-]+:)?Obs\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function attributesOf(source) {
  const attributes = {};
  ATTRIBUTE.lastIndex = 0;
  let match = ATTRIBUTE.exec(source);
  while (match !== null) {
    attributes[match[1]] = match[2] !== undefined ? match[2] : match[3];
    match = ATTRIBUTE.exec(source);
  }
  return attributes;
}

/**
 * The observations of a BDM answer (SDMX-ML structure specific data): 'YYYY-Qn' -> value, read from the
 * `<Obs TIME_PERIOD="2026-Q2" OBS_VALUE="138.01" .../>` elements. Entries that are not a quarter with a
 * finite positive value are skipped; an answer with none at all throws, so that an empty or unexpected
 * document is never taken for "nothing published".
 */
function parseObservations(xml) {
  if (typeof xml !== 'string') {
    throw new Error('Réponse INSEE inattendue');
  }
  const result = new Map();
  const withoutComments = xml.replace(/<!--[\s\S]*?-->/g, '');
  OBS_TAG.lastIndex = 0;
  let tag = OBS_TAG.exec(withoutComments);
  while (tag !== null) {
    const attributes = attributesOf(tag[1]);
    const period = String(attributes.TIME_PERIOD === undefined ? '' : attributes.TIME_PERIOD);
    const value = Number(attributes.OBS_VALUE);
    if (INSEE_PERIOD.test(period) && Number.isFinite(value) && value > 0) {
      result.set(period, value);
    }
    tag = OBS_TAG.exec(withoutComments);
  }
  if (result.size === 0) {
    throw new Error('Réponse INSEE inattendue');
  }
  return result;
}

module.exports = {
  REMINDER_DAYS_BEFORE,
  INSEE_SERIES,
  INSEE_BASE_URL,
  nextAnniversary,
  targetQuarter,
  toInseePeriod,
  proposeRent,
  probablePublication,
  revisionState,
  inseeUrl,
  parseObservations,
};
