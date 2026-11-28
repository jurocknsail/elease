import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatEuro } from '../../core/format/fr';
import { MonthBar } from '../../core/stats/stats';

/** A smooth path through points (Catmull-Rom turned into cubic Béziers), without overshoot. */
function smoothPath(points: readonly [number, number][]): string {
  if (points.length === 0) {
    return '';
  }
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i - 1] ?? points[i];
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const [x3, y3] = points[i + 2] ?? points[i + 1];
    // Control points kept between the two ends: the curve never overshoots (a cumulative line that
    // jumps from 0 would otherwise dip below the axis).
    const low = Math.min(y1, y2);
    const high = Math.max(y1, y2);
    const clamp = (y: number) => Math.min(high, Math.max(low, y));
    const c1x = x1 + (x2 - x0) / 6;
    const c1y = clamp(y1 + (y2 - y0) / 6);
    const c2x = x2 - (x3 - x1) / 6;
    const c2y = clamp(y2 - (y3 - y1) / 6);
    d += ` C${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${x2} ${y2}`;
  }
  return d;
}

/** « 12,4 k€ » where room is short. */
export function compactEuro(n: number): string {
  if (n < 1000) {
    return formatEuro(Math.round(n));
  }
  return `${(n / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k€`;
}

/**
 * Amount called per month (bars, left scale) with the running total over the period behind them
 * (soft area, its own scale on the right). Bars are HTML columns of equal width, so the area's points
 * sit exactly at the bar centres; the area is an SVG stretched to the plot (`non-scaling-stroke`).
 */
@Component({
  selector: 'app-month-bars',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block @container' },
  template: `
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      <span class="inline-flex items-center gap-1.5">
        <span class="size-2.5 rounded-[3px] bg-accent"></span>Montant du mois
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="h-2.5 w-4 rounded-[3px] border-t-2 border-accent/50 bg-accent/15"></span>Cumul
        <span class="font-semibold text-text tabular-nums">{{ cumulLabel() }}</span>
      </span>
    </div>

    <div class="relative mt-4 pr-1 pl-11 sm:pl-12">
      <!-- Grid and left scale (monthly amounts). -->
      <div
        class="pointer-events-none absolute inset-y-0 right-1 left-11 sm:left-12"
        aria-hidden="true"
      >
        @for (line of grid(); track line.pct) {
          <div
            class="absolute inset-x-0 border-t border-dashed border-border"
            [style.bottom.%]="line.pct"
          ></div>
          <span
            class="absolute -left-11 w-10 -translate-y-1/2 text-right text-[10px] text-muted tabular-nums sm:-left-12 sm:w-11 sm:text-[11px]"
            [style.bottom.%]="line.pct"
            [style.transform]="'translateY(50%)'"
            >{{ line.label }}</span
          >
        }
      </div>

      <div class="relative h-44 sm:h-52">
        <!-- Running total, behind the bars. -->
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          class="absolute inset-0 h-full w-full overflow-visible"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="cumul-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--color-accent)" stop-opacity="0.22" />
              <stop offset="100%" stop-color="var(--color-accent)" stop-opacity="0.02" />
            </linearGradient>
          </defs>
          <path [attr.d]="area()" fill="url(#cumul-fill)" />
          <path
            [attr.d]="line()"
            fill="none"
            stroke="var(--color-accent)"
            stroke-opacity="0.55"
            stroke-width="2"
            stroke-linecap="round"
            vector-effect="non-scaling-stroke"
          />
        </svg>

        <ul class="relative flex h-full items-end" role="list">
          @for (bar of view(); track bar.period) {
            <li
              class="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end px-[3px] sm:px-1.5"
              [attr.aria-label]="bar.a11y"
              [attr.title]="bar.a11y"
            >
              <span
                class="pointer-events-none mb-1 rounded-md px-1 text-[10px] font-semibold whitespace-nowrap tabular-nums transition-opacity sm:text-[11px]"
                [class]="
                  bar.highlight
                    ? 'text-text opacity-100'
                    : 'text-muted opacity-0 group-hover:opacity-100'
                "
                >{{ bar.compact }}</span
              >
              <span
                class="block w-full max-w-9 rounded-t-md transition-[height,filter] duration-500 ease-out group-hover:brightness-95"
                [class.shadow-[0_6px_16px_-6px_var(--color-accent)]]="bar.highlight"
                [style.background]="bar.fill"
                [style.height.%]="bar.height"
              ></span>
            </li>
          }
        </ul>
      </div>

      <ul class="mt-2 flex" aria-hidden="true">
        @for (bar of view(); track bar.period) {
          <li
            class="min-w-0 flex-1 truncate text-center text-[10px] sm:text-[11px]"
            [class]="bar.highlight ? 'font-semibold text-text' : 'text-muted'"
          >
            <span class="@lg:hidden">{{ bar.initial }}</span><span class="hidden @lg:inline">{{
              bar.short
            }}</span>
          </li>
        }
      </ul>
    </div>
  `,
})
export class MonthBars {
  readonly bars = input.required<MonthBar[]>();

