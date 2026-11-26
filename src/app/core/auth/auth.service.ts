import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { ParseClient } from '../parse/parse-client';
import { withTimeout } from '../parse/with-timeout';

export interface SessionUser {
  username: string;
  email: string;
}

/** Back4App can hang for a minute: sign-in gives up after the same 20 s as every other call. */
export const LOGIN_TIMEOUT_MS = 20000;
/** Signing out is local and immediate; this only bounds the wait for the server to revoke the session. */
export const LOGOUT_TIMEOUT_MS = 3000;

/**
 * The signed-in Parse user. Everything goes through the abstract `ParseClient`: this service never
 * imports the SDK and creates no SDK object itself (the first `ParseClient` call is what initializes
 * the SDK, and anything created earlier would be orphaned by `disableSingleInstance`).
 *
 * The session lives in the SDK (browser local storage), so it survives a reload; `user` reads it
 * lazily, the first time it is needed, and then follows `login` / `logout`.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly client = inject(ParseClient);
  /** `undefined` until the stored session has been read (lazily, on first access to `user`). */
  private readonly current = signal<SessionUser | null | undefined>(undefined);
  private readonly logoutListeners = new Set<() => void>();

  readonly user: Signal<SessionUser | null> = computed(() => {
    const value = this.current();
    return value === undefined ? this.restore() : value;
  });

  /**
   * Signs in. Rejects with the original error: Parse 101 for a wrong username or password, 100 or a
   * `BackendTimeoutError` when the server cannot be reached. The password is only handed to Parse: it
   * is never stored, logged or put in an error.
   */
  async login(username: string, password: string): Promise<void> {
    await withTimeout(this.client.logIn(username, password), LOGIN_TIMEOUT_MS);
    this.current.set(this.restore() ?? { username, email: '' });
  }

  /**
   * Signs out. The user and everything held in memory for them go immediately (before the first
   * `await`), so another account signing in on the same device never sees stale data and nothing can
   * race with the server call. A failing or hanging server call does not matter: the SDK has already
   * removed the stored session.
   */
  async logout(): Promise<void> {
    this.current.set(null);
    for (const listener of [...this.logoutListeners]) {
      try {
        listener();
      } catch {
        // One failing listener must not keep the others from clearing their data.
      }
    }
    try {
      await withTimeout(this.client.logOut(), LOGOUT_TIMEOUT_MS);
    } catch {
      // Already signed out locally; the server revokes the token on its own expiry otherwise.
    }
  }

  /** Runs `listener` at every sign-out, synchronously. Returns a function that removes it. */
  onLogout(listener: () => void): () => void {
    this.logoutListeners.add(listener);
    return () => this.logoutListeners.delete(listener);
  }

  private restore(): SessionUser | null {
    try {
      return this.read();
    } catch {
      // An unreadable stored session counts as no session.
      return null;
    }
  }

  private read(): SessionUser | null {
    const username = this.client.currentUsername();
    return username ? { username, email: this.client.currentUserEmail() ?? '' } : null;
  }
}
