import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Outline icons on a 24 px grid, drawn for a 1.75 px stroke. */
const ICONS = {
  mail: ['M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'm3 7 9 6 9-6'],
  users: [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    'M22 21v-2a4 4 0 0 0-3-3.87',
    'M16 3.13a4 4 0 0 1 0 7.75',
  ],
  sliders: [
    'M4 6h9',
    'M17 6h3',
    'M15 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
    'M4 12h3',
    'M11 12h9',
    'M9 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
    'M4 18h11',
    'M19 18h1',
    'M17 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  ],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    'M12 2v2',
    'M12 20v2',
    'M4.93 4.93l1.41 1.41',
    'M17.66 17.66l1.41 1.41',
    'M2 12h2',
    'M20 12h2',
    'M6.34 17.66l-1.41 1.41',
    'M19.07 4.93l-1.41 1.41',
  ],
  moon: ['M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'],
  monitor: [
    'M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    'M8 21h8',
    'M12 17v4',
  ],
  'wifi-off': [
    'M12 20h.01',
    'M8.5 16.43a5 5 0 0 1 7 0',
    'M5 12.86a10 10 0 0 1 5.17-2.69',
    'M19 12.86a10 10 0 0 0-2.01-1.52',
    'M2 8.82a15 15 0 0 1 4.18-2.64',
    'M22 8.82a15 15 0 0 0-11.29-3.76',
    'm2 2 20 20',
  ],
  alert: [
    'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
    'M12 9v4',
    'M12 17h.01',
  ],
  clock: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M12 6v6l4 2'],
  'check-circle': ['M21.8 10A10 10 0 1 1 17 3.34', 'm9 11 3 3L22 4'],
  check: ['M20 6 9 17l-5-5'],
  'arrow-left': ['M19 12H5', 'm12 19-7-7 7-7'],
  home: ['M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'],
  'log-out': ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
  plus: ['M12 5v14', 'M5 12h14'],
  pencil: ['M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z', 'm15 5 4 4'],
  trash: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M10 11v6', 'M14 11v6'],
  refresh: ['M21 12a9 9 0 1 1-2.64-6.36L21 8', 'M21 3v5h-5'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3'],
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm17 8-5-5-5 5', 'M12 3v12'],
  send: ['m22 2-7 20-4-9-9-4z', 'M22 2 11 13'],
  'trending-up': ['m22 7-8.5 8.5-5-5L2 17', 'M16 7h6v6'],
  'log-in': ['M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4', 'm10 17 5-5-5-5', 'M15 12H3'],
  x: ['M18 6 6 18', 'm6 6 12 12'],
} as const;

export type IconName = keyof typeof ICONS;

/**
 * A decorative icon (hidden from assistive technology): the meaning is always carried by text next to
 * it. Size it with `size-*` classes on the element, colour it with `text-*` (it follows the text colour).
 */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0', 'aria-hidden': 'true', '[attr.data-icon]': 'name()' },
  template: `
    <svg
      class="size-full"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      focusable="false"
    >
      @for (path of paths(); track path) {
        <path [attr.d]="path" />
      }
    </svg>
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  protected readonly paths = computed(() => ICONS[this.name()]);
}
