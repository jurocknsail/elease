import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '../../core/auth/auth.service';
import { ParseClient } from '../../core/parse/parse-client';
import { FakeParseClient } from '../../core/parse/testing/fake-parse-client';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { SettingsPage } from './settings.page';

const confirm = { open: vi.fn<() => Promise<boolean>>() };

async function setup() {
  const fake = new FakeParseClient();
  fake.userName = 'julien';
  fake.seed('Leaseholder', 'h1', {
    name: 'Durand Test',
    email: 'durand@example.test',
    phone: '',
    leases: [],
  });
  confirm.open.mockReset();
  TestBed.configureTestingModule({
    providers: [
      { provide: ParseClient, useValue: fake },
      { provide: ConfirmDialog, useValue: confirm },
      provideRouter([
        { path: 'reglages', component: SettingsPage },
        { path: 'login', children: [] },
      ]),
    ],
  });
  const harness = await RouterTestingHarness.create('/reglages');
  const root = harness.fixture.nativeElement as HTMLElement;
  const settle = async () => {
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    await harness.fixture.whenStable();
  };
  await vi.waitFor(() => expect(root.querySelector('#profile-name')).not.toBeNull());
  return {
    fake,
    harness,
    root,
    settle,
    router: TestBed.inject(Router),
    auth: TestBed.inject(AuthService),
  };
}

const button = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

function type(root: HTMLElement, id: string, value: string) {
  const input = root.querySelector<HTMLInputElement>(`#${id}`);
  input!.value = value;
  input!.dispatchEvent(new Event('input'));
}

async function choose(root: HTMLElement, content: string) {
  const input = root.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new File([content], 'elease-backup-julien-2027-01-05.json')],
  });
  input.dispatchEvent(new Event('change'));
}

describe('SettingsPage', () => {
  it('shows its sections, the signed-in user, and the profile pre-filled on first use', async () => {
    const { root, fake } = await setup();
    const text = root.textContent ?? '';
    for (const title of ['Profil bailleur', 'Apparence', 'Sauvegarde', 'Compte']) {
      expect(text).toContain(title);
    }
    expect(text).toContain('julien');
    expect(root.querySelector<HTMLInputElement>('#profile-name')?.value).toBe('SCI LA CHARINE');
    expect(fake.recordsOf('LandlordProfile')).toHaveLength(1);
  });

  it('saves the profile only when it is valid and changed, with trimmed values', async () => {
    const { root, fake, settle } = await setup();
    const save = () => button(root, 'Enregistrer') as HTMLButtonElement;
    expect(save().disabled).toBe(true);

    type(root, 'profile-name', '   ');
    await settle();
    expect(save().disabled).toBe(true);

    type(root, 'profile-name', '  SCI DES TESTS  ');
    await settle();
    expect(save().disabled).toBe(false);
    expect(root.textContent).toContain('Modifications non enregistrées');

    save().click();
    await vi.waitFor(() => expect(root.textContent).toContain('Profil enregistré'));
    expect(fake.recordsOf('LandlordProfile')[0].attrs['name']).toBe('SCI DES TESTS');
    expect(save().disabled).toBe(true);
  });

  it('previews a restore, asks for confirmation, and creates nothing until it is given', async () => {
    const { root, fake, settle } = await setup();
    const file = JSON.stringify([
      { objectId: 'h1', name: 'Durand Test', email: 'durand@example.test', phone: '', leases: [] },
      { objectId: 'h9', name: 'Nouveau Test', email: 'n@example.test', phone: '', leases: [] },
    ]);
    await choose(root, file);
    await vi.waitFor(() =>
      expect(root.textContent).toContain('1 locataire sera ajouté, 1 déjà présent ignoré'),
    );
    expect(fake.callsOf('save', 'Leaseholder')).toHaveLength(0);

    confirm.open.mockResolvedValueOnce(false);
    button(root, 'Restaurer')!.click();
    await settle();
    expect(confirm.open).toHaveBeenCalledTimes(1);
    expect(fake.callsOf('save', 'Leaseholder')).toHaveLength(0);

    confirm.open.mockResolvedValueOnce(true);
    button(root, 'Restaurer')!.click();
    await vi.waitFor(() => expect(root.textContent).toContain('Restauration terminée'));
    expect(fake.recordsOf('Leaseholder').map((r) => r.attrs['name'])).toContain('Nouveau Test');
  });

  it('refuses a file that is not a backup, with nothing created', async () => {
    const { root, fake } = await setup();
    await choose(root, '{ pas du json');
    await vi.waitFor(() => expect(root.textContent).toContain("n'est pas une sauvegarde"));
    expect(button(root, 'Restaurer depuis un fichier')).toBeDefined();
    expect(button(root, 'Restaurer')).toBeUndefined();
    expect(fake.callsOf('save', 'Leaseholder')).toHaveLength(0);
  });

  it('signs out and goes to /login right away, without waiting for the server to revoke the session', async () => {
    const { fake, root, router, auth } = await setup();
    // A server that never answers: the redirect must not wait for the 3 s cap of the revoke call.
    fake.hangWhen((call) => call.op === 'logout');
    expect(auth.user()?.username).toBe('julien');

    button(root, 'Se déconnecter')?.click();

    await vi.waitFor(() => expect(router.url).toBe('/login'));
    expect(auth.user()).toBeNull();
    expect(fake.callsOf('logout')).toHaveLength(1);
  });
});
