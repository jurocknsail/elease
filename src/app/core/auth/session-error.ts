import { Injectable, Injector, inject } from '@angular/core';
import { Router } from '@angular/router';
import { INVALID_SESSION_TOKEN } from '../parse/parse-client';
import { AuthService } from './auth.service';
import { safeReturnUrl } from './return-url';

/** Whether the error is Parse's "invalid or expired session token" (code 209). */
export function isSessionError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === INVALID_SESSION_TOKEN
  );
}

/**
 * Sends the user back to the login screen when the session is no longer valid.
 *
 * Parse code 209: signs out (`logout`), then goes to `/login`, keeping the current page as the
 * `returnUrl` so signing in again brings the user back, and returns true. Any other error: does nothing
 * and returns false. It never throws and never swallows the error: the caller rethrows it.
 *
 * `logout` is a parameter, not an injection, so this stays callable from anywhere (the plan's
 * `(err, router)` signature has no way to reach `AuthService` outside an injection context).
 * `AuthService.logout` drops the local session synchronously, before the navigation below: otherwise
 * `/login` would see a signed-in user and bounce straight back.
 */
export function handleSessionError(
  error: unknown,
  router: Pick<Router, 'navigate' | 'url'>,
  logout: () => unknown,
): boolean {
  if (!isSessionError(error)) {
    return false;
  }
  try {
    // Not awaited: signing out locally is immediate, and a failing or hanging server call must neither
    // delay the redirect nor surface as an unhandled rejection.
    Promise.resolve(logout()).catch(() => undefined);
  } catch {
    // A failing logout never blocks the redirect.
  }
  const returnUrl = safeReturnUrl(router.url);
  Promise.resolve(
    router.navigate(['/login'], { queryParams: returnUrl ? { returnUrl } : {} }),
  ).catch(() => undefined);
  return true;
}

/**
 * What the repositories call in the `catch` of every remote call: on an expired session it signs out
 * and redirects (`handleSessionError`). The caller always rethrows the original error afterwards, so
 * the screen that asked still stops its spinner. `Router` is resolved lazily, only when a 209 occurs,
 * so a repository (and its unit tests) never needs a router for any other error.
 */
@Injectable({ providedIn: 'root' })
export class SessionErrorHandler {
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);

  /** True when the error was an invalid session (sign-out and redirect started). Never throws. */
  handle(error: unknown): boolean {
    if (!isSessionError(error)) {
      return false;
    }
    try {
      return handleSessionError(error, this.injector.get(Router), () => this.auth.logout());
    } catch {
      return false;
    }
  }
}
