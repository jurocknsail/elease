import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatEuro } from '../../core/format/fr';
import { MonthBar } from '../../core/stats/stats';

/**
 * Monthly bars in plain HTML (no chart library): each bar is a column whose height is its share of the
 * highest month. The amount of each month is in its accessible label and tooltip; the last month with
 * an amount is printed above its bar.
 */
@Component({
  selector: 'app-month-bars',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative">
      <div
        class="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border"
      ></div>
      <span
        class="absolute top-0 left-0 -translate-y-1/2 bg-card pr-1.5 text-[11px] text-muted tabular-nums"
      >
        {{ maxLabel() }}
      </span>
      <ul class="flex h-40 items-end gap-1 pt-3 sm:gap-2" role="list">
        @for (bar of view(); track bar.period) {
          <li
            class="relative flex h-full min-w-0 flex-1 flex-col justify-end"
            [attr.aria-label]="bar.label + ' : ' + (bar.count ? bar.amount : 'aucun envoi')"
            [attr.title]="
              bar.label +
              ' : ' +
              (bar.count ? bar.amount + ' (' + bar.count + ' appels)' : 'aucun envoi')
            "
          >
            @if (bar.highlight) {
              <span
                class="mb-1 text-center text-[10px] font-semibold whitespace-nowrap text-text tabular-nums sm:text-[11px]"
                >{{ bar.compact }}</span
              >
            }
            <span
              class="block w-full rounded-t-[4px] transition-[height] duration-300"
              [class]="bar.count ? (bar.highlight ? 'bg-accent' : 'bg-accent/45') : 'bg-border'"
              [style.height.%]="bar.height"
            ></span>
          </li>
        }
      </ul>
      <ul class="mt-1.5 flex gap-1 border-t border-border pt-1.5 sm:gap-2" aria-hidden="true">
        @for (bar of view(); track bar.period) {
          <li class="min-w-0 flex-1 truncate text-center text-[10px] text-muted sm:text-[11px]">
            {{ bar.short }}
          </li>
        }
      </ul>
    </div>
  `,
})
export class MonthBars {
  readonly bars = input.required<MonthBar[]>();

  private readonly max = computed(() => Math.max(0, ...this.bars().map((b) => b.total)));
  protected readonly maxLabel = computed(() => (this.max() > 0 ? formatEuro(this.max()) : ''));
  protected readonly view = computed(() => {
    const max = this.max();
    const bars = this.bars();
    const lastWithAmount = bars.map((b) => b.count > 0).lastIndexOf(true);
    return bars.map((bar, i) => ({
      ...bar,
      amount: formatEuro(bar.total),
      compact: compactEuro(bar.total),
      highlight: i === lastWithAmount,
      height: max > 0 && bar.count > 0 ? Math.max(2, (bar.total / max) * 100) : 1.5,
    }));
  });
}

/** « 12,4 k€ » above a bar, where room is short. */
function compactEuro(n: number): string {
  if (n < 1000) {
    return formatEuro(Math.round(n));
  }
  return `${(n / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k€`;
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

  private readonly points = computed(() => {
    const values = this.values();
    if (values.length < 2) {
      return [];
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    return values.map((v, i) => [(i / (values.length - 1)) * 100, 38 - ((v - min) / span) * 34]);
  });
  protected readonly line = computed(() =>
    this.points()
      .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`)
      .join(' '),
  );
  protected readonly area = computed(() => {
    const line = this.line();
    return line ? `${line} L100 40 L0 40 Z` : '';
  });
}
