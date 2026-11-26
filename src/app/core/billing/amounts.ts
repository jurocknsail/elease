import { Lease } from '../models/lease';

/*
 * Single source of truth for what a rent call bills: the list screens and the PDF both use these.
 * They are a literal port of `computeTVA` / `computeTotalPrice` of the legacy
 * `src/app/tab-send/tab-send.page.ts` (branch main, lines 127-141). The order of the additions is
 * kept as is and nothing is rounded: floating-point results feed the PDF, whose JSON must equal
 * the legacy definition.
 */

/** VAT on the rent alone: 20 % (only billed for professional leases). */
export function computeTVA(lease: Lease): number {
  return lease.price * 0.2;
}

/** Total of the rent call: rent (+ VAT if professional) + charges advance + additional charges. */
export function computeTotalPrice(lease: Lease): number {
  const noChargesPrice = lease.isPro ? lease.price + computeTVA(lease) : lease.price;
  // The legacy test is `charge != null && charge != 0`. Here `!= null` also covers undefined and
  // `!== 0` is equivalent to the legacy `!= 0` for a number: a missing charge or 0 adds nothing.
  let totalPrice =
    lease.charge != null && lease.charge !== 0 ? noChargesPrice + lease.charge : noChargesPrice;

  if (lease.additionalCharges) {
    lease.additionalCharges.forEach((charge) => {
      totalPrice += charge.amount;
    });
  }

  return totalPrice;
}
