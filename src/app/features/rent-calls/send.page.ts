import { Location } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  InjectionToken,
  Signal,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { APP_ENV } from '../../core/app-env';
import { AuthService } from '../../core/auth/auth.service';
import { SessionErrorHandler, isSessionError } from '../../core/auth/session-error';
import {
  BillingPeriod,
  billingPeriod,
  defaultCallDate,
  periodKey,
  periodLabel,
} from '../../core/billing/period';
import { NOW } from '../../core/clock';
import { effectiveSandbox } from '../../core/email/email-guard';
import { groupByEmail, recipientKey, type EmailGroup } from '../../core/email/rent-call-email';
import { RentCallSender, SEND_CLOCK, type SendResult } from '../../core/email/rent-call-sender';
import { formatEuro } from '../../core/format/fr';
import type { LandlordProfile } from '../../core/models/landlord-profile';
import { describeBackendError } from '../../core/parse/backend-error';
import { LandlordProfileRepository } from '../../core/parse/landlord-profile.repository';
import { LeaseholderRepository } from '../../core/parse/leaseholder.repository';
import { rentCallFileName } from '../../core/pdf/file-name';
import { PDF_RENDERER, PdfRenderError, type RenderedPdf } from '../../core/pdf/pdf-render';
import { buildRentCallDefinition } from '../../core/pdf/rent-call-definition';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { EmptyState } from '../../shared/ui/empty-state';
import { ErrorState } from '../../shared/ui/error-state';
import { Icon } from '../../shared/ui/icon';
import { PdfViewer } from '../../shared/ui/pdf-viewer';
import { Pill, type PillTone } from '../../shared/ui/pill';
import { addMaybeSent, readMaybeSent, removeMaybeSent } from './maybe-sent';
import {
  RentCallRow,
  buildRows,
  canSend,
  confirmMessage,
  dueDateLabel,
  initialSelection,
  parseDateInput,
  rowKey,
  selectionSummary,
  toDateInputValue,
} from './send-state';

/**
 * Whether the screen is wide enough for two panes (list and preview side by side): 1024 px, the same
 * threshold as Tailwind's `lg`. Below it the preview is a full-screen panel opened from the list.
 * Specs replace it.
 */
export const WIDE_LAYOUT = new InjectionToken<Signal<boolean>>('WIDE_LAYOUT', {
  providedIn: 'root',
  factory: () => {
    const wide = signal(false);
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const query = window.matchMedia('(min-width: 1024px)');
      wide.set(query.matches);
      query.addEventListener('change', (event) => wide.set(event.matches));
    }
    return wide.asReadonly();
  },
});

/** At most this many PDFs are drawn at the same time: the screen stays responsive. */
export const MAX_PARALLEL_RENDERS = 2;

/** Query parameter of the full-screen preview (narrow screens): the browser's Back button closes it. */
const VIEWER_PARAM = 'apercu';

const SKELETON = 'animate-pulse rounded bg-border';

const STALE_SELECTION_MESSAGE =
  'Certains baux ont déjà été envoyés entre-temps : vérifiez la sélection.';
const DELETED_MESSAGE = 'Certains baux ont été supprimés entre-temps : vérifiez la sélection.';
const CHANGED_MESSAGE =
  "Les informations de certains baux ont changé : leurs aperçus sont régénérés. Vérifiez-les, puis relancez l'envoi.";
const UNREADABLE_MESSAGE =
  "Impossible de vérifier l'état des envois : rien n'a été envoyé. Réessayez dans un instant.";
const RENDER_FAILED = 'La génération du PDF a échoué.';

/** A generated PDF, or why there is none (yet), for one lease and the current call date. */
type PdfEntry =
  | { status: 'queued' }
  | { status: 'generating' }
  | { status: 'ready'; rendered: RenderedPdf; fileName: string; fingerprint: string }
  | { status: 'failed'; message: string };

type PdfKind = 'none' | 'queued' | 'generating' | 'ready' | 'failed';

/** What the template draws for one lease. */
interface RowView {
  key: string;
  index: number;
  lease: string;
  holder: string;
  amount: string;
  sent: boolean;
  /** Sent, as far as the user can tell: the e-mail may have gone out but is not recorded. */
  maybeSent: boolean;
  selected: boolean;
  active: boolean;
  pdf: PdfKind;
}

type OutcomeKind =
  'sent' | 'warning' | 'uncertain' | 'failed' | 'no-address' | 'recorded' | 'blocked';

/** What happened to one e-mail of a send, with what is needed to act on it afterwards. */
interface Outcome {
  kind: OutcomeKind;
  result: SendResult;
  period: BillingPeriod;
  group: EmailGroup;
  /** Leases that were still « À envoyer » when the send started: a retry stops if one is sent now. */
  guardIds: string[];
  busy: boolean;
  /** Error of the last « Marquer comme envoyé » attempt. */
  recordError?: string;
}

function holdersLabel(names: readonly string[]): string {
  return names.join(', ');
}

/**
 * The send screen: the rent calls of one period, each with its PDF, previewed before it can be sent.
 *
 * Safety, in the order a send goes:
 *  1. The data is loaded fresh when the page opens (leaseholders and landlord profile). If that fails
 *     nothing can be sent until a reload succeeds.
 *  2. Every selected PDF is generated up-front (a few at a time, cancellable) for the CURRENT call
 *     date; the button is enabled only when each selected lease has its PDF (`canSend`).
 *  3. The confirmation says exactly what goes out (e-mails, tenants, total; test mode).
 *  4. After the confirmation the data is loaded again: a selected lease that turned « Envoyé » in the
 *     meantime (another device) stops the send; so does a lease whose information changed (its PDF is
 *     regenerated and must be previewed again).
 *  5. The very bytes that were previewed (the same `base64` of the same render) go to `RentCallSender`,
 *     which applies the recipient guard and the sandbox. A second click while a send runs does nothing.
 *  6. The outcome of every e-mail is shown, with the right next step: nothing for a delivered one, a
 *     « Réessayer » for that group only after a plain failure, a record-only « Marquer comme envoyé »
 *     (no e-mail) after an uncertain one.
 */
