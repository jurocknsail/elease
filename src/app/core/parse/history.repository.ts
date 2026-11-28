import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { RentCallLog, RentChange } from '../models/history';
import { INDEX_TYPES } from '../models/lease';
import { ParseClient } from './parse-client';
import { withTimeout } from './with-timeout';

export const SEND_CLASS = 'RentCallLog';
export const CHANGE_CLASS = 'RentChange';
/** Parse Server's own ceiling for one query: years of history for a few dozen leases. */
const MAX_ROWS = 1000;

type Json = Record<string, unknown>;

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const SOURCES = ['app', 'legacy', 'baseline'] as const;
const REASONS = ['create', 'edit', 'revision', 'baseline'] as const;

/** A row as the server stored it, or null when it is not usable (never shown half-read). */
export function rentCallLogFromParse(json: Json): RentCallLog | null {
  const leaseId = str(json['leaseId']);
  const period = str(json['period']);
  const sentAt = num(json['sentAt']);
  const total = num(json['total']);
  const source = SOURCES.find((s) => s === json['source']);
  if (
    !leaseId ||
    !period ||
    !/^\d{4}-\d{2}$/.test(period) ||
    sentAt === undefined ||
    total === undefined ||
    !source
  ) {
    return null;
  }
  return {
    leaseId,
    leaseName: str(json['leaseName']) ?? '',
    period,
    sentAt,
    source,
    price: num(json['price']) ?? 0,
    charge: num(json['charge']) ?? 0,
    tva: num(json['tva']) ?? 0,
    extras: num(json['extras']) ?? 0,
    total,
  };
}

export function rentChangeFromParse(json: Json): RentChange | null {
  const leaseId = str(json['leaseId']);
  const at = num(json['at']);
  const newPrice = num(json['newPrice']);
  const newTotal = num(json['newTotal']);
  const reason = REASONS.find((r) => r === json['reason']);
  if (!leaseId || at === undefined || newPrice === undefined || newTotal === undefined || !reason) {
    return null;
  }
  const change: RentChange = {
    leaseId,
    leaseName: str(json['leaseName']) ?? '',
    at,
    reason,
    newPrice,
    newTotal,
  };
  const indexType = INDEX_TYPES.find((t) => t === json['indexType']);
  const optional = {
    oldPrice: num(json['oldPrice']),
    oldTotal: num(json['oldTotal']),
    indexType,
    oldIndexQuarter: str(json['oldIndexQuarter']),
    oldIndexValue: num(json['oldIndexValue']),
    newIndexQuarter: str(json['newIndexQuarter']),
    newIndexValue: num(json['newIndexValue']),
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) {
      (change as unknown as Json)[key] = value;
    }
  }
  return change;
}

/**
 * The lease history (read-only). Kept in memory for the session; forgotten at sign-out.
 * A class that does not exist yet on the server (trigger not deployed) reads as empty.
 */
@Injectable({ providedIn: 'root' })
export class HistoryRepository {
  private readonly client = inject(ParseClient);
  private epoch = 0;

  readonly sends = signal<RentCallLog[]>([]);
  readonly changes = signal<RentChange[]>([]);

  constructor() {
    inject(AuthService).onLogout(() => this.reset());
  }

  reset(): void {
    this.epoch += 1;
    this.sends.set([]);
    this.changes.set([]);
  }

  async load(): Promise<void> {
    const epoch = this.epoch;
    const [sends, changes] = await Promise.all([
      withTimeout(this.client.query(SEND_CLASS).ascending('sentAt').limit(MAX_ROWS).find()),
      withTimeout(this.client.query(CHANGE_CLASS).ascending('at').limit(MAX_ROWS).find()),
    ]);
    if (epoch !== this.epoch) {
      return;
    }
    this.sends.set(sends.flatMap((o) => rentCallLogFromParse(o.toJSON()) ?? []));
    this.changes.set(changes.flatMap((o) => rentChangeFromParse(o.toJSON()) ?? []));
  }
}
