import { rentCallLogFromParse, rentChangeFromParse } from './history.repository';

describe('history mapping', () => {
  it('reads a send row and refuses an incomplete one', () => {
    expect(
      rentCallLogFromParse({
        leaseId: 'L1',
        leaseName: 'Studio',
        period: '2026-12',
        sentAt: 5,
        source: 'legacy',
        total: 1000,
        price: 1000,
      }),
    ).toEqual({
      leaseId: 'L1',
      leaseName: 'Studio',
      period: '2026-12',
      sentAt: 5,
      source: 'legacy',
      price: 1000,
      charge: 0,
      tva: 0,
      extras: 0,
      total: 1000,
    });
    expect(
      rentCallLogFromParse({
        leaseId: 'L1',
        period: '12/2026',
        sentAt: 5,
        source: 'app',
        total: 1,
      }),
    ).toBeNull();
    expect(
      rentCallLogFromParse({
        leaseId: 'L1',
        period: '2026-12',
        sentAt: 5,
        source: 'other',
        total: 1,
      }),
    ).toBeNull();
  });

  it('reads a change row, optional fields only when present', () => {
    expect(
      rentChangeFromParse({
        leaseId: 'L1',
        at: 3,
        reason: 'revision',
        newPrice: 1032.3,
        newTotal: 1238.76,
        oldPrice: 1000,
        indexType: 'ILAT',
        newIndexQuarter: '2026-T2',
      }),
    ).toEqual({
      leaseId: 'L1',
      leaseName: '',
      at: 3,
      reason: 'revision',
      newPrice: 1032.3,
      newTotal: 1238.76,
      oldPrice: 1000,
      indexType: 'ILAT',
      newIndexQuarter: '2026-T2',
    });
    expect(rentChangeFromParse({ leaseId: 'L1', at: 3, reason: 'revision' })).toBeNull();
  });
});