@Component({
  selector: 'app-send',
  imports: [RouterLink, EmptyState, ErrorState, Icon, PdfViewer, Pill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
  template: `
    <div [class]="rootClass()" (keydown.escape)="onEscape()">
      <header [class]="overlayOpen() ? 'hidden' : 'shrink-0'">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 class="text-xl font-semibold tracking-tight md:text-2xl">
                Appels de loyer — {{ monthLabel() }}
              </h1>
              @if (testMode) {
                <app-pill tone="accent">Mode test</app-pill>
              }
            </div>
            <p class="mt-1 text-sm text-muted">Échéance : {{ dueLabel() }}</p>
          </div>
          <div class="flex flex-col gap-1 sm:items-end">
            <label for="send-date" class="text-sm font-medium">Date de l'appel</label>
            <input
              id="send-date"
              type="date"
              class="field-input sm:w-48"
              [value]="dateText()"
              [disabled]="sending()"
              [attr.aria-invalid]="dateValid() ? null : 'true'"
              aria-describedby="send-date-help"
              (input)="onDateInput($event)"
            />
          </div>
        </div>
        <p
          id="send-date-help"
          class="mt-1 text-xs sm:text-right"
          [class]="dateValid() ? 'text-muted' : 'text-danger'"
          [attr.role]="dateValid() ? null : 'alert'"
        >
          @if (dateValid()) {
            Les appels facturent le mois suivant la date de l'appel.
          } @else {
            Saisissez une date d'appel valide pour pouvoir envoyer.
          }
        </p>
      </header>

      @if (!overlayOpen()) {
        @if (loadFailure() && view() === 'content') {
          <div
            role="alert"
            class="flex shrink-0 flex-col gap-3 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-text sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p class="font-semibold">{{ failedInfo().title }}</p>
              <p>
                {{ failedInfo().message }} Les données affichées peuvent ne pas être à jour :
                l'envoi est désactivé tant qu'elles n'ont pas été actualisées.
              </p>
            </div>
            @if (failedInfo().retryable) {
              <button
                type="button"
                class="btn btn-secondary shrink-0"
                [disabled]="loading()"
                [attr.aria-busy]="loading()"
                (click)="refresh()"
              >
                Réessayer
              </button>
            }
          </div>
        }
        @if (message(); as info) {
          <p
            role="alert"
            class="shrink-0 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm font-medium text-text"
          >
            {{ info }}
          </p>
        }
      }

      <div [class]="bodyClass()">
        <section [class]="listPaneClass()" aria-labelledby="send-list-title">
          <h2 id="send-list-title" class="sr-only">Baux de {{ monthLabel() }}</h2>

          @if (outcomes().length > 0) {
            <section
              #results
              tabindex="-1"
              role="status"
              aria-live="polite"
              aria-labelledby="send-results-title"
              class="mb-4 rounded-xl border border-border bg-bg focus:outline-none"
            >
              <div class="border-b border-border px-4 py-3">
                <h2 id="send-results-title" class="text-sm font-semibold">
                  Résultat de l'envoi — {{ resultsPeriod() }}
                </h2>
                <p class="text-xs text-muted">{{ resultsSummary() }}</p>
              </div>
              @if (anySimulated()) {
                <p
                  class="border-b border-border bg-accent-soft px-4 py-3 text-sm font-semibold text-text"
                >
                  Mode test : aucun e-mail n'a été livré aux locataires.
                </p>
              }
              <ul class="divide-y divide-border">
                @for (outcome of outcomes(); track outcome.result.email) {
                  <li class="px-4 py-3">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        @if (outcome.kind === 'no-address') {
                          <p class="text-sm font-semibold">Aucune adresse e-mail renseignée</p>
                        } @else {
                          <p class="text-sm font-semibold break-all">
                            <span dir="ltr" class="[unicode-bidi:isolate]">{{
                              outcome.result.email
                            }}</span>
                          </p>
                        }
                        <p class="mt-0.5 text-xs text-muted">
                          {{ names(outcome) }} · {{ callCount(outcome) }}
                        </p>
                      </div>
                      <app-pill [tone]="pillTone(outcome)">{{ pillLabel(outcome) }}</app-pill>
                    </div>

                    @switch (outcome.kind) {
                      @case ('warning') {
                        <p
                          class="mt-2 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm font-medium text-text"
                        >
                          {{ outcome.result.warning }}
                        </p>
                      }
                      @case ('uncertain') {
                        <p
                          class="mt-2 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-text"
                        >
                          {{ outcome.result.error }}
                        </p>
                        <div class="mt-2 flex flex-col items-start gap-2">
                          <button
                            type="button"
                            class="btn btn-secondary"
                            [disabled]="outcome.busy || sending()"
                            [attr.aria-busy]="outcome.busy"
                            (click)="markSent(outcome)"
                          >
                            Marquer comme envoyé
                          </button>
                          <p class="text-xs text-muted">
                            N'envoie rien : enregistre seulement l'envoi, une fois votre boîte
                            vérifiée.
                          </p>
                        </div>
                        @if (outcome.recordError; as recordError) {
                          <p role="alert" class="mt-2 text-sm text-danger">{{ recordError }}</p>
                        }
                      }
                      @case ('failed') {
                        <p class="mt-2 text-sm text-danger">{{ outcome.result.error }}</p>
                        <div class="mt-2">
                          <button
                            type="button"
                            class="btn btn-secondary"
                            [disabled]="outcome.busy || sending() || !canRetry()"
                            [attr.aria-busy]="outcome.busy"
                            (click)="retry(outcome)"
                          >
                            Réessayer
                          </button>
                        </div>
                      }
                      @case ('no-address') {
                        <p class="mt-2 text-sm text-text">
                          Renseignez l'adresse e-mail dans
                          <a routerLink="/locataires" class="font-semibold text-accent underline"
                            >Locataires</a
                          >, puis relancez l'envoi de ce bail.
                        </p>
                      }
                      @case ('blocked') {
                        <p
                          class="mt-2 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-text"
                        >
                          Ce bail a été envoyé entre-temps : rien n'a été renvoyé. Vérifiez les
                          statuts.
                        </p>
                      }
                    }
                  </li>
                }
              </ul>
            </section>
          }

          @switch (view()) {
            @case ('skeleton') {
              <div aria-busy="true">
                <p class="sr-only">Chargement des baux en cours.</p>
                <ul
                  aria-hidden="true"
                  class="divide-y divide-border rounded-xl border border-border"
                >
                  @for (n of rowPlaceholders; track n) {
                    <li class="flex items-center gap-3 px-3 py-3">
                      <span class="${SKELETON} size-5"></span>
                      <span class="flex-1">
                        <span class="${SKELETON} block h-4 w-2/3"></span>
                        <span class="${SKELETON} mt-2 block h-3 w-1/2"></span>
                      </span>
                      <span class="${SKELETON} h-4 w-16"></span>
                    </li>
                  }
                </ul>
              </div>
            }
            @case ('error') {
              @if (loadFailure(); as failed) {
                <app-error-state
                  class="rounded-xl border border-dashed border-border-strong"
                  [error]="failed.cause"
                  [retrying]="loading()"
                  (retry)="refresh()"
                />
              }
            }
            @case ('empty') {
              <app-empty-state
                class="rounded-xl border border-dashed border-border-strong"
                heading="Aucun bail à envoyer"
                message="Ajoutez un locataire et son bail pour préparer vos appels de loyer."
                icon="users"
              >
                <a routerLink="/locataires" class="btn btn-primary">Aller aux locataires</a>
              </app-empty-state>
            }
            @case ('content') {
              <div
                #list
                role="listbox"
                aria-multiselectable="true"
                tabindex="0"
                [attr.aria-label]="'Baux à envoyer pour ' + monthLabel()"
                [attr.aria-activedescendant]="activeId()"
                [attr.aria-busy]="generating()"
                class="group divide-y divide-border rounded-xl border border-border bg-bg focus-visible:outline-none"
                (keydown)="onListKeydown($event)"
              >
                @for (row of views(); track row.key) {
                  <div
                    role="option"
                    [id]="'send-row-' + row.index"
                    [attr.aria-selected]="row.selected"
                    [class]="rowClass(row)"
                    (click)="activate(row.key)"
                  >
                    <span
                      aria-hidden="true"
                      class="-ml-1 flex size-11 shrink-0 items-center justify-center dense:size-9"
                      (click)="toggleFromBox($event, row.key)"
                    >
                      <span [class]="boxClass(row)">
                        @if (row.selected) {
                          <app-icon name="check" class="size-3.5" />
                        }
                      </span>
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="flex items-baseline justify-between gap-3">
                        <span class="truncate text-sm font-medium" [attr.title]="row.lease">{{
                          row.lease
                        }}</span>
                        <span class="shrink-0 text-sm font-semibold tabular-nums">{{
                          row.amount
                        }}</span>
                      </span>
                      <span class="mt-0.5 flex items-center justify-between gap-3">
                        <span class="truncate text-[13px] text-muted" [attr.title]="row.holder">{{
                          row.holder
                        }}</span>
                        <app-pill [tone]="row.sent ? 'ok' : row.maybeSent ? 'neutral' : 'warn'">{{
                          row.sent ? 'Envoyé' : row.maybeSent ? 'Peut-être envoyé' : 'À envoyer'
                        }}</app-pill>
                      </span>
                      @if (row.selected || row.active) {
                        @switch (row.pdf) {
                          @case ('queued') {
                            <span class="mt-0.5 block text-xs text-muted">Génération…</span>
                          }
                          @case ('generating') {
                            <span class="mt-0.5 block text-xs text-muted">Génération…</span>
                          }
                          @case ('failed') {
                            <span class="mt-0.5 block text-xs font-medium text-danger"
                              >Échec de la génération</span
                            >
                          }
                        }
                      }
                    </span>
                  </div>
                }
              </div>
            }
          }
        </section>

        <section
          [class]="viewerPaneClass()"
          [attr.role]="overlayOpen() ? 'dialog' : null"
          [attr.aria-modal]="overlayOpen() ? 'true' : null"
          [attr.aria-label]="overlayOpen() ? 'Aperçu de l\\'appel de loyer' : null"
        >
          @if (overlayOpen()) {
            <div class="mb-3 flex shrink-0 items-center justify-between gap-3">
              <button #back type="button" class="btn btn-secondary" (click)="closeViewer()">
                <app-icon name="arrow-left" class="size-4" />
                Retour
              </button>
              @if (preview(); as current) {
                <label class="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    class="size-5 accent-[var(--color-accent)]"
                    [checked]="current.selected"
                    (change)="toggle(current.key)"
                  />
                  Inclure dans l'envoi
                </label>
              }
            </div>
          }
          @if (preview(); as current) {
            <div class="mb-2 min-w-0 shrink-0">
              <h2 class="truncate text-sm font-semibold">
                {{ current.lease }} · {{ current.holder }}
              </h2>
              <p class="truncate text-xs text-muted">
                {{ current.amount }}
                @if (previewFileName(); as fileName) {
                  · {{ fileName }}
                }
              </p>
            </div>
          }
          <div class="flex min-h-0 flex-1 flex-col">
            @switch (previewState()) {
              @case ('ready') {
                <app-pdf-viewer [blob]="previewBlob()" />
              }
              @case ('pending') {
                <div
                  role="status"
                  aria-busy="true"
                  class="flex flex-1 items-center justify-center rounded-xl border border-border bg-surface p-6 text-sm text-muted"
                >
                  Génération du PDF…
                </div>
              }
              @case ('failed') {
                <div
                  role="alert"
                  class="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-surface p-6 text-center"
                >
                  <p class="text-sm font-semibold">Échec de la génération</p>
                  <p class="max-w-sm text-sm text-muted">{{ previewError() }}</p>
                  <button type="button" class="btn btn-primary" (click)="retryPreview()">
                    Réessayer
                  </button>
                </div>
              }
              @case ('stale') {
                <div
                  class="flex flex-1 items-center justify-center rounded-xl border border-border bg-surface p-6 text-center text-sm text-muted"
                >
                  Aperçu indisponible : les données n'ont pas pu être actualisées.
                </div>
              }
              @case ('hidden') {}
              @default {
                <div
                  class="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border-strong p-6 text-center text-sm text-muted"
                >
                  Sélectionnez un bail pour voir son appel de loyer.
                </div>
              }
            }
          </div>
        </section>
      </div>

      <footer [class]="footerClass()">
        <div class="flex items-center justify-between gap-4">
          <p class="min-w-0 text-sm" aria-live="polite">
            <span class="font-semibold tabular-nums">{{ selectionLabel() }}</span>
          </p>
          <button
            type="button"
            class="btn btn-primary shrink-0"
            [disabled]="blockReason() !== null"
            [attr.aria-busy]="sending()"
            aria-describedby="send-reason"
            (click)="send()"
          >
            {{ sendLabel() }}
          </button>
        </div>
        <p id="send-reason" class="mt-1 min-h-4 text-xs text-muted" aria-live="polite">
          {{ blockReason() ?? progressText() }}
        </p>
      </footer>
    </div>
  `,
})
export class SendPage {
  private readonly repository = inject(LeaseholderRepository);
  private readonly profiles = inject(LandlordProfileRepository);
  private readonly sender = inject(RentCallSender);
  private readonly auth = inject(AuthService);
  private readonly session = inject(SessionErrorHandler);
  private readonly dialog = inject(ConfirmDialog);
  private readonly render = inject(PDF_RENDERER);
  private readonly now = inject(NOW);
  private readonly sendClock = inject(SEND_CLOCK);
  private readonly env = inject(APP_ENV);
  private readonly wide = inject(WIDE_LAYOUT);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);

  private readonly listRef = viewChild<ElementRef<HTMLElement>>('list');
  private readonly backRef = viewChild<ElementRef<HTMLElement>>('back');
  private readonly resultsRef = viewChild<ElementRef<HTMLElement>>('results');

  /** Nothing reaches the tenants: outside production, and in production with the Mailjet sandbox on. */
  protected readonly testMode = effectiveSandbox(this.env);
  protected readonly rowPlaceholders = [0, 1, 2, 3];

  // ---- call date -------------------------------------------------------------------------------
  /** The text of the date field (may be empty or invalid while the user types). */
  protected readonly dateText = signal(toDateInputValue(defaultCallDate(this.now())));
  /** The last VALID call date: rows, PDFs and period follow it. */
  private readonly callDate = signal(defaultCallDate(this.now()));
  protected readonly dateValid = computed(() => parseDateInput(this.dateText()) !== null);
  private readonly period = computed(() => billingPeriod(this.callDate()));
  protected readonly monthLabel = computed(() => periodLabel(this.period()));
  protected readonly dueLabel = computed(() => dueDateLabel(this.period()));

  // ---- data (S1) -------------------------------------------------------------------------------
  protected readonly loading = signal(true);
  /** True once the very first load has ended (successfully or not). */
  private readonly firstLoadDone = signal(false);
  /** The last load failed (cause), until a load succeeds. */
  protected readonly loadFailure = signal<{ cause: unknown } | null>(null);
  /** A load succeeded and nothing failed since: only then may anything be sent. */
  private readonly freshFlag = signal(false);
  private readonly profile = signal<LandlordProfile | null>(null);
  protected readonly fresh = computed(() => this.freshFlag() && this.profile() !== null);
  protected readonly failedInfo = computed(() => describeBackendError(this.loadFailure()?.cause));
  /** Something the user must read before going on (a stopped send). */
  protected readonly message = signal<string | null>(null);

  private readonly data = computed(() => buildRows(this.repository.leaseholders(), this.period()));
  private readonly keyed = computed(() =>
    this.data().map((row, index) => ({ row, key: rowKey(row, index), index })),
  );
  private readonly rowByKey = computed(
    () => new Map(this.keyed().map((entry) => [entry.key, entry.row] as const)),
  );

  // ---- selection and preview -------------------------------------------------------------------
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  private readonly previewKey = signal<string | null>(null);
  /** Leases of an e-mail whose outcome is unknown: shown « Peut-être envoyé » until recorded. */
  private readonly maybeSentIds = signal<ReadonlySet<string>>(new Set());
  private initialised = false;

  // ---- PDFs ------------------------------------------------------------------------------------
  private readonly pdfs = signal<ReadonlyMap<string, PdfEntry>>(new Map());
  private readonly previewed = computed(
    () =>
      new Set([...this.pdfs()].filter(([, entry]) => entry.status === 'ready').map(([key]) => key)),
  );
  /** Bumped when the date changes and when the page is left: older renders are ignored. */
  private epoch = 0;
  private active = 0;
  /** The time printed in the PDFs of this epoch (their definition must be reproducible). */
  private generationNow = this.now();
  private destroyed = false;

  // ---- sending (S3) ----------------------------------------------------------------------------
  protected readonly sending = signal(false);
  /** Synchronous guard: set before anything asynchronous, so a second click can never get in. */
  private sendGuard = false;
  protected readonly outcomes = signal<Outcome[]>([]);

  // ---- layout ----------------------------------------------------------------------------------
  private readonly params = toSignal(this.route.queryParamMap, { initialValue: null });
  protected readonly overlayOpen = computed(
    () => !this.wide() && this.params()?.get(VIEWER_PARAM) === '1',
  );
  private viewerPushed = false;

  protected readonly summary = computed(() => selectionSummary(this.data(), this.selected()));

  protected readonly views = computed<RowView[]>(() => {
    const selected = this.selected();
    const active = this.previewKey();
    const pdfs = this.pdfs();
    const maybe = this.maybeSentIds();
    return this.keyed().map(({ row, key, index }) => ({
      key,
      index,
      lease: row.lease.name,
      holder: row.holder.name,
      amount: formatEuro(row.amount),
      sent: row.status === 'sent',
      maybeSent: row.status === 'todo' && !!row.lease.objectId && maybe.has(row.lease.objectId),
      selected: selected.has(key),
      active: key === active,
      pdf: pdfs.get(key)?.status ?? 'none',
    }));
  });

  protected readonly view = computed<'skeleton' | 'error' | 'empty' | 'content'>(() => {
    if (!this.firstLoadDone()) {
      return 'skeleton';
    }
    if (this.data().length > 0) {
      return 'content';
    }
    return this.loadFailure() ? 'error' : 'empty';
  });

  protected readonly activeId = computed(() => {
    const key = this.previewKey();
    const found = this.keyed().find((entry) => entry.key === key);
    return found ? `send-row-${found.index}` : null;
  });

  protected readonly preview = computed(() => this.views().find((row) => row.active) ?? null);
  private readonly previewEntry = computed(() => {
    const key = this.previewKey();
    return key === null ? undefined : this.pdfs().get(key);
  });
  protected readonly previewState = computed<
    'none' | 'stale' | 'pending' | 'ready' | 'failed' | 'hidden'
  >(() => {
    if (this.previewKey() === null || !this.preview()) {
      return 'none';
    }
    if (!this.wide() && !this.overlayOpen()) {
      return 'hidden';
    }
    const entry = this.previewEntry();
    if (!entry) {
      return this.profile() ? 'pending' : 'stale';
    }
    return entry.status === 'ready' ? 'ready' : entry.status === 'failed' ? 'failed' : 'pending';
  });
  protected readonly previewBlob = computed(() => {
    const entry = this.previewEntry();
    return entry?.status === 'ready' ? entry.rendered.blob : null;
  });
  protected readonly previewFileName = computed(() => {
    const entry = this.previewEntry();
    return entry?.status === 'ready' ? entry.fileName : null;
  });
  protected readonly previewError = computed(() => {
    const entry = this.previewEntry();
    return entry?.status === 'failed' ? entry.message : '';
  });

  private readonly selectedStates = computed(() => {
    const pdfs = this.pdfs();
    let pending = 0;
    let failed = 0;
    let ready = 0;
    for (const key of this.selected()) {
      const status = pdfs.get(key)?.status;
      if (status === 'ready') {
        ready += 1;
      } else if (status === 'failed') {
        failed += 1;
      } else {
        pending += 1;
      }
    }
    return { pending, failed, ready };
  });
  protected readonly generating = computed(() => this.selectedStates().pending > 0);

  /** Why the send button is disabled, or null when it is enabled. Announced under the button. */
  protected readonly blockReason = computed<string | null>(() => {
    if (this.sending() || this.sender.inFlight() > 0) {
      return 'Envoi en cours…';
    }
    if (!this.fresh()) {
      return this.loading() ? 'Actualisation des données…' : 'Données non actualisées';
    }
    if (!this.dateValid()) {
      return "Saisissez une date d'appel valide";
    }
    if (this.selected().size === 0) {
      return 'Sélectionnez au moins un bail';
    }
    if (!canSend(this.selected(), this.previewed())) {
      return this.selectedStates().failed > 0 && this.selectedStates().pending === 0
        ? 'La génération de certains PDF a échoué : réessayez'
        : 'Génération des PDF en cours…';
    }
    return null;
  });

  protected readonly progressText = computed(() => {
    const { pending, ready, failed } = this.selectedStates();
    const total = pending + ready + failed;
    if (total === 0 || pending === 0) {
      return '';
    }
    return `Génération des PDF : ${ready + failed} sur ${total}`;
  });

  protected readonly selectionLabel = computed(() => {
    const { count, total } = this.summary();
    return `${count} ${count <= 1 ? 'sélectionné' : 'sélectionnés'} · ${formatEuro(total)}`;
  });
  protected readonly sendLabel = computed(() => {
    const { count } = this.summary();
    return count === 0 ? 'Envoyer' : `Envoyer ${count} ${count === 1 ? 'appel' : 'appels'}`;
  });

  // ---- results ---------------------------------------------------------------------------------
  protected readonly anySimulated = computed(() =>
    this.outcomes().some((outcome) => outcome.result.simulated),
  );
  protected readonly resultsPeriod = computed(() => {
    const first = this.outcomes()[0];
    return first ? periodLabel(first.period) : '';
  });
  protected readonly resultsSummary = computed(() => {
    const outcomes = this.outcomes();
    const count = (kinds: OutcomeKind[]) => outcomes.filter((o) => kinds.includes(o.kind)).length;
    const parts: string[] = [];
    const sent = count(['sent', 'warning', 'recorded']);
    const uncertain = count(['uncertain']);
    const failed = count(['failed', 'no-address', 'blocked']);
    if (sent > 0) {
      parts.push(`${sent} ${sent === 1 ? 'envoyé' : 'envoyés'}`);
    }
    if (uncertain > 0) {
      parts.push(`${uncertain} à vérifier`);
    }
    if (failed > 0) {
      parts.push(`${failed} ${failed === 1 ? 'échec' : 'échecs'}`);
    }
    return parts.join(' · ');
  });
  /** A retry needs a fresh view of the statuses: never from data that could not be refreshed. */
  protected readonly canRetry = computed(() => this.fresh());

  // ---- layout classes (literal strings: Tailwind scans the sources) ----------------------------
  protected readonly rootClass = computed(() =>
    this.overlayOpen()
      ? 'fixed inset-0 z-40 flex flex-col bg-bg pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]'
      : 'flex h-full min-h-0 flex-col gap-4',
  );
  protected readonly bodyClass = computed(() =>
    this.wide()
      ? 'grid min-h-0 flex-1 grid-cols-[20rem_minmax(0,1fr)] gap-4 xl:grid-cols-[26rem_minmax(0,1fr)] xl:gap-6'
      : 'flex min-h-0 flex-1 flex-col',
  );
  protected readonly listPaneClass = computed(() =>
    this.overlayOpen() ? 'hidden' : 'flex min-h-0 flex-1 flex-col overflow-y-auto pr-1',
  );
  protected readonly viewerPaneClass = computed(() => {
    if (this.wide()) {
      return 'flex min-h-0 flex-col';
    }
    return this.overlayOpen() ? 'flex min-h-0 flex-1 flex-col' : 'hidden';
  });
  protected readonly footerClass = computed(() =>
    this.overlayOpen()
      ? 'shrink-0 border-t border-border bg-bg pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]'
      : 'shrink-0 border-t border-border bg-bg pt-3',
  );

  constructor() {
    this.loadMaybeSent();
    void this.refresh();

    // A send started by ANOTHER instance of this page (left and opened again) is still running: nothing
    // may be sent meanwhile (`blockReason`). When it ends, what was recorded is read again before the
    // button comes back.
    let otherSendRunning = false;
    effect(() => {
      const running = this.sender.inFlight() > 0;
      untracked(() => {
        if (this.sendGuard) {
          return;
        }
        if (running) {
          otherSendRunning = true;
        } else if (otherSendRunning) {
          otherSendRunning = false;
          this.freshFlag.set(false);
          void this.refresh();
        }
      });
    });

    // Focus follows the full-screen preview: into it when it opens, back to the list when it closes.
    let wasOpen = false;
    effect(() => {
      const open = this.overlayOpen();
      untracked(() => {
        if (open && !wasOpen) {
          setTimeout(() => this.backRef()?.nativeElement.focus(), 0);
        } else if (!open && wasOpen) {
          this.viewerPushed = false;
          setTimeout(() => this.listRef()?.nativeElement.focus(), 0);
        }
        wasOpen = open;
      });
    });

    inject(DestroyRef).onDestroy(() => {
      // Leaving the page: whatever is still being drawn is ignored.
      this.destroyed = true;
      this.epoch += 1;
    });
  }

  // ===== loading =================================================================================

  /** Loads the data again (and the profile), then applies it. Never throws. */
  protected async refresh(): Promise<void> {
    if (this.refreshing) {
      // A load is already running and may have started before what made this one necessary.
      this.reloadAfter = true;
      return;
    }
    this.refreshing = true;
    this.loading.set(true);
    try {
      await this.fetchFresh(true);
    } finally {
      this.refreshing = false;
      if (!this.sessionEnded) {
        this.loading.set(false);
        this.firstLoadDone.set(true);
      }
    }
    if (this.reloadAfter && !this.destroyed) {
      this.reloadAfter = false;
      await this.refresh();
    }
  }

  private reloadAfter = false;

  /** True while this page is sending (the confirmation, the checks, the e-mails): leaving costs the results. */
  hasSendInProgress(): boolean {
    return this.sendGuard;
  }

  private refreshing = false;
  /** The session expired: the repositories are sending the user to the login screen. */
  private sessionEnded = false;

  /**
   * Loads the leaseholders (and optionally the landlord profile). True only when everything loaded:
   * then, and only then, the data counts as fresh. On failure the flag drops, so sending stays disabled
   * until a later load succeeds; rows already in memory remain visible (stale).
   */
  private async fetchFresh(withProfile: boolean): Promise<boolean> {
    const [loaded, profile] = await Promise.allSettled([
      this.repository.load(),
      withProfile ? this.profiles.get() : Promise.resolve(this.profile()),
    ]);
    if (this.destroyed) {
      return false;
    }
    if (profile.status === 'fulfilled' && profile.value) {
      this.profile.set(profile.value);
    }
    const failure =
      loaded.status === 'rejected'
        ? loaded.reason
        : profile.status === 'rejected'
          ? profile.reason
          : null;
    if (failure !== null) {
      if (isSessionError(failure)) {
        // The repository signs the user out and redirects: nothing else to show.
        this.sessionEnded = true;
        return false;
      }
      this.loadFailure.set({ cause: failure });
      this.freshFlag.set(false);
      if (!this.initialised && this.data().length > 0) {
        this.applyData();
      }
      return false;
    }
    this.loadFailure.set(null);
    this.freshFlag.set(true);
    this.applyData();
    return true;
  }

  /**
   * Brings the screen in line with the repository: first time, the default selection; afterwards, the
   * selection loses the leases that no longer exist. PDFs whose lease changed are dropped and generated
   * again, and what must be previewed is queued.
   */
  private applyData(): void {
    const keys = new Set(this.rowByKey().keys());
    this.pruneMaybeSent();
    if (!this.initialised) {
      this.initialised = true;
      this.selected.set(this.defaultSelection());
    } else {
      this.selected.update((current) => new Set([...current].filter((key) => keys.has(key))));
    }
    const current = this.previewKey();
    if (current === null || !keys.has(current)) {
      this.previewKey.set(this.firstKey());
    }
    this.changedByLoad.push(...this.reconcile());
    this.requestGeneration([
      ...this.selected(),
      ...(this.previewKey() ? [this.previewKey()!] : []),
    ]);
  }

  /** Selected leases whose PDF was dropped because the lease changed, since the last `takeChanged`. */
  private changedByLoad: string[] = [];

  private takeChanged(keys: ReadonlySet<string>): string[] {
    const changed = this.changedByLoad;
    this.changedByLoad = [];
    return changed.filter((key) => keys.has(key));
  }

  // ===== leases that may have been sent (kept across reloads) ===================================

  private username(): string | null {
    return this.auth.user()?.username ?? null;
  }

  /** Reads what the browser remembers for this user and the displayed period. */
  private loadMaybeSent(): void {
    const user = this.username();
    this.maybeSentIds.set(
      user ? readMaybeSent(user, periodKey(this.period()), this.sendClock()) : new Set(),
    );
  }

  private forgetMaybeSent(ids: readonly string[], period: BillingPeriod): void {
    const user = this.username();
    if (user) {
      removeMaybeSent(user, periodKey(period), ids, this.sendClock());
    }
    if (periodKey(period) === periodKey(this.period())) {
      this.maybeSentIds.update(
        (current) => new Set([...current].filter((id) => !ids.includes(id))),
      );
    }
  }

  /** What is to send, minus the leases whose e-mail may already have gone out: never preselected. */
  private defaultSelection(): Set<string> {
    const maybe = this.maybeSentIds();
    const selected = initialSelection(this.data());
    this.keyed().forEach(({ row, key }) => {
      if (row.lease.objectId && maybe.has(row.lease.objectId)) {
        selected.delete(key);
      }
    });
    return selected;
  }

  /** A lease that now reads « Envoyé » needs no flag any more. */
  private pruneMaybeSent(): void {
    const recorded = this.keyed()
      .filter(({ row }) => row.status === 'sent' && !!row.lease.objectId)
      .map(({ row }) => row.lease.objectId as string)
      .filter((id) => this.maybeSentIds().has(id));
    if (recorded.length > 0) {
      this.forgetMaybeSent(recorded, this.period());
    }
  }

  private firstKey(): string | null {
    for (const { key } of this.keyed()) {
      if (this.selected().has(key)) {
        return key;
      }
    }
    return this.keyed()[0]?.key ?? null;
  }

  // ===== PDFs ====================================================================================

  private definitionFor(row: RentCallRow, profile: LandlordProfile) {
    return buildRentCallDefinition({
      leaseholder: row.holder,
      lease: row.lease,
      profile,
      callDate: this.callDate(),
      now: this.generationNow,
    });
  }

  /** Queues the PDF of every key that has none yet (nothing already generated is touched). */
  private requestGeneration(keys: readonly string[]): void {
    if (!this.profile()) {
      return;
    }
    const known = this.rowByKey();
    const current = this.pdfs();
    const missing = [...new Set(keys)].filter((key) => known.has(key) && !current.has(key));
    if (missing.length > 0) {
      const next = new Map(current);
      for (const key of missing) {
        next.set(key, { status: 'queued' });
      }
      this.pdfs.set(next);
    }
    this.schedule();
  }

  private setEntry(key: string, entry: PdfEntry): void {
    const next = new Map(this.pdfs());
    next.set(key, entry);
    this.pdfs.set(next);
  }

  private nextQueuedKey(): string | null {
    const pdfs = this.pdfs();
    const preview = this.previewKey();
    if (preview !== null && pdfs.get(preview)?.status === 'queued') {
      return preview;
    }
    for (const { key } of this.keyed()) {
      if (pdfs.get(key)?.status === 'queued') {
        return key;
      }
    }
    return null;
  }

  /** Starts queued renders, never more than `MAX_PARALLEL_RENDERS` at a time. */
  private schedule(): void {
    if (this.destroyed || !this.profile()) {
      return;
    }
    while (this.active < MAX_PARALLEL_RENDERS) {
      const key = this.nextQueuedKey();
      if (key === null) {
        return;
      }
      this.setEntry(key, { status: 'generating' });
      void this.generate(key, this.epoch);
    }
  }

  /**
   * Renders one lease ONCE. The result is kept with the file name and a fingerprint of the definition;
   * an answer for an older epoch (the date changed, the page was left) is dropped.
   */
  private async generate(key: string, epoch: number): Promise<void> {
    this.active += 1;
    try {
      const row = this.rowByKey().get(key);
      const profile = this.profile();
      if (!row || !profile) {
        this.dropEntries([key]);
        return;
      }
      const def = this.definitionFor(row, profile);
      const rendered = await this.render(def);
      if (epoch !== this.epoch || this.destroyed) {
        return;
      }
      this.setEntry(key, {
        status: 'ready',
        rendered,
        fileName: rentCallFileName(row.holder, row.lease, this.period()),
        fingerprint: JSON.stringify(def),
      });
    } catch (error) {
      if (epoch === this.epoch && !this.destroyed) {
        this.setEntry(key, {
          status: 'failed',
          message: error instanceof PdfRenderError ? error.message : RENDER_FAILED,
        });
      }
    } finally {
      this.active -= 1;
      this.schedule();
    }
  }

  private dropEntries(keys: readonly string[]): void {
    const next = new Map(this.pdfs());
    for (const key of keys) {
      next.delete(key);
    }
    this.pdfs.set(next);
  }

  /**
   * Drops the PDFs that no longer match their lease (its information changed on another device) or
   * whose lease is gone. Returns the SELECTED keys that lost their PDF: those must be previewed again.
   */
  private reconcile(): string[] {
    const profile = this.profile();
    if (!profile) {
      return [];
    }
    const rows = this.rowByKey();
    const stale: string[] = [];
    for (const [key, entry] of this.pdfs()) {
      if (entry.status !== 'ready') {
        continue;
      }
      const row = rows.get(key);
      let fingerprint: string | null = null;
      try {
        fingerprint = row ? JSON.stringify(this.definitionFor(row, profile)) : null;
      } catch {
        fingerprint = null;
      }
      if (fingerprint !== entry.fingerprint) {
        stale.push(key);
      }
    }
    if (stale.length === 0) {
      return [];
    }
    this.dropEntries(stale);
    this.requestGeneration([
      ...this.selected(),
      ...(this.previewKey() ? [this.previewKey()!] : []),
    ]);
    return stale.filter((key) => this.selected().has(key));
  }

  /** Retries the PDF of one lease that failed. */
  protected retryPreview(): void {
    const key = this.previewKey();
    if (key !== null) {
      this.retryPdf(key);
    }
  }

  private retryPdf(key: string): void {
    if (this.pdfs().get(key)?.status !== 'failed') {
      return;
    }
    this.setEntry(key, { status: 'queued' });
    this.schedule();
  }

  // ===== call date ===============================================================================

  protected onDateInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.dateText.set(value);
    const date = parseDateInput(value);
    if (!date || this.sending()) {
      return;
    }
    const current = this.callDate();
    if (
      date.getFullYear() === current.getFullYear() &&
      date.getMonth() === current.getMonth() &&
      date.getDate() === current.getDate()
    ) {
      return;
    }
    const previousPeriod = periodKey(this.period());
    // Every PDF carries the call date: the ones generated for the old date are dropped, the renders in
    // flight are invalidated (their answer is ignored), and the selection's PDFs are generated again.
    this.epoch += 1;
    this.generationNow = this.now();
    this.callDate.set(date);
    this.loadMaybeSent();
    this.pdfs.set(new Map());
    if (periodKey(this.period()) !== previousPeriod) {
      // Another month: other statuses. Same rule as on opening: what is still to send is selected.
      this.selected.set(this.defaultSelection());
      this.previewKey.set(this.firstKey());
    }
    this.requestGeneration([
      ...this.selected(),
      ...(this.previewKey() ? [this.previewKey()!] : []),
    ]);
  }

  // ===== selection, preview, keyboard ============================================================

  protected rowClass(row: RowView): string {
    const base =
      'flex min-h-14 cursor-pointer items-start gap-2 px-3 py-2 dense:py-1.5 first:rounded-t-xl last:rounded-b-xl';
    return row.active
      ? `${base} bg-accent-soft group-focus-visible:ring-2 group-focus-visible:ring-accent group-focus-visible:ring-inset`
      : `${base} hover:bg-surface`;
  }

  protected boxClass(row: RowView): string {
    return row.selected
      ? 'flex size-5 items-center justify-center rounded border border-accent bg-accent text-on-accent'
      : 'flex size-5 items-center justify-center rounded border border-border-strong bg-bg';
  }

  /** A click on a row: preview it (on a narrow screen, full-screen). */
  protected activate(key: string): void {
    this.previewKey.set(key);
    this.requestGeneration([key]);
    this.listRef()?.nativeElement.focus({ preventScroll: true });
    if (!this.wide()) {
      this.openViewer();
    }
  }

  /** A click on the check box: toggles the selection only. */
  protected toggleFromBox(event: Event, key: string): void {
    event.stopPropagation();
    this.previewKey.set(key);
    this.toggle(key);
    this.listRef()?.nativeElement.focus({ preventScroll: true });
  }

  protected toggle(key: string): void {
    const next = new Set(this.selected());
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    this.selected.set(next);
    // Deselecting never deletes a PDF; selecting generates only what is missing.
    this.requestGeneration([key]);
  }

  protected onListKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const keys = this.keyed().map((entry) => entry.key);
    const current = this.previewKey();
    const index = current === null ? -1 : keys.indexOf(current);
    let target: number | null = null;
    switch (event.key) {
      case 'ArrowDown':
        target = Math.min(keys.length - 1, index + 1);
        break;
      case 'ArrowUp':
        target = Math.max(0, index - 1);
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = keys.length - 1;
        break;
      case ' ':
      case 'Spacebar':
        if (current !== null) {
          event.preventDefault();
          this.toggle(current);
        }
        return;
      case 'Enter':
        if (current !== null) {
          event.preventDefault();
          this.activate(current);
        }
        return;
      default:
        return;
    }
    event.preventDefault();
    if (target !== null && target >= 0 && keys[target] !== undefined) {
      this.previewKey.set(keys[target]);
      this.requestGeneration([keys[target]]);
      // Keeps the focused row in view (absent from jsdom).
      document.getElementById(`send-row-${target}`)?.scrollIntoView?.({ block: 'nearest' });
    }
  }

  // ===== full-screen preview (narrow screens) ====================================================

  private openViewer(): void {
    if (this.wide() || this.overlayOpen()) {
      return;
    }
    this.viewerPushed = true;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [VIEWER_PARAM]: '1' },
      queryParamsHandling: 'merge',
    });
  }

  protected closeViewer(): void {
    if (!this.overlayOpen()) {
      return;
    }
    if (this.viewerPushed) {
      // The entry we pushed: going back removes it, like the browser's own Back button.
      this.viewerPushed = false;
      this.location.back();
    } else {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { [VIEWER_PARAM]: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    }
  }

  protected onEscape(): void {
    this.closeViewer();
  }

  // ===== sending =================================================================================

  /**
   * The button. Guarded twice against a double click: the flag is set before anything asynchronous, and
   * the button is disabled while `sending`.
   */
  protected async send(): Promise<void> {
    if (this.sendGuard || this.sender.inFlight() > 0 || this.blockReason() !== null) {
      return;
    }
    this.sendGuard = true;
    this.sending.set(true);
    this.message.set(null);
    try {
      await this.sendSelected();
    } finally {
      this.sendGuard = false;
      this.sending.set(false);
    }
  }

  private async sendSelected(): Promise<void> {
    const period = this.period();
    const { emails, holders, total } = this.summary();
    const chosen = this.keyed().filter((entry) => this.selected().has(entry.key));
    // What the confirmation announces is what is sent: the selection is frozen here. A click on a
    // check box while the data is read again must not change the set of e-mails.
    const confirmedKeys = new Set(chosen.map((entry) => entry.key));
    const maybe = this.maybeSentIds();
    const repeats = chosen.filter(
      ({ row }) => row.status === 'sent' || (!!row.lease.objectId && maybe.has(row.lease.objectId)),
    ).length;
    const withoutAddress = new Set(
      chosen
        .filter(({ row }) => recipientKey(row.holder) === '')
        .map(({ row }) => row.holder.objectId ?? row.holder),
    ).size;
    const confirmed = await this.dialog.open({
      title: 'Envoyer les appels de loyer ?',
      message: confirmMessage({
        emails,
        holders,
        total,
        testMode: this.testMode,
        repeats,
        withoutAddress,
      }),
      confirmLabel: repeats > 0 ? 'Envoyer quand même' : 'Envoyer',
    });
    if (!confirmed) {
      return;
    }
    this.closeViewer();

    // The leases that were still « À envoyer » when the user decided: if one is sent now, stop.
    const expectTodo = chosen.filter(({ row }) => row.status === 'todo').map(({ key }) => key);

    // S2: look again, right before sending.
    this.changedByLoad = [];
    if (!(await this.fetchFresh(false))) {
      if (!this.sessionEnded) {
        this.message.set(UNREADABLE_MESSAGE);
      }
      return;
    }
    const rows = this.rowByKey();
    const gone = expectTodo.filter((key) => !rows.has(key));
    const alreadySent = expectTodo.filter((key) => rows.get(key)?.status === 'sent');
    if (gone.length > 0 || alreadySent.length > 0) {
      const drop = new Set([...gone, ...alreadySent]);
      this.selected.update((current) => new Set([...current].filter((key) => !drop.has(key))));
      this.message.set(alreadySent.length > 0 ? STALE_SELECTION_MESSAGE : DELETED_MESSAGE);
      return;
    }
    // A lease whose information changed lost its PDF in that load (and a new one is being generated):
    // the user has not seen it, so nothing is sent.
    if (this.takeChanged(confirmedKeys).length > 0 || this.reconcile().length > 0) {
      this.message.set(CHANGED_MESSAGE);
      return;
    }
    const profile = this.profile();
    if (!profile || !canSend(confirmedKeys, this.previewed())) {
      this.message.set(CHANGED_MESSAGE);
      return;
    }

    // The previewed bytes ARE the bytes that are sent: the base64 of the very render kept for the preview.
    const sending = this.keyed().filter((entry) => confirmedKeys.has(entry.key));
    const items = sending.flatMap(({ row, key }) => {
      const entry = this.pdfs().get(key);
      return entry?.status === 'ready'
        ? [
            {
              holder: row.holder,
              pdf: { lease: row.lease, fileName: entry.fileName, base64: entry.rendered.base64 },
            },
          ]
        : [];
    });
    if (items.length !== sending.length) {
      this.message.set(CHANGED_MESSAGE);
      return;
    }
    const todoIds = new Set(
      sending
        .filter(({ row }) => row.status === 'todo' && !!row.lease.objectId)
        .map(({ row }) => row.lease.objectId as string),
    );
    const groups = groupByEmail(items);
    const results = await this.sender.send(groups, period, profile);
    await this.afterSend(results, groups, period, todoIds);
  }

  /** Shows what happened to each e-mail, then reads the statuses again. */
  private async afterSend(
    results: SendResult[],
    groups: ReadonlyMap<string, EmailGroup>,
    period: BillingPeriod,
    todoIds: ReadonlySet<string>,
  ): Promise<void> {
    const outcomes = results.map((result) =>
      this.toOutcome(
        result,
        groups.get(result.email) ?? { holderNames: [], pdfs: [] },
        period,
        todoIds,
      ),
    );
    this.outcomes.set(outcomes);
    this.applyOutcomes(outcomes);
    await this.fetchFresh(false);
    this.showResults();
  }

  private toOutcome(
    result: SendResult,
    group: EmailGroup,
    period: BillingPeriod,
    todoIds: ReadonlySet<string>,
  ): Outcome {
    let kind: OutcomeKind;
    if (result.email === '') {
      kind = 'no-address';
    } else if (result.ok) {
      kind = result.warning ? 'warning' : 'sent';
    } else {
      kind = result.uncertain ? 'uncertain' : 'failed';
    }
    return {
      kind,
      result,
      period,
      group,
      guardIds: result.leaseIds.filter((id) => todoIds.has(id)),
      busy: false,
    };
  }

  /** After a send: delivered and uncertain leases leave the selection; uncertain ones are marked. */
  private applyOutcomes(outcomes: readonly Outcome[]): void {
    const leave = new Set<string>();
    const uncertain = new Set(this.maybeSentIds());
    for (const outcome of outcomes) {
      if (outcome.kind === 'sent' || outcome.kind === 'warning' || outcome.kind === 'uncertain') {
        outcome.result.leaseIds.forEach((id) => leave.add(id));
      }
      // Mailed but not recorded (warning) is as unsure as an uncertain send: the lease stays « À envoyer »
      // in the data, so it is flagged « Peut-être envoyé » and a later re-selection is warned about.
      if (outcome.kind === 'uncertain' || outcome.kind === 'warning') {
        outcome.result.leaseIds.forEach((id) => uncertain.add(id));
        const user = this.username();
        if (user) {
          addMaybeSent(user, periodKey(outcome.period), outcome.result.leaseIds, this.sendClock());
        }
      } else if (outcome.kind === 'sent') {
        this.forgetMaybeSent(outcome.result.leaseIds, outcome.period);
        outcome.result.leaseIds.forEach((id) => uncertain.delete(id));
      }
    }
    this.maybeSentIds.set(uncertain);
    this.selected.update((current) => new Set([...current].filter((key) => !leave.has(key))));
  }

  private updateOutcome(email: string, change: Partial<Outcome>): void {
    this.outcomes.update((list) =>
      list.map((outcome) => (outcome.result.email === email ? { ...outcome, ...change } : outcome)),
    );
  }

  /**
   * « Réessayer » of ONE e-mail that definitely did not go out: the same generated PDFs, only that
   * group, after a fresh look at the statuses (never for a delivered or uncertain group).
   */
  protected async retry(outcome: Outcome): Promise<void> {
    if (
      this.sendGuard ||
      this.sender.inFlight() > 0 ||
      outcome.kind !== 'failed' ||
      !this.fresh()
    ) {
      return;
    }
    const profile = this.profile();
    if (!profile) {
      return;
    }
    this.sendGuard = true;
    this.sending.set(true);
    this.updateOutcome(outcome.result.email, { busy: true });
    try {
      if (!(await this.fetchFresh(false))) {
        this.message.set(UNREADABLE_MESSAGE);
        this.updateOutcome(outcome.result.email, { busy: false });
        return;
      }
      const sentNow = outcome.guardIds.some((id) => this.isSentFor(id, outcome.period));
      if (sentNow) {
        this.updateOutcome(outcome.result.email, { kind: 'blocked', busy: false });
        return;
      }
      const [result] = await this.sender.send(
        new Map([[outcome.result.email, outcome.group]]),
        outcome.period,
        profile,
      );
      const next = this.toOutcome(result, outcome.group, outcome.period, new Set(outcome.guardIds));
      this.outcomes.update((list) =>
        list.map((current) => (current.result.email === outcome.result.email ? next : current)),
      );
      this.applyOutcomes([next]);
      await this.fetchFresh(false);
    } finally {
      this.sendGuard = false;
      this.sending.set(false);
    }
  }

  private isSentFor(leaseId: string, period: BillingPeriod): boolean {
    const rows = buildRows(this.repository.leaseholders(), period);
    return rows.some((row) => row.lease.objectId === leaseId && row.status === 'sent');
  }

  /**
   * « Marquer comme envoyé » after an uncertain send: records that the rent calls of this e-mail went out,
   * WITHOUT sending anything (for the user who checked the mailbox).
   */
  protected async markSent(outcome: Outcome): Promise<void> {
    if (this.sendGuard || this.sender.inFlight() > 0 || outcome.kind !== 'uncertain') {
      return;
    }
    this.sendGuard = true;
    this.sending.set(true);
    try {
      const confirmed = await this.dialog.open({
        title: 'Marquer comme envoyé ?',
        message:
          "Aucun e-mail ne sera envoyé : seul l'état d'envoi sera enregistré. À faire uniquement si vous avez vérifié que l'e-mail est bien parti.",
        confirmLabel: 'Marquer comme envoyé',
      });
      if (!confirmed) {
        return;
      }
      this.updateOutcome(outcome.result.email, { busy: true, recordError: undefined });
      try {
        await this.repository.markLeasesSent(
          outcome.result.leaseIds,
          periodKey(outcome.period),
          this.sendClock(),
        );
      } catch (error) {
        // `markLeasesSent` never signs out by itself (a 209 after a DELIVERED e-mail must not replace the
        // send screen). Here no e-mail is involved, so an expired session may redirect to the login.
        const expired = isSessionError(error);
        this.updateOutcome(outcome.result.email, {
          busy: false,
          recordError: expired
            ? 'Session expirée : reconnectez-vous puis réessayez de marquer comme envoyé.'
            : "L'état d'envoi n'a pas pu être enregistré. Réessayez.",
        });
        if (expired) {
          this.session.handle(error);
        }
        return;
      }
      this.updateOutcome(outcome.result.email, { kind: 'recorded', busy: false });
      this.forgetMaybeSent(outcome.result.leaseIds, outcome.period);
      await this.fetchFresh(false);
    } finally {
      this.sendGuard = false;
      this.sending.set(false);
    }
  }

  /** Brings the summary into view and gives it the focus, so nobody has to look for it. */
  private showResults(): void {
    setTimeout(() => {
      const element = this.resultsRef()?.nativeElement;
      element?.scrollIntoView?.({ block: 'start' });
      element?.focus({ preventScroll: true });
    }, 0);
  }

  // ===== results presentation ====================================================================

  protected names(outcome: Outcome): string {
    return holdersLabel(outcome.result.holderNames);
  }

  protected callCount(outcome: Outcome): string {
    const count = outcome.group.pdfs.length || outcome.result.leaseIds.length;
    return `${count} ${count === 1 ? 'appel' : 'appels'}`;
  }

  protected pillTone(outcome: Outcome): PillTone {
    switch (outcome.kind) {
      case 'sent':
      case 'recorded':
        return 'ok';
      case 'warning':
      case 'uncertain':
      case 'blocked':
        return 'warn';
      default:
        return 'danger';
    }
  }

  protected pillLabel(outcome: Outcome): string {
    switch (outcome.kind) {
      case 'sent':
      case 'warning':
        return 'Envoyé';
      case 'recorded':
        return 'Enregistré comme envoyé';
      case 'uncertain':
        return 'Peut-être envoyé';
      case 'blocked':
        return 'Déjà envoyé';
      default:
        return 'Échec';
    }
  }
}
