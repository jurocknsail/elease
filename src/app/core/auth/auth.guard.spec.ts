import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
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
