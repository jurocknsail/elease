import { provideLocationMocks } from '@angular/common/testing';
import { Component, effect, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { APP_ENV, AppEnv } from '../../core/app-env';
import { NOW } from '../../core/clock';
import { RentCallSender, SEND_CLOCK } from '../../core/email/rent-call-sender';
import { LeaseholderRepository } from '../../core/parse/leaseholder.repository';
import { ParseClient } from '../../core/parse/parse-client';
import {
  FakeCall,
  FakeParseClient,
  parseError,
  pointer,
} from '../../core/parse/testing/fake-parse-client';
import { PDF_RENDERER, PdfRenderError, RenderedPdf } from '../../core/pdf/pdf-render';
import { ConfirmDialog, ConfirmDialogOptions } from '../../shared/ui/confirm-dialog';
import { PdfViewer } from '../../shared/ui/pdf-viewer';
import { SendPage, WIDE_LAYOUT } from './send.page';

/*
 * Everything is fake here: the Parse client (FakeParseClient answers `sendEmail` itself, no request
 * ever leaves), the PDF renderer, the confirmation dialog and the PDF viewer. Only fictitious data.
 */

const TEST_ADDRESS = 'julien.berger1421@gmail.com';

@Component({ template: '<p>autre page</p>' })
class OtherPage {}

/** Stands for the real viewer: records the blobs it was given. */
@Component({ selector: 'app-pdf-viewer', template: '<div data-stub-viewer></div>' })
class StubViewer {
  static seen: Array<Blob | null> = [];
  readonly blob = input<Blob | null>(null);
  constructor() {
    effect(() => {
      StubViewer.seen.push(this.blob());
    });
  }
}

/** The renderer: instant by default, or controlled by the spec (`manual`). Identifies the lease by name. */
class FakeRenderer {
  readonly calls: Array<{ lease: string; def: TDocumentDefinitions }> = [];
  readonly results: Array<{ lease: string; rendered: RenderedPdf }> = [];
  manual = false;
  failFor = new Set<string>();
  active = 0;
  maxActive = 0;
  private readonly waiting: Array<{
    lease: string;
    finish: () => void;
    fail: (e: unknown) => void;
  }> = [];
  private count = 0;

  readonly render = (def: TDocumentDefinitions): Promise<RenderedPdf> => {
    const json = JSON.stringify(def);
    const lease =
      ['Studio', 'Garage', 'Commerce', 'Cave', 'Box', 'Loft'].find((name) => json.includes(name)) ??
      'inconnu';
    this.calls.push({ lease, def });
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    return new Promise<RenderedPdf>((resolve, reject) => {
      const finish = () => {
        this.active -= 1;
        this.count += 1;
        const content = `%PDF-fake ${this.count} ${lease}`;
        const rendered = {
          blob: new Blob([content], { type: 'application/pdf' }),
          base64: btoa(content),
        };
        this.results.push({ lease, rendered });
        resolve(rendered);
      };
      const fail = (error: unknown) => {
        this.active -= 1;
        reject(error);
      };
      if (this.failFor.has(lease)) {
        fail(new PdfRenderError('La génération du PDF ne répond pas.'));
      } else if (this.manual) {
        this.waiting.push({ lease, finish, fail });
      } else {
        finish();
      }
    });
  };

  /** Finishes the oldest waiting render (manual mode). */
  finishNext(): void {
    this.waiting.shift()?.finish();
  }

  get pending(): number {
    return this.waiting.length;
  }

  rendersOf(lease: string): number {
    return this.calls.filter((call) => call.lease === lease).length;
  }

  lastResult(lease: string): RenderedPdf | undefined {
    return this.results.filter((result) => result.lease === lease).at(-1)?.rendered;
  }
}

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

interface SeedOptions {
  dupontEmail?: string;
  martinEmail?: string;
}

/** Dupont: Studio 600 (to send), Garage 80 (sent). Martin: Commerce, pro, 1 653,80 (to send). */
function seedStandard(fake: FakeParseClient, options: SeedOptions = {}): void {
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
    email: options.dupontEmail ?? TEST_ADDRESS,
    phone: '',
    leases: [pointer('Lease', 'l-studio'), pointer('Lease', 'l-garage')],
  });
  fake.seed('Leaseholder', 'h-martin', {
    name: 'Martin',
    email: options.martinEmail ?? TEST_ADDRESS,
    phone: '',
    leases: [pointer('Lease', 'l-commerce')],
  });
  fake.seed('Leaseholder', 'h-sans-bail', {
    name: 'Sans bail',
    email: 'sansbail@example.test',
    phone: '',
    leases: [],
  });
}

const DEV_ENV: AppEnv = { production: false, sandbox: false, testRecipientEmail: TEST_ADDRESS };
/** Production-like, to have several distinct recipients: the fake client never reaches a server. */
const PROD_ENV: AppEnv = { production: true, sandbox: false };

interface SetupOptions {
  now?: Date;
  env?: AppEnv;
  wide?: boolean;
  seed?: (fake: FakeParseClient) => void;
  before?: (fake: FakeParseClient) => void;
  manualRender?: boolean;
  /** Called with each confirmation before it answers. */
  onConfirm?: (options: ConfirmDialogOptions) => void | Promise<void>;
  answers?: boolean[];
}

