import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { isSessionError } from '../../core/auth/session-error';
import { billingPeriod, defaultCallDate, periodLabel } from '../../core/billing/period';
import { NOW } from '../../core/clock';
import { formatEuro } from '../../core/format/fr';
import { describeBackendError } from '../../core/parse/backend-error';
import { LeaseholderRepository } from '../../core/parse/leaseholder.repository';
import { EmptyState } from '../../shared/ui/empty-state';
import { ErrorState } from '../../shared/ui/error-state';
import { Icon } from '../../shared/ui/icon';
import { Pill } from '../../shared/ui/pill';
import {
  REMINDER_FROM_DAY,
  RentCallRow,
  buildRows,
  rowKey,
  showReminderBanner,
  summary,
} from './send-state';

/**
 * One row, two layouts. Below 768 px: two lines (lease + amount, tenant + status). From 768 px: one
 * line in four columns. Names take the room that is left and truncate; the status and the amount have
 * fixed columns. Literal class strings: Tailwind scans the sources.
 */
const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_7.5rem_7rem] lg:gap-x-4 lg:px-5 lg:py-2.5';

const SKELETON = 'animate-pulse rounded bg-border';

/** What the template draws for one lease. */
interface RowView {
  key: string;
  lease: string;
  holder: string;
  sent: boolean;
  amount: string;
}

function toView(row: RentCallRow, index: number): RowView {
  return {
    key: rowKey(row, index),
    lease: row.lease.name,
    holder: row.holder.name,
    sent: row.status === 'sent',
    amount: formatEuro(row.amount),
  };
}

function capitalise(value: string): string {
  return value.charAt(0).toLocaleUpperCase('fr') + value.slice(1);
}

/**
 * Home screen: the rent calls of the month to come (« Janvier 2027 »), with what is left to send, what
 * is sent, the month's total and one row per lease. The month is the billing month of the default call
 * date (the 25th of the current month), read from the injected clock.
 *
 * The data comes from `LeaseholderRepository`, reloaded every time the page opens (the send screen
 * changes the statuses). Rows already in memory stay on screen while that reload runs, and a failed
 * reload never blanks them: it adds a notice with « Réessayer ». The skeleton only shows when there is
 * nothing to show yet; a backend that does not answer ends in the error state after the repository's
 * 20 s time-out, never in a spinner that does not stop.
 */
