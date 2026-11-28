import { IndexType } from './lease';

/**
 * History rows written by the server (Cloud Code trigger on `Lease`, see cloud/lib/history.js):
 * append-only, read-only for the app. They start on the day the trigger was deployed (and the
 * backfill job gave each lease a 'baseline' row).
 */

/** One rent call sent for one lease, with the amounts as they were that day. */
export interface RentCallLog {
  leaseId: string;
  leaseName: string;
  /** Billed period, 'YYYY-MM'. */
  period: string;
  /** Milliseconds since the epoch. */
  sentAt: number;
  source: 'app' | 'legacy' | 'baseline';
  price: number;
  charge: number;
  tva: number;
  extras: number;
  total: number;
}

/** One change of the amount billed for one lease. */
export interface RentChange {
  leaseId: string;
  leaseName: string;
  /** Milliseconds since the epoch. */
  at: number;
  reason: 'create' | 'edit' | 'revision' | 'baseline';
  oldPrice?: number;
  newPrice: number;
  oldTotal?: number;
  newTotal: number;
  indexType?: IndexType;
  oldIndexQuarter?: string;
  oldIndexValue?: number;
  newIndexQuarter?: string;
  newIndexValue?: number;
}
