import { Injectable, Signal, inject, signal } from '@angular/core';
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
  private readonly state = signal<Leaseholder[]>([]);

  readonly leaseholders: Signal<Leaseholder[]> = this.state.asReadonly();

  async load(): Promise<void> {
    const objects = await withTimeout(
      this.client
        .query(HOLDER_CLASS)
        .include('leases')
        .ascending('createdAt')
        .limit(MAX_HOLDERS)
        .find(),
    );
    this.state.set(objects.map((object) => leaseholderFromParse(object.toJSON())));
  }

  async createLeaseholder(input: Omit<Leaseholder, 'objectId' | 'leases'>): Promise<Leaseholder> {
    const object = this.client.newObject(HOLDER_CLASS);
    object.set('name', input.name);
    object.set('email', input.email);
    object.set('phone', input.phone);
    object.set('leases', []);
    object.setACL(this.client.ownerAcl());
    const saved = await withTimeout(object.save());
    const holder = leaseholderFromParse(saved.toJSON());
    this.state.update((list) => [...list, holder]);
    return holder;
  }

  async updateContact(
    id: string,
    contact: { name: string; email: string; phone: string },
  ): Promise<void> {
    const object = await withTimeout(this.client.fetchById(HOLDER_CLASS, id));
    object.set('name', contact.name);
    object.set('email', contact.email);
    object.set('phone', contact.phone);
    const saved = await withTimeout(object.save());
    const { name, email, phone } = leaseholderFromParse(saved.toJSON());
    this.state.update((list) =>
      list.map((holder) => (holder.objectId === id ? { ...holder, name, email, phone } : holder)),
    );
  }

  async addLease(holderId: string, lease: Lease): Promise<Lease> {
    // Fetched first: no lease is created for a holder that does not exist or is not readable.
    const holder = await withTimeout(this.client.fetchById(HOLDER_CLASS, holderId));

    const object = this.client.newObject(LEASE_CLASS);
    writeLeaseFields(object, lease);
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
  }

  async updateLease(lease: Lease): Promise<void> {
    if (!lease.objectId) {
      throw new Error('Bail sans identifiant : enregistrement impossible.');
    }
    // Fetched so that absent values can stay absent, see writeLeaseFields.
    const object = await withTimeout(this.client.fetchById(LEASE_CLASS, lease.objectId));
    writeLeaseFields(object, lease);
    const saved = await withTimeout(object.save());
    this.replaceLease(leaseFromParse(saved.toJSON()));
  }

  /**
   * Unlinks the lease from the holder, then deletes it. Safe to retry: removing an absent pointer and
   * deleting an already deleted lease both count as done. If the lease cannot be deleted the pointer
   * is put back, so no invisible lease is left behind.
   */
  async deleteLease(holderId: string, leaseId: string): Promise<void> {
    const holder = await withTimeout(this.client.fetchById(HOLDER_CLASS, holderId));
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
  }

  /**
   * Deletes the holder together with all its leases (the legacy app swallowed lease deletion errors
   * and left orphans). Leases go first and any failure stops everything before the holder is touched,
   * so the holder still references what remains and the call can simply be retried: a lease that is
   * already gone counts as deleted, and so does an already deleted holder.
   */
  async deleteLeaseholder(id: string): Promise<void> {
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
  }

  /** Records that the rent calls of these leases were sent: `lastSendDate` and `lastSentPeriod`. */
  async markLeasesSent(leaseIds: string[], periodKey: string, at: number): Promise<void> {
    // Each lease on its own: those that succeed are saved and shown as sent even if another fails.
    const results = await Promise.allSettled(
      leaseIds.map(async (id) => {
        const object = await withTimeout(this.client.fetchById(LEASE_CLASS, id));
        object.set('lastSendDate', at);
        object.set('lastSentPeriod', periodKey);
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
