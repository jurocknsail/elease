import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { isSentForPeriod } from '../../core/billing/send-status';
import { nextAnniversary } from '../../core/revision/revision';
import { isSessionError } from '../../core/auth/session-error';
import { periodLabel } from '../../core/billing/period';
import { NOW } from '../../core/clock';
import { formatDate, formatEuro } from '../../core/format/fr';
import { InseeService } from '../../core/insee/insee.service';
import { INDEX_TYPES, IndexType } from '../../core/models/lease';
import { HistoryRepository } from '../../core/parse/history.repository';
import { LeaseholderRepository } from '../../core/parse/leaseholder.repository';
import {
  IndexPoint,
  billedByMonth,
  historyStart,
  indexSeries,
  inseeQuarterLabel,
  leaseRows,
  onlyLease,
  portfolioSummary,
  recentRentChanges,
  sendTimings,
  yearOverYear,
} from '../../core/stats/stats';
import { ErrorState } from '../../shared/ui/error-state';
import { Pill } from '../../shared/ui/pill';
import { MonthBars, Sparkline } from './charts';

const INDEX_NAMES: Record<IndexType, string> = {
  IRL: 'Loyers d’habitation',
  ILC: 'Commerce et artisanat',
  ILAT: 'Bureaux et activités',
};

type IndexCard =
  | { type: IndexType; name: string; state: 'loading' | 'error' }
  | {
      type: IndexType;
      name: string;
      state: 'ready';
      value: string;
      quarter: string;
      change: string | null;
      up: boolean;
      values: number[];
      from: string;
    };

const PERCENT = new Intl.NumberFormat('fr-FR', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  signDisplay: 'exceptZero',
});
const INDEX_VALUE = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Statistiques: what the leases bring in today, the history recorded by the server since it started
 * (amount called per month, when the calls left, rent changes), and the INSEE rent indices.
 */
