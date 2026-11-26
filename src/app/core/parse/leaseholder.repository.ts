import { Injectable, Signal, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { SessionErrorHandler } from '../auth/session-error';
import { Lease } from '../models/lease';
import { Leaseholder } from '../models/leaseholder';
import { leaseFromParse, leaseholderFromParse, writeLeaseFields } from './mapping';
import { OBJECT_NOT_FOUND, ParseClient, RemoteObject } from './parse-client';
import { BackendTimeoutError, withTimeout } from './with-timeout';

const HOLDER_CLASS = 'Leaseholder';
const LEASE_CLASS = 'Lease';
/** Parse's maximum page size; far above the ~7 holders of an account. */
const MAX_HOLDERS = 1000;

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === OBJECT_NOT_FOUND
  );
}

function isRemoteObject(value: unknown): value is RemoteObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as RemoteObject).destroy === 'function'
  );
}

/**
 * Leaseholders and their leases on Back4App, same layout as the legacy app: class `Leaseholder`
 * (`name`, `email`, `phone`, `leases`: array of pointers to `Lease`) and class `Lease`; every object
 * created gets an ACL readable and writable by the signed-in user only.
 *
 * `leaseholders` mirrors the server: it only changes after a call succeeded, from what the server
 * returned. On failure the state is left as it was and the error is rethrown as received (Parse errors
 * unchanged, a `BackendTimeoutError` when Back4App does not answer within 20 s).
 */
@Injectable({ providedIn: 'root' })
export class LeaseholderRepository {
  private readonly client = inject(ParseClient);
  private readonly session = inject(SessionErrorHandler);
  private readonly state = signal<Leaseholder[]>([]);
  /** Bumped at every sign-out: an answer that arrives for an older session is dropped. */
  private epoch = 0;

  readonly leaseholders: Signal<Leaseholder[]> = this.state.asReadonly();

  constructor() {
    inject(AuthService).onLogout(() => this.reset());
  }

  /**
   * Forgets everything held in memory. Runs at every sign-out, so another account signing in on the
   * same device never sees stale data, and an answer still in flight for the previous session is not
   * kept either.
   */
  reset(): void {
    this.epoch += 1;
    this.state.set([]);
  }

  async load(): Promise<void> {
    return this.guarded(async () => {
      const epoch = this.epoch;
      const objects = await withTimeout(
        this.client
          .query(HOLDER_CLASS)
          .include('leases')
          .ascending('createdAt')
          .limit(MAX_HOLDERS)
          .find(),
      );
      if (epoch !== this.epoch) {
        // Signed out while waiting: this answer belongs to the previous session.
        return;
      }
      this.state.set(objects.map((object) => leaseholderFromParse(object.toJSON())));
    });
  }

  async createLeaseholder(input: Omit<Leaseholder, 'objectId' | 'leases'>): Promise<Leaseholder> {
    return this.guarded(async () => {
      const epoch = this.epoch;
      const object = this.client.newObject(HOLDER_CLASS);
      object.set('name', input.name);
      object.set('email', input.email);
      object.set('phone', input.phone);
      object.set('leases', []);
      object.setACL(this.client.ownerAcl());
      const saved = await withTimeout(object.save());
      const holder = leaseholderFromParse(saved.toJSON());
      if (epoch === this.epoch) {
        this.state.update((list) => [...list, holder]);
      }
      return holder;
    });
  }

  async updateContact(
    id: string,
    contact: { name: string; email: string; phone: string },
  ): Promise<void> {
    return this.guarded(async () => {
      const object = await withTimeout(this.client.fetchById(HOLDER_CLASS, id));
      object.set('name', contact.name);
      object.set('email', contact.email);
      object.set('phone', contact.phone);
      const saved = await withTimeout(object.save());
      const { name, email, phone } = leaseholderFromParse(saved.toJSON());
      this.state.update((list) =>
        list.map((holder) => (holder.objectId === id ? { ...holder, name, email, phone } : holder)),
      );
    });
  }

  async addLease(holderId: string, lease: Lease): Promise<Lease> {
    return this.guarded(async () => {
      // Fetched first: no lease is created for a holder that does not exist or is not readable.
      const holder = await withTimeout(this.client.fetchById(HOLDER_CLASS, holderId));

      const object = this.client.newObject(LEASE_CLASS);
      // Creating (also the restore path): the bookkeeping fields are part of what is stored.
      writeLeaseFields(object, lease, { bookkeeping: true });
      object.setACL(this.client.ownerAcl());
      const savedLease = await withTimeout(object.save());

      try {
        // Atomic append of a pointer: the other leases of the holder are not rewritten.
        holder.addUnique('leases', savedLease);
        await withTimeout(holder.save());
      } catch (error) {
        // Never leave an orphan lease behind. After a timeout the link may still land, so the lease is
        // not deleted then: it could be live.
        if (!(error instanceof BackendTimeoutError)) {
          await this.discard(savedLease);
        }
        throw error;
      }

      const created = leaseFromParse(savedLease.toJSON());
      this.state.update((list) =>
        list.map((h) => (h.objectId === holderId ? { ...h, leases: [...h.leases, created] } : h)),
      );
      return created;
    });
  }

