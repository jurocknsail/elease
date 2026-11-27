import {
  MAYBE_SENT_KEY,
  MAYBE_SENT_TTL_MS,
  addMaybeSent,
  readMaybeSent,
  removeMaybeSent,
} from './maybe-sent';

const T0 = 1_800_000_000_000;

describe('maybe-sent memory', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('remembers leases per user and period', () => {
    addMaybeSent('julien', '2026-12', ['l1', 'l2'], T0);

    expect([...readMaybeSent('julien', '2026-12', T0 + 1000)].sort()).toEqual(['l1', 'l2']);
    expect(readMaybeSent('julien', '2027-01', T0 + 1000).size).toBe(0);
  });

  it('ignores, and removes, the entries of another user', () => {
    addMaybeSent('julien', '2026-12', ['l1'], T0);

    expect(readMaybeSent('autre', '2026-12', T0 + 1000).size).toBe(0);
    expect(localStorage.getItem(MAYBE_SENT_KEY)).toBeNull();
  });

  it('ignores an entry older than 24 hours', () => {
    addMaybeSent('julien', '2026-12', ['l1'], T0);

    expect(readMaybeSent('julien', '2026-12', T0 + MAYBE_SENT_TTL_MS - 1).size).toBe(1);
    expect(readMaybeSent('julien', '2026-12', T0 + MAYBE_SENT_TTL_MS).size).toBe(0);
  });

  it('forgets leases that were recorded', () => {
    addMaybeSent('julien', '2026-12', ['l1', 'l2'], T0);

    removeMaybeSent('julien', '2026-12', ['l1'], T0 + 1000);

    expect([...readMaybeSent('julien', '2026-12', T0 + 1000)]).toEqual(['l2']);
  });

  it('survives corrupt data and a storage that throws', () => {
    localStorage.setItem(MAYBE_SENT_KEY, '{not json');
    expect(readMaybeSent('julien', '2026-12', T0).size).toBe(0);
    localStorage.setItem(MAYBE_SENT_KEY, JSON.stringify([{ nope: 1 }, 'x']));
    expect(readMaybeSent('julien', '2026-12', T0).size).toBe(0);

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => addMaybeSent('julien', '2026-12', ['l1'], T0)).not.toThrow();
    expect(() => removeMaybeSent('julien', '2026-12', ['l1'], T0)).not.toThrow();
    expect(readMaybeSent('julien', '2026-12', T0).size).toBe(0);
  });
});
