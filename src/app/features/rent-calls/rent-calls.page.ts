import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { isSessionError } from '../../core/auth/session-error';
import { billingPeriod, callTitle, defaultCallDate, periodLabel } from '../../core/billing/period';
import { NOW } from '../../core/clock';
import { formatEuro, formatLeaseAddress } from '../../core/format/fr';
import { Leaseholder } from '../../core/models/leaseholder';
import { describeBackendError } from '../../core/parse/backend-error';
import { LeaseholderRepository } from '../../core/parse/leaseholder.repository';
import { EmptyState } from '../../shared/ui/empty-state';
import { ErrorState } from '../../shared/ui/error-state';
import { Icon } from '../../shared/ui/icon';
import { Avatar } from '../../shared/ui/avatar';
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

const SKELETON = 'animate-pulse rounded-md bg-border/70';

/** What the template draws for one lease. */
interface LeaseView {
  key: string;
  /** Id of the lease, for its anchor in the tenant's page (`#bail-<id>`). */
  leaseId?: string;
  lease: string;
  address: string;
  sent: boolean;
  /** The status label (see `sendMoment`). */
  when: string;
  amount: string;
}

/** One tenant and the rent calls of its leases, listed under the tenant. */
interface HolderGroup {
  key: string;
  /** Id of the tenant, for the link to its page. */
  holderId?: string;
  holder: string;
  holderRef: Leaseholder;
  todo: number;
  sent: number;
  total: string;
  leases: LeaseView[];
}

function toView(row: RentCallRow, index: number): LeaseView {
  return {
    key: rowKey(row, index),
    leaseId: row.lease.objectId,
    lease: row.lease.name || 'Bail sans nom',
    address: formatLeaseAddress(row.lease),
    sent: row.status === 'sent',
    when: sendMoment(row.status === 'sent', row.lease.lastSendDate),
    amount: formatEuro(row.amount),
  };
}