  /**
   * Saves an edit. Only what the user changed is written: the lease is compared with the version in
   * the state, and `lastSendDate`, `lastSentPeriod`, `lastSentPeriodAt` and `revisionReminderSentFor`
   * are never written (only `markLeasesSent` and the cloud job record them), so a stale copy cannot
   * erase what another device or a reminder recorded. The state then shows the server's version of the lease.
   */
  async updateLease(lease: Lease): Promise<void> {
    return this.guarded(async () => {
      if (!lease.objectId) {
        throw new Error('Bail sans identifiant : enregistrement impossible.');
      }
      const base = this.state()
        .flatMap((holder) => holder.leases)
        .find((candidate) => candidate.objectId === lease.objectId);
      const object = await withTimeout(this.client.fetchById(LEASE_CLASS, lease.objectId));
      const changed = writeLeaseFields(object, lease, { bookkeeping: false, base });
      const result = changed ? await withTimeout(object.save()) : object;
      this.replaceLease(leaseFromParse(result.toJSON()));
    });
  }

  /**
   * Unlinks the lease from the holder, then deletes it. Safe to retry: removing an absent pointer and
   * deleting an already deleted lease both count as done. If the lease cannot be deleted the pointer
   * is put back, so no invisible lease is left behind.
   */
  async deleteLease(holderId: string, leaseId: string): Promise<void> {
    return this.guarded(async () => {
      const holder = await withTimeout(this.client.fetchById(HOLDER_CLASS, holderId));

      // Never destroy a lease of another holder. It must still be linked on the server, or be known
      // under this holder in the state (a retry after a timeout: the unlink already went through).
      const linked = holder.get('leases');
      const isLinked =
        Array.isArray(linked) && linked.some((ref) => isRemoteObject(ref) && ref.id === leaseId);
      const isKnown = this.state()
        .find((candidate) => candidate.objectId === holderId)
        ?.leases.some((candidate) => candidate.objectId === leaseId);
      if (!isLinked && !isKnown) {
        throw new Error("Ce bail n'appartient pas à ce locataire : suppression impossible.");
      }

      const lease = this.client.objectRef(LEASE_CLASS, leaseId);
      holder.remove('leases', lease);
      await withTimeout(holder.save());

      try {
        await withTimeout(lease.destroy());
      } catch (error) {
        if (!isNotFound(error)) {
          if (!(error instanceof BackendTimeoutError)) {
            await this.relink(holder, lease);
          }
          throw error;
        }
      }

      this.state.update((list) =>
        list.map((h) =>
          h.objectId === holderId
            ? { ...h, leases: h.leases.filter((l) => l.objectId !== leaseId) }
            : h,
        ),
      );
    });
  }

  /**
   * Deletes the holder together with all its leases (the legacy app swallowed lease deletion errors
   * and left orphans). Leases go first and any failure stops everything before the holder is touched,
   * so the holder still references what remains and the call can simply be retried: a lease that is
   * already gone counts as deleted, and so does an already deleted holder.
   */
  async deleteLeaseholder(id: string): Promise<void> {
    return this.guarded(async () => {
      let holder: RemoteObject;
      try {
        holder = await withTimeout(this.client.fetchById(HOLDER_CLASS, id));
      } catch (error) {
        if (isNotFound(error)) {
          this.removeHolder(id);
          return;
        }
        throw error;
      }

      const stored = holder.get('leases');
      const leases = Array.isArray(stored) ? stored.filter(isRemoteObject) : [];
      const results = await Promise.allSettled(leases.map((lease) => withTimeout(lease.destroy())));
      const failure = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected' && !isNotFound(result.reason),
      );
      if (failure) {
        throw failure.reason;
      }

      await withTimeout(holder.destroy());
      this.removeHolder(id);
    });
  }

  /**
   * Records that the rent calls of these leases were sent: `lastSendDate`, `lastSentPeriod` and
   * `lastSentPeriodAt` (equal to `lastSendDate`, so a later legacy send, which only rewrites
   * `lastSendDate`, can be told apart), all in the same save and nothing else.
   */
  async markLeasesSent(leaseIds: string[], periodKey: string, at: number): Promise<void> {
    return this.guarded(async () => {
      // Each lease on its own: those that succeed are saved and shown as sent even if another fails.
      const results = await Promise.allSettled(
        leaseIds.map(async (id) => {
          const object = await withTimeout(this.client.fetchById(LEASE_CLASS, id));
          object.set('lastSendDate', at);
          object.set('lastSentPeriod', periodKey);
          object.set('lastSentPeriodAt', at);
          const saved = await withTimeout(object.save());
          this.replaceLease(leaseFromParse(saved.toJSON()));
        }),
      );
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failure) {
        throw failure.reason;
      }
    });
  }

  /**
   * Runs one operation of the public API. An expired session (Parse 209, also thrown synchronously by
   * `ownerAcl()`) signs the user out and sends them to the login screen; the original error is always
   * rethrown, so the screen that asked stops its spinner and can show it.
   */
  private async guarded<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.session.handle(error);
      throw error;
    }
  }

  private replaceLease(updated: Lease): void {
    this.state.update((list) =>
      list.map((holder) =>
        holder.leases.some((l) => l.objectId === updated.objectId)
          ? {
              ...holder,
              leases: holder.leases.map((l) => (l.objectId === updated.objectId ? updated : l)),
            }
          : holder,
      ),
    );
  }

  private removeHolder(id: string): void {
    this.state.update((list) => list.filter((holder) => holder.objectId !== id));
  }

  /** Best effort: the caller rethrows the original error whatever happens here. */
  private async discard(object: RemoteObject): Promise<void> {
    try {
      await withTimeout(object.destroy());
    } catch {
      // Nothing more can be done; the original error is what matters.
    }
  }

  /** Best effort, like `discard`. */
  private async relink(holder: RemoteObject, lease: RemoteObject): Promise<void> {
    try {
      holder.addUnique('leases', lease);
      await withTimeout(holder.save());
    } catch {
      // Keep the original error.
    }
  }
}
