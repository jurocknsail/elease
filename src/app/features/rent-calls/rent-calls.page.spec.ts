import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService } from '../../core/auth/auth.service';
import { NOW } from '../../core/clock';
import { formatEuro } from '../../core/format/fr';
import { Lease } from '../../core/models/lease';
import { Leaseholder } from '../../core/models/leaseholder';
import { LeaseholderRepository } from '../../core/parse/leaseholder.repository';
import { ParseClient } from '../../core/parse/parse-client';
import { FakeParseClient, parseError, pointer } from '../../core/parse/testing/fake-parse-client';
import { RentCallsPage } from './rent-calls.page';

@Component({ template: '<p>autre page</p>' })
class OtherPage {}

/** Fictitious data only: invented names and addresses. */
function storedLease(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    isPro: false,
    name: 'Studio',
    lot: 0,
    streetNumber: 12,
    streetName: 'rue des Tests',
    optionalAddressInfo: '',
    postalCode: 13600,
    city: 'La Ciotat',
    lastSendDate: 0,
    price: 600,
    additionalCharges: [],
    ...overrides,
  };
}

const SENT_AT = new Date(2026, 10, 25, 10, 0).getTime();
const SENT_DEC_2026 = {
  lastSendDate: SENT_AT,
  lastSentPeriod: '2026-12',
  lastSentPeriodAt: SENT_AT,
};

/** Dupont: Studio 600 (to send), Garage 80 (sent). Martin: Commerce, pro, 1 653,80 (to send). */
function seedStandard(fake: FakeParseClient): void {
  fake.seed('Lease', 'l-studio', storedLease({ name: 'Studio', price: 600 }));
  fake.seed('Lease', 'l-garage', storedLease({ name: 'Garage', price: 80, ...SENT_DEC_2026 }));
  fake.seed(
    'Lease',
    'l-commerce',
    storedLease({
      name: 'Commerce',
      isPro: true,
      price: 1234,
      charge: 123,
      additionalCharges: [{ title: 'Parking', amount: 50 }],
    }),
  );
  fake.seed('Leaseholder', 'h-dupont', {
    name: 'Dupont',
    email: 'dupont@example.test',
    phone: '',
    leases: [pointer('Lease', 'l-studio'), pointer('Lease', 'l-garage')],
  });
  fake.seed('Leaseholder', 'h-martin', {
    name: 'Martin',
    email: 'martin@example.test',
    phone: '',
    leases: [pointer('Lease', 'l-commerce')],
  });
  // A tenant who has no lease yet (exists in the real data).
  fake.seed('Leaseholder', 'h-sans-bail', {
    name: 'Sans bail',
    email: 'sansbail@example.test',
    phone: '',
    leases: [],
  });
}

interface SetupOptions {
  now?: Date;
  seed?: (fake: FakeParseClient) => void;
  routes?: boolean;
  /** Called before the page opens, e.g. to make the backend hang. */
  before?: (fake: FakeParseClient) => void;
}

async function setup(options: SetupOptions = {}) {
  const fake = new FakeParseClient();
  fake.userName = 'julien';
  (options.seed ?? seedStandard)(fake);
  options.before?.(fake);
  /** The clock the page reads: a spec moves it to let time pass. */
  const clock = { now: options.now ?? new Date(2026, 10, 25, 9, 30) };
  TestBed.configureTestingModule({
    providers: [
      { provide: ParseClient, useValue: fake },
      { provide: NOW, useValue: () => new Date(clock.now) },
      provideRouter([
        { path: 'appels', component: RentCallsPage },
        { path: 'appels/envoi', component: OtherPage },
        { path: 'locataires', component: OtherPage },
        ...(options.routes === false ? [] : [{ path: 'login', component: OtherPage }]),
      ]),
    ],
  });
  const harness = await RouterTestingHarness.create();
  const router = TestBed.inject(Router);
  const view = {
    fake,
    clock,
    harness,
    router,
    auth: TestBed.inject(AuthService),
    repository: TestBed.inject(LeaseholderRepository),
    get root(): HTMLElement {
      return harness.routeNativeElement as HTMLElement;
    },
    /** Lets the promises of the load run, then renders. (No real timer is involved.) */
    async settle() {
      for (let i = 0; i < 80; i++) {
        await Promise.resolve();
      }
      harness.detectChanges();
    },
    async open() {
      await harness.navigateByUrl('/appels', RentCallsPage);
      harness.detectChanges();
      await view.settle();
    },
  };
  return view;
}