/** The status label: « Envoyé le 25 nov. » (no time), « Envoyé » without a date, or « À envoyer ». */
function sendMoment(sent: boolean, at: number | undefined): string {
  if (!sent) {
    return 'À envoyer';
  }
  if (!at) {
    return 'Envoyé';
  }
  return `Envoyé le ${new Date(at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`;
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
  imports: [Avatar, RouterLink, RouterLinkActive, EmptyState, ErrorState, Icon, Pill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <header class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div class="min-w-0">
        <h1 class="text-2xl font-semibold tracking-tight md:text-[1.75rem]">
          {{ title().calls }}
          <span class="font-normal text-muted">{{ title().billed }}</span>
        </h1>
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
          <a routerLink="/appels/envoi" [class]="actionClass()"
            ><app-icon name="send" class="size-4" />Préparer les envois</a
          >
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
                <app-icon name="refresh" class="size-4" />
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
            <div class="card px-4 py-3 md:px-5 md:py-4">
              <dt class="flex items-center gap-1.5 text-xs font-medium text-muted md:text-sm">
                <app-icon name="clock" class="size-4 text-warn" />À envoyer
              </dt>
              <dd
                class="mt-1 text-2xl font-semibold tabular-nums xl:text-3xl"
                [class.text-accent]="totals().todo > 0"
              >
                {{ totals().todo }}
              </dd>
            </div>
            <div class="card px-4 py-3 md:px-5 md:py-4">
              <dt class="flex items-center gap-1.5 text-xs font-medium text-muted md:text-sm">
                <app-icon name="check-circle" class="size-4 text-ok" />Envoyés
              </dt>
              <dd class="mt-1 text-2xl font-semibold tabular-nums xl:text-3xl">
                {{ totals().sent
                }}<span class="text-base font-medium text-muted">
                  / {{ totals().sent + totals().todo }}</span
                >
                <span
                  class="mt-2 block h-1.5 overflow-hidden rounded-full bg-border"
                  role="progressbar"
                  aria-label="Avancement des envois"
                  [attr.aria-valuenow]="progress()"
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <span
                    class="block h-full rounded-full bg-ok transition-[width] duration-500"
                    [style.width.%]="progress()"
                  ></span>
                </span>
              </dd>
            </div>
            <div class="col-span-2 card px-4 py-3 lg:col-span-1 md:px-5 md:py-4">
              <dt class="text-xs font-medium text-muted md:text-sm">Total du mois</dt>
              <dd class="mt-1 text-2xl font-semibold tabular-nums xl:text-3xl">
                {{ totalLabel() }}
                <span class="block text-xs font-normal text-muted">{{ leaseCountLabel() }}</span>
              </dd>
            </div>
          </dl>
        </section>

        <section class="mt-6 overflow-hidden card">
          <h2
            class="flex items-center gap-2 border-b border-border px-4 py-3.5 text-[15px] font-semibold lg:px-5"
          >
            <app-icon name="users" class="size-[18px] text-accent" />
            Détail par bail
          </h2>
          <ul
            [attr.aria-label]="'Locataires et baux de ' + monthLabel()"
            class="divide-y divide-border"
          >
            @for (group of groups(); track group.key) {
              <li>
                <div
                  class="mx-2 grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-x-3 pt-2.5 pr-3 pb-0.5 pl-2 lg:gap-x-4 lg:pr-4"
                >
                  <h3
                    class="flex min-w-0 items-center gap-3 text-sm font-semibold"
                    [attr.title]="group.holder"
                  >
                    <app-avatar [name]="group.holder" />
                    <span class="truncate">{{ group.holder }}</span>
                  </h3>
                  <span class="text-right text-sm font-semibold tabular-nums">{{
                    group.total
                  }}</span>
                </div>
                <ul class="flex flex-col pb-1.5">
                  @for (lease of group.leases; track lease.key) {
                    <li
                      class="mx-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg py-1 pr-3 pl-4 sm:grid-cols-[auto_minmax(0,1fr)_9rem_6rem] sm:pl-11 transition-colors hover:bg-surface lg:gap-x-4 lg:pr-4 lg:pl-12"
                    >
                      @if (lease.sent) {
                        <span
                          aria-hidden="true"
                          class="grid size-6 place-items-center rounded-full bg-ok-soft text-ok"
                        >
                          <app-icon name="check" class="size-3.5" />
                        </span>
                      } @else {
                        <span
                          aria-hidden="true"
                          class="size-6 rounded-full border-2 border-dashed border-warn"
                        ></span>
                      }
                      <a
                        [routerLink]="['/locataires', group.holderId]"
                        [fragment]="lease.leaseId ? 'bail-' + lease.leaseId : undefined"
                        routerLinkActive
                        ariaCurrentWhenActive="location"
                        [routerLinkActiveOptions]="leaseActiveOptions"
                        class="-mx-2 min-w-0 rounded-md px-2 py-0.5 aria-[current=location]:bg-accent-soft aria-[current=location]:text-accent"
                      >
                        <span
                          class="block truncate text-sm font-medium"
                          [attr.title]="lease.lease"
                          >{{ lease.lease }}</span
                        >
                        <span
                          class="block truncate text-xs text-muted"
                          [attr.title]="lease.address"
                          >{{ lease.address }}</span
                        >
                      </a>
                      <app-pill
                        class="col-start-2 row-start-2 justify-self-start sm:col-auto sm:row-auto sm:justify-self-end"
                        [tone]="lease.sent ? 'ok' : 'warn'"
                        >{{ lease.when }}</app-pill
                      >
                      <span
                        class="col-start-3 row-start-1 text-right text-sm font-medium tabular-nums sm:col-auto sm:row-auto"
                        >{{ lease.amount }}</span
                      >
                    </li>
                  }
                </ul>
              </li>
            }
          </ul>
        </section>
      }

      @case ('error') {
        @if (failure(); as failed) {
          <app-error-state
            class="mt-8 rounded-2xl border border-dashed border-border-strong bg-card/50"
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
                  class="card px-4 py-3 md:px-5 md:py-4"
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
            <div class="mt-6 overflow-hidden card">
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
          class="mt-8 rounded-2xl border border-dashed border-border-strong bg-card/50"
          heading="Aucun bail enregistré"
          message="Ajoutez un locataire et son bail pour préparer vos appels de loyer."
          icon="users"
        >
          <a routerLink="/locataires" class="btn btn-primary"
            ><app-icon name="users" class="size-4" />Aller aux locataires</a
          >
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
  protected readonly title = computed(() => callTitle(this.period()));

  private readonly data = computed(() => buildRows(this.repository.leaseholders(), this.period()));
  protected readonly rows = computed(() => this.data().map(toView));
  /** The rows grouped by tenant, in the order of the data (by name). */
  protected readonly groups = computed<HolderGroup[]>(() => {
    const byHolder = new Map<Leaseholder, { row: RentCallRow; index: number }[]>();
    this.data().forEach((row, index) => {
      const bucket = byHolder.get(row.holder) ?? [];
      bucket.push({ row, index });
      byHolder.set(row.holder, bucket);
    });
    return [...byHolder].map(([holder, bucket]) => {
      const totals = summary(bucket.map((entry) => entry.row));
      return {
        key: holder.objectId ?? holder.name,
        holderId: holder.objectId,
        holder: holder.name || 'Locataire sans nom',
        holderRef: holder,
        todo: totals.todo,
        sent: totals.sent,
        total: formatEuro(totals.total),
        leases: bucket.map((entry) => toView(entry.row, entry.index)),
      };
    });
  });
  protected readonly totals = computed(() => summary(this.data()));
  protected readonly progress = computed(() => {
    const { sent, todo } = this.totals();
    return sent + todo === 0 ? 0 : Math.round((sent / (sent + todo)) * 100);
  });
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

  /** A lease is active when the address names it (`#bail-<id>`), not just the tenant. */
  protected readonly leaseActiveOptions = {
    paths: 'exact',
    queryParams: 'ignored',
    fragment: 'exact',
    matrixParams: 'ignored',
  } as const;
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