@Component({
  selector: 'app-rent-calls',
  imports: [RouterLink, EmptyState, ErrorState, Icon, Pill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <header class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div class="min-w-0">
        <h1 class="text-2xl font-semibold tracking-tight md:text-[1.75rem]">{{ title() }}</h1>
        <div class="mt-1 min-h-5 text-sm text-muted">
          @switch (view()) {
            @case ('content') {
              @if (totals().todo > 0) {
                <p>{{ todoSentence() }}</p>
              } @else {
                <p class="flex items-center gap-2 font-medium text-ok">
                  <app-icon name="check-circle" class="size-5" />
                  <span>Tous les appels de {{ monthLabel() }} ont été envoyés.</span>
                </p>
              }
            }
            @case ('skeleton') {
              <span class="${SKELETON} mt-0.5 block h-4 w-44" aria-hidden="true"></span>
            }
          }
        </div>
      </div>

      @switch (view()) {
        @case ('content') {
          <a routerLink="/appels/envoi" [class]="actionClass()">Préparer les envois</a>
        }
        @case ('skeleton') {
          <span
            class="${SKELETON} block h-11 w-full dense:h-9 md:w-44 md:rounded-lg"
            aria-hidden="true"
          ></span>
        }
      }
    </header>

    @switch (view()) {
      @case ('content') {
        @if (failureInfo(); as info) {
          <div
            role="alert"
            class="mt-6 flex flex-col gap-3 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-text sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p class="font-semibold">{{ info.title }}</p>
              <p>
                {{ info.message }} Les statuts et les montants affichés peuvent ne pas être à jour.
              </p>
            </div>
            @if (info.retryable) {
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

        @if (reminder()) {
          <div
            role="status"
            class="mt-6 flex items-start gap-3 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3 text-sm text-text"
          >
            <app-icon name="clock" class="mt-0.5 size-5 text-accent" />
            <p class="font-medium">Les appels de loyer de {{ monthLabel() }} sont à envoyer.</p>
          </div>
        }

        <section aria-labelledby="resume-titre" class="mt-6">
          <h2 id="resume-titre" class="sr-only">Résumé du mois</h2>
          <dl class="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <div class="rounded-xl border border-border bg-surface px-4 py-3 md:px-5 md:py-4">
              <dt class="text-xs font-medium text-muted md:text-sm">À envoyer</dt>
              <dd
                class="mt-1 text-2xl font-semibold tabular-nums xl:text-3xl"
                [class.text-accent]="totals().todo > 0"
              >
                {{ totals().todo }}
              </dd>
            </div>
            <div class="rounded-xl border border-border bg-surface px-4 py-3 md:px-5 md:py-4">
              <dt class="text-xs font-medium text-muted md:text-sm">Envoyés</dt>
              <dd class="mt-1 text-2xl font-semibold tabular-nums xl:text-3xl">
                {{ totals().sent }}
              </dd>
            </div>
            <div
              class="col-span-2 rounded-xl border border-border bg-surface px-4 py-3 lg:col-span-1 md:px-5 md:py-4"
            >
              <dt class="text-xs font-medium text-muted md:text-sm">Total du mois</dt>
              <dd class="mt-1 text-2xl font-semibold tabular-nums xl:text-3xl">
                {{ totalLabel() }}
                <span class="block text-xs font-normal text-muted">{{ leaseCountLabel() }}</span>
              </dd>
            </div>
          </dl>
        </section>

        <section class="mt-6 overflow-hidden rounded-xl border border-border bg-bg">
          <h2 class="border-b border-border px-4 py-3 text-sm font-semibold lg:px-5">
            Détail par bail
          </h2>
          <div
            aria-hidden="true"
            class="${ROW_GRID} hidden border-b border-border bg-surface py-2! text-xs font-medium text-muted lg:grid"
          >
            <span>Bail</span>
            <span>Locataire</span>
            <span>Statut</span>
            <span class="text-right">Montant</span>
          </div>
          <ul [attr.aria-label]="'Baux de ' + monthLabel()" class="divide-y divide-border">
            @for (row of rows(); track row.key) {
              <li class="${ROW_GRID}">
                <span
                  class="col-start-1 row-start-1 truncate text-sm font-medium"
                  [attr.title]="row.lease"
                  >{{ row.lease }}</span
                >
                <span
                  class="col-start-1 row-start-2 truncate text-sm text-muted lg:col-start-2 lg:row-start-1"
                  [attr.title]="row.holder"
                  >{{ row.holder }}</span
                >
                <app-pill
                  class="col-start-2 row-start-2 justify-self-end lg:col-start-3 lg:row-start-1 lg:justify-self-start"
                  [tone]="row.sent ? 'ok' : 'warn'"
                  >{{ row.sent ? 'Envoyé' : 'À envoyer' }}</app-pill
                >
                <span
                  class="col-start-2 row-start-1 text-right text-sm font-semibold tabular-nums lg:col-start-4"
                  >{{ row.amount }}</span
                >
              </li>
            }
          </ul>
        </section>
      }

      @case ('error') {
        @if (failure(); as failed) {
          <app-error-state
            class="mt-8 rounded-xl border border-dashed border-border-strong"
            [error]="failed.cause"
            [retrying]="loading()"
            (retry)="refresh()"
          />
        }
      }

      @case ('skeleton') {
        <div aria-busy="true">
          <p class="sr-only">Chargement des appels de loyer en cours.</p>
          <div aria-hidden="true">
            @if (reserveBanner()) {
              <!-- From the 25th the banner is nearly always there once the data is in: keep its room. -->
              <div
                data-skeleton="banner"
                class="${SKELETON} mt-6 h-[66px] rounded-xl min-[480px]:h-12"
              ></div>
            }
            <div class="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
              @for (n of kpiPlaceholders; track n) {
                <div
                  data-skeleton="kpi"
                  class="rounded-xl border border-border bg-surface px-4 py-3 md:px-5 md:py-4"
                  [class]="n === 2 ? 'col-span-2 lg:col-span-1' : ''"
                >
                  <span class="flex h-4 items-center md:h-5">
                    <span class="${SKELETON} h-3.5 w-20"></span>
                  </span>
                  <span class="${SKELETON} mt-1 block h-8 w-16 xl:h-9"></span>
                  @if (n === 2) {
                    <span class="flex h-4 items-center">
                      <span class="${SKELETON} h-3 w-14"></span>
                    </span>
                  }
                </div>
              }
            </div>
            <div class="mt-6 overflow-hidden rounded-xl border border-border bg-bg">
              <div class="border-b border-border px-4 py-3 lg:px-5">
                <span class="${SKELETON} my-1 block h-3 w-28"></span>
              </div>
              <div class="hidden h-[33px] border-b border-border bg-surface lg:block"></div>
              <ul class="divide-y divide-border">
                @for (n of rowPlaceholders; track n) {
                  <li data-skeleton="row" class="${ROW_GRID}">
                    <span class="${SKELETON} col-start-1 row-start-1 my-0.5 block h-4 w-3/4"></span>
                    <span
                      class="${SKELETON} col-start-1 row-start-2 my-0.5 block h-4 w-1/2 lg:col-start-2 lg:row-start-1"
                    ></span>
                    <span
                      class="${SKELETON} col-start-2 row-start-2 block h-5 w-20 justify-self-end rounded-full lg:col-start-3 lg:row-start-1 lg:justify-self-start"
                    ></span>
                    <span
                      class="${SKELETON} col-start-2 row-start-1 my-0.5 block h-4 w-16 justify-self-end lg:col-start-4"
                    ></span>
                  </li>
                }
              </ul>
            </div>
          </div>
        </div>
      }

      @case ('empty') {
        <app-empty-state
          class="mt-8 rounded-xl border border-dashed border-border-strong"
          heading="Aucun bail enregistré"
          message="Ajoutez un locataire et son bail pour préparer vos appels de loyer."
          icon="users"
        >
          <a routerLink="/locataires" class="btn btn-primary">Aller aux locataires</a>
        </app-empty-state>
      }
    }
  `,
})
export class RentCallsPage {
  private readonly repository = inject(LeaseholderRepository);
  private readonly now = inject(NOW);

  /** The day the screen was last loaded on: the month shown follows it. */
  private readonly today = signal(this.now());
  protected readonly loading = signal(true);
  /** The last failure of a load, until a load succeeds. */
  protected readonly failure = signal<{ cause: unknown } | null>(null);

  private readonly period = computed(() => billingPeriod(defaultCallDate(this.today())));
  /** « janvier 2027 », for sentences. */
  protected readonly monthLabel = computed(() => periodLabel(this.period()));
  protected readonly title = computed(() => capitalise(this.monthLabel()));

  private readonly data = computed(() => buildRows(this.repository.leaseholders(), this.period()));
  protected readonly rows = computed(() => this.data().map(toView));
  protected readonly totals = computed(() => summary(this.data()));
  protected readonly reminder = computed(() => showReminderBanner(this.today(), this.data()));
  /** On and after the reminder day, the skeleton keeps the room the banner will most likely take. */
  protected readonly reserveBanner = computed(() => this.today().getDate() >= REMINDER_FROM_DAY);

  /**
   * What the screen shows. Rows in memory always win (fresh or stale); with none, a failure is the
   * error state; otherwise the skeleton while loading; otherwise there is truly nothing: the empty state.
   */
  protected readonly view = computed<'content' | 'error' | 'skeleton' | 'empty'>(() => {
    if (this.data().length > 0) {
      return 'content';
    }
    if (this.failure()) {
      return 'error';
    }
    return this.loading() ? 'skeleton' : 'empty';
  });

  protected readonly todoSentence = computed(() => {
    const { todo } = this.totals();
    return `${todo} ${todo === 1 ? 'appel' : 'appels'} à envoyer sur ${this.data().length}`;
  });
  protected readonly totalLabel = computed(() => formatEuro(this.totals().total));
  protected readonly leaseCountLabel = computed(() => {
    const count = this.data().length;
    return `sur ${count} ${count === 1 ? 'bail' : 'baux'}`;
  });
  protected readonly actionClass = computed(
    () => `btn w-full md:w-auto ${this.totals().todo > 0 ? 'btn-primary' : 'btn-secondary'}`,
  );

  /** The wording of the failure, for the notice shown above rows that are already on screen. */
  protected readonly failureInfo = computed(() => {
    const failed = this.failure();
    return failed ? describeBackendError(failed.cause) : null;
  });

  protected readonly kpiPlaceholders = [0, 1, 2];
  protected readonly rowPlaceholders = [0, 1, 2, 3];
  /** True while a load is running: a second one is not started. */
  private running = false;

  constructor() {
    void this.refresh();
  }

  /** Loads from the backend; the previous data stays visible meanwhile. Never throws. */
  protected async refresh(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.today.set(this.now());
    this.loading.set(true);
    try {
      await this.repository.load();
      this.failure.set(null);
    } catch (error) {
      if (isSessionError(error)) {
        // The repository is signing the user out and sending them to the login screen: no second
        // error here. `loading` stays on, so that nothing misleading (an « empty » screen, since the
        // sign-out cleared the data) shows until the redirect replaces the page.
        return;
      }
      this.failure.set({ cause: error });
    } finally {
      this.running = false;
    }
    this.loading.set(false);
  }
}
