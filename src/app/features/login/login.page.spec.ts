import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService, LOGIN_TIMEOUT_MS } from '../../core/auth/auth.service';
import { ParseClient } from '../../core/parse/parse-client';
import { FakeParseClient, parseError } from '../../core/parse/testing/fake-parse-client';
import { BackendTimeoutError } from '../../core/parse/with-timeout';
import { LoginPage, loginErrorMessage } from './login.page';

// A throw-away test credential: nothing real, nothing reaches a server.
const PASSWORD = 'correct horse battery staple';

@Component({ template: 'page' })
class Page {}

async function setup(url = '/login') {
  const fake = new FakeParseClient();
  fake.userId = null;
  fake.addAccount('julien', PASSWORD);
  TestBed.configureTestingModule({
    providers: [
      { provide: ParseClient, useValue: fake },
      provideRouter([
        { path: 'login', component: LoginPage },
        { path: 'appels', component: Page },
        { path: 'locataires', component: Page },
        { path: 'locataires/:id', component: Page },
      ]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  const component = await harness.navigateByUrl(url, LoginPage);
  const root = harness.routeNativeElement as HTMLElement;
  const q = <T extends HTMLElement>(selector: string) => root.querySelector(selector) as T;
  return {
    fake,
    harness,
    component,
    router: TestBed.inject(Router),
    auth: TestBed.inject(AuthService),
    root,
    username: () => q<HTMLInputElement>('input[name="username"]'),
    password: () => q<HTMLInputElement>('input[name="password"]'),
    button: () => q<HTMLButtonElement>('button[type="submit"]'),
    alert: () => root.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
    /** Types the credentials and submits the way a user does (Enter / button). */
    async signIn(user: string, pass: string) {
      q<HTMLInputElement>('input[name="username"]').value = user;
      q<HTMLInputElement>('input[name="password"]').value = pass;
      q<HTMLFormElement>('form').dispatchEvent(new Event('submit', { cancelable: true }));
      harness.detectChanges();
    },
    /** Lets the promises of the sign-in run, then renders. (Nothing here waits on a real timer.) */
    async settle() {
      for (let i = 0; i < 30; i++) {
        await Promise.resolve();
      }
      harness.detectChanges();
    },
  };
}

describe('LoginPage', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows a centred card with « Identifiant », « Mot de passe » and « Se connecter »', async () => {
    const { root, username, password, button } = await setup();

    expect(root.querySelector('h1')?.textContent?.trim()).toBe('Connexion');
    expect(root.querySelector('label[for="login-username"]')?.textContent?.trim()).toBe(
      'Identifiant',
    );
    expect(root.querySelector('label[for="login-password"]')?.textContent?.trim()).toBe(
      'Mot de passe',
    );
    expect(username().id).toBe('login-username');
    expect(password().id).toBe('login-password');
    expect(button().textContent?.trim()).toBe('Se connecter');
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });

  describe('validation', () => {
    it('asks for both fields, calls nothing, and focuses the first empty one', async () => {
      const { fake, root, username, signIn } = await setup();
      document.body.append(root);

      await signIn('', '');

      expect(root.textContent).toContain('Saisissez votre identifiant');
      expect(root.textContent).toContain('Saisissez votre mot de passe');
      expect(username().getAttribute('aria-invalid')).toBe('true');
      expect(username().getAttribute('aria-describedby')).toBe('login-username-error');
      expect(document.activeElement).toBe(username());
      expect(fake.callsOf('login')).toEqual([]);
    });
  });

  describe('signing in', () => {
    it('signs in, trimming the identifier but never the password, and goes to /appels', async () => {
      const { fake, router, auth, signIn, settle } = await setup();

      await signIn('  julien  ', PASSWORD);
      await settle();

      expect(fake.callsOf('login').map((call) => call.username)).toEqual(['julien']);
      expect(auth.user()?.username).toBe('julien');
      expect(router.url).toBe('/appels');
    });

    it('goes back to the page that was asked for before the login (returnUrl)', async () => {
      const { router, signIn, settle } = await setup('/login?returnUrl=%2Flocataires%2Fabc');

      await signIn('julien', PASSWORD);
      await settle();

      expect(router.url).toBe('/locataires/abc');
    });

    it.each(['https://evil.example/appels', '//evil.example'])(
      'ignores the return address %s (no open redirect)',
      async (returnUrl) => {
        const { router, signIn, settle } = await setup(
          `/login?returnUrl=${encodeURIComponent(returnUrl)}`,
        );

        await signIn('julien', PASSWORD);
        await settle();

        expect(router.url).toBe('/appels');
      },
    );

    it('shows « Connexion… », disables the button, and does not sign in twice on a second submit', async () => {
      const { fake, button, signIn, settle } = await setup();
      fake.hangWhen((call) => call.op === 'login');

      await signIn('julien', PASSWORD);
      await settle();

      expect(button().disabled).toBe(true);
      expect(button().textContent?.trim()).toBe('Connexion…');
      expect(button().getAttribute('aria-busy')).toBe('true');

      await signIn('julien', PASSWORD);
      await settle();
      expect(fake.callsOf('login')).toHaveLength(1);
    });
  });

  describe('failures', () => {
    it('wrong credentials: « Identifiant ou mot de passe incorrect », password cleared and focused, button usable again', async () => {
      const { root, username, password, button, alert, signIn, settle } = await setup();
      document.body.append(root);

      await signIn('julien', 'not the password');
      await settle();

      expect(alert()).toBe('Identifiant ou mot de passe incorrect');
      expect(username().value).toBe('julien');
      expect(password().value).toBe('');
      expect(document.activeElement).toBe(password());
      expect(button().disabled).toBe(false);
      expect(button().textContent?.trim()).toBe('Se connecter');
    });

    it('never puts the typed password on the page or in the console', async () => {
      const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation(() => undefined),
      );
      const { root, signIn, settle } = await setup();

      await signIn('julien', 'wrong password 123');
      await settle();

      expect(root.textContent).not.toContain('wrong password 123');
      expect(root.innerHTML).not.toContain('wrong password 123');
      for (const spy of spies) {
        expect(JSON.stringify(spy.mock.calls)).not.toContain('wrong password 123');
      }
    });

    it('timeout after 20 s: « Le serveur ne répond pas. Réessayez. », not "incorrect", and the password is kept', async () => {
      const { fake, password, button, alert, signIn, settle } = await setup();
      vi.useFakeTimers();
      fake.hangWhen((call) => call.op === 'login');

      await signIn('julien', PASSWORD);
      await vi.advanceTimersByTimeAsync(LOGIN_TIMEOUT_MS);
      await settle();

      expect(alert()).toBe('Le serveur ne répond pas. Réessayez.');
      expect(alert()).not.toContain('incorrect');
      expect(password().value).toBe(PASSWORD);
      expect(button().disabled).toBe(false);
    });

    it('network failure (Parse code 100): « Le serveur ne répond pas. Réessayez. », not "incorrect"', async () => {
      const { fake, alert, signIn, settle } = await setup();
      fake.failWhen((call) => call.op === 'login', parseError(100, 'XMLHttpRequest failed'));

      await signIn('julien', PASSWORD);
      await settle();

      expect(alert()).toBe('Le serveur ne répond pas. Réessayez.');
    });
  });
});

describe('loginErrorMessage', () => {
  it('reserves « Identifiant ou mot de passe incorrect » for Parse code 101', () => {
    expect(loginErrorMessage(parseError(101))).toBe('Identifiant ou mot de passe incorrect');
    for (const error of [
      new BackendTimeoutError(),
      parseError(100),
      parseError(141),
      parseError(209),
      parseError(107),
      new Error('x'),
      null,
      undefined,
    ]) {
      expect(loginErrorMessage(error)).not.toBe('Identifiant ou mot de passe incorrect');
    }
  });

  it('says the server does not answer for a timeout, code 100 and an offline device', () => {
    expect(loginErrorMessage(new BackendTimeoutError())).toBe(
      'Le serveur ne répond pas. Réessayez.',
    );
    expect(loginErrorMessage(parseError(100))).toBe('Le serveur ne répond pas. Réessayez.');
    const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
    try {
      Object.defineProperty(Navigator.prototype, 'onLine', {
        configurable: true,
        get: () => false,
      });
      expect(loginErrorMessage(new Error('x'))).toBe('Le serveur ne répond pas. Réessayez.');
    } finally {
      if (descriptor) {
        Object.defineProperty(Navigator.prototype, 'onLine', descriptor);
      }
    }
  });
});
