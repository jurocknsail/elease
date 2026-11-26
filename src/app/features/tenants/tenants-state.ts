import { Injectable, computed, inject, signal } from '@angular/core';
import { isSessionError } from '../../core/auth/session-error';
import { describeBackendError, isConnectionError } from '../../core/parse/backend-error';
import { LeaseholderRepository } from '../../core/parse/leaseholder.repository';
import { BackendTimeoutError } from '../../core/parse/with-timeout';

/** « 2 baux », « 1 bail », « Aucun bail ». */
export function leaseCountLabel(count: number): string {
  if (count === 0) {
    return 'Aucun bail';
  }
  return `${count} ${count === 1 ? 'bail' : 'baux'}`;
}

/** A new attempt was refused because the data could not be refreshed after a time-out. */
export class ReloadRequiredError extends Error {
  constructor() {
    super('Les données doivent être actualisées avant un nouvel essai.');
    this.name = 'ReloadRequiredError';
  }
}

/**
 * The French sentence shown inside a block when a save or a deletion failed. A time-out says what is
 * true: the server may have applied the change. Never contains a raw error message.
 */
export function saveErrorMessage(error: unknown, action: 'save' | 'delete' = 'save'): string {
  if (error instanceof ReloadRequiredError) {
    return "Les données n'ont pas pu être actualisées. Réessayez dans un instant : rien n'a été renvoyé au serveur.";
  }
  if (error instanceof BackendTimeoutError) {
    return "Le serveur n'a pas répondu : l'opération a peut-être abouti. Les données sont actualisées, vérifiez-les avant de réessayer.";
  }
  if (isConnectionError(error)) {
    return describeBackendError(error).message;
  }
  return action === 'delete'
    ? 'La suppression a échoué. Réessayez dans un instant.'
    : "L'enregistrement a échoué. Réessayez dans un instant.";
}

/**
 * What the tenant screens share (list, detail, blocks): the load of the data, and the rule for every
 * change. Provided by the list page, so the detail, which sits inside it, reaches the same instance.
 *
 * Loading is stale-while-revalidate: rows already in memory stay on screen while the reload runs, and a
 * failed reload keeps them (the page adds a notice). After a mutation that timed out, the server may
 * have applied it although the repository's state is unchanged: `attempt` then reloads before it lets
 * another change through, so a retry never works on a picture that is out of date (a lease created
 * twice, an edit written over an unseen one).
 */
@Injectable()
export class TenantsState {
  private readonly repository = inject(LeaseholderRepository);

  readonly holders = this.repository.leaseholders;
  readonly loading = signal(true);
  /** The last failure of a load, until a load succeeds. */
  readonly failure = signal<{ cause: unknown } | null>(null);
  /** A load has succeeded since the page opened (or rows were already known). */
  private readonly loadedOnce = signal(false);
  readonly loaded = computed(() => this.loadedOnce() || this.holders().length > 0);
  /** A change timed out: reload before the next one. */
  readonly needsReload = signal(false);

  private running: Promise<void> | null = null;

  /** Loads from the backend, the previous data staying visible. Never throws. */
  refresh(): Promise<void> {
    if (this.running) {
      return this.running;
    }
    this.loading.set(true);
    const clearsReload = this.needsReload();
    const run = (async () => {
      try {
        await this.repository.load();
        this.failure.set(null);
        this.loadedOnce.set(true);
        if (clearsReload) {
          // Only a load that started after the time-out can vouch for the data.
          this.needsReload.set(false);
        }
      } catch (error) {
        if (isSessionError(error)) {
          // The repository is signing the user out and going to the login screen: no error of ours,
          // and `loading` stays on so that nothing misleading shows before the redirect.
          return;
        }
        this.failure.set({ cause: error });
      }
      this.loading.set(false);
    })();
    this.running = run.finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /**
   * Runs one change. If an earlier change timed out, the data is reloaded first and the change is
   * refused (`ReloadRequiredError`) while that reload fails. A time-out of this change starts a reload
   * and marks the data as needing it, whatever happens to that reload.
   */
  async attempt<T>(operation: () => Promise<T>): Promise<T> {
    if (this.needsReload()) {
      await this.refresh();
      if (this.needsReload()) {
        await this.refresh();
      }
      if (this.needsReload()) {
        throw new ReloadRequiredError();
      }
    }
    try {
      return await operation();
    } catch (error) {
      if (error instanceof BackendTimeoutError) {
        this.needsReload.set(true);
        void this.refresh().then(() => (this.needsReload() ? this.refresh() : undefined));
      }
      throw error;
    }
  }
}