  /** A round top for the left scale, a little above the highest month. */
  private readonly top = computed(() => {
    const max = Math.max(0, ...this.bars().map((b) => b.total));
    if (max <= 0) {
      return 1;
    }
    const step = 10 ** Math.floor(Math.log10(max));
    return Math.ceil((max * 1.1) / step) * step;
  });
  protected readonly grid = computed(() =>
    [0, 50, 100].map((pct) => ({ pct, label: pct ? compactEuro((this.top() * pct) / 100) : '0' })),
  );

  private readonly cumul = computed(() => {
    let sum = 0;
    return this.bars().map((b) => (sum += b.total));
  });
  protected readonly cumulLabel = computed(() => formatEuro(this.cumul().at(-1) ?? 0));

  private readonly cumulPoints = computed((): [number, number][] => {
    const values = this.cumul();
    const max = values.at(-1) ?? 0;
    if (max <= 0) {
      return [];
    }
    const n = values.length;
    return values.map((v, i) => [
      Number((((i + 0.5) / n) * 100).toFixed(2)),
      Number((100 - (v / max) * 92).toFixed(2)),
    ]);
  });
  protected readonly line = computed(() => smoothPath(this.cumulPoints()));
  protected readonly area = computed(() => {
    const points = this.cumulPoints();
    if (points.length === 0) {
      return '';
    }
    return `${smoothPath(points)} L${points.at(-1)![0]} 100 L${points[0][0]} 100 Z`;
  });

  protected readonly view = computed(() => {
    const top = this.top();
    const bars = this.bars();
    const cumul = this.cumul();
    const lastWithAmount = bars.map((b) => b.count > 0).lastIndexOf(true);
    return bars.map((bar, i) => ({
      ...bar,
      compact: compactEuro(bar.total),
      highlight: i === lastWithAmount,
      initial: bar.short.charAt(0).toUpperCase(),
      fill:
        bar.count === 0
          ? 'var(--color-border)'
          : i === lastWithAmount
            ? 'linear-gradient(to top, color-mix(in srgb, var(--color-accent) 80%, var(--color-card)), var(--color-accent))'
            : 'linear-gradient(to top, color-mix(in srgb, var(--color-accent) 38%, var(--color-card)), color-mix(in srgb, var(--color-accent) 62%, var(--color-card)))',
      height: bar.count > 0 ? Math.max(2, (bar.total / top) * 100) : 1,
      a11y: bar.count
        ? `${bar.label} : ${formatEuro(bar.total)} (${bar.count} ${bar.count === 1 ? 'appel' : 'appels'}), cumul ${formatEuro(cumul[i])}`
        : `${bar.label} : aucun envoi`,
    }));
  });
}

/**
 * A small line of an index over time. Drawn in a stretched viewBox (the line keeps its width with
 * `non-scaling-stroke`); the axis labels are HTML so that they are never distorted.
 */
@Component({
  selector: 'app-sparkline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      class="block h-16 w-full overflow-visible"
      aria-hidden="true"
    >
      <path [attr.d]="area()" class="fill-accent/10" />
      <path
        [attr.d]="line()"
        fill="none"
        class="stroke-accent"
        stroke-width="1.75"
        stroke-linejoin="round"
        stroke-linecap="round"
        vector-effect="non-scaling-stroke"
      />
    </svg>
  `,
})
export class Sparkline {
  readonly values = input.required<number[]>();

  private readonly points = computed((): [number, number][] => {
    const values = this.values();
    if (values.length < 2) {
      return [];
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    return values.map((v, i) => [
      Number(((i / (values.length - 1)) * 100).toFixed(2)),
      Number((38 - ((v - min) / span) * 34).toFixed(2)),
    ]);
  });
  protected readonly line = computed(() => smoothPath(this.points()));
  protected readonly area = computed(() => {
    const line = this.line();
    return line ? `${line} L100 40 L0 40 Z` : '';
  });
}
