import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '../../core/auth/auth.service';
import { ParseClient } from '../../core/parse/parse-client';
import { FakeParseClient } from '../../core/parse/testing/fake-parse-client';
import { SettingsPage } from './settings.page';

async function setup() {
  const fake = new FakeParseClient();
  fake.userName = 'julien';
  TestBed.configureTestingModule({
    providers: [
      { provide: ParseClient, useValue: fake },
      provideRouter([
        { path: 'reglages', component: SettingsPage },
        { path: 'login', component: SettingsPage },
      ]),
    ],
  });
  const harness = await RouterTestingHarness.create('/reglages');
  return { fake, harness, router: TestBed.inject(Router), auth: TestBed.inject(AuthService) };
}

const signOutButton = (root: HTMLElement) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Se déconnecter'));

describe('SettingsPage (placeholder)', () => {
  it('signs out and goes to /login right away, without waiting for the server to revoke the session', async () => {
    const { fake, harness, router, auth } = await setup();
    // A server that never answers: the redirect must not wait for the 3 s cap of the revoke call.
    fake.hangWhen((call) => call.op === 'logout');
    expect(auth.user()?.username).toBe('julien');

    signOutButton(harness.fixture.nativeElement as HTMLElement)?.click();

    await vi.waitFor(() => expect(router.url).toBe('/login'));
    expect(auth.user()).toBeNull();
    expect(fake.callsOf('logout')).toHaveLength(1);
  });

  it('shows who is signed in', async () => {
    const { harness } = await setup();
    expect((harness.fixture.nativeElement as HTMLElement).textContent).toContain('julien');
  });
});
