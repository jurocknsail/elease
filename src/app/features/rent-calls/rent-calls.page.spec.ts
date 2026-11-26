import { Component, signal } from '@angular/core';
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

    it('rolls over to January of the next year in December', async () => {
      const view = await setup({ now: new Date(2026, 11, 10) });
      await view.open();

      expect(text(view.root.querySelector('h1'))).toBe('Janvier 2027');
    });

    it('uses the month after the call date: on 3 January the calls of 25 January bill February', async () => {
      const view = await setup({ now: new Date(2027, 0, 3) });
      await view.open();

      expect(text(view.root.querySelector('h1'))).toBe('Février 2027');
    });

    it('capitalises the accented first letter of août', async () => {
      const view = await setup({ now: new Date(2026, 6, 25) });
      await view.open();

      expect(text(view.root.querySelector('h1'))).toBe('Août 2026');
    });
  });

  describe('loading', () => {
    it('shows a skeleton (3 cards, 4 rows), marked busy, while the first load is pending', async () => {
      const view = await setup({
        before: (fake) => fake.hangWhen((call) => call.op === 'find'),
      });
      await view.open();

      expect(isBusy(view.root)).toBe(true);
      expect(view.root.querySelectorAll('[data-skeleton="kpi"]')).toHaveLength(3);
      expect(view.root.querySelectorAll('[data-skeleton="row"]')).toHaveLength(4);
      expect(rowsOf(view.root)).toHaveLength(0);
      // The title is known at once: it comes from the clock, not from the data.
      expect(text(view.root.querySelector('h1'))).toBe('Décembre 2026');
      expect(view.root.querySelector('app-error-state')).toBeNull();
      expect(view.root.querySelector('app-empty-state')).toBeNull();
    });

    it('keeps the room of the reminder banner in the skeleton from the 25th, and only then', async () => {
      const hang = (fake: FakeParseClient) => fake.hangWhen((call) => call.op === 'find');
      const on25 = await setup({ now: new Date(2026, 10, 25), before: hang });
      await on25.open();
      expect(on25.root.querySelectorAll('[data-skeleton="banner"]')).toHaveLength(1);

      TestBed.resetTestingModule();
      const on24 = await setup({ now: new Date(2026, 10, 24), before: hang });
      await on24.open();
      expect(on24.root.querySelectorAll('[data-skeleton="kpi"]')).toHaveLength(3);
      expect(on24.root.querySelectorAll('[data-skeleton="banner"]')).toHaveLength(0);
    });

    it('replaces the skeleton by the real content, and nothing stays busy', async () => {
      const view = await setup();
      await view.open();

      expect(isBusy(view.root)).toBe(false);
      expect(view.root.querySelectorAll('[data-skeleton]')).toHaveLength(0);
      expect(rowsOf(view.root).length).toBeGreaterThan(0);
    });

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

    it('prints amounts with formatEuro, aligned right on tabular figures', async () => {
      const view = await setup();
      await view.open();

      const amounts = rowsOf(view.root).map((row) => row.children[3] as HTMLElement);
      expect(amounts.map((a) => raw(a))).toEqual([
        formatEuro(80),
        formatEuro(600),
        formatEuro(1653.8),
      ]);
      for (const amount of amounts) {
        expect(amount.className).toContain('tabular-nums');
        expect(amount.className).toContain('text-right');
      }
    });

    it('uses the pills: « À envoyer » in the warn tone, « Envoyé » in the ok tone, never wrapping', async () => {
      const view = await setup();
      await view.open();

      const pills = rowsOf(view.root).map((row) => row.querySelector('app-pill') as HTMLElement);
      expect(pills.map((p) => text(p))).toEqual(['Envoyé', 'À envoyer', 'À envoyer']);
      expect(pills[0].className).toContain('text-ok');
      expect(pills[1].className).toContain('text-warn');
      for (const pill of pills) {
        expect(pill.className).toContain('whitespace-nowrap');
      }
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

    it('lists the leases of two tenants who share an e-mail address', async () => {
      const view = await setup({
        seed: (fake) => {
          fake.seed('Lease', 'l1', storedLease({ name: 'Studio' }));
          fake.seed('Lease', 'l2', storedLease({ name: 'Garage' }));
          for (const [id, name, lease] of [
            ['h1', 'Camille Roy', 'l1'],
            ['h2', 'Louis Roy', 'l2'],
          ]) {
            fake.seed('Leaseholder', id, {
              name,
              email: 'famille@example.test',
              phone: '',
              leases: [pointer('Lease', lease)],
            });
          }
        },
      });
      await view.open();

      expect(rowsOf(view.root).map((r) => cells(r)[1])).toEqual(['Camille Roy', 'Louis Roy']);
    });

    it('renders a lease without lot, charge, renewal date and additional charges', async () => {
      const view = await setup({
        seed: (fake) => {
          fake.seed('Lease', 'l1', {
            isPro: false,
            name: 'Maison',
            streetNumber: 3,
            streetName: 'rue A',
            optionalAddressInfo: '',
            postalCode: 1000,
            city: 'Bourg',
            lastSendDate: 0,
            price: 950,
          });
          fake.seed('Leaseholder', 'h1', {
            name: 'Leroy',
            email: 'leroy@example.test',
            phone: '',
            leases: [pointer('Lease', 'l1')],
          });
        },
      });
      await view.open();

      expect(plain(cells(rowsOf(view.root)[0]).join(' | '))).toBe(
        'Maison | Leroy | À envoyer | 950 €',
      );
    });

    it('truncates long names with an ellipsis, and keeps the full name in a tooltip', async () => {
      const longLease = 'Local commercial avec réserve et cour intérieure, bâtiment principal';
      const longHolder = 'Société Civile Immobilière des Trois Moulins et Associés Réunis';
      const view = await setup({
        seed: (fake) => {
          fake.seed('Lease', 'l1', storedLease({ name: longLease }));
          fake.seed('Leaseholder', 'h1', {
            name: longHolder,
            email: 'sci@example.test',
            phone: '',
            leases: [pointer('Lease', 'l1')],
          });
        },
      });
      await view.open();

      const row = rowsOf(view.root)[0];
      const leaseCell = row.children[0] as HTMLElement;
      const holderCell = row.children[1] as HTMLElement;
      expect(leaseCell.className).toContain('truncate');
      expect(holderCell.className).toContain('truncate');
      expect(leaseCell.getAttribute('title')).toBe(longLease);
      expect(holderCell.getAttribute('title')).toBe(longHolder);
      expect(text(leaseCell)).toBe(longLease);
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

    it('says « sur N baux » under the total, with a singular for one lease', async () => {
      const view = await setup();
      await view.open();
      expect(plain(text(view.root.querySelector('dl')))).toContain('sur 3 baux');

      TestBed.resetTestingModule();
      const single = await setup({
        seed: (fake) => {
          fake.seed('Lease', 'l1', storedLease({ name: 'Studio' }));
          fake.seed('Leaseholder', 'h1', {
            name: 'Dupont',
            email: 'd@example.test',
            phone: '',
            leases: [pointer('Lease', 'l1')],
          });
        },
      });
      await single.open();

      expect(text(single.root.querySelector('dl'))).toContain('sur 1 bail');
      expect(text(single.root.querySelector('dl'))).not.toContain('1 baux');
    });
  });

  describe('lead sentence and plurals', () => {
    it('says « 2 appels à envoyer sur 3 » with the plural', async () => {
      const view = await setup();
      await view.open();

      expect(text(view.root.querySelector('header'))).toContain('2 appels à envoyer sur 3');
    });

    it('says « 1 appel à envoyer sur 3 » with the singular', async () => {
      const view = await setup({
        seed: (fake) => {
          seedStandard(fake);
          fake.seed(
            'Lease',
            'l-commerce',
            storedLease({ name: 'Commerce', price: 100, ...SENT_DEC_2026 }),
          );
        },
      });
      await view.open();

      expect(text(view.root.querySelector('header'))).toContain('1 appel à envoyer sur 3');
      expect(text(view.root.querySelector('header'))).not.toContain('1 appels');
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

    it('does not claim that everything is sent when something is still to send', async () => {
      const view = await setup();
      await view.open();

      expect(text(view.root)).not.toContain('ont été envoyés');
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

    it('names the billing month of the year to come in December', async () => {
      const view = await setup({ now: new Date(2026, 11, 28) });
      await view.open();

      expect(text(banner(view.root))).toBe('Les appels de loyer de janvier 2027 sont à envoyer.');
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

    it('is not shown when there is no lease at all', async () => {
      const empty = await setup({ now: new Date(2026, 10, 25), seed: () => undefined });
      await empty.open();
      expect(banner(empty.root)).toBeUndefined();
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

    it('is the primary button while calls are to send', async () => {
      const view = await setup();
      await view.open();

      const link = actionLink(view.root) as HTMLElement;
      expect(link.classList.contains('btn')).toBe(true);
      expect(link.classList.contains('btn-primary')).toBe(true);
      expect(link.classList.contains('btn-secondary')).toBe(false);
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

    it('is not offered when there is nothing to send (no lease at all)', async () => {
      const view = await setup({ seed: () => undefined });
      await view.open();

      expect(actionLink(view.root)).toBeUndefined();
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

    it('shows a generic error with « Réessayer » for any other failure', async () => {
      const view = await setup({
        before: (fake) => fake.failWhen((call) => call.op === 'find', parseError(1, 'boom')),
      });
      await view.open();

      expect(text(view.root.querySelector('app-error-state'))).toContain('Une erreur est survenue');
      expect(text(view.root)).not.toContain('boom');
      expect(retryButton(view.root)).toBeDefined();
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

    it('reads the date again on « Réessayer »: a page left open over a month change follows it', async () => {
      const view = await setup({
        now: new Date(2026, 10, 25),
        before: (fake) => fake.failWhen((call) => call.op === 'find', parseError(100)),
      });
      await view.open();
      expect(text(view.root.querySelector('h1'))).toBe('Décembre 2026');

      view.clock.now = new Date(2026, 11, 28);
      retryButton(view.root)?.click();
      await view.settle();

      expect(text(view.root.querySelector('h1'))).toBe('Janvier 2027');
      expect(text(banner(view.root))).toBe('Les appels de loyer de janvier 2027 sont à envoyer.');
    });

    it('disables « Réessayer » while the retry runs, so a second tap starts no second request', async () => {
      const view = await setup({
        before: (fake) => fake.failWhen((call) => call.op === 'find', parseError(100)),
      });
      await view.open();
      view.fake.hangWhen((call) => call.op === 'find');

      retryButton(view.root)?.click();
      view.harness.detectChanges();
      const button = retryButton(view.root) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      button.click();
      await view.settle();

      expect(view.fake.callsOf('find', 'Leaseholder')).toHaveLength(2);
      // Still the error state (not an endless spinner in its place) until the retry answers.
      expect(view.root.querySelector('app-error-state')).not.toBeNull();
    });

    it('fails again on retry: the error state stays with a working « Réessayer »', async () => {
      const view = await setup({
        before: (fake) => fake.failWhen((call) => call.op === 'find', parseError(100), false),
      });
      await view.open();

      retryButton(view.root)?.click();
      await view.settle();

      expect(view.fake.callsOf('find', 'Leaseholder')).toHaveLength(2);
      expect((retryButton(view.root) as HTMLButtonElement).disabled).toBe(false);
      expect(text(view.root.querySelector('app-error-state'))).toContain('Connexion requise');
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

    it('recovers from a timeout with « Réessayer »', async () => {
      vi.useFakeTimers();
      const view = await setup({
        before: (fake) => fake.hangWhen((call) => call.op === 'find'),
      });
      await view.open();
      await vi.advanceTimersByTimeAsync(20_000);
      await view.settle();

      retryButton(view.root)?.click();
      await view.settle();

      expect(rowsOf(view.root)).toHaveLength(3);
      expect(view.root.querySelector('app-error-state')).toBeNull();
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

    it('while the redirect is pending after a 209, shows neither an error nor the empty state', async () => {
      // No /login route here: the redirect cannot complete, so the page stays on screen and what it
      // shows in the meantime is what a user would see for an instant before the login screen.
      const view = await setup({
        routes: false,
        before: (fake) => fake.failWhen((call) => call.op === 'find', parseError(209)),
      });
      await view.open();

      expect(view.root.querySelector('[role="alert"]')).toBeNull();
      expect(view.root.querySelector('app-error-state')).toBeNull();
      expect(view.root.querySelector('app-empty-state')).toBeNull();
      expect(text(view.root)).not.toContain('Session expirée');
      expect(text(view.root)).not.toContain('Aucun bail');
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

    it('then shows the fresh data when the load answers', async () => {
      const view = await setup();
      await view.open();
      expect(kpi(view.root, 'À envoyer')).toBe('2');

      // Meanwhile the send screen recorded a send: the server now holds the new status.
      view.fake.seed(
        'Lease',
        'l-studio',
        storedLease({ name: 'Studio', price: 600, ...SENT_DEC_2026 }),
      );
      await leaveAndComeBack(view);
      await view.settle();

      expect(kpi(view.root, 'À envoyer')).toBe('1');
      expect(kpi(view.root, 'Envoyés')).toBe('2');
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

    it("disables the notice's « Réessayer » while the reload it started runs, rows still on screen", async () => {
      const view = await setup();
      await view.open();
      view.fake.failWhen((call) => call.op === 'find', parseError(100));
      await leaveAndComeBack(view);
      await view.settle();
      expect(view.root.querySelector('[role="alert"]')).not.toBeNull();
      view.fake.hangWhen((call) => call.op === 'find');

      retryButton(view.root)?.click();
      view.harness.detectChanges();

      const button = retryButton(view.root) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-busy')).toBe('true');
      button.click();
      await view.settle();
      // The visit, the failing reload and the one retry: a second tap started nothing.
      expect(view.fake.callsOf('find', 'Leaseholder')).toHaveLength(3);
      expect(rowsOf(view.root)).toHaveLength(3);
    });

    it('shows the skeleton on return when the account has no data in memory yet', async () => {
      const view = await setup({ seed: () => undefined });
      await view.open();
      expect(view.root.querySelector('app-empty-state')).not.toBeNull();
      view.fake.hangWhen((call) => call.op === 'find');

      await leaveAndComeBack(view);
      await view.settle();

      expect(isBusy(view.root)).toBe(true);
    });
  });

  describe('one load at a time', () => {
    it('does not start a second load while one is in flight', async () => {
      const view = await setup({
        before: (fake) => fake.hangWhen((call) => call.op === 'find', false),
      });
      const page = await view.harness.navigateByUrl('/appels', RentCallsPage);
      await view.settle();
      expect(view.fake.callsOf('find', 'Leaseholder')).toHaveLength(1);

      const refresh = (page as unknown as { refresh(): Promise<void> }).refresh.bind(page);
      void refresh();
      void refresh();
      await view.settle();

      expect(view.fake.callsOf('find', 'Leaseholder')).toHaveLength(1);
    });
  });

  describe('leases without an objectId', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('renders every one of them, with no duplicate-key warning even when the names are identical', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const bare = (price: number): Lease => ({
        isPro: false,
        name: 'Garage',
        lot: null,
        streetNumber: 1,
        streetName: 'rue A',
        optionalAddressInfo: '',
        postalCode: 13600,
        city: 'Ville-Test',
        price,
        charge: null,
        additionalCharges: [],
        lastSendDate: 0,
        renewalDate: null,
      });
      const holders: Leaseholder[] = [
        {
          objectId: 'h1',
          name: 'Dupont',
          email: 'dupont@example.test',
          phone: '',
          leases: [bare(80), bare(90)],
        },
        { name: 'Dupont', email: 'autre@example.test', phone: '', leases: [bare(100)] },
      ];
      const source = signal(holders);
      TestBed.configureTestingModule({
        providers: [
          {
            provide: LeaseholderRepository,
            useValue: { leaseholders: source.asReadonly(), load: async () => undefined },
          },
          { provide: NOW, useValue: () => new Date(2026, 10, 25) },
          provideRouter([{ path: 'appels', component: RentCallsPage }]),
        ],
      });
      const harness = await RouterTestingHarness.create('/appels');
      for (let i = 0; i < 40; i++) {
        await Promise.resolve();
      }
      harness.detectChanges();
      const root = harness.routeNativeElement as HTMLElement;
      const amounts = () => rowsOf(root).map((row) => plain(text(row.children[3])));

      expect(amounts()).toEqual(['80 €', '90 €', '100 €']);

      // A second render, from new objects with other amounts and one more lease: Angular compares the
      // new keys with the previous ones, which is where duplicate keys are reported (NG0955).
      source.set([
        { ...holders[0], leases: [bare(85), bare(95), bare(70)] },
        { ...holders[1], leases: [bare(105)] },
      ]);
      harness.detectChanges();

      expect(amounts()).toEqual(['85 €', '95 €', '70 €', '105 €']);
      const logged = [...warn.mock.calls, ...error.mock.calls].map((args) => String(args[0]));
      expect(logged.filter((line) => line.includes('NG0955'))).toEqual([]);
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
