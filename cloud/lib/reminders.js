'use strict';

const { billingPeriod, periodLabel, parisParts } = require('./periods');
const { computeTotalPrice, sumAmounts } = require('./amounts');
const { isSentForPeriod } = require('./send-status');
const {
  revisionState,
  toInseePeriod,
  probablePublication,
  targetQuarter,
} = require('./revision');
const { formatEuro, formatIndex, formatYmd, quarterLabel } = require('./format');

/*
 * The two reminder e-mails, pure: they only build { to, subject, text } for the OWNER. They never read a
 * tenant address, and the caller sends from the owner's address to the owner's address.
 */

const APP_URL = 'https://e-lease-app.smarthomeserver.online';
const MONTHLY_LINK = APP_URL + '/appels';
const REVISION_LINK = APP_URL + '/locataires';

/**
 * The month-end reminder: the leases whose rent call of the next month is still to send (same rule as the
 * app's "À envoyer"). `today` is the day of the reminder (the call date); the period is the following month.
 * Returns null when nothing is to send.
 *
 * @param {{ owner: {email: string, username?: string}, leases: Array<{holderName: string, lease: object}>, today: Date }} input
 */
function buildMonthlyReminder(input) {
  const period = billingPeriod(input.today);
  const todo = input.leases.filter((entry) => !isSentForPeriod(entry.lease, period));
  if (todo.length === 0) {
    return null;
  }
  const label = periodLabel(period);
  const count = todo.length;
  const totals = todo.map((entry) => computeTotalPrice(entry.lease));
  const lines = todo.map(
    (entry, i) => `- ${entry.lease.name || 'Bail'} (${entry.holderName || 'locataire'}) : ${formatEuro(totals[i])}`,
  );
  const subject =
    count === 1
      ? `1 appel de loyer à envoyer pour ${label}`
      : `${count} appels de loyer à envoyer pour ${label}`;
  const intro =
    count === 1
      ? `Un appel de loyer est à envoyer pour ${label} :`
      : `${count} appels de loyer sont à envoyer pour ${label} :`;
  const text = [
    'Bonjour,',
    '',
    intro,
    '',
    ...lines,
    '',
    `Total : ${formatEuro(sumAmounts(totals))}`,
    '',
    `Envoyer les appels : ${MONTHLY_LINK}`,
    '',
  ].join('\n');
  return { to: input.owner.email, subject, text };
}

function whenText(days) {
  if (days === 0) {
    return "aujourd'hui";
  }
  return days === 1 ? 'demain' : `dans ${days} jours`;
}

/**
 * The annual revision reminder for one lease whose anniversary is within the reminder window.
 * `newIndex` is the published value of the target quarter, absent while INSEE has not published it
 * (the mail then says so and gives the expected publication date: `publication`, a calendar date
 * { year, month, day } or a Date/epoch, computed from the index type when not given).
 * Throws when the lease has no revision in view on `today`.
 *
 * @param {{ owner: {email: string}, holderName: string, lease: object, today: Date, newIndex?: number, publication?: object }} input
 */
function buildRevisionReminder(input) {
  const { owner, holderName, lease, today } = input;
  const observations =
    input.newIndex !== undefined && lease.referenceIndexQuarter
      ? new Map([[toInseePeriod(targetQuarter(lease.referenceIndexQuarter)), input.newIndex]])
      : undefined;
  const state = revisionState(lease, today, observations);
  if (state.kind !== 'upcoming') {
    throw new Error('Aucune révision à annoncer pour ce bail');
  }
  const leaseName = lease.name || 'Bail';
  const anniversary = formatYmd(state.anniversary);
  const subject = `Révision du loyer — ${leaseName} — ${anniversary}`;
  const quarter = quarterLabel(state.targetQuarter);
  const head = [
    'Bonjour,',
    '',
    'Une révision annuelle de loyer approche.',
    '',
    `Bail : ${leaseName}`,
    `Locataire : ${holderName || '—'}`,
    `Date anniversaire : ${anniversary} (${whenText(state.days)})`,
    `Indice applicable : ${lease.indexType} ${quarter}`,
  ];
  let body;
  if (state.newIndex !== undefined) {
    body = [
      `Indice : ${formatIndex(lease.referenceIndexValue)} (${quarterLabel(lease.referenceIndexQuarter)}) → ${formatIndex(state.newIndex)} (${quarter})`,
      `Loyer hors charges : ${formatEuro(lease.price)} → ${formatEuro(state.proposedRent)}`,
      '',
      "Rien n'est appliqué automatiquement. Pour que le nouveau loyer figure dans l'appel du mois qui précède l'anniversaire, ouvrez le bail dans l'application et appliquez la révision.",
    ];
  } else {
    const given = input.publication;
    const publication = given
      ? given.year !== undefined
        ? given
        : parisParts(given)
      : state.publication || probablePublication(lease.indexType, state.targetQuarter);
    body = [
      `Indice de référence : ${formatIndex(lease.referenceIndexValue)} (${quarterLabel(lease.referenceIndexQuarter)})`,
      `Loyer actuel hors charges : ${formatEuro(lease.price)}`,
      '',
      `L'indice ${lease.indexType} ${quarter} n'est pas encore publié par l'INSEE (publication probable le ${formatYmd(publication)}).`,
      'Vous recevrez un nouveau message avec le loyer proposé dès sa publication.',
    ];
  }
  const text = [...head, ...body, '', `Application : ${REVISION_LINK}`, ''].join('\n');
  return { to: owner.email, subject, text };
}

module.exports = { MONTHLY_LINK, REVISION_LINK, buildMonthlyReminder, buildRevisionReminder };
