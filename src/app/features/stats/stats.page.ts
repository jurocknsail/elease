import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
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
    <header class="mb-6">
      <h1 class="text-2xl font-semibold tracking-tight md:text-[1.75rem]">Statistiques</h1>
      <p class="mt-1 text-sm text-muted">{{ subtitle() }}</p>
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
        <div class="card px-4 py-3.5">
          <p class="meta-label">Baux</p>
          <p class="mt-1.5 text-xl font-semibold tracking-tight tabular-nums">
            {{ summary().leaseCount }}
          </p>
        </div>
        <div class="card px-4 py-3.5">
          <p class="meta-label truncate">Appels de {{ periodName() }}</p>
          <p class="mt-1.5 text-xl font-semibold tracking-tight tabular-nums">
            {{ summary().sent
            }}<span class="text-base font-medium text-muted"> / {{ summary().leaseCount }}</span>
          </p>
          <div class="mt-2 h-1 overflow-hidden rounded-full bg-border" aria-hidden="true">
            <div class="h-full rounded-full bg-accent" [style.width.%]="progress()"></div>
          </div>
        </div>
      </section>

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
        <div class="grid grid-cols-1 gap-3 @2xl:grid-cols-3">
          @for (card of indices(); track card.type) {
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

  protected readonly summary = computed(() =>
    portfolioSummary(this.holders.leaseholders(), this.today()),
  );
  protected readonly monthly = computed(() => formatEuro(this.summary().monthly));
  protected readonly annual = computed(() => formatEuro(this.summary().annual));
  protected readonly periodName = computed(() => periodLabel(this.summary().period).split(' ')[0]);
  protected readonly progress = computed(() => {
    const { sent, leaseCount } = this.summary();
    return leaseCount ? (sent / leaseCount) * 100 : 0;
  });

  protected readonly hasSends = computed(() => this.history.sends().length > 0);
  protected readonly bars = computed(() =>
    billedByMonth(this.history.sends(), this.summary().period),
  );

  protected readonly subtitle = computed(() => {
    const start = historyStart(this.history.sends(), this.history.changes());
    return start === null
      ? 'L’historique démarre avec les prochains envois et révisions.'
      : `Historique enregistré depuis le ${formatDate(start)}.`;
  });

  protected readonly timings = computed(() =>
    sendTimings(this.history.sends()).map((t) => ({
      ...t,
      label: capitalise(periodLabel({ year: +t.period.slice(0, 4), month: +t.period.slice(5) })),
      when:
        formatDate(t.firstSentAt) === formatDate(t.lastSentAt)
          ? `le ${formatDate(t.lastSentAt)}`
          : `du ${formatDate(t.firstSentAt)} au ${formatDate(t.lastSentAt)}`,
    })),
  );

  protected readonly changes = computed(() =>
    recentRentChanges(this.history.changes()).map((c) => {
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
