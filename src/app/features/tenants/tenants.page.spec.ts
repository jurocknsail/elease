import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { InseeService } from '../../core/insee/insee.service';
import { LeaseholderRepository } from '../../core/parse/leaseholder.repository';
import { ParseClient } from '../../core/parse/parse-client';
import {
  FakeCall,
  FakeParseClient,
  parseError,
  pointer,
} from '../../core/parse/testing/fake-parse-client';
import { BackendTimeoutError } from '../../core/parse/with-timeout';
import { ConfirmDialog, ConfirmDialogOptions } from '../../shared/ui/confirm-dialog';
import { TenantDetail } from './tenant-detail';
import { TenantsPage, filterHolders } from './tenants.page';

@Component({ template: '<p>autre page</p>' })
class OtherPage {}

const SENT_AT = new Date(2026, 10, 25, 10, 0).getTime();

/** Fictitious data only. */
function storedLease(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    isPro: false,
    name: 'Studio',
    lot: 0,
    streetNumber: 12,
    streetName: 'rue des Tests',
    optionalAddressInfo: '',
    postalCode: 1000,
    city: 'Ville-Test',
    lastSendDate: 0,
    price: 600,
    charge: 40,
    additionalCharges: [],
    renewalDate: new Date(2027, 2, 1).getTime(),
    indexType: 'IRL',
    referenceIndexQuarter: '2025-T2',
    referenceIndexValue: 145.47,
    ...overrides,
  };
}

function seedStandard(fake: FakeParseClient): void {
  fake.seed(
    'Lease',
    'l-studio',
    storedLease({
      lastSendDate: SENT_AT,
      lastSentPeriod: '2026-12',
      lastSentPeriodAt: SENT_AT,
    }),
  );
  // Incomplete: no anniversary date, no index; a pro lease with an extra charge.
  fake.seed(
    'Lease',
    'l-local',
    storedLease({
      name: 'Local commercial',
      isPro: true,
      price: 1234,
      additionalCharges: [{ title: 'Parking', amount: 50 }],
      renewalDate: undefined,
      indexType: undefined,
      referenceIndexQuarter: undefined,
      referenceIndexValue: undefined,
    }),
  );
  fake.seed('Leaseholder', 'h-dupont', {
    name: 'Dupont',
    email: 'dupont@example.test',
    phone: '',
    leases: [pointer('Lease', 'l-studio'), pointer('Lease', 'l-local')],
  });
  fake.seed('Leaseholder', 'h-elodie', {
    name: 'Élodie Sans-Bail',
    email: 'elodie@example.test',
    phone: '06 12 34 56 78',
    leases: [],
  });
}

interface SetupOptions {
  answers?: boolean[];
  before?: (fake: FakeParseClient) => void;
}

async function setup(options: SetupOptions = {}) {
  const fake = new FakeParseClient();
  seedStandard(fake);
  options.before?.(fake);
  const answers = [...(options.answers ?? [])];
  const dialog = {
    opened: [] as ConfirmDialogOptions[],
    open: async (config: ConfirmDialogOptions): Promise<boolean> => {
      dialog.opened.push(config);
      return answers.length > 0 ? (answers.shift() as boolean) : true;
    },
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ParseClient, useValue: fake },
      { provide: ConfirmDialog, useValue: dialog },
      // Never the real INSEE API from a spec, whatever the day the suite runs on.
      { provide: InseeService, useValue: { observations: () => new Promise(() => undefined) } },
      provideRouter([
        {
          path: 'locataires',
          component: TenantsPage,
          children: [{ path: ':id', component: TenantDetail }],
        },
        { path: 'login', component: OtherPage },
      ]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  const view = {
    fake,
    dialog,
    harness,
    router: TestBed.inject(Router),
    repository: TestBed.inject(LeaseholderRepository),
    get root(): HTMLElement {
      return harness.routeNativeElement as HTMLElement;
    },
    async settle() {
      for (let i = 0; i < 80; i++) {
        await Promise.resolve();
      }
      harness.detectChanges();
    },
    async open(url: string) {
      await harness.navigateByUrl(url);
      harness.detectChanges();
      await view.settle();
    },
  };
  return view;
}

type View = Awaited<ReturnType<typeof setup>>;

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The block (section) whose heading is `title`. */
function block(root: HTMLElement, title: string): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>('section[aria-labelledby]')].find(
    (section) => text(section.querySelector('h3')) === title,
  );
  if (!found) {
    throw new Error(`No block « ${title} »`);
  }
  return found;
}

