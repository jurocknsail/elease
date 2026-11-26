import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, TitleStrategy, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AppTitleStrategy } from './app-title.strategy';
import { routes } from './app.routes';
import { AuthService } from './core/auth/auth.service';
import { NOW } from './core/clock';
import { LeaseholderRepository } from './core/parse/leaseholder.repository';
import { ParseClient } from './core/parse/parse-client';
import { FakeParseClient, parseError } from './core/parse/testing/fake-parse-client';

function setup(signedIn: boolean) {
  const fake = new FakeParseClient();
  fake.userName = 'julien';
  fake.addAccount('julien', 'pass');
  if (!signedIn) {
    fake.userId = null;
  }
  TestBed.configureTestingModule({
    providers: [
      { provide: ParseClient, useValue: fake },
      // The home page's heading is the billing month: a fixed clock keeps it deterministic.
      { provide: NOW, useValue: () => new Date(2026, 10, 25) },
      provideRouter(routes),
      { provide: TitleStrategy, useClass: AppTitleStrategy },
    ],
  });
  return { fake, router: TestBed.inject(Router) };
}

const heading = (harness: RouterTestingHarness) =>
  (harness.routeNativeElement as HTMLElement).querySelector('h1')?.textContent?.trim();

describe('routes', () => {
  afterEach(() => {
    document.title = '';
  });

  it('opens on « Appels de loyer » (the month to come) when signed in', async () => {
    const { router } = setup(true);

    const harness = await RouterTestingHarness.create('/');

    expect(router.url).toBe('/appels');
    expect(
      (harness.fixture.nativeElement as HTMLElement).querySelector('app-shell main h1')
        ?.textContent,
    ).toBe('Décembre 2026');
  });

  it.each([
    ['/appels', 'Décembre 2026'],
    ['/appels/envoi', 'Appels de loyer — décembre 2026'],
    ['/locataires', 'Locataires'],
    ['/locataires/abc123', 'Locataire'],
    ['/reglages', 'Réglages'],
  ])('serves %s inside the shell, lazily', async (url, title) => {
    const { router } = setup(true);

    const harness = await RouterTestingHarness.create(url);

    expect(router.url).toBe(url);
    const main = (harness.fixture.nativeElement as HTMLElement).querySelector('app-shell main');
    expect(main?.querySelector('h1')?.textContent?.trim()).toBe(title);
  });

  it('comes back to the same screen on a reload: the URL is the state, the session is restored', async () => {
    const { router } = setup(true);

    await RouterTestingHarness.create('/locataires');

    expect(router.url).toBe('/locataires');
    expect(TestBed.inject(AuthService).user()?.username).toBe('julien');
  });

  it('sends everything to the login screen when signed out, remembering where the user was going', async () => {
    const { router } = setup(false);

    await RouterTestingHarness.create('/locataires');
    expect(router.url).toBe('/login?returnUrl=%2Flocataires');

    await router.navigateByUrl('/');
    expect(router.url).toBe('/login');

    await router.navigateByUrl('/n-importe-quoi');
    expect(router.url).toBe('/login');
  });

  it('stops a user whose session ended while the shell stays open, on the very next navigation', async () => {
    const { router } = setup(true);
    const harness = await RouterTestingHarness.create('/appels');
    expect(router.url).toBe('/appels');

    // Nothing navigates away: the shell (parent route) stays active, only its child changes.
    await TestBed.inject(AuthService).logout();
    await harness.navigateByUrl('/locataires');

    expect(router.url).toBe('/login?returnUrl=%2Flocataires');
  });

  it('a crafted returnUrl that spells the login page (/%6Cogin) does not leave a signed-in user on /login', async () => {
    const { router, fake } = setup(false);
    fake.addAccount('julien', 'pass');
    const harness = await RouterTestingHarness.create('/login?returnUrl=%2F%256Cogin');
    const page = harness.fixture.nativeElement as HTMLElement;
    (page.querySelector('input[name="username"]') as HTMLInputElement).value = 'julien';
    (page.querySelector('input[name="password"]') as HTMLInputElement).value = 'pass';

    page.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));

    // Angular decodes /%6Cogin to /login: only the query changes, so the guard must run again.
    await vi.waitFor(() => expect(router.url).toBe('/appels'));
  });

  it('keeps a signed-in user away from /login', async () => {
    const { router } = setup(true);

    await RouterTestingHarness.create('/login');

    expect(router.url).toBe('/appels');
  });

  it('sends an unknown address to « Appels de loyer »', async () => {
    const { router } = setup(true);

    await RouterTestingHarness.create('/page/inconnue');

    expect(router.url).toBe('/appels');
  });

  it('shows the login page at /login when signed out', async () => {
    const { router } = setup(false);

    const harness = await RouterTestingHarness.create('/login');

    expect(router.url).toBe('/login');
    expect(heading(harness)).toBe('Connexion');
  });

  it('sets the document title per route', async () => {
    setup(true);
    const harness = await RouterTestingHarness.create('/appels');
    expect(document.title).toBe('Appels de loyer — E-Lease');

    await harness.navigateByUrl('/locataires');
    expect(document.title).toBe('Locataires — E-Lease');

    await harness.navigateByUrl('/reglages');
    expect(document.title).toBe('Réglages — E-Lease');
  });

  it('titles the login page', async () => {
    setup(false);
    await RouterTestingHarness.create('/login');

    expect(document.title).toBe('Connexion — E-Lease');
  });

  describe('expired session (Parse 209) in the running app', () => {
    it('sends the user to the login screen, remembering the page, and the guard does not send them back', async () => {
      const { fake, router } = setup(true);
      const harness = await RouterTestingHarness.create('/locataires');
      expect(router.url).toBe('/locataires');
      const holders = TestBed.inject(LeaseholderRepository);
      fake.failWhen((call) => call.op === 'find', parseError(209, 'invalid session token'));

      // A screen loads its data: the server says the session is gone.
      await expect(holders.load()).rejects.toMatchObject({ code: 209 });
      await vi.waitFor(() => expect(router.url).toContain('/login'));
      await harness.fixture.whenStable();

      expect(router.url).toBe('/login?returnUrl=%2Flocataires');
      expect(TestBed.inject(AuthService).user()).toBeNull();
      expect(fake.userId).toBeNull();
    });
  });
});