async function setup(options: SetupOptions = {}) {
  StubViewer.seen = [];
  const fake = new FakeParseClient();
  fake.userName = 'julien';
  (options.seed ?? seedStandard)(fake);
  options.before?.(fake);
  const renderer = new FakeRenderer();
  renderer.manual = options.manualRender ?? false;
  const wide = signal(options.wide ?? true);
  const answers = [...(options.answers ?? [])];
  const dialog = {
    opened: [] as ConfirmDialogOptions[],
    open: async (config: ConfirmDialogOptions): Promise<boolean> => {
      dialog.opened.push(config);
      await options.onConfirm?.(config);
      return answers.length > 0 ? (answers.shift() as boolean) : true;
    },
  };
  const clock = { now: options.now ?? new Date(2026, 10, 25, 9, 30) };
  TestBed.configureTestingModule({
    providers: [
      { provide: ParseClient, useValue: fake },
      { provide: NOW, useValue: () => new Date(clock.now) },
      { provide: SEND_CLOCK, useValue: () => SENT_AT },
      { provide: APP_ENV, useValue: options.env ?? DEV_ENV },
      { provide: PDF_RENDERER, useValue: renderer.render },
      { provide: ConfirmDialog, useValue: dialog },
      { provide: WIDE_LAYOUT, useValue: wide },
      provideLocationMocks(),
      provideRouter([
        { path: 'appels/envoi', component: SendPage },
        { path: 'locataires', component: OtherPage },
        { path: 'login', component: OtherPage },
      ]),
    ],
  });
  TestBed.overrideComponent(SendPage, {
    remove: { imports: [PdfViewer] },
    add: { imports: [StubViewer] },
  });
  const harness = await RouterTestingHarness.create();
  const view = {
    fake,
    renderer,
    dialog,
    wide,
    harness,
    router: TestBed.inject(Router),
    repository: TestBed.inject(LeaseholderRepository),
    page: undefined as unknown as SendPage,
    get root(): HTMLElement {
      return harness.routeNativeElement as HTMLElement;
    },
    async settle() {
      for (let round = 0; round < 3; round++) {
        for (let i = 0; i < 60; i++) {
          await Promise.resolve();
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
        harness.detectChanges();
      }
    },
    async open() {
      // The router listens to the (mock) browser history: the Back button works as in the app.
      view.router.initialNavigation();
      view.page = await harness.navigateByUrl('/appels/envoi', SendPage);
      harness.detectChanges();
      await view.settle();
    },
  };
  return view;
}

type View = Awaited<ReturnType<typeof setup>>;

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
const plain = (value: string) =>
  value.replace(
    new RegExp('[' + String.fromCharCode(0xa0) + String.fromCharCode(0x202f) + ']', 'g'),
    ' ',
  );
const rowsOf = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[role="option"]')];
const sendButton = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('footer button')!;
const reason = (root: HTMLElement) => text(root.querySelector('#send-reason'));
const buttons = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].filter((b) => text(b) === label);
const clouds = (fake: FakeParseClient): FakeCall[] => fake.callsOf('cloud');
const attachmentsOf = (call: FakeCall) =>
  (call.params?.['attachments'] as Array<{ Filename: string; Base64Content: string }>) ?? [];