type View = Awaited<ReturnType<typeof setup>>;

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** The text exactly as rendered: no-break spaces kept. */
const raw = (element: Element | null | undefined) => (element?.textContent ?? '').trim();
/** Plain spaces instead of the no-break ones of the French formatting. */
const plain = (value: string) =>
  value.replace(
    new RegExp('[' + String.fromCharCode(0xa0) + String.fromCharCode(0x202f) + ']', 'g'),
    ' ',
  );

/** The first amount of a text, in cents: « 3 927,90 € sur 3 baux » -> 392790. */
function euroCents(shown: string): number {
  const found = /\d[\d\s]*,\d{2}/.exec(shown);
  return found ? Math.round(Number(found[0].replace(/\s/g, '').replace(',', '.')) * 100) : NaN;
}

const rowsOf = (root: HTMLElement) => [
  ...root.querySelectorAll<HTMLElement>('ul[aria-label] > li'),
];
const cells = (row: HTMLElement) => [...row.children].map((c) => text(c));
const isBusy = (root: HTMLElement) => root.querySelector('[aria-busy="true"]') !== null;

function kpi(root: HTMLElement, label: string): string | undefined {
  const term = [...root.querySelectorAll('dt')].find((dt) => text(dt) === label);
  return term ? text(term.parentElement?.querySelector('dd')) : undefined;
}

const banner = (root: HTMLElement) =>
  [...root.querySelectorAll('[role="status"]')].find((el) => text(el).includes('sont à envoyer'));

const retryButton = (root: HTMLElement) =>
  [...root.querySelectorAll('button')].find((b) => text(b) === 'Réessayer');

const actionLink = (root: HTMLElement) =>
  [...root.querySelectorAll('a')].find((a) => text(a) === 'Préparer les envois');

