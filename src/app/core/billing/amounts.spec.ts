import { Lease } from '../models/lease';
import { computeTVA, computeTotalPrice, sumAmounts, toCents } from './amounts';

function lease(overrides: Partial<Lease> = {}): Lease {
  return {
    isPro: false,
    name: 'Bail test',
    lot: null,
    streetNumber: 1,
    streetName: 'rue des Tests',
    optionalAddressInfo: '',
    postalCode: 13600,
    city: 'La Ciotat',
    price: 0,
    charge: null,
    additionalCharges: [],
    lastSendDate: 0,
    renewalDate: null,
    ...overrides,
  };
}

/** The legacy `computeTVA()` of `tab-send.page.ts` (main), verbatim. */
function legacyComputeTVA(l: Lease): number {
  return l.price * 0.2;
}

/** The legacy `computeTotalPrice()` of `tab-send.page.ts` (main), verbatim. */
function legacyComputeTotalPrice(l: Lease): number {
  const noChargesPrice = l.isPro ? l.price + legacyComputeTVA(l) : l.price;
  let totalPrice = l.charge != null && l.charge != 0 ? noChargesPrice + l.charge : noChargesPrice;

  if (l.additionalCharges) {
    l.additionalCharges.forEach((charge) => {
      totalPrice += charge.amount;
    });
  }

  return totalPrice;
}

describe('computeTVA', () => {
  it('is 20 % of the rent', () => {
    expect(computeTVA(lease({ price: 1234 }))).toBeCloseTo(246.8, 10);
    expect(computeTVA(lease({ price: 1000 }))).toBe(200);
  });

  it('does not round (the PDF prints it with toFixed(2) itself)', () => {
    expect(computeTVA(lease({ price: 1234 }))).toBe(1234 * 0.2);
    expect(computeTVA(lease({ price: 333.33 }))).toBe(333.33 * 0.2);
  });

  it('does not depend on isPro (only the total does)', () => {
    expect(computeTVA(lease({ isPro: false, price: 500 }))).toBe(100);
    expect(computeTVA(lease({ isPro: true, price: 500 }))).toBe(100);
  });
});

describe('computeTotalPrice', () => {
  it('adds the TVA on the rent for a professional lease: rent + TVA + charge + extras', () => {
    const l = lease({
      isPro: true,
      price: 1234,
      charge: 123,
      additionalCharges: [{ title: 'Parking', amount: 50 }],
    });

    expect(computeTVA(l)).toBeCloseTo(246.8, 10);
    expect(computeTotalPrice(l)).toBeCloseTo(1653.8, 10);
  });

  it('has no TVA for a residential lease', () => {
    expect(computeTotalPrice(lease({ isPro: false, price: 300, charge: null }))).toBe(300);
    expect(computeTotalPrice(lease({ isPro: false, price: 300, charge: 40 }))).toBe(340);
  });

  it('ignores a null or zero charge', () => {
    expect(computeTotalPrice(lease({ isPro: true, price: 1000, charge: null }))).toBe(1200);
    expect(computeTotalPrice(lease({ isPro: true, price: 1000, charge: 0 }))).toBe(1200);
  });

  it('adds every additional charge, a negative one being a discount', () => {
    const l = lease({
      price: 100,
      additionalCharges: [
        { title: 'Parking', amount: 30 },
        { title: 'Remise', amount: -10 },
      ],
    });

    expect(computeTotalPrice(l)).toBe(120);
  });

  it('is the bare rent when there is nothing else', () => {
    expect(computeTotalPrice(lease({ price: 750 }))).toBe(750);
  });

  it('accumulates in the legacy order, so the floating-point result is the legacy one', () => {
    // ((0.1 + 0.2) + 0.3) = 0.6000000000000001 whereas 0.1 + (0.2 + 0.3) = 0.6.
    const l = lease({
      price: 0.1,
      additionalCharges: [
        { title: 'A', amount: 0.2 },
        { title: 'B', amount: 0.3 },
      ],
    });

    expect(computeTotalPrice(l)).toBe(0.6000000000000001);
    expect(computeTotalPrice(l)).toBe(legacyComputeTotalPrice(l));
  });

  it('gives exactly the legacy result (Object.is) on a grid of real-looking leases', () => {
    const prices = [0, 300, 333.33, 1234, 1899.99, 2450.5];
    const charges: (number | null)[] = [null, 0, 12.34, 123, 99.99];
    const extras = [
      [],
      [{ title: 'A', amount: 50 }],
      [
        { title: 'A', amount: 0.1 },
        { title: 'B', amount: 0.2 },
        { title: 'C', amount: 19.99 },
      ],
      [
        { title: 'A', amount: 33.33 },
        { title: 'B', amount: -7.77 },
      ],
    ];

    for (const isPro of [true, false]) {
      for (const price of prices) {
        for (const charge of charges) {
          for (const additionalCharges of extras) {
            const l = lease({ isPro, price, charge, additionalCharges });

            expect(Object.is(computeTotalPrice(l), legacyComputeTotalPrice(l))).toBe(true);
            expect(Object.is(computeTVA(l), legacyComputeTVA(l))).toBe(true);
          }
        }
      }
    }
  });

  it('does not modify the lease', () => {
    const l = lease({
      isPro: true,
      price: 1234,
      charge: 123,
      additionalCharges: [{ title: 'A', amount: 5 }],
    });
    const before = JSON.stringify(l);

    computeTotalPrice(l);
    computeTVA(l);

    expect(JSON.stringify(l)).toBe(before);
  });
});