function dispatchKey(element: Element, key: string): void {
  element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

function typeDate(view: View, value: string): void {
  const input = view.root.querySelector<HTMLInputElement>('#send-date')!;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('SendPage', () => {
  describe('opening', () => {
    it('shows the period, the due date, the date field and one row per lease (none for a tenant without lease)', async () => {
      const view = await setup();
      await view.open();

      expect(text(view.root.querySelector('h1'))).toBe('Appels de loyer — décembre 2026');
      expect(text(view.root)).toContain('Échéance : 1er décembre 2026');
      const input = view.root.querySelector<HTMLInputElement>('#send-date')!;
      expect(input.type).toBe('date');
      expect(input.value).toBe('2026-11-25');
      expect(view.root.querySelector('label[for="send-date"]')?.textContent).toContain(
        "Date de l'appel",
      );
      expect(rowsOf(view.root).map((row) => plain(text(row)))).toEqual([
        expect.stringContaining('Garage'),
        expect.stringContaining('Studio'),
        expect.stringContaining('Commerce'),
      ]);
    });

    it('loads fresh data from the backend every time it opens (S1)', async () => {
      const view = await setup();
      await view.open();

      expect(view.fake.callsOf('find', 'Leaseholder')).toHaveLength(1);
      expect(view.fake.callsOf('find', 'LandlordProfile')).toHaveLength(1);
    });

    it('shows a skeleton, marked busy, while loading', async () => {
      const view = await setup({
        before: (fake) =>
          fake.hangWhen((call) => call.op === 'find' && call.className === 'Leaseholder'),
      });
      await view.open();

      expect(view.root.querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(rowsOf(view.root)).toHaveLength(0);
      expect(sendButton(view.root).disabled).toBe(true);
    });

    it('selects what is still to send, not what is sent, and previews the first selected row', async () => {
      const view = await setup();
      await view.open();

      const rows = rowsOf(view.root);
      expect(rows.map((row) => row.getAttribute('aria-selected'))).toEqual([
        'false',
        'true',
        'true',
      ]);
      expect(
        view.root.querySelector('[role="listbox"]')?.getAttribute('aria-activedescendant'),
      ).toBe(rows[1].id);
      expect(plain(text(rows[0]))).toContain('Envoyé');
      expect(plain(text(rows[1]))).toContain('À envoyer');
      expect(plain(text(rows[2]))).toContain('1 653,80');
    });

    it('announces the selection in the footer: « N sélectionnés · total »', async () => {
      const view = await setup();
      await view.open();

      expect(plain(text(view.root.querySelector('footer')))).toContain(
        '2 sélectionnés · 2 253,80 €',
      );
      expect(text(sendButton(view.root))).toBe('Envoyer 2 appels');
    });

    it('says « Envoyer 1 appel » in the singular', async () => {
      const view = await setup();
      await view.open();

      dispatchKey(view.root.querySelector('[role="listbox"]')!, ' ');
      view.harness.detectChanges();

      expect(text(sendButton(view.root))).toBe('Envoyer 1 appel');
      expect(plain(text(view.root.querySelector('footer')))).toContain(
        '1 sélectionné · 1 653,80 €',
      );
    });
  });

  describe('PDF generation', () => {
    it('generates every selected PDF up-front, once each, and enables sending only when all are ready (S6)', async () => {
      const view = await setup({ manualRender: true });
      await view.open();

      expect(sendButton(view.root).disabled).toBe(true);
      expect(reason(view.root)).toBe('Génération des PDF en cours…');

      view.renderer.finishNext();
      await view.settle();
      expect(sendButton(view.root).disabled).toBe(true);

      view.renderer.finishNext();
      await view.settle();
      expect(sendButton(view.root).disabled).toBe(false);
      expect(view.renderer.calls.map((call) => call.lease).sort()).toEqual(['Commerce', 'Studio']);
    });

    it('bounds the parallelism: with 6 leases to send, at most 2 render at a time', async () => {
      const view = await setup({
        manualRender: true,
        seed: (fake) => {
          const names = ['Studio', 'Garage', 'Commerce', 'Cave', 'Box', 'Loft'];
          names.forEach((name) => fake.seed('Lease', `l-${name}`, storedLease({ name })));
          fake.seed('Leaseholder', 'h-x', {
            name: 'Dupont',
            email: TEST_ADDRESS,
            phone: '',
            leases: names.map((name) => pointer('Lease', `l-${name}`)),
          });
        },
      });
      await view.open();

      expect(view.renderer.calls).toHaveLength(2);
      for (let i = 0; i < 6; i++) {
        view.renderer.finishNext();
        await view.settle();
      }
      expect(view.renderer.calls).toHaveLength(6);
      expect(view.renderer.maxActive).toBeLessThanOrEqual(2);
      expect(sendButton(view.root).disabled).toBe(false);
    });

    it('shows « Génération… » on a row that is being generated', async () => {
      const view = await setup({ manualRender: true });
      await view.open();

      expect(rowsOf(view.root).some((row) => text(row).includes('Génération…'))).toBe(true);
      expect(view.root.querySelector('[role="listbox"]')?.getAttribute('aria-busy')).toBe('true');
    });

    it('a failed render shows « Échec de la génération » and keeps sending blocked; « Réessayer » renders only that lease again', async () => {
      const view = await setup();
      view.renderer.failFor.add('Commerce');
      await view.open();

      const commerce = rowsOf(view.root)[2];
      expect(text(commerce)).toContain('Échec de la génération');
      expect(sendButton(view.root).disabled).toBe(true);
      expect(reason(view.root)).toBe('La génération de certains PDF a échoué : réessayez');
      // The pane of the previewed lease says it and offers the retry.
      dispatchKey(view.root.querySelector('[role="listbox"]')!, 'ArrowDown');
      view.harness.detectChanges();
      expect(text(view.root.querySelector('[role="alert"]'))).toContain(
        'La génération du PDF ne répond pas.',
      );

      view.renderer.failFor.clear();
      const rendersBefore = view.renderer.calls.length;
      buttons(view.root, 'Réessayer')[0].click();
      await view.settle();

      expect(view.renderer.calls.length).toBe(rendersBefore + 1);
      expect(view.renderer.rendersOf('Studio')).toBe(1);
      expect(sendButton(view.root).disabled).toBe(false);
    });

    it('deselecting never deletes a PDF, and selecting again does not render again', async () => {
      const view = await setup();
      await view.open();
      expect(view.renderer.calls).toHaveLength(2);
      const list = view.root.querySelector('[role="listbox"]')!;

      dispatchKey(list, ' '); // deselect Studio (the previewed row)
      view.harness.detectChanges();
      expect(rowsOf(view.root)[1].getAttribute('aria-selected')).toBe('false');
      dispatchKey(list, ' '); // select it again
      view.harness.detectChanges();
      await view.settle();

      expect(rowsOf(view.root)[1].getAttribute('aria-selected')).toBe('true');
      expect(view.renderer.calls).toHaveLength(2);
      expect(sendButton(view.root).disabled).toBe(false);
    });

    it('selecting a lease that has no PDF yet generates just that one', async () => {
      const view = await setup();
      await view.open();
      const list = view.root.querySelector('[role="listbox"]')!;

      dispatchKey(list, 'ArrowUp'); // Garage (sent, not selected)
      dispatchKey(list, ' ');
      view.harness.detectChanges();
      await view.settle();

      expect(view.renderer.rendersOf('Garage')).toBe(1);
      expect(view.renderer.rendersOf('Studio')).toBe(1);
    });
  });

  describe('call date', () => {
    it('changing the date to another month recomputes the period, the due date, the statuses, the selection and the PDFs', async () => {
      const view = await setup();
      await view.open();
      expect(view.renderer.calls).toHaveLength(2);

      typeDate(view, '2026-12-25');
      view.harness.detectChanges();
      await view.settle();

      expect(text(view.root.querySelector('h1'))).toBe('Appels de loyer — janvier 2027');
      expect(text(view.root)).toContain('Échéance : 1er janvier 2027');
      // Garage was sent for December, not for January: it is now to send, and selected.
      expect(rowsOf(view.root).map((row) => row.getAttribute('aria-selected'))).toEqual([
        'true',
        'true',
        'true',
      ]);
      expect(plain(text(rowsOf(view.root)[0]))).toContain('À envoyer');
      expect(view.renderer.calls).toHaveLength(2 + 3);
      expect(sendButton(view.root).disabled).toBe(false);
    });

    it('a change inside the same month regenerates the PDFs (they print the date) but keeps the selection', async () => {
      const view = await setup();
      await view.open();
      const list = view.root.querySelector('[role="listbox"]')!;
      dispatchKey(list, ' '); // deselect Studio
      view.harness.detectChanges();

      typeDate(view, '2026-11-26');
      view.harness.detectChanges();
      await view.settle();

      expect(text(view.root.querySelector('h1'))).toBe('Appels de loyer — décembre 2026');
      expect(rowsOf(view.root)[1].getAttribute('aria-selected')).toBe('false');
      expect(rowsOf(view.root)[2].getAttribute('aria-selected')).toBe('true');
      // The selection (Commerce) and the previewed row (Studio) are generated again.
      expect(view.renderer.calls).toHaveLength(2 + 2);
    });

    it('invalidates the PDFs of the old date: sending stays blocked until the new ones are ready, and a late render of the old date is never used', async () => {
      const view = await setup({ manualRender: true });
      await view.open();
      expect(view.renderer.pending).toBe(2);

      typeDate(view, '2026-11-26');
      view.harness.detectChanges();
      // The two renders of the old date are still running: the limit holds, nothing new starts yet.
      expect(view.renderer.calls).toHaveLength(2);

      view.renderer.finishNext();
      view.renderer.finishNext();
      await view.settle();
      // The old renders ended: they are ignored. The new ones started.
      expect(view.renderer.calls).toHaveLength(4);
      expect(sendButton(view.root).disabled).toBe(true);
      expect(reason(view.root)).toBe('Génération des PDF en cours…');

      view.renderer.finishNext();
      view.renderer.finishNext();
      await view.settle();
      expect(sendButton(view.root).disabled).toBe(false);
      // Only the renders of the new date count: the byte-identity test below checks which are sent.
      expect(view.renderer.maxActive).toBeLessThanOrEqual(2);
    });

    it('an empty or invalid date blocks sending and says so; the last valid date stays in force', async () => {
      const view = await setup();
      await view.open();

      typeDate(view, '');
      view.harness.detectChanges();

      expect(sendButton(view.root).disabled).toBe(true);
      expect(reason(view.root)).toBe("Saisissez une date d'appel valide");
      expect(view.root.querySelector('#send-date')?.getAttribute('aria-invalid')).toBe('true');
      expect(text(view.root.querySelector('h1'))).toBe('Appels de loyer — décembre 2026');

      typeDate(view, '2026-11-25');
      view.harness.detectChanges();
      expect(sendButton(view.root).disabled).toBe(false);
    });
  });

  describe('confirmation', () => {
    it('says what goes out: e-mails, tenants, total, and that nothing is delivered in test mode', async () => {
      const view = await setup();
      await view.open();

      sendButton(view.root).click();
      await view.settle();

      expect(view.dialog.opened).toHaveLength(1);
      const [config] = view.dialog.opened;
      expect(config.confirmLabel).toBe('Envoyer');
      // Dupont and Martin share one address: 1 e-mail, 2 tenants.
      expect(plain(config.message)).toContain('1 e-mail à 2 locataires, total 2 253,80 €.');
      expect(config.message).toContain('Mode test : aucun e-mail ne sera livré aux locataires.');
    });

    it('uses the singular, and no test-mode sentence in production', async () => {
      const view = await setup({ env: PROD_ENV });
      await view.open();
      const list = view.root.querySelector('[role="listbox"]')!;
      dispatchKey(list, ' '); // deselect Commerce
      view.harness.detectChanges();

      sendButton(view.root).click();
      await view.settle();

      const [config] = view.dialog.opened;
      expect(plain(config.message)).toContain('1 e-mail à 1 locataire, total 1 653,80 €.');
      expect(config.message).not.toContain('Mode test');
    });

    it('cancelling sends nothing and keeps the selection', async () => {
      const view = await setup({ answers: [false] });
      await view.open();

      sendButton(view.root).click();
      await view.settle();

      expect(clouds(view.fake)).toHaveLength(0);
      expect(
        rowsOf(view.root).filter((row) => row.getAttribute('aria-selected') === 'true'),
      ).toHaveLength(2);
      expect(sendButton(view.root).disabled).toBe(false);
    });

    it('warns when a lease already sent (or perhaps sent) is selected on purpose', async () => {
      const view = await setup();
      await view.open();
      const list = view.root.querySelector('[role="listbox"]')!;
      dispatchKey(list, 'ArrowUp');
      dispatchKey(list, ' '); // select Garage (sent)
      view.harness.detectChanges();
      await view.settle();

      sendButton(view.root).click();
      await view.settle();

      expect(view.dialog.opened[0].message).toContain(
        'Attention : 1 appel déjà envoyé ou peut-être envoyé pour cette période.',
      );
    });
  });

  describe('S1: data that could not be refreshed blocks sending', () => {
    const failLeaseholders = (fake: FakeParseClient) =>
      fake.failWhen(
        (call) => call.op === 'find' && call.className === 'Leaseholder',
        parseError(100, 'Connexion'),
      );

    it('shows a blocking error state with « Réessayer » when nothing could be loaded, and no send is possible', async () => {
      const view = await setup({ before: failLeaseholders });
      await view.open();

      expect(view.root.querySelector('app-error-state')).not.toBeNull();
      expect(sendButton(view.root).disabled).toBe(true);
      expect(reason(view.root)).toBe('Données non actualisées');
      await (view.page as unknown as { send(): Promise<void> }).send();
      expect(view.dialog.opened).toHaveLength(0);
      expect(clouds(view.fake)).toHaveLength(0);

      buttons(view.root, 'Réessayer')[0].click();
      await view.settle();
      expect(view.root.querySelector('app-error-state')).toBeNull();
      expect(rowsOf(view.root)).toHaveLength(3);
      expect(sendButton(view.root).disabled).toBe(false);
    });

    it('with rows already in memory, shows the stale warning, keeps the rows, and blocks sending until a load succeeds', async () => {
      const view = await setup();
      await view.repository.load(); // the home page had loaded them
      failLeaseholders(view.fake);
      await view.open();

      expect(rowsOf(view.root)).toHaveLength(3);
      const alert = [...view.root.querySelectorAll('[role="alert"]')].find((el) =>
        text(el).includes('peuvent ne pas être à jour'),
      );
      expect(alert).toBeDefined();
      expect(sendButton(view.root).disabled).toBe(true);
      expect(reason(view.root)).toBe('Données non actualisées');
      await (view.page as unknown as { send(): Promise<void> }).send();
      expect(view.dialog.opened).toHaveLength(0);
      expect(clouds(view.fake)).toHaveLength(0);

      buttons(view.root, 'Réessayer')[0].click();
      await view.settle();
      expect(sendButton(view.root).disabled).toBe(false);
    });

    it('a failure to load the landlord profile blocks sending too', async () => {
      const view = await setup({
        before: (fake) =>
          fake.failWhen(
            (call) => call.op === 'find' && call.className === 'LandlordProfile',
            parseError(100, 'Connexion'),
          ),
      });
      await view.open();

      expect(sendButton(view.root).disabled).toBe(true);
      expect(reason(view.root)).toBe('Données non actualisées');
    });
  });

  describe('S2: looking again right before sending', () => {
    it('loads again after the confirmation, and sends nothing when a selected lease was sent in the meantime', async () => {
      const view = await setup({
        onConfirm: () => {
          // Another device sends « Studio » while the dialog is open.
          view.fake.seed(
            'Lease',
            'l-studio',
            storedLease({ name: 'Studio', price: 600, ...SENT_DEC_2026 }),
          );
        },
      });
      await view.open();
      const loadsBefore = view.fake.callsOf('find', 'Leaseholder').length;

      sendButton(view.root).click();
      await view.settle();

      expect(view.fake.callsOf('find', 'Leaseholder').length).toBeGreaterThan(loadsBefore);
      expect(clouds(view.fake)).toHaveLength(0);
      expect(text(view.root)).toContain(
        'Certains baux ont déjà été envoyés entre-temps : vérifiez la sélection.',
      );
      const rows = rowsOf(view.root);
      const studio = rows.find((row) => text(row).includes('Studio'))!;
      expect(studio.getAttribute('aria-selected')).toBe('false');
      expect(plain(text(studio))).toContain('Envoyé');
      // The other lease is still selected, and sending is possible again.
      expect(
        rows.find((row) => text(row).includes('Commerce'))!.getAttribute('aria-selected'),
      ).toBe('true');
    });

    it('sends nothing when the data cannot be read again', async () => {
      const view = await setup({
        onConfirm: () =>
          view.fake.failWhen(
            (call) => call.op === 'find' && call.className === 'Leaseholder',
            parseError(100, 'Connexion'),
          ),
      });
      await view.open();

      sendButton(view.root).click();
      await view.settle();

      expect(clouds(view.fake)).toHaveLength(0);
      expect(text(view.root)).toContain(
        "Impossible de vérifier l'état des envois : rien n'a été envoyé.",
      );
      expect(sendButton(view.root).disabled).toBe(true);
      expect(reason(view.root)).toBe('Données non actualisées');
    });

    it('sends nothing when a lease changed since its PDF was previewed; the PDF is generated again', async () => {
      const view = await setup({
        onConfirm: () => {
          // The rent of « Studio » is changed elsewhere while the dialog is open.
          view.fake.seed('Lease', 'l-studio', storedLease({ name: 'Studio', price: 650 }));
        },
      });
      await view.open();
      expect(view.renderer.rendersOf('Studio')).toBe(1);

      sendButton(view.root).click();
      await view.settle();

      expect(clouds(view.fake)).toHaveLength(0);
      expect(text(view.root)).toContain('Les informations de certains baux ont changé');
      expect(view.renderer.rendersOf('Studio')).toBe(2);
      // The new PDF is ready: the user may now preview it and send again.
      expect(sendButton(view.root).disabled).toBe(false);
    });
  });

  describe('S3: a second click never sends twice', () => {
    it('two clicks in a row open one confirmation and send once', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const view = await setup({ onConfirm: () => gate });
      await view.open();

      const button = sendButton(view.root);
      button.click();
      button.click();
      await (view.page as unknown as { send(): Promise<void> }).send();
      expect(view.dialog.opened).toHaveLength(1);

      release();
      await view.settle();

      expect(view.dialog.opened).toHaveLength(1);
      expect(clouds(view.fake)).toHaveLength(1);
    });

    it('the button is disabled and says so while a send runs', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const view = await setup({ onConfirm: () => gate });
      await view.open();

      sendButton(view.root).click();
      await view.settle();
      expect(sendButton(view.root).disabled).toBe(true);
      expect(reason(view.root)).toBe('Envoi en cours…');
      expect(view.root.querySelector<HTMLInputElement>('#send-date')!.disabled).toBe(true);

      release();
      await view.settle();
    });
  });

  describe('S4/S7: the sender is used as built, nothing real is ever called', () => {
    it('sends one e-mail with the sandbox flag, the subject of the period, the test address and one attachment per lease', async () => {
      const view = await setup();
      await view.open();

      sendButton(view.root).click();
      await view.settle();

      const calls = clouds(view.fake);
      expect(calls).toHaveLength(1);
      expect(calls[0].functionName).toBe('sendEmail');
      expect(calls[0].params?.['sandbox']).toBe(true);
      expect(calls[0].params?.['recipientEmail']).toBe(TEST_ADDRESS);
      expect(calls[0].params?.['subject']).toBe('Appel de loyer — décembre 2026');
      expect(attachmentsOf(calls[0]).map((a) => a.Filename)).toEqual([
        'dupont-studio-12_2026.pdf',
        'martin-commerce-12_2026.pdf',
      ]);
    });

    it('a tenant with another address is refused by the guard in development: a failed result and no request', async () => {
      const view = await setup({
        seed: (fake) => seedStandard(fake, { martinEmail: 'martin@example.test' }),
      });
      await view.open();

      sendButton(view.root).click();
      await view.settle();

      const calls = clouds(view.fake);
      expect(calls).toHaveLength(1);
      expect(calls[0].params?.['recipientEmail']).toBe(TEST_ADDRESS);
      const results = view.root.querySelector('[role="status"]')!;
      expect(text(results)).toContain('martin@example.test');
      expect(text(results)).toContain('Échec');
      expect(JSON.stringify(calls)).not.toContain('martin@example.test');
    });
  });

  describe('the confirmed selection is the one that is sent', () => {
    it('a check box toggled after the confirmation does not change the e-mails that go out', async () => {
      const view = await setup({
        onConfirm: () => {
          // The user clicks on a row after confirming, while the data is read again.
          dispatchKey(view.root.querySelector('[role="listbox"]')!, ' ');
        },
      });
      await view.open();

      sendButton(view.root).click();
      await view.settle();

      const sent = attachmentsOf(clouds(view.fake)[0]).map((a) => a.Filename);
      expect(sent).toEqual(['dupont-studio-12_2026.pdf', 'martin-commerce-12_2026.pdf']);
    });
  });

  describe('an e-mail send that is running blocks every instance of the page (app-wide guard)', () => {
    it('a page opened again while a send is pending cannot send, and comes back after a fresh load once it ends', async () => {
      let finish!: () => void;
      const pending = new Promise<unknown>((resolve) => (finish = () => resolve([])));
      const view = await setup();
      const sender = TestBed.inject(RentCallSender);
      const sendAll = vi
        .spyOn(sender as unknown as { sendAll: () => Promise<unknown> }, 'sendAll')
        .mockImplementation(() => pending);
      await view.open();
      sendButton(view.root).click();
      await view.settle();
      expect(sendAll).toHaveBeenCalledTimes(1);
      expect(sender.inFlight()).toBe(1);

      // The user goes to another screen and comes back: a NEW instance of the page.
      await view.harness.navigateByUrl('/locataires');
      await view.open();
      const dialogsBefore = view.dialog.opened.length;
      expect(sendButton(view.root).disabled).toBe(true);
      expect(reason(view.root)).toBe('Envoi en cours…');
      await (view.page as unknown as { send(): Promise<void> }).send();
      expect(sendAll).toHaveBeenCalledTimes(1);
      expect(view.dialog.opened.length).toBe(dialogsBefore);

      const loadsBefore = view.fake.callsOf('find', 'Leaseholder').length;
      finish();
      await view.settle();

      expect(sender.inFlight()).toBe(0);
      expect(view.fake.callsOf('find', 'Leaseholder').length).toBeGreaterThan(loadsBefore);
      expect(sendButton(view.root).disabled).toBe(false);
    });

    it('« Réessayer » and « Marquer comme envoyé » do nothing while a send is running elsewhere', async () => {
      const view = await setup({
        before: (fake) =>
          fake.failWhen((call) => call.op === 'cloud', parseError(100, 'Connexion perdue')),
      });
      await view.open();
      sendButton(view.root).click();
      await view.settle();
      const sender = TestBed.inject(RentCallSender);
      sender.inFlight.set(1); // another page's send
      const opened = view.dialog.opened.length;

      buttons(view.root, 'Marquer comme envoyé')[0].click();
      await view.settle();

      expect(view.dialog.opened.length).toBe(opened);
      expect(view.fake.callsOf('save', 'Lease')).toHaveLength(0);
    });
  });

  describe('test mode and maybe-sent flags', () => {
    it('shows « Mode test » and says nothing is delivered also in production with the sandbox on', async () => {
      const view = await setup({ env: { production: true, sandbox: true } });
      await view.open();
      expect(text(view.root.querySelector('header'))).toContain('Mode test');

      sendButton(view.root).click();
      await view.settle();

      expect(view.dialog.opened[0].message).toContain('Mode test : aucun e-mail ne sera livré');
    });

    it('delivered but not recorded: the leases show « Peut-être envoyé » and re-selecting them is warned about', async () => {
      const view = await setup({
        before: (fake) =>
          fake.failWhen(
            (call) => call.op === 'save' && call.className === 'Lease',
            parseError(141, 'refus'),
          ),
      });
      await view.open();
      sendButton(view.root).click();
      await view.settle();

      // Studio was not recorded (its save failed once): its row is flagged; select it again.
      const flagged = rowsOf(view.root).filter((row) =>
        plain(text(row)).includes('Peut-être envoyé'),
      );
      expect(flagged.length).toBeGreaterThan(0);
      (flagged[0].querySelector('span[aria-hidden="true"]') as HTMLElement).click();
      view.harness.detectChanges();
      await view.settle();
      sendButton(view.root).click();
      await view.settle();

      const second = view.dialog.opened.at(-1)!;
      expect(second.message).toContain('Attention : 1 appel déjà envoyé ou peut-être envoyé');
      expect(second.confirmLabel).toBe('Envoyer quand même');
    });

    it('the confirm label is plain « Envoyer » when nothing is repeated', async () => {
      const view = await setup();
      await view.open();
      sendButton(view.root).click();
      await view.settle();
      expect(view.dialog.opened[0].confirmLabel).toBe('Envoyer');
    });
  });

  describe('byte identity: what is previewed is what is sent', () => {
    it('sends the base64 of the very render that was previewed, and never renders again', async () => {
      const view = await setup();
      await view.open();
      const rendersBefore = view.renderer.calls.length;
      const list = view.root.querySelector('[role="listbox"]')!;
      // Studio is previewed first; move to Commerce to preview it too.
      dispatchKey(list, 'ArrowDown');
      view.harness.detectChanges();
      await view.settle();
      const previewed = StubViewer.seen.filter((blob): blob is Blob => blob !== null);
      expect(previewed.length).toBeGreaterThan(1);
      expect(previewed.at(-1)).toBe(view.renderer.lastResult('Commerce')!.blob);
      expect(previewed).toContain(view.renderer.lastResult('Studio')!.blob);

      sendButton(view.root).click();
      await view.settle();

      expect(view.renderer.calls.length).toBe(rendersBefore);
      const sent = attachmentsOf(clouds(view.fake)[0]);
      expect(sent).toHaveLength(2);
      expect(sent.map((a) => a.Base64Content).sort()).toEqual(
        [
          view.renderer.lastResult('Commerce')!.base64,
          view.renderer.lastResult('Studio')!.base64,
        ].sort(),
      );
      // The previewed blob decodes to the same bytes as the attachment.
      expect(await previewed.at(-1)!.text()).toBe(atob(sent[1].Base64Content));
      expect(await view.renderer.lastResult('Studio')!.blob.text()).toBe(
        atob(sent[0].Base64Content),
      );
    });

    it('after a date change, only the PDFs of the new date are sent', async () => {
      const view = await setup();
      await view.open();
      typeDate(view, '2026-11-26');
      view.harness.detectChanges();
      await view.settle();
      const afterChange = view.renderer.calls.length;

      sendButton(view.root).click();
      await view.settle();

      expect(view.renderer.calls.length).toBe(afterChange);
      const newest = new Set(
        ['Commerce', 'Studio'].map((lease) => view.renderer.lastResult(lease)!.base64),
      );
      expect(new Set(attachmentsOf(clouds(view.fake)[0]).map((a) => a.Base64Content))).toEqual(
        newest,
      );
    });
  });

  describe('S5: results', () => {
    it('delivered: « Envoyé », the address isolated left-to-right, the test-mode banner, statuses refreshed, selection cleared', async () => {
      const view = await setup({ env: { ...DEV_ENV, sandbox: true } });
      await view.open();

      sendButton(view.root).click();
      await view.settle();

      const results = view.root.querySelector<HTMLElement>('[role="status"][aria-live="polite"]')!;
      expect(text(results)).toContain("Résultat de l'envoi — décembre 2026");
      expect(text(results)).toContain('Envoyé');
      expect(text(results)).toContain("Mode test : aucun e-mail n'a été livré aux locataires.");
      expect(results.querySelector('[dir="ltr"]')?.textContent).toContain(TEST_ADDRESS);
      expect(buttons(results, 'Réessayer')).toHaveLength(0);
      // The statuses were read again: every lease is « Envoyé », nothing is selected.
      const rows = rowsOf(view.root);
      expect(rows.every((row) => plain(text(row)).includes('Envoyé'))).toBe(true);
      expect(rows.every((row) => row.getAttribute('aria-selected') === 'false')).toBe(true);
      expect(reason(view.root)).toBe('Sélectionnez au moins un bail');
      // The send was recorded: only the three bookkeeping fields, for the right period.
      const saves = view.fake.callsOf('save', 'Lease');
      expect(saves).toHaveLength(2);
      expect(saves[0].ops?.map((op) => (op as { key: string }).key).sort()).toEqual([
        'lastSendDate',
        'lastSentPeriod',
        'lastSentPeriodAt',
      ]);
      expect(JSON.stringify(saves[0].ops)).toContain('2026-12');
      expect(view.dialog.opened.length).toBe(1);
    });

    it('does not show the test-mode banner when the e-mails were really sent (production)', async () => {
      const view = await setup({ env: PROD_ENV });
      await view.open();

      sendButton(view.root).click();
      await view.settle();

      expect(text(view.root.querySelector('[role="status"]'))).not.toContain('Mode test');
    });

    it('delivered but not recorded: the warning is prominent, with no « Réessayer » and no resend', async () => {
      const view = await setup({
        before: (fake) =>
          fake.failWhen(
            (call) => call.op === 'save' && call.className === 'Lease',
            parseError(141, 'refus'),
          ),
      });
      await view.open();

      sendButton(view.root).click();
      await view.settle();

      const results = view.root.querySelector<HTMLElement>('[role="status"]')!;
      expect(text(results)).toContain(
        "E-mail envoyé, mais l'état d'envoi n'a pas pu être enregistré : ne le renvoyez pas.",
      );
      expect(text(results)).toContain('Envoyé');
      expect(buttons(results, 'Réessayer')).toHaveLength(0);
      expect(buttons(results, 'Marquer comme envoyé')).toHaveLength(0);
      expect(clouds(view.fake)).toHaveLength(1);
    });

    it('uncertain: « Peut-être envoyé », no plain « Réessayer », and the record-only action sends nothing', async () => {
      const view = await setup({
        before: (fake) =>
          fake.failWhen((call) => call.op === 'cloud', parseError(100, 'Connexion perdue')),
      });
      await view.open();

      sendButton(view.root).click();
      await view.settle();

      const results = view.root.querySelector<HTMLElement>('[role="status"]')!;
      expect(text(results)).toContain('Peut-être envoyé');
      expect(text(results)).toContain("l'e-mail a peut-être été envoyé");
      expect(buttons(results, 'Réessayer')).toHaveLength(0);
      expect(clouds(view.fake)).toHaveLength(1);
      // Not recorded, not selected again by accident; the leases are flagged in the list.
      expect(
        rowsOf(view.root).filter((row) => plain(text(row)).includes('Peut-être envoyé')),
      ).toHaveLength(2);
      expect(rowsOf(view.root).every((row) => row.getAttribute('aria-selected') === 'false')).toBe(
        true,
      );
      expect(view.fake.callsOf('save', 'Lease')).toHaveLength(0);

      buttons(results, 'Marquer comme envoyé')[0].click();
      await view.settle();

      // The confirmation came first, then ONLY the bookkeeping was written: no new cloud call.
      expect(view.dialog.opened.at(-1)?.title).toBe('Marquer comme envoyé ?');
      expect(clouds(view.fake)).toHaveLength(1);
      const saves = view.fake.callsOf('save', 'Lease');
      expect(saves).toHaveLength(2);
      expect(JSON.stringify(saves[0].ops)).toContain('2026-12');
      expect(JSON.stringify(saves[0].ops)).toContain(String(SENT_AT));
      expect(text(view.root.querySelector('[role="status"]'))).toContain('Enregistré comme envoyé');
      expect(rowsOf(view.root).every((row) => plain(text(row)).includes('Envoyé'))).toBe(true);
    });

    it('declining the record-only confirmation changes nothing', async () => {
      const view = await setup({
        answers: [true, false],
        before: (fake) =>
          fake.failWhen((call) => call.op === 'cloud', parseError(100, 'Connexion perdue')),
      });
      await view.open();
      sendButton(view.root).click();
      await view.settle();

      buttons(view.root, 'Marquer comme envoyé')[0].click();
      await view.settle();

      expect(view.fake.callsOf('save', 'Lease')).toHaveLength(0);
      expect(buttons(view.root, 'Marquer comme envoyé')).toHaveLength(1);
    });

    describe('with two recipients, one of which fails', () => {
      const seedTwo = (fake: FakeParseClient) =>
        seedStandard(fake, {
          dupontEmail: 'dupont@example.test',
          martinEmail: 'martin@example.test',
        });
      const refuseMartin = (fake: FakeParseClient) =>
        fake.failWhen(
          (call) =>
            call.op === 'cloud' && call.params?.['recipientEmail'] === 'martin@example.test',
          parseError(141, 'Mailjet refuse'),
        );

      it('plain failure: « Échec » with the message and « Réessayer » for THAT group only, with the same PDFs', async () => {
        const view = await setup({ env: PROD_ENV, seed: seedTwo, before: refuseMartin });
        await view.open();

        sendButton(view.root).click();
        await view.settle();

        expect(clouds(view.fake)).toHaveLength(2);
        const results = view.root.querySelector<HTMLElement>('[role="status"]')!;
        expect(text(results)).toContain('Mailjet refuse');
        expect(buttons(results, 'Réessayer')).toHaveLength(1);
        const failedCall = clouds(view.fake).find(
          (call) => call.params?.['recipientEmail'] === 'martin@example.test',
        )!;
        const rendersBefore = view.renderer.calls.length;

        buttons(results, 'Réessayer')[0].click();
        await view.settle();

        const calls = clouds(view.fake);
        expect(calls).toHaveLength(3);
        // Only Martin again, never Dupont (delivered), with the very same attachment.
        expect(calls[2].params?.['recipientEmail']).toBe('martin@example.test');
        expect(attachmentsOf(calls[2])).toEqual(attachmentsOf(failedCall));
        expect(view.renderer.calls.length).toBe(rendersBefore);
        expect(buttons(view.root, 'Réessayer')).toHaveLength(0);
        expect(text(view.root.querySelector('[role="status"]'))).toContain('2 envoyés');
      });

      it('a retry stops when the lease was sent from elsewhere in the meantime', async () => {
        const view = await setup({ env: PROD_ENV, seed: seedTwo, before: refuseMartin });
        await view.open();
        sendButton(view.root).click();
        await view.settle();
        view.fake.seed(
          'Lease',
          'l-commerce',
          storedLease({
            name: 'Commerce',
            isPro: true,
            price: 1234,
            charge: 123,
            additionalCharges: [{ title: 'Parking', amount: 50 }],
            ...SENT_DEC_2026,
          }),
        );

        buttons(view.root, 'Réessayer')[0].click();
        await view.settle();

        expect(clouds(view.fake)).toHaveLength(2);
        expect(text(view.root.querySelector('[role="status"]'))).toContain('Déjà envoyé');
      });
    });

    it('a tenant without an address: « Aucune adresse e-mail renseignée » and a link to Locataires, nothing sent for them', async () => {
      const view = await setup({
        env: PROD_ENV,
        seed: (fake) => seedStandard(fake, { martinEmail: '' }),
      });
      await view.open();

      sendButton(view.root).click();
      await view.settle();

      expect(view.dialog.opened[0].message).toContain(
        '1 locataire sans adresse e-mail ne recevra rien.',
      );
      expect(view.dialog.opened[0].message).toContain('1 e-mail à 2 locataires');
      const results = view.root.querySelector<HTMLElement>('[role="status"]')!;
      expect(text(results)).toContain('Aucune adresse e-mail renseignée');
      const link = results.querySelector<HTMLAnchorElement>('a[href="/locataires"]');
      expect(link?.textContent).toContain('Locataires');
      expect(buttons(results, 'Réessayer')).toHaveLength(0);
      expect(clouds(view.fake)).toHaveLength(1);
      expect(clouds(view.fake)[0].params?.['recipientEmail']).toBe(TEST_ADDRESS);
    });
  });

  describe('keyboard', () => {
    it('↑ and ↓ move the preview between rows; the preview follows', async () => {
      const view = await setup();
      await view.open();
      const list = view.root.querySelector('[role="listbox"]')!;
      const rows = rowsOf(view.root);

      // The preview starts on the first selected row (Studio, row 1).
      dispatchKey(list, 'ArrowUp');
      view.harness.detectChanges();
      expect(list.getAttribute('aria-activedescendant')).toBe(rows[0].id);
      dispatchKey(list, 'ArrowDown');
      dispatchKey(list, 'ArrowDown');
      dispatchKey(list, 'ArrowDown');
      view.harness.detectChanges();
      expect(list.getAttribute('aria-activedescendant')).toBe(rows[2].id);
      dispatchKey(list, 'ArrowUp');
      view.harness.detectChanges();
      expect(list.getAttribute('aria-activedescendant')).toBe(rows[1].id);
      dispatchKey(list, 'ArrowUp');
      view.harness.detectChanges();

      await view.settle();
      expect(StubViewer.seen.at(-1)).toBe(view.renderer.lastResult('Garage')?.blob);
      expect(list.getAttribute('aria-activedescendant')).toBe(rows[0].id);
    });

    it('Space toggles the selection of the focused row, and does nothing else', async () => {
      const view = await setup();
      await view.open();
      const list = view.root.querySelector('[role="listbox"]')!;

      const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
      list.dispatchEvent(event);
      view.harness.detectChanges();

      expect(event.defaultPrevented).toBe(true);
      expect(rowsOf(view.root)[0].getAttribute('aria-selected')).toBe('false');
      expect(plain(text(view.root.querySelector('footer')))).toContain('1 sélectionné ·');
    });

    it('is a multi-select listbox, focusable by keyboard, with a name', async () => {
      const view = await setup();
      await view.open();

      const list = view.root.querySelector<HTMLElement>('[role="listbox"]')!;
      expect(list.getAttribute('aria-multiselectable')).toBe('true');
      expect(list.tabIndex).toBe(0);
      expect(list.getAttribute('aria-label')).toContain('décembre 2026');
    });

    it('clicking a row previews it and a click on its box toggles only the selection', async () => {
      const view = await setup();
      await view.open();
      const rows = rowsOf(view.root);

      rows[2].click();
      view.harness.detectChanges();
      expect(
        view.root.querySelector('[role="listbox"]')!.getAttribute('aria-activedescendant'),
      ).toBe(rows[2].id);
      expect(rows[2].getAttribute('aria-selected')).toBe('true');

      (rows[2].querySelector('span[aria-hidden="true"]') as HTMLElement).click();
      view.harness.detectChanges();
      expect(rows[2].getAttribute('aria-selected')).toBe('false');
    });
  });

  describe('narrow screens: the preview is full-screen', () => {
    it('shows only the list at first; a tap opens the preview as a dialog with « Retour », which closes it', async () => {
      const view = await setup({ wide: false });
      await view.open();

      expect(view.root.querySelector('[role="dialog"]')).toBeNull();
      expect(view.root.querySelector('[data-stub-viewer]')).toBeNull();

      rowsOf(view.root)[0].click();
      view.harness.detectChanges();
      await view.settle();

      expect(view.router.url).toContain('apercu=1');
      const dialog = view.root.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(dialog.querySelector('[data-stub-viewer]')).not.toBeNull();
      expect(text(dialog)).toContain('Retour');
      // The send button stays reachable inside the full-screen view.
      expect(sendButton(view.root)).not.toBeNull();

      buttons(view.root, 'Retour')[0].click();
      await view.settle();
      expect(view.root.querySelector('[role="dialog"]')).toBeNull();
      expect(view.router.url).not.toContain('apercu');
    });

    it('Escape closes it, and the browser Back button too', async () => {
      const view = await setup({ wide: false });
      await view.open();

      rowsOf(view.root)[0].click();
      await view.settle();
      expect(view.root.querySelector('[role="dialog"]')).not.toBeNull();
      view.root
        .querySelector('[role="dialog"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await view.settle();
      expect(view.root.querySelector('[role="dialog"]')).toBeNull();

      rowsOf(view.root)[1].click();
      await view.settle();
      expect(view.root.querySelector('[role="dialog"]')).not.toBeNull();
      TestBed.inject((await import('@angular/common')).Location).back();
      await view.settle();
      expect(view.root.querySelector('[role="dialog"]')).toBeNull();
    });

    it('the full-screen preview can include or exclude the lease', async () => {
      const view = await setup({ wide: false });
      await view.open();
      rowsOf(view.root)[1].click();
      await view.settle();

      const box = view.root.querySelector<HTMLInputElement>(
        '[role="dialog"] input[type="checkbox"]',
      )!;
      expect(box.checked).toBe(true);
      box.click();
      view.harness.detectChanges();
      expect(box.checked).toBe(false);
    });

    it('Enter on the list opens the full-screen preview of the focused row', async () => {
      const view = await setup({ wide: false });
      await view.open();

      dispatchKey(view.root.querySelector('[role="listbox"]')!, 'Enter');
      await view.settle();

      expect(view.root.querySelector('[role="dialog"]')).not.toBeNull();
    });
  });

  describe('previewing a failed or missing PDF', () => {
    it('asks to select a lease when there is none to show', async () => {
      const view = await setup({ seed: () => undefined });
      await view.open();

      expect(text(view.root)).toContain('Aucun bail à envoyer');
    });
  });
});
