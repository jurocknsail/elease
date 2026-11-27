/**
 * Memory of the leases whose e-mail MAY have gone out without being recorded (a send whose outcome is
 * unknown, or one delivered but not recorded). Without it, a reload shows such a lease « À envoyer » and
 * preselected, one click away from a second e-mail to a real tenant.
 *
 * Kept in `localStorage` per user, billing period and lease, for 24 hours. Every access is guarded: a
 * private window or blocked storage simply means no memory, never an error. Entries of another user are
 * ignored and removed as soon as someone else signs in.
 */
export const MAYBE_SENT_KEY = 'elease.maybeSent.v1';
export const MAYBE_SENT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

interface Entry {
  user: string;
  period: string;
  id: string;
  at: number;
}

function isEntry(value: unknown): value is Entry {
  const entry = value as Partial<Entry> | null;
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof entry.user === 'string' &&
    typeof entry.period === 'string' &&
    typeof entry.id === 'string' &&
    typeof entry.at === 'number'
  );
}

/** The stored entries that are still valid, or none when storage is unreadable or corrupt. */
function load(now: number): Entry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(MAYBE_SENT_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is Entry => isEntry(entry) && now - entry.at < MAYBE_SENT_TTL_MS,
        )
      : [];
  } catch {
    return [];
  }
}

function save(entries: Entry[]): void {
  try {
    if (entries.length === 0) {
      localStorage.removeItem(MAYBE_SENT_KEY);
    } else {
      localStorage.setItem(MAYBE_SENT_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
    }
  } catch {
    // No storage: no memory.
  }
}

/** Lease ids flagged for this user and period. Expired entries, and those of other users, are purged. */
export function readMaybeSent(user: string, period: string, now: number): Set<string> {
  const entries = load(now);
  const mine = entries.filter((entry) => entry.user === user);
  if (mine.length !== entries.length) {
    save(mine);
  }
  return new Set(mine.filter((entry) => entry.period === period).map((entry) => entry.id));
}

/** Flags leases (their e-mail may have gone out). */
export function addMaybeSent(
  user: string,
  period: string,
  ids: readonly string[],
  now: number,
): void {
  const entries = load(now).filter(
    (entry) => entry.user === user && !(entry.period === period && ids.includes(entry.id)),
  );
  save([...entries, ...ids.map((id) => ({ user, period, id, at: now }))]);
}

/** Forgets leases (recorded as sent, or read as sent). */
export function removeMaybeSent(
  user: string,
  period: string,
  ids: readonly string[],
  now: number,
): void {
  const entries = load(now);
  const kept = entries.filter(
    (entry) => !(entry.user === user && entry.period === period && ids.includes(entry.id)),
  );
  if (kept.length !== entries.length) {
    save(kept);
  }
}
