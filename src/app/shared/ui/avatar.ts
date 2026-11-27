import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Up to two initials of a name (« Jean Dupont » → « JD »), or « ? ». */
export function initialsOf(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toLocaleUpperCase('fr'))
    .join('');
  return letters || '?';
}

/** The tenant's initials in a small coloured square: the same everywhere in the app. Decorative. */
@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    class:
      'grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-accent/90 to-indigo-500 text-[11px] font-bold text-white shadow-sm',
  },
  template: '{{ letters() }}',
})
export class Avatar {
  readonly name = input('');
  protected readonly letters = computed(() => initialsOf(this.name()));
}