describe('RentCallsPage', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('title', () => {
    it('is the billing month, capitalised: « Décembre 2026 » on 25 November 2026', async () => {
      const view = await setup({ now: new Date(2026, 10, 25) });
      await view.open();

      const headings = [...view.root.querySelectorAll('h1')];
      expect(headings).toHaveLength(1);
      expect(text(headings[0])).toBe('Décembre 2026');
    });

    it('uses the month after the call date: on 3 January the calls of 25 January bill February', async () => {
      const view = await setup({ now: new Date(2027, 0, 3) });
      await view.open();

      expect(text(view.root.querySelector('h1'))).toBe('Février 2027');
    });
  });

  describe('loading', () => {
    it('loads from the repository every time the page opens, not once per app', async () => {
      const view = await setup();
      await view.open();
      expect(view.fake.callsOf('find', 'Leaseholder')).toHaveLength(1);

      await view.harness.navigateByUrl('/locataires');
      await view.harness.navigateByUrl('/appels', RentCallsPage);
      await view.settle();

      expect(view.fake.callsOf('find', 'Leaseholder')).toHaveLength(2);
    });
  });

  describe('rows', () => {
    it('lists one row per lease: lease, tenant, status pill, amount; a tenant without lease has none', async () => {
      const view = await setup();
      await view.open();

      const rows = rowsOf(view.root).map(cells);
      expect(rows.map((r) => plain(r.join(' | ')))).toEqual([
        // Sorted by tenant name, then lease name.
        'Garage | Dupont | Envoyé | 80 €',
        'Studio | Dupont | À envoyer | 600 €',
        'Commerce | Martin | À envoyer | 1 653,80 €',
      ]);
      expect(text(view.root)).not.toContain('Sans bail');
    });

    it('shows a lease sent by the legacy app only (last send in the previous month) as sent', async () => {
      const view = await setup({
        seed: (fake) => {
          fake.seed(
            'Lease',
            'l-legacy',
            storedLease({ name: 'Ancien envoi', lastSendDate: new Date(2026, 10, 25).getTime() }),
          );
          fake.seed(
            'Lease',
            'l-old',
            storedLease({ name: 'Trop ancien', lastSendDate: new Date(2026, 9, 25).getTime() }),
          );
          fake.seed('Leaseholder', 'h1', {
            name: 'Durand',
            email: 'durand@example.test',
            phone: '',
            leases: [pointer('Lease', 'l-legacy'), pointer('Lease', 'l-old')],
          });
        },
      });
      await view.open();

      expect(rowsOf(view.root).map((r) => cells(r)[0] + ':' + cells(r)[2])).toEqual([
        'Ancien envoi:Envoyé',
        'Trop ancien:À envoyer',
      ]);
    });
  });

  describe('summary cards', () => {
    it('shows the number to send, the number sent and the month total (sent leases included)', async () => {
      const view = await setup();
      await view.open();

      expect(kpi(view.root, 'À envoyer')).toBe('2');
      expect(kpi(view.root, 'Envoyés')).toBe('1');
      const total = [...view.root.querySelectorAll('dt')].find(
        (dt) => text(dt) === 'Total du mois',
      )?.parentElement;
      expect(plain(text(total))).toContain('2 333,80 €');
      // The exact string of formatEuro, with its no-break spaces.
      expect(raw(total)).toContain(formatEuro(600 + 80 + 1653.8));
    });

    it('adds the rows as they are printed: three leases at 1 309,30 € make 3 927,90 €, not 3 927,89 €', async () => {
      // Each of these professional leases bills 1309.296 (1091.08 + 20 % VAT); the raw sum is 3927.888.
      const view = await setup({
        seed: (fake) => {
          for (const id of ['a', 'b', 'c']) {
            fake.seed(
              'Lease',
              `l-${id}`,
              storedLease({ name: `Local ${id.toUpperCase()}`, isPro: true, price: 1091.08 }),
            );
          }
          fake.seed('Leaseholder', 'h1', {
            name: 'Dupont',
            email: 'dupont@example.test',
            phone: '',
            leases: ['a', 'b', 'c'].map((id) => pointer('Lease', `l-${id}`)),
          });
        },
      });
      await view.open();

      const shown = rowsOf(view.root).map((row) => text(row.children[3]));
      expect(shown.map(plain)).toEqual(['1 309,30 €', '1 309,30 €', '1 309,30 €']);
      const total = [...view.root.querySelectorAll('dt')].find(
        (dt) => text(dt) === 'Total du mois',
      )?.parentElement;
      expect(plain(text(total))).toContain('3 927,90 €');
      expect(plain(text(total))).not.toContain('3 927,89');
      // The same sum a person makes from the rows on screen.
      const fromRows = shown.reduce((sum, amount) => sum + euroCents(amount), 0);
      expect(euroCents(text(total))).toBe(fromRows);
      expect(fromRows).toBe(392790);
    });
  });

  describe('lead sentence and plurals', () => {
    it('says « 2 appels à envoyer sur 3 » with the plural', async () => {
      const view = await setup();
      await view.open();

      expect(text(view.root.querySelector('header'))).toContain('2 appels à envoyer sur 3');
    });

    it('reassures when everything is sent: « Tous les appels de décembre 2026 ont été envoyés. »', async () => {
      const view = await setup({
        seed: (fake) => {
          seedStandard(fake);
          fake.seed('Lease', 'l-studio', storedLease({ name: 'Studio', ...SENT_DEC_2026 }));
          fake.seed('Lease', 'l-commerce', storedLease({ name: 'Commerce', ...SENT_DEC_2026 }));
        },
      });
      await view.open();

      expect(text(view.root.querySelector('header'))).toContain(
        'Tous les appels de décembre 2026 ont été envoyés.',
      );
      expect(text(view.root.querySelector('header'))).not.toContain('à envoyer sur');
    });
  });

  describe('reminder banner', () => {
    it('is not shown on the 24th, even with calls to send', async () => {
      const view = await setup({ now: new Date(2026, 10, 24, 23, 59) });
      await view.open();

      expect(banner(view.root)).toBeUndefined();
    });

    it('is shown from the 25th while a call is to send, as a status region with a sentence', async () => {
      const view = await setup({ now: new Date(2026, 10, 25, 0, 5) });
      await view.open();

      const region = banner(view.root);
      expect(region).toBeDefined();
      expect(text(region)).toBe('Les appels de loyer de décembre 2026 sont à envoyer.');
      expect(region?.getAttribute('role')).toBe('status');
    });

    it('is not shown on the 25th when everything is already sent', async () => {
      const view = await setup({
        now: new Date(2026, 10, 25),
        seed: (fake) => {
          fake.seed('Lease', 'l1', storedLease({ name: 'Studio', ...SENT_DEC_2026 }));
          fake.seed('Leaseholder', 'h1', {
            name: 'Dupont',
            email: 'd@example.test',
            phone: '',
            leases: [pointer('Lease', 'l1')],
          });
        },
      });
      await view.open();

      expect(banner(view.root)).toBeUndefined();
    });
  });

  describe('main action', () => {
    it('« Préparer les envois » goes to /appels/envoi', async () => {
      const view = await setup();
      await view.open();

      const link = actionLink(view.root) as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('/appels/envoi');
      link.click();
      await vi.waitFor(() => expect(view.router.url).toBe('/appels/envoi'));
    });

    it('stays available, as a secondary button, once everything is sent', async () => {
      const view = await setup({
        seed: (fake) => {
          fake.seed('Lease', 'l1', storedLease({ name: 'Studio', ...SENT_DEC_2026 }));
          fake.seed('Leaseholder', 'h1', {
            name: 'Dupont',
            email: 'd@example.test',
            phone: '',
            leases: [pointer('Lease', 'l1')],
          });
        },
      });
      await view.open();

      const link = actionLink(view.root) as HTMLElement;
      expect(link).toBeDefined();
      expect(link.classList.contains('btn-secondary')).toBe(true);
      expect(link.classList.contains('btn-primary')).toBe(false);
      expect(link.getAttribute('href')).toBe('/appels/envoi');
    });
  });

  describe('empty', () => {
    it('shows « Aucun bail enregistré » with a link to « Locataires » when there is no tenant', async () => {
      const view = await setup({ seed: () => undefined });
      await view.open();

      const empty = view.root.querySelector('app-empty-state') as HTMLElement;
      expect(text(empty)).toContain('Aucun bail enregistré');
      const link = [...empty.querySelectorAll('a')].find((a) => text(a).includes('locataires'));
      expect(link?.getAttribute('href')).toBe('/locataires');
      expect(rowsOf(view.root)).toHaveLength(0);
      expect(kpi(view.root, 'À envoyer')).toBeUndefined();
      expect(isBusy(view.root)).toBe(false);
    });

    it('shows it too when the tenants have no lease at all', async () => {
      const view = await setup({
        seed: (fake) => {
          fake.seed('Leaseholder', 'h1', {
            name: 'Sans bail',
            email: 'a@example.test',
            phone: '',
            leases: [],
          });
        },
      });
      await view.open();

      expect(text(view.root.querySelector('app-empty-state'))).toContain('Aucun bail enregistré');
    });
  });

  describe('errors', () => {
    it('shows the error state with « Réessayer » when the backend cannot be reached (Parse 100)', async () => {
      const view = await setup({
        before: (fake) => fake.failWhen((call) => call.op === 'find', parseError(100)),
      });
      await view.open();

      const state = view.root.querySelector('app-error-state') as HTMLElement;
      expect(text(state)).toContain('Connexion requise');
      expect(retryButton(view.root)).toBeDefined();
      expect(isBusy(view.root)).toBe(false);
      expect(rowsOf(view.root)).toHaveLength(0);
      expect(view.root.querySelector('app-empty-state app-empty-state')).toBeNull();
    });

    it('« Réessayer » loads again and recovers', async () => {
      const view = await setup({
        before: (fake) => fake.failWhen((call) => call.op === 'find', parseError(100)),
      });
      await view.open();
      expect(view.fake.callsOf('find', 'Leaseholder')).toHaveLength(1);

      retryButton(view.root)?.click();
      await view.settle();

      expect(view.fake.callsOf('find', 'Leaseholder')).toHaveLength(2);
      expect(view.root.querySelector('app-error-state')).toBeNull();
      expect(rowsOf(view.root)).toHaveLength(3);
      expect(retryButton(view.root)).toBeUndefined();
    });

    it('a backend that hangs ends in the error state after 20 s, never in a spinner', async () => {
      vi.useFakeTimers();
      const view = await setup({
        before: (fake) => fake.hangWhen((call) => call.op === 'find'),
      });
      await view.open();
      expect(isBusy(view.root)).toBe(true);

      await vi.advanceTimersByTimeAsync(19_999);
      view.harness.detectChanges();
      expect(isBusy(view.root)).toBe(true);

      await vi.advanceTimersByTimeAsync(1);
      await view.settle();

      expect(isBusy(view.root)).toBe(false);
      const state = view.root.querySelector('app-error-state') as HTMLElement;
      expect(text(state)).toContain('Connexion requise');
      expect(text(state)).toContain('Le serveur ne répond pas');
      expect(retryButton(view.root)).toBeDefined();
    });

    it('does not show a second error for an expired session (209): the repository redirects', async () => {
      const view = await setup({
        before: (fake) => fake.failWhen((call) => call.op === 'find', parseError(209)),
      });
      await view.open();

      await vi.waitFor(() => expect(view.router.url).toContain('/login'));
      expect(view.auth.user()).toBeNull();
      expect(view.fake.callsOf('find', 'Leaseholder')).toHaveLength(1);
    });
  });

  describe('coming back (stale-while-revalidate)', () => {
    async function leaveAndComeBack(view: View) {
      await view.harness.navigateByUrl('/locataires');
      await view.harness.navigateByUrl('/appels', RentCallsPage);
    }

    it('shows the rows already in memory at once while the new load is pending: no skeleton', async () => {
      const view = await setup();
      await view.open();
      view.fake.hangWhen((call) => call.op === 'find');

      await leaveAndComeBack(view);
      await view.settle();

      expect(view.fake.callsOf('find', 'Leaseholder')).toHaveLength(2);
      expect(rowsOf(view.root)).toHaveLength(3);
      expect(view.root.querySelectorAll('[data-skeleton]')).toHaveLength(0);
      expect(view.root.querySelector('app-error-state')).toBeNull();
    });

    it('keeps the rows and says the refresh failed, with « Réessayer », when the reload fails', async () => {
      const view = await setup();
      await view.open();
      view.fake.failWhen((call) => call.op === 'find', parseError(100));

      await leaveAndComeBack(view);
      await view.settle();

      expect(rowsOf(view.root)).toHaveLength(3);
      expect(view.root.querySelector('app-error-state')).toBeNull();
      const alert = view.root.querySelector('[role="alert"]') as HTMLElement;
      expect(text(alert)).toContain('Connexion requise');
      expect(retryButton(view.root)).toBeDefined();

      retryButton(view.root)?.click();
      await view.settle();

      expect(view.root.querySelector('[role="alert"]')).toBeNull();
      expect(rowsOf(view.root)).toHaveLength(3);
      expect(view.fake.callsOf('find', 'Leaseholder')).toHaveLength(3);
    });
  });

  describe('structure', () => {
    it('has one h1 (the month), h2 headings for the sections and an accessible list name', async () => {
      const view = await setup();
      await view.open();

      expect(view.root.querySelectorAll('h1')).toHaveLength(1);
      expect([...view.root.querySelectorAll('h2')].map((h) => text(h)).length).toBeGreaterThan(0);
      expect(view.root.querySelector('ul[aria-label]')?.getAttribute('aria-label')).toContain(
        'décembre 2026',
      );
    });
  });
});
