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

/**
 * An amount in whole cents, rounded exactly as the PDF prints it (`toFixed(2)`) and as `formatEuro`
 * shows it. Add THESE integers, never the raw floats: a total built from unrounded amounts can differ
 * by a cent or two from the sum of the rows a person reads (three professional leases at 1091.08 each
 * bill 1309.296 and print 1 309,30 €, but their raw sum 3927.888 prints 3 927,89 € instead of 3 927,90 €).
 *
 * An amount that is not a finite number counts as 0 (the screens show it as a dash, so it adds nothing
 * to what is displayed); the result is never `-0`. `computeTotalPrice` itself is left as it is: the PDF
 * must stay identical to the legacy one.
 */
export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) {
    return 0;
  }
  // `|| 0` turns -0 (from a tiny negative amount) into 0.
  return Math.round(Number(amount.toFixed(2)) * 100) || 0;
}

/**
 * The sum of amounts as the owner adds them up by hand: each amount rounded to the cent first (`toCents`),
 * the integers added (exact), then converted back to euros. One rule for the month total of the home
 * screen, the total of the selection on the send screen and the total of the reminder e-mail.
 */
export function sumAmounts(amounts: readonly number[]): number {
  let cents = 0;
  for (const amount of amounts) {
    cents += toCents(amount);
  }
  return cents / 100;
}