describe('toCents', () => {
  it('rounds to whole cents exactly as the PDF prints the amount (toFixed(2))', () => {
    // 1.005 is stored as 1.00499999999999989...: the PDF prints 1.00, so it is 100 cents.
    expect(toCents(1.005)).toBe(100);
    // 0.125 is exact in binary: toFixed rounds the tie up.
    expect(toCents(0.125)).toBe(13);
    expect(toCents(1309.304)).toBe(130930);
    expect(toCents(1309.296)).toBe(130930);
    expect(toCents(2.675)).toBe(267);
  });

  it('is exact for amounts that already have at most two decimals', () => {
    expect(toCents(600)).toBe(60000);
    expect(toCents(1653.8)).toBe(165380);
    expect(toCents(0.07)).toBe(7);
    expect(toCents(19.99)).toBe(1999);
    expect(toCents(1090.1)).toBe(109010);
  });

  it('is 0 for zero and for minus zero (never -0)', () => {
    expect(toCents(0)).toBe(0);
    expect(Object.is(toCents(-0), 0)).toBe(true);
    expect(Object.is(toCents(-0.001), 0)).toBe(true);
  });

  it('keeps the sign for negative amounts, rounding the same way', () => {
    expect(toCents(-1.005)).toBe(-100);
    expect(toCents(-0.125)).toBe(-13);
    expect(toCents(-12.5)).toBe(-1250);
    expect(toCents(-1309.304)).toBe(-130930);
  });

  it('handles large amounts', () => {
    expect(toCents(123456789.12)).toBe(12345678912);
    expect(toCents(1e12)).toBe(1e14);
    // A six-figure rent call: 98765.43 + 20 % VAT + 1234.56 of charges.
    const big = 98765.43 * 1.2 + 1234.56;
    expect(toCents(big)).toBe(Number(big.toFixed(2).replace('.', '')));
  });

  it('counts an amount that is not a number as nothing (the screens show it as a dash)', () => {
    expect(toCents(NaN)).toBe(0);
    expect(toCents(Infinity)).toBe(0);
    expect(toCents(-Infinity)).toBe(0);
  });

  it('always gives an integer, equal to the printed digits, for many pseudo-random amounts', () => {
    // Small deterministic generator: the same amounts on every run.
    let seed = 20261125;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let i = 0; i < 5000; i++) {
      const amount =
        next() * 10 ** Math.floor(next() * 7) * (next() < 0.5 ? 1 : 1.2) + next() / 1000;
      const cents = toCents(amount);
      expect(Number.isInteger(cents)).toBe(true);
      expect(cents).toBe(Number(amount.toFixed(2).replace('.', '')));
    }
  });
});

describe('sumAmounts', () => {
  it('is 0 without amounts', () => {
    expect(sumAmounts([])).toBe(0);
  });

  it('adds the amounts as they are printed: each one rounded to the cent first', () => {
    // Three professional leases at 1091.08: each bills 1309.296, printed 1 309,30.
    const each = computeTotalPrice(lease({ isPro: true, price: 1091.08 }));
    expect(each.toFixed(2)).toBe('1309.30');
    expect(sumAmounts([each, each, each])).toBe(3927.9);
    // The plain float sum would be 3927.888 (3 927,89 once printed): one cent short of the three rows.
    expect(each + each + each).not.toBe(3927.9);
  });

  it('does not carry the float noise of 0.1 + 0.2', () => {
    expect(sumAmounts([0.1, 0.2])).toBe(0.3);
  });

  it('does not depend on the order', () => {
    const amounts = [1309.296, 0.125, 2.675, 99.994, 1.005, 600, 0.1, 0.2];
    const reversed = [...amounts].reverse();
    expect(sumAmounts(reversed)).toBe(sumAmounts(amounts));
  });

  it('ignores an amount that is not a number instead of turning the total into NaN', () => {
    expect(sumAmounts([NaN, 100.5, Infinity])).toBe(100.5);
  });
});
