import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ParseClient } from '../parse/parse-client';
import { FakeParseClient } from '../parse/testing/fake-parse-client';
import { authGuard, guestGuard } from './auth.guard';

@Component({ template: 'page' })
class Page {}

function setup(signedIn: boolean) {
  const fake = new FakeParseClient();
  fake.addAccount('julien', 'pass');
  if (!signedIn) {
    fake.userId = null;
  }
  TestBed.configureTestingModule({
    providers: [
      { provide: ParseClient, useValue: fake },
      provideRouter([
        { path: 'login', component: Page, canActivate: [guestGuard] },
        {
          path: '',
          canActivate: [authGuard],
          // Moving between the children of an already active parent skips `canActivate`.
          canActivateChild: [authGuard],
          children: [
            { path: 'appels', component: Page },
            { path: 'appels/envoi', component: Page },
            { path: 'locataires', component: Page },
            { path: 'locataires/:id', component: Page },
          ],
        },
      ]),
    ],
  });
  return { fake, router: TestBed.inject(Router) };
}

describe('authGuard', () => {
  it('lets a signed-in user through', async () => {
    const { router } = setup(true);

    await RouterTestingHarness.create('/locataires');

    expect(router.url).toBe('/locataires');
  });

  it('sends a signed-out user to /login, remembering the requested address', async () => {
    const { router } = setup(false);

    await RouterTestingHarness.create('/locataires/abc?tab=baux');

    expect(router.url).toBe('/login?returnUrl=%2Flocataires%2Fabc%3Ftab%3Dbaux');
  });

  it('stops asking for a session that no longer exists, even after the page was shown', async () => {
    const { router, fake } = setup(true);
    const harness = await RouterTestingHarness.create('/appels');
    expect(router.url).toBe('/appels');

    // The session ends (sign-out): the next protected navigation is refused.
    const { AuthService } = await import('./auth.service');
    await TestBed.inject(AuthService).logout();
    expect(fake.userId).toBeNull();
    await harness.navigateByUrl('/locataires');

    expect(router.url).toBe('/login?returnUrl=%2Flocataires');
  });

  it('never forwards an address that is not an internal path (defence in depth)', () => {
    setup(false);
    const route = {} as ActivatedRouteSnapshot;

    for (const url of [
      '//evil.example/appels',
      'https://evil.example',
      '/\\evil.example',
      '/login',
    ]) {
      const result = TestBed.runInInjectionContext(() =>
        authGuard(route, { url } as RouterStateSnapshot),
      );

      expect(result).toBeInstanceOf(UrlTree);
      expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/login');
    }
  });

  it('does not let the login page be used as a return address', async () => {
    const { router } = setup(false);

    await RouterTestingHarness.create('/login?returnUrl=%2Flocataires');
    expect(router.url).toBe('/login?returnUrl=%2Flocataires');
  });
});

describe('guestGuard', () => {
  it('shows the login page to a signed-out user', async () => {
    const { router } = setup(false);

    await RouterTestingHarness.create('/login');

    expect(router.url).toBe('/login');
  });

  it('sends a signed-in user from /login to /appels', async () => {
    const { router } = setup(true);

    await RouterTestingHarness.create('/login');

    expect(router.url).toBe('/appels');
  });
});
