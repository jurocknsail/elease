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
  it('is 20 % of the rent, unrounded (the PDF prints it with toFixed(2) itself), whatever isPro', () => {
    expect(computeTVA(lease({ price: 1234 }))).toBeCloseTo(246.8, 10);
    expect(computeTVA(lease({ price: 333.33 }))).toBe(333.33 * 0.2);
    expect(computeTVA(lease({ isPro: true, price: 500 }))).toBe(100);
    expect(computeTVA(lease({ isPro: false, price: 500 }))).toBe(100);
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

    expect(computeTotalPrice(l)).toBeCloseTo(1653.8, 10);
  });

  it('has no TVA for a residential lease, and ignores a null or zero charge', () => {
    expect(computeTotalPrice(lease({ isPro: false, price: 300, charge: 40 }))).toBe(340);
    expect(computeTotalPrice(lease({ isPro: false, price: 300, charge: null }))).toBe(300);
    expect(computeTotalPrice(lease({ isPro: true, price: 1000, charge: 0 }))).toBe(1200);
  });

  it('accumulates in the legacy order, so the floating-point result is the legacy one', () => {
    // ((0.1 + 0.2) + 0.3) = 0.6000000000000001 whereas 0.1 + (0.2 + 0.3) = 0.6.
    const float = lease({
      price: 0.1,
      additionalCharges: [
        { title: 'A', amount: 0.2 },
        { title: 'B', amount: 0.3 },
      ],
    });
    expect(computeTotalPrice(float)).toBe(0.6000000000000001);

    const pro = lease({
      isPro: true,
      price: 1899.99,
      charge: 12.34,
      additionalCharges: [
        { title: 'A', amount: 33.33 },
        { title: 'B', amount: -7.77 },
      ],
    });
    for (const l of [float, pro, lease({ price: 333.33, charge: 99.99 })]) {
      expect(Object.is(computeTotalPrice(l), legacyComputeTotalPrice(l))).toBe(true);
      expect(Object.is(computeTVA(l), legacyComputeTVA(l))).toBe(true);
    }
  });
});

describe('toCents', () => {
  it('rounds to whole cents exactly as the PDF prints the amount (toFixed(2)), sign included', () => {
    // 1.005 is stored as 1.00499999999999989...: the PDF prints 1.00, so it is 100 cents.
    expect(toCents(1.005)).toBe(100);
    // 0.125 is exact in binary: toFixed rounds the tie up.
    expect(toCents(0.125)).toBe(13);
    expect(toCents(1309.296)).toBe(130930);
    expect(toCents(1653.8)).toBe(165380);
    expect(toCents(-1.005)).toBe(-100);
    expect(toCents(-1309.304)).toBe(-130930);
    expect(toCents(123456789.12)).toBe(12345678912);
  });

  it('is 0 for minus zero and for a value that is not a number (the screens show it as a dash)', () => {
    expect(Object.is(toCents(-0), 0)).toBe(true);
    expect(Object.is(toCents(-0.001), 0)).toBe(true);
    expect(toCents(NaN)).toBe(0);
    expect(toCents(Infinity)).toBe(0);
  });
});

describe('sumAmounts', () => {
  it('adds the amounts as they are printed: each one rounded to the cent first (3 pro leases of 1091.08)', () => {
    // Each bills 1309.296, printed 1 309,30.
    const each = computeTotalPrice(lease({ isPro: true, price: 1091.08 }));
    expect(each.toFixed(2)).toBe('1309.30');
    expect(sumAmounts([each, each, each])).toBe(3927.9);
    // The plain float sum would be 3927.888 (3 927,89 once printed): one cent short of the three rows.
    expect(each + each + each).not.toBe(3927.9);
  });

  it('is 0 without amounts, has no float noise, and ignores an amount that is not a number', () => {
    expect(sumAmounts([])).toBe(0);
    expect(sumAmounts([0.1, 0.2])).toBe(0.3);
    expect(sumAmounts([NaN, 100.5, Infinity])).toBe(100.5);
  });
});