function button(scope: HTMLElement, label: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll('button')].find((b) => text(b) === label);
  if (!found) {
    throw new Error(`No button « ${label} »`);
  }
  return found as HTMLButtonElement;
}

/** The input of the field whose label starts with `label`. */
function field(scope: HTMLElement, label: string): HTMLInputElement {
  const found = [...scope.querySelectorAll('label')].find((l) => text(l).startsWith(label));
  const input = found ? scope.querySelector<HTMLInputElement>('#' + found.htmlFor) : null;
  if (!input) {
    throw new Error(`No field « ${label} »`);
  }
  return input;
}

async function typeInto(view: View, input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('blur'));
  view.harness.detectChanges();
}

async function click(view: View, element: HTMLElement) {
  element.click();
  view.harness.detectChanges();
  await view.settle();
}

const saves = (fake: FakeParseClient, className: string): FakeCall[] =>
  fake.callsOf('save', className);
const opKeys = (call: FakeCall) => (call.ops ?? []).map((op) => op.key).sort();

describe('Locataires', () => {
  describe('list', () => {
    it('lists every tenant, one with no lease as « Aucun bail », and finds by name or e-mail without accents', async () => {
      const view = await setup();
      await view.open('/locataires');

      const rows = [...view.root.querySelectorAll('a[data-holder-row]')].map((a) => text(a));
      expect(rows.length).toBe(2);
      expect(rows[0]).toMatch(/Dupont.*dupont@example\.test.*2 baux$/);
      expect(rows[1]).toMatch(/Élodie Sans-Bail.*elodie@example\.test.*Aucun bail$/);

      const search = view.root.querySelector<HTMLInputElement>('input[type="search"]')!;
      await typeInto(view, search, 'ELODIE');
      expect([...view.root.querySelectorAll('a[data-holder-row]')].map((a) => text(a))).toEqual([
        expect.stringContaining('Élodie'),
      ]);
      await typeInto(view, search, 'dupont@');
      expect(view.root.querySelectorAll('a[data-holder-row]').length).toBe(1);
      await typeInto(view, search, 'zzz');
      expect(text(view.root)).toContain('Aucun locataire ne correspond');
    });

    it('filters locally, case and accents ignored (pure)', () => {
      const holders = [
        { name: 'Zoé Arnaud', email: 'zoe@example.test', phone: '', leases: [] },
        { name: 'Élodie Dubois', email: 'e@example.test', phone: '', leases: [] },
      ];
      expect(filterHolders(holders, 'elodie').map((h) => h.name)).toEqual(['Élodie Dubois']);
      expect(filterHolders(holders, '').map((h) => h.name)).toEqual([
        'Élodie Dubois',
        'Zoé Arnaud',
      ]);
    });

    it('shows the error state with « Réessayer » when the first load fails', async () => {
      const view = await setup({
        before: (fake) => fake.failWhen((call) => call.op === 'find', new BackendTimeoutError()),
      });
      await view.open('/locataires');
      expect(text(view.root)).toContain('Connexion requise');
      await click(view, button(view.root, 'Réessayer'));
      expect(text(view.root)).toContain('Dupont');
    });
  });

  describe('detail', () => {
    it('shows « Aucun bail » for a tenant without lease, and offers to add one', async () => {
      const view = await setup();
      await view.open('/locataires/h-elodie');
      expect(text(block(view.root, 'Contact'))).toContain('Élodie Sans-Bail');
      expect(text(block(view.root, 'Contact'))).toContain('06 12 34 56 78');
      expect(text(view.root)).toContain('Aucun bail. Ajoutez le premier');
      expect([...view.root.querySelectorAll('section[aria-labelledby] h3')].map(text)).toEqual([
        'Contact',
        'Baux',
      ]);
      expect(text(view.root)).toContain('Ajouter un bail');
    });

    it('shows the leases read-only: pills, amounts, never-sent and period of the last send', async () => {
      const view = await setup();
      await view.open('/locataires/h-dupont');

      const studio = text(block(view.root, 'Studio'));
      expect(studio).toContain('Habitation');
      expect(studio).not.toContain('À compléter');
      expect(studio).toContain('01000 Ville-Test');
      expect(studio).toContain("Total de l'appel");
      expect(studio).toContain('01/03/2027');
      expect(studio).toContain('IRL · T2 2025 · 145,47');
      expect(studio).toContain('25/11/2026 · appel de décembre 2026');

      const local = text(block(view.root, 'Local commercial'));
      expect(local).toContain('Pro');
      expect(local).toContain('À compléter');
      expect(local).toContain('Jamais');
      expect(local).toContain('Non renseigné');
      expect(local).toContain('Parking');
    });

    it('says « Locataire introuvable », with a way back, for an unknown id', async () => {
      const view = await setup();
      await view.open('/locataires/n-existe-pas');
      expect(text(view.root)).toContain('Locataire introuvable');
      expect(view.root.querySelector('a[href="/locataires"]')).not.toBeNull();
    });
  });

  describe('contact', () => {
    it('refuses a@b like the sender does, saves the other values normalised, and writes only what changed', async () => {
      const view = await setup();
      await view.open('/locataires/h-elodie');
      const contact = block(view.root, 'Contact');
      await click(view, button(contact, 'Modifier'));

      await typeInto(view, field(contact, 'Adresse e-mail'), 'a@b');
      await click(view, button(contact, 'Enregistrer'));
      expect(saves(view.fake, 'Leaseholder').length).toBe(0);
      expect(field(contact, 'Adresse e-mail').getAttribute('aria-invalid')).toBe('true');
      const describedBy = field(contact, 'Adresse e-mail').getAttribute('aria-describedby') ?? '';
      expect(text(view.root.querySelector('#' + describedBy.split(' ').at(-1)))).toContain(
        'une seule adresse e-mail valide',
      );

      await typeInto(view, field(contact, 'Adresse e-mail'), ' elodie.nouvelle@example.test ');
      await typeInto(view, field(contact, 'Téléphone'), '+33 6 98 76 54 32');
      await click(view, button(contact, 'Enregistrer'));

      const stored = view.fake.record('Leaseholder', 'h-elodie')!.attrs;
      expect(stored['email']).toBe('elodie.nouvelle@example.test');
      expect(stored['phone']).toBe('0698765432');
      expect(stored['name']).toBe('Élodie Sans-Bail');
      expect(contact.querySelector('form')).toBeNull();
      expect(text(contact)).toContain('0698765432');
    });

    it('keeps the form open with the typed values and says why when the save fails', async () => {
      const view = await setup();
      await view.open('/locataires/h-elodie');
      const contact = block(view.root, 'Contact');
      await click(view, button(contact, 'Modifier'));
      await typeInto(view, field(contact, 'Nom'), 'Nouveau nom');
      view.fake.failWhen((call) => call.op === 'save', parseError(141, 'secret detail'));

      await click(view, button(contact, 'Enregistrer'));

      expect(field(contact, 'Nom').value).toBe('Nouveau nom');
      expect(text(contact.querySelector('[role="alert"]'))).toBe(
        "L'enregistrement a échoué. Réessayez dans un instant.",
      );
      expect(text(contact)).not.toContain('secret detail');
      expect(view.fake.record('Leaseholder', 'h-elodie')!.attrs['name']).toBe('Élodie Sans-Bail');
      expect(button(contact, 'Enregistrer').disabled).toBe(false);
    });

    it('persists nothing when cancelled', async () => {
      const view = await setup();
      await view.open('/locataires/h-elodie');
      const contact = block(view.root, 'Contact');
      await click(view, button(contact, 'Modifier'));
      await typeInto(view, field(contact, 'Nom'), 'Autre');
      await click(view, button(contact, 'Annuler'));

      expect(saves(view.fake, 'Leaseholder').length).toBe(0);
      expect(contact.querySelector('form')).toBeNull();
      expect(text(contact)).toContain('Élodie Sans-Bail');
    });
  });

  describe('lease', () => {
    it('saves normalised values, empty optionals as no value, and never writes the bookkeeping', async () => {
      const view = await setup();
      await view.open('/locataires/h-dupont');
      const studio = block(view.root, 'Studio');
      await click(view, button(studio, 'Modifier'));

      await typeInto(view, field(studio, 'Loyer hors charges'), '1 234,56');
      await typeInto(view, field(studio, 'Avance sur charges'), '');
      await click(view, button(studio, 'Enregistrer'));

      const calls = saves(view.fake, 'Lease');
      expect(calls.length).toBe(1);
      expect(opKeys(calls[0])).toEqual(['charge', 'price']);
      expect(calls[0].ops).toContainEqual({ kind: 'set', key: 'price', value: 1234.56 });
      expect(calls[0].ops).toContainEqual({ kind: 'unset', key: 'charge' });
      const stored = view.fake.record('Lease', 'l-studio')!.attrs;
      expect(stored['lastSendDate']).toBe(SENT_AT);
      expect(stored['lastSentPeriod']).toBe('2026-12');
      expect(text(studio)).toContain('1 234,56');
    });

    it('requires the postal code (exactly 5 digits) and the street number, with messages', async () => {
      const view = await setup({
        before: (fake) => {
          fake.seed(
            'Lease',
            'l-vide',
            storedLease({ postalCode: 0, streetNumber: 0, name: 'Vide' }),
          );
          fake.seed('Leaseholder', 'h-vide', {
            name: 'Vide',
            email: 'vide@example.test',
            phone: '',
            leases: [pointer('Lease', 'l-vide')],
          });
        },
      });
      await view.open('/locataires/h-vide');
      const lease = block(view.root, 'Vide');
      await click(view, button(lease, 'Modifier'));
      await typeInto(view, field(lease, 'Code postal'), '1300');
      await click(view, button(lease, 'Enregistrer'));

      expect(saves(view.fake, 'Lease').length).toBe(0);
      expect(field(lease, 'Code postal').getAttribute('aria-invalid')).toBe('true');
      expect(text(lease)).toContain('exactement 5 chiffres');
      expect(field(lease, 'Numéro').getAttribute('aria-invalid')).toBe('true');
    });

    it('keeps the form open with the typed values when the save fails, and cancels without persisting', async () => {
      const view = await setup();
      await view.open('/locataires/h-dupont');
      const studio = block(view.root, 'Studio');
      await click(view, button(studio, 'Modifier'));
      await typeInto(view, field(studio, 'Loyer hors charges'), '777');
      view.fake.failWhen((call) => call.op === 'save', parseError(141));

      await click(view, button(studio, 'Enregistrer'));
      expect(field(studio, 'Loyer hors charges').value).toBe('777');
      expect(studio.querySelector('[role="alert"]')).not.toBeNull();
      expect(view.fake.record('Lease', 'l-studio')!.attrs['price']).toBe(600);

      const attempts = saves(view.fake, 'Lease').length;
      await click(view, button(studio, 'Annuler'));
      expect(studio.querySelector('form')).toBeNull();
      expect(text(studio)).toContain('600 €');
      expect(saves(view.fake, 'Lease').length).toBe(attempts);
    });

    it('asks for a confirmation before deleting, and deletes only on confirm', async () => {
      const view = await setup({ answers: [false, true] });
      await view.open('/locataires/h-dupont');
      await click(view, button(block(view.root, 'Studio'), 'Supprimer'));

      expect(view.dialog.opened[0].title).toBe('Supprimer définitivement « Studio » ?');
      expect(view.dialog.opened[0].danger).toBe(true);
      expect(view.fake.callsOf('destroy').length).toBe(0);
      expect(view.fake.record('Lease', 'l-studio')).toBeDefined();

      await click(view, button(block(view.root, 'Studio'), 'Supprimer'));
      expect(view.fake.record('Lease', 'l-studio')).toBeUndefined();
      expect(text(view.root)).not.toContain('IRL · T2 2025');
    });

    it('adds a lease with only the required fields, the optional ones left empty', async () => {
      const view = await setup();
      await view.open('/locataires/h-elodie');
      await click(view, button(view.root, 'Ajouter un bail'));
      const form = block(view.root, 'Nouveau bail');

      await typeInto(view, field(form, 'Nom du bail'), 'Cave');
      await typeInto(view, field(form, 'Numéro'), '3');
      await typeInto(view, field(form, 'Voie'), 'rue des Tests');
      await typeInto(view, field(form, 'Code postal'), '13600');
      await typeInto(view, field(form, 'Ville'), 'Ville-Test');
      await typeInto(view, field(form, 'Loyer hors charges'), '50');
      await click(view, button(form, 'Enregistrer'));

      const created = view.fake.recordsOf('Lease').filter((r) => r.attrs['name'] === 'Cave');
      expect(created.length).toBe(1);
      const attrs = created[0].attrs;
      expect(attrs['price']).toBe(50);
      expect(attrs['postalCode']).toBe(13600);
      for (const absent of ['lot', 'charge', 'renewalDate', 'indexType', 'referenceIndexQuarter']) {
        expect(attrs).not.toHaveProperty(absent);
      }
      expect(view.fake.record('Leaseholder', 'h-elodie')!.attrs['leases']).toHaveLength(1);
      expect(text(view.root)).toContain('Cave');
      expect(text(view.root)).not.toContain('Nouveau bail');
    });
  });

  describe('deleting a tenant', () => {
    it('asks first, then deletes the tenant and goes back to the list', async () => {
      const view = await setup({ answers: [false, true] });
      await view.open('/locataires/h-dupont');
      await click(view, button(view.root, 'Supprimer le locataire'));
      expect(view.dialog.opened[0].message).toContain('ses 2 baux');
      expect(view.fake.record('Leaseholder', 'h-dupont')).toBeDefined();

      await click(view, button(view.root, 'Supprimer le locataire'));
      expect(view.fake.record('Leaseholder', 'h-dupont')).toBeUndefined();
      expect(view.fake.recordsOf('Lease').length).toBe(0);
      expect(view.router.url).toBe('/locataires');
    });
  });

  describe('after a time-out', () => {
    it('reloads before another attempt, and the retry then goes through', async () => {
      const view = await setup();
      await view.open('/locataires/h-dupont');
      const studio = block(view.root, 'Studio');
      await click(view, button(studio, 'Modifier'));
      await typeInto(view, field(studio, 'Loyer hors charges'), '650');
      view.fake.failWhen((call) => call.op === 'save', new BackendTimeoutError());
      const findsBefore = view.fake.callsOf('find').length;

      await click(view, button(studio, 'Enregistrer'));

      expect(text(studio.querySelector('[role="alert"]'))).toContain('peut-être abouti');
      expect(view.fake.callsOf('find').length).toBeGreaterThan(findsBefore);
      expect(field(studio, 'Loyer hors charges').value).toBe('650');

      await click(view, button(studio, 'Enregistrer'));
      expect(view.fake.record('Lease', 'l-studio')!.attrs['price']).toBe(650);
    });

    it('refuses another attempt while the data cannot be refreshed, without sending anything', async () => {
      const view = await setup();
      await view.open('/locataires/h-dupont');
      const studio = block(view.root, 'Studio');
      await click(view, button(studio, 'Modifier'));
      await typeInto(view, field(studio, 'Loyer hors charges'), '650');
      view.fake.failWhen((call) => call.op === 'save', new BackendTimeoutError());
      // The reload that follows the time-out fails too (twice: the page also tries again).
      view.fake.failWhen((call) => call.op === 'find', parseError(100), false);

      await click(view, button(studio, 'Enregistrer'));
      const savesBefore = saves(view.fake, 'Lease').length;
      await click(view, button(studio, 'Enregistrer'));

      expect(saves(view.fake, 'Lease').length).toBe(savesBefore);
      expect(text(studio.querySelector('[role="alert"]'))).toContain('pas pu être actualisées');
    });
  });
});
