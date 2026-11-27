import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Icon, IconName } from './icon';

/**
 * A centred message for a screen or a list with nothing to show (yet): optional icon, a heading, an
 * optional sentence, and whatever is projected below (typically one button). `ErrorState` builds on it.
 */
@Component({
  selector: 'app-empty-state',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-12 text-center">
      @if (icon(); as name) {
        <span class="mb-1 grid size-16 place-items-center rounded-2xl bg-accent-soft ring-8 ring-accent-soft/40">
          <app-icon [name]="name" class="size-8 text-accent" />
        </span>
      }
      <h2 class="text-lg font-semibold tracking-tight text-text">{{ heading() }}</h2>
      @if (message(); as text) {
        <p class="text-sm text-muted">{{ text }}</p>
      }
      <div class="mt-1 flex flex-wrap justify-center gap-2 empty:hidden">
        <ng-content />
      </div>
    </div>
  `,
})
export class EmptyState {
  readonly heading = input.required<string>();
  readonly message = input<string>();
  readonly icon = input<IconName>();
}
