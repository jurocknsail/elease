'use strict';

/*
 * What a rent call bills, ported from src/app/core/billing/amounts.ts (itself a literal port of the legacy
 * computeTVA / computeTotalPrice). The order of the additions is kept and nothing is rounded here.
 */

/** VAT on the rent alone: 20 % (only billed for professional leases). */
function computeTVA(lease) {
  return lease.price * 0.2;
}

/** Total of the rent call: rent (+ VAT if professional) + charges advance + additional charges. */
function computeTotalPrice(lease) {
  const noChargesPrice = lease.isPro ? lease.price + computeTVA(lease) : lease.price;
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
 * An amount in whole cents, rounded exactly as the PDF prints it (toFixed(2)). Add THESE integers, never the
 * raw floats: three professional leases at 1091.08 bill 1309.296 each and print 1 309,30 €; their raw sum
 * 3927.888 would print 3 927,89 € instead of 3 927,90 €. A non-finite amount counts as 0; never -0.
 */
function toCents(amount) {
  if (!Number.isFinite(amount)) {
    return 0;
  }
  return Math.round(Number(amount.toFixed(2)) * 100) || 0;
}

/** The sum of amounts as the owner adds them by hand: cents first, integers added, back to euros. */
function sumAmounts(amounts) {
  let cents = 0;
  for (const amount of amounts) {
    cents += toCents(amount);
  }
  return cents / 100;
}

module.exports = { computeTVA, computeTotalPrice, toCents, sumAmounts };
