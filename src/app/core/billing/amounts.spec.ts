import { Lease } from '../models/lease';
import { computeTVA, computeTotalPrice } from './amounts';

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
