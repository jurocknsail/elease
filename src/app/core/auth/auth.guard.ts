import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { DEFAULT_URL, safeReturnUrl } from './return-url';

/**
 * Lets signed-in users through. Everyone else goes to `/login`, with the address they asked for as
 * `returnUrl` (only when it is an internal path) so signing in brings them back to it. Register it as
 * both `canActivate` and `canActivateChild` on the parent route: the router skips `canActivate` when
 * only a child changes, and the session may have ended since the parent was entered.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  if (inject(AuthService).user()) {
    return true;
  }
  const returnUrl = safeReturnUrl(state.url);
  return inject(Router).createUrlTree(['/login'], {
    // Nothing to remember when the user asked for the page they land on anyway.
    queryParams: returnUrl && returnUrl !== DEFAULT_URL ? { returnUrl } : {},
  });
};

/** Guards `/login`: someone who is already signed in has nothing to do there and lands on `/appels`. */
export const guestGuard: CanActivateFn = () => {
  if (inject(AuthService).user()) {
    return inject(Router).createUrlTree(['/appels']);
  }
  return true;
};