@Component({
  selector: 'app-stats-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MonthBars, Sparkline, Pill, ErrorState],
  host: { class: 'block @container' },
  template: `
    <header class="mb-6 flex flex-col gap-4 @2xl:flex-row @2xl:items-end @2xl:justify-between">
      <div class="min-w-0">
        <h1 class="text-2xl font-semibold tracking-tight md:text-[1.75rem]">Statistiques</h1>
        <p class="mt-1 text-sm text-muted">{{ subtitle() }}</p>
      </div>
      @if (leaseOptions().length > 1) {
        <div class="w-full @2xl:w-72">
          <label for="stats-lease" class="sr-only">Bail</label>
          <select
            id="stats-lease"
            class="field-input"
            [value]="selectedId() ?? ''"
            (change)="select($any($event.target).value)"
          >
            <option value="">Tous les baux</option>
            @for (group of leaseOptions(); track group.holder) {
              <optgroup [label]="group.holder">
                @for (option of group.leases; track option.id) {
                  <option [value]="option.id" [selected]="option.id === selectedId()">
                    {{ option.name }}
                  </option>
                }
              </optgroup>
            }
          </select>
        </div>
      }
    </header>

    @if (failure() && summary().leaseCount === 0) {
      <app-error-state
        class="rounded-2xl border border-dashed border-border-strong bg-card/50"
        [error]="failure()"
        [retrying]="loading()"
        (retry)="load()"
      />
    } @else {
      <section aria-label="Chiffres clés" class="grid grid-cols-2 gap-3 @3xl:grid-cols-4">
        <div class="card px-4 py-3.5">
          <p class="meta-label">Appelé par mois</p>
          <p class="mt-1.5 text-xl font-semibold tracking-tight tabular-nums">{{ monthly() }}</p>
        </div>
        <div class="card px-4 py-3.5">
          <p class="meta-label">Sur un an</p>
          <p class="mt-1.5 text-xl font-semibold tracking-tight tabular-nums">{{ annual() }}</p>
        </div>
        @if (selectedRow(); as row) {
          <div class="card px-4 py-3.5">
            <p class="meta-label">Prochaine révision</p>
            <p class="mt-1.5 text-xl font-semibold tracking-tight tabular-nums">
              {{ row.nextRevision ? date(row.nextRevision) : '—' }}
            </p>
          </div>
        } @else {
          <div class="card px-4 py-3.5">
            <p class="meta-label">Baux</p>
            <p class="mt-1.5 text-xl font-semibold tracking-tight tabular-nums">
              {{ summary().leaseCount }}
            </p>
          </div>
        }
        <div class="card px-4 py-3.5">
          <p class="meta-label truncate">
            Appel{{ selectedRow() ? '' : 's' }} de {{ periodName() }}
          </p>
          @if (selectedRow()) {
            <p class="mt-1.5 text-xl font-semibold tracking-tight">
              {{ summary().sent ? 'Envoyé' : 'À envoyer' }}
            </p>
          } @else {
            <p class="mt-1.5 text-xl font-semibold tracking-tight tabular-nums">
              {{ summary().sent
              }}<span class="text-base font-medium text-muted"> / {{ summary().leaseCount }}</span>
            </p>
          }
          <div class="mt-2 h-1 overflow-hidden rounded-full bg-border" aria-hidden="true">
            <div class="h-full rounded-full bg-accent" [style.width.%]="progress()"></div>
          </div>
        </div>
      </section>

      @if (!selectedRow() && rows().length > 1) {
        <section class="card mt-4 overflow-hidden" aria-labelledby="stats-leases">
          <div class="flex items-baseline justify-between gap-3 px-4 pt-4 pb-2 md:px-5">
            <h2 id="stats-leases" class="text-sm font-semibold">Par bail</h2>
            <span class="text-xs text-muted">Touchez un bail pour le détail</span>
          </div>
          <div
            class="hidden grid-cols-[minmax(0,1.6fr)_7rem_minmax(0,1fr)_6rem_6.5rem] gap-4 border-b border-border px-5 pb-2 @3xl:grid"
            aria-hidden="true"
          >
            <span class="meta-label">Bail</span>
            <span class="meta-label text-right">Par mois</span>
            <span class="meta-label">Part</span>
            <span class="meta-label text-right">Évolution</span>
            <span class="meta-label text-right">Révision</span>
          </div>
          <ul class="divide-y divide-border">
            @for (r of rows(); track r.leaseId) {
              <li>
                <button
                  type="button"
                  class="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left text-sm transition-colors hover:bg-surface md:px-5 @3xl:grid-cols-[minmax(0,1.6fr)_7rem_minmax(0,1fr)_6rem_6.5rem] @3xl:gap-x-4"
                  (click)="select(r.leaseId)"
                >
                  <span class="min-w-0">
                    <span class="block truncate font-medium">{{
                      r.leaseName || 'Bail sans nom'
                    }}</span>
                    <span class="block truncate text-xs text-muted">{{ r.holderName }}</span>
                  </span>
                  <span class="text-right font-semibold tabular-nums">{{ euro(r.monthly) }}</span>
                  <span class="col-span-2 flex items-center gap-2 @3xl:col-span-1">
                    <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                      <span
                        class="block h-full rounded-full bg-accent/70"
                        [style.width.%]="r.share"
                      ></span>
                    </span>
                    <span class="w-10 text-right text-xs text-muted tabular-nums"
                      >{{ round(r.share) }} %</span
                    >
                  </span>
                  <span
                    class="text-xs tabular-nums @3xl:text-right @3xl:text-sm"
                    [class]="
                      r.evolution === null
                        ? 'text-muted'
                        : r.evolution > 0
                          ? 'text-ok'
                          : 'text-danger'
                    "
                  >
                    <span class="@3xl:hidden">Évolution </span
                    >{{ r.evolution === null ? '—' : percent(r.evolution) }}
                  </span>
                  <span class="text-right text-xs text-muted tabular-nums @3xl:text-sm">
                    <span class="@3xl:hidden">Révision </span
                    >{{ r.nextRevision ? shortDate(r.nextRevision) : '—' }}
                  </span>
                </button>
              </li>
            }
          </ul>
        </section>
      }

      <section class="card mt-4 px-4 py-4 md:px-5" aria-labelledby="stats-billed">
        <div class="mb-5 flex items-baseline justify-between gap-3">
          <h2 id="stats-billed" class="text-sm font-semibold">Montant appelé par mois</h2>
          <span class="text-xs text-muted">12 derniers mois</span>
        </div>
        @if (hasSends()) {
          <app-month-bars [bars]="bars()" />
        } @else {
          <p
            class="rounded-xl border border-dashed border-border-strong px-4 py-8 text-center text-sm text-muted"
          >
            L’historique se remplit à chaque envoi : le graphique apparaîtra après les prochains
            appels de loyer.
          </p>
        }
      </section>

      <div class="mt-4 grid grid-cols-1 gap-4 @4xl:grid-cols-2">
        <section class="card px-4 py-4 md:px-5" aria-labelledby="stats-sends">
          <h2 id="stats-sends" class="mb-3 text-sm font-semibold">Envois</h2>
          @if (timings().length) {
            <ul class="divide-y divide-border">
              @for (t of timings(); track t.period) {
                <li class="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div class="min-w-0">
                    <p class="font-medium">{{ t.label }}</p>
                    <p class="text-xs text-muted">
                      {{ t.count }} {{ t.count === 1 ? 'appel' : 'appels' }} · {{ t.when }}
                    </p>
                  </div>
                  <app-pill [tone]="t.onTime ? 'ok' : 'warn'">{{
                    t.onTime ? 'À temps' : 'En retard'
                  }}</app-pill>
                </li>
              }
            </ul>
          } @else {
            <p class="text-sm text-muted">Aucun envoi enregistré pour l’instant.</p>
          }
        </section>

        <section class="card px-4 py-4 md:px-5" aria-labelledby="stats-changes">
          <h2 id="stats-changes" class="mb-3 text-sm font-semibold">Évolution des loyers</h2>
          @if (changes().length) {
            <ul class="divide-y divide-border">
              @for (c of changes(); track $index) {
                <li class="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div class="min-w-0">
                    <p class="truncate font-medium" [attr.title]="c.name">{{ c.name }}</p>
                    <p class="text-xs text-muted">{{ c.date }}</p>
                  </div>
                  <div class="shrink-0 text-right">
                    <p class="tabular-nums">
                      <span class="text-muted line-through decoration-muted/50">{{ c.from }}</span>
                      <span class="font-semibold"> {{ c.to }}</span>
                    </p>
                    <p class="text-xs" [class]="c.up ? 'text-ok' : 'text-muted'">
                      {{ c.reason }} · {{ c.delta }}
                    </p>
                  </div>
                </li>
              }
            </ul>
          } @else {
            <p class="text-sm text-muted">
              Les révisions et modifications de loyer apparaîtront ici à partir de maintenant.
            </p>
          }
        </section>
      </div>

      <section class="mt-4" aria-labelledby="stats-indices">
        <div class="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="stats-indices" class="text-sm font-semibold">Indices INSEE</h2>
          <span class="text-xs text-muted">6 dernières années</span>
        </div>
        <div class="grid grid-cols-1 gap-3" [class.@2xl:grid-cols-3]="shownIndices().length > 1">
          @for (card of shownIndices(); track card.type) {
            <article class="card px-4 pt-3.5 pb-3">
              <div class="flex items-baseline justify-between gap-2">
                <p class="text-sm font-semibold">{{ card.type }}</p>
                <p class="truncate text-xs text-muted">{{ card.name }}</p>
              </div>
              @switch (card.state) {
                @case ('ready') {
                  <p class="mt-2 flex items-baseline gap-2">
                    <span class="text-xl font-semibold tracking-tight tabular-nums">{{
                      card.value
                    }}</span>
                    <span class="text-xs text-muted">{{ card.quarter }}</span>
                  </p>
                  @if (card.change) {
                    <p class="text-xs font-medium" [class]="card.up ? 'text-ok' : 'text-danger'">
                      {{ card.change }} sur un an
                    </p>
                  }
                  <div class="mt-2">
                    <app-sparkline [values]="card.values" />
                    <div class="mt-1 flex justify-between text-[10px] text-muted">
                      <span>{{ card.from }}</span><span>{{ card.quarter }}</span>
                    </div>
                  </div>
                }
                @case ('error') {
                  <p class="mt-3 text-sm text-muted">
                    Indice indisponible —
                    <button
                      type="button"
                      class="font-semibold text-accent underline-offset-2 hover:underline"
                      (click)="loadIndex(card.type)"
                    >
                      Réessayer
                    </button>
                  </p>
                }
                @default {
                  <div
                    aria-hidden="true"
                    class="mt-3 h-24 animate-pulse rounded-lg bg-border/50"
                  ></div>
                }
              }
            </article>
          }
        </div>
      </section>
    }
  `,
})
export class StatsPage {
  private readonly holders = inject(LeaseholderRepository);
  private readonly history = inject(HistoryRepository);
  private readonly insee = inject(InseeService);
  private readonly now = inject(NOW);

