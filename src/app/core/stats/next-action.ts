import { isSentForPeriod } from '../billing/send-status';
import { BillingPeriod, periodLabel } from '../billing/period';
import { Lease } from '../models/lease';
import { Leaseholder } from '../models/leaseholder';
import { REMINDER_DAYS_BEFORE, nextAnniversary } from '../revision/revision';
import { currentPeriod } from './stats';

/**
 * The one next thing the owner has to do, in one sentence (the discreet hint at the top of the app).
 * Pure: holders and today in, sentence out. Priority:
 *  1. calls of the coming period still to send, from the 25th: do it now;
 *  2. a rent revision whose anniversary comes before the next calls;
 *  3. the next calls (the 25th), with or without calls already sent.
 */
export interface NextAction {
  /** Identifies the sentence: a dismissed hint stays hidden until its sentence changes. */
  id: string;
  tone: 'todo' | 'info';
  text: string;
  link?: { label: string; path: string; fragment?: string };
}

const REMINDER_DAY = 25;
const MS_PER_DAY = 86_400_000;

const DAY_MONTH = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function days(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);
}

function callsLabel(n: number): string {
  return `${n} ${n === 1 ? 'appel' : 'appels'} de loyer`;
}

function nextRevision(
  holders: readonly Leaseholder[],
  today: Date,
): { holder: Leaseholder; lease: Lease; date: Date; inDays: number } | null {
  let best: { holder: Leaseholder; lease: Lease; date: Date; inDays: number } | null = null;
  for (const holder of holders) {
    for (const lease of holder.leases) {
      if (lease.renewalDate == null || !Number.isFinite(lease.renewalDate) || !lease.indexType) {
        continue;
      }
      const date = nextAnniversary(lease.renewalDate, today);
      const inDays = days(today, date);
      if (inDays <= REMINDER_DAYS_BEFORE && (!best || inDays < best.inDays)) {
        best = { holder, lease, date, inDays };
      }
    }
  }
  return best;
}

export function nextAction(holders: readonly Leaseholder[], today: Date): NextAction | null {
  const leases = holders.flatMap((h) => h.leases);
  if (leases.length === 0) {
    return null;
  }
  const period: BillingPeriod = currentPeriod(today);
  const month = periodLabel(period);
  const todo = leases.filter((lease) => !isSentForPeriod(lease, period)).length;
  const callDay = new Date(today.getFullYear(), today.getMonth(), REMINDER_DAY);
  const appels = { label: 'Voir les appels', path: '/appels' };

  if (todo > 0 && today.getDate() >= REMINDER_DAY) {
    return {
      id: `send-now:${period.year}-${period.month}:${todo}`,
      tone: 'todo',
      text: `À faire : envoyer ${callsLabel(todo)} de ${month}. Un rappel vous est envoyé par e-mail chaque matin tant que ce n'est pas fait.`,
      link: { label: 'Envoyer', path: '/appels' },
    };
  }

  // The next calls: the 25th of this month when some are still to send, otherwise of next month.
  const nextCallDay =
    todo > 0 ? callDay : new Date(today.getFullYear(), today.getMonth() + 1, REMINDER_DAY);
  const revision = nextRevision(holders, today);
  if (revision && revision.date.getTime() <= nextCallDay.getTime()) {
    const when = revision.inDays === 0 ? "aujourd'hui" : `le ${DAY_MONTH.format(revision.date)}`;
    return {
      id: `revision:${revision.lease.objectId}:${revision.date.getTime()}`,
      tone: 'info',
      text: `Prochaine étape : révision du loyer « ${revision.lease.name || 'Bail sans nom'} » ${when}. Un rappel vous est envoyé par e-mail 45 jours avant.`,
      link: revision.holder.objectId
        ? {
            label: 'Voir le bail',
            path: `/locataires/${revision.holder.objectId}`,
            fragment: revision.lease.objectId ? `bail-${revision.lease.objectId}` : undefined,
          }
        : undefined,
    };
  }

  if (todo > 0) {
    return {
      id: `send-on:${period.year}-${period.month}`,
      tone: 'info',
      text: `Prochaine étape : envoyer les appels de ${month} le ${DAY_MONTH.format(callDay)}. Un rappel vous sera envoyé par e-mail.`,
      link: appels,
    };
  }
  const following = periodLabel(currentPeriod(nextCallDay));
  return {
    id: `all-sent:${period.year}-${period.month}`,
    tone: 'info',
    text: `Tous les appels de ${month} sont envoyés. Prochaine étape : les appels de ${following}, le ${DAY_MONTH.format(nextCallDay)}.`,
  };
}
