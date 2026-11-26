/** Rent index families: IRL (housing), ILC (shops/crafts), ILAT (offices and other activities). */
export type IndexType = 'IRL' | 'ILC' | 'ILAT';

export const INDEX_TYPES: readonly IndexType[] = ['IRL', 'ILC', 'ILAT'];

export interface AdditionalCharge {
  title: string;
  amount: number;
}

export interface Lease {
  objectId?: string;
  isPro: boolean;
  name: string;
  /** 0 or null: the lease has no lot number. */
  lot: number | null;
  streetNumber: number;
  streetName: string;
  optionalAddressInfo: string;
  postalCode: number;
  city: string;
  price: number;
  /** Null when the lease has no "Avance sur charges". */
  charge: number | null;
  additionalCharges: AdditionalCharge[];
  /** Milliseconds since the epoch, 0 = never sent. */
  lastSendDate: number;
  /** Billing period of the last rent call sent, 'YYYY-MM'. */
  lastSentPeriod?: string;
  /**
   * Milliseconds timestamp of the send that wrote `lastSentPeriod`: the new app saves it in the same
   * write as `lastSentPeriod`, equal to the `lastSendDate` it writes. The legacy app only rewrites
   * `lastSendDate`, so a `lastSendDate` that differs from this value is a later legacy send.
   */
  lastSentPeriodAt?: number;
  /** Anniversary date in milliseconds, null when not filled in yet. */
  renewalDate: number | null;
  indexType?: IndexType;
  /** Quarter of the reference index, 'YYYY-Tn'. */
  referenceIndexQuarter?: string;
  referenceIndexValue?: number;
  /** Anniversary ('YYYY-MM-DD', optionally suffixed ':pending') the revision reminder was sent for. */
  revisionReminderSentFor?: string;
}