  private readonly today = signal(this.now());
  protected readonly loading = signal(true);
  protected readonly failure = signal<unknown>(null);
  private readonly series = signal<Partial<Record<IndexType, IndexPoint[] | 'error'>>>({});
  private readonly router = inject(Router);

  /** The lease shown alone (`?bail=<id>`, so that the view can be reloaded or shared), or null. */
  private readonly queryLease = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(map((params) => params.get('bail'))),
    { initialValue: null },
  );
  protected readonly rows = computed(() =>
    leaseRows(
      this.holders.leaseholders(),
      this.history.sends(),
      this.history.changes(),
      this.today(),
      nextAnniversary,
    ),
  );
  protected readonly selectedRow = computed(() => {
    const id = this.queryLease();
    return id ? (this.rows().find((r) => r.leaseId === id) ?? null) : null;
  });
  protected readonly selectedId = computed(() => this.selectedRow()?.leaseId ?? null);
  private readonly selectedLease = computed(() => {
    const id = this.selectedId();
    return id
      ? (this.holders
          .leaseholders()
          .flatMap((h) => h.leases)
          .find((l) => l.objectId === id) ?? null)
      : null;
  });
  protected readonly leaseOptions = computed(() =>
    this.holders
      .leaseholders()
      .filter((h) => h.leases.some((l) => l.objectId))
      .map((h) => ({
        holder: h.name || 'Locataire sans nom',
        leases: h.leases
          .filter((l) => l.objectId)
          .map((l) => ({ id: l.objectId as string, name: l.name || 'Bail sans nom' })),
      })),
  );
  private readonly scopedHolders = computed(() => {
    const id = this.selectedId();
    return id ? onlyLease(this.holders.leaseholders(), id) : this.holders.leaseholders();
  });
  private readonly scopedSends = computed(() => {
    const id = this.selectedId();
    return id ? this.history.sends().filter((s) => s.leaseId === id) : this.history.sends();
  });
  private readonly scopedChanges = computed(() => {
    const id = this.selectedId();
    return id ? this.history.changes().filter((c) => c.leaseId === id) : this.history.changes();
  });

  protected readonly summary = computed(() => portfolioSummary(this.scopedHolders(), this.today()));
  protected readonly monthly = computed(() => formatEuro(this.summary().monthly));
  protected readonly annual = computed(() => formatEuro(this.summary().annual));
  protected readonly periodName = computed(() => periodLabel(this.summary().period).split(' ')[0]);
  protected readonly progress = computed(() => {
    const { sent, leaseCount } = this.summary();
    return leaseCount ? (sent / leaseCount) * 100 : 0;
  });

  protected readonly hasSends = computed(() => this.scopedSends().length > 0);
  protected readonly bars = computed(() =>
    billedByMonth(this.scopedSends(), this.summary().period),
  );

  protected readonly subtitle = computed(() => {
    const row = this.selectedRow();
    if (row) {
      return `${row.holderName || 'Locataire sans nom'} · ${row.leaseName || 'Bail sans nom'}`;
    }
    const start = historyStart(this.history.sends(), this.history.changes());
    return start === null
      ? 'L’historique démarre avec les prochains envois et révisions.'
      : `Historique enregistré depuis le ${formatDate(start)}.`;
  });

  protected readonly timings = computed(() =>
    sendTimings(this.scopedSends()).map((t) => ({
      ...t,
      label: capitalise(periodLabel({ year: +t.period.slice(0, 4), month: +t.period.slice(5) })),
      when:
        formatDate(t.firstSentAt) === formatDate(t.lastSentAt)
          ? `le ${formatDate(t.lastSentAt)}`
          : `du ${formatDate(t.firstSentAt)} au ${formatDate(t.lastSentAt)}`,
    })),
  );

  protected readonly changes = computed(() =>
    recentRentChanges(this.scopedChanges()).map((c) => {
      const from = c.oldTotal ?? 0;
      const delta = c.newTotal - from;
      const percent = from > 0 ? (delta / from) * 100 : null;
      return {
        name: c.leaseName || 'Bail sans nom',
        date: formatDate(c.at),
        from: formatEuro(from),
        to: formatEuro(c.newTotal),
        up: delta > 0,
        reason: c.reason === 'revision' ? 'Révision' : 'Modification',
        delta: percent === null ? formatEuro(delta) : `${PERCENT.format(percent)} %`,
      };
    }),
  );

  protected readonly indices = computed<IndexCard[]>(() =>
    INDEX_TYPES.map((type): IndexCard => {
      const name = INDEX_NAMES[type];
      const points = this.series()[type];
      if (points === 'error') {
        return { type, name, state: 'error' };
      }
      if (!points || points.length === 0) {
        return { type, name, state: 'loading' };
      }
      const last = points[points.length - 1];
      const yoy = yearOverYear(points);
      return {
        type,
        name,
        state: 'ready',
        value: INDEX_VALUE.format(last.value),
        quarter: inseeQuarterLabel(last.quarter),
        change: yoy === null ? null : `${PERCENT.format(yoy)} %`,
        up: (yoy ?? 0) >= 0,
        values: points.map((p) => p.value),
        from: inseeQuarterLabel(points[0].quarter),
      };
    }),
  );

  protected readonly shownIndices = computed(() => {
    const type = this.selectedLease()?.indexType;
    return type ? this.indices().filter((card) => card.type === type) : this.indices();
  });

  protected readonly euro = formatEuro;
  protected readonly date = formatDate;
  protected round(n: number): number {
    return Math.round(n);
  }
  protected percent(n: number): string {
    return `${PERCENT.format(n)} %`;
  }
  protected shortDate(ms: number): string {
    return formatDate(ms).slice(0, 5);
  }

  protected select(id: string): void {
    void this.router.navigate([], { queryParams: { bail: id || null }, replaceUrl: true });
  }

  constructor() {
    void this.load();
    INDEX_TYPES.forEach((type) => void this.loadIndex(type));
  }

  async load(): Promise<void> {
    this.loading.set(true);
    const [holders, history] = await Promise.allSettled([this.holders.load(), this.history.load()]);
    this.loading.set(false);
    // The history is a bonus: without it the page still shows today's figures and the indices.
    if (holders.status === 'rejected' && !isSessionError(holders.reason)) {
      this.failure.set(holders.reason);
    } else {
      this.failure.set(null);
    }
    if (history.status === 'rejected') {
      console.warn('[stats] historique indisponible', history.reason);
    }
  }

  async loadIndex(type: IndexType): Promise<void> {
    this.series.update((s) => ({ ...s, [type]: undefined }));
    try {
      const points = indexSeries(await this.insee.observations(type));
      this.series.update((s) => ({ ...s, [type]: points.length ? points : 'error' }));
    } catch {
      this.series.update((s) => ({ ...s, [type]: 'error' }));
    }
  }
}
