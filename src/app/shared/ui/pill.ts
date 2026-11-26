import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type PillTone = 'ok' | 'warn' | 'danger' | 'accent' | 'neutral';

/** Literal class strings (Tailwind scans the sources). Every pair is >= 4.5:1 in both themes. */
const TONE_CLASSES: Record<PillTone, string> = {
  ok: 'bg-ok-soft text-ok ring-ok/25',
  warn: 'bg-warn-soft text-warn ring-warn/25',
  danger: 'bg-danger-soft text-danger ring-danger/25',
  accent: 'bg-accent-soft text-accent ring-accent/25',
  neutral: 'bg-surface text-muted ring-border-strong/40',
};

/**
 * A small status label (« Envoyé », « Pro », « Révision le 01/03 »): 11 px semibold, fully rounded.
 * It never wraps and never shrinks: the text always stays on one line, whatever the width around it.
 * The meaning is in the text; the colour only reinforces it.
 */
@Component({
  selector: 'app-pill',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] leading-4 font-semibold whitespace-nowrap ring-1 ring-inset',
    '[class]': 'toneClasses()',
  },
  template: '<ng-content />',
})
export class Pill {
  readonly tone = input<PillTone>('neutral');
  protected readonly toneClasses = computed(() => TONE_CLASSES[this.tone()]);
}
