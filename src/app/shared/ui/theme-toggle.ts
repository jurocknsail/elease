import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ThemeMode, ThemeService } from '../../core/theme/theme.service';
import { Icon, IconName } from './icon';

const NEXT: Record<ThemeMode, ThemeMode> = { system: 'light', light: 'dark', dark: 'system' };
const LABELS: Record<ThemeMode, string> = { system: 'Système', light: 'Clair', dark: 'Sombre' };
const ICONS: Record<ThemeMode, IconName> = { system: 'monitor', light: 'sun', dark: 'moon' };

/**
 * One button that cycles the theme Système → Clair → Sombre (through `ThemeService.setMode`). The
 * state is visible (icon and text), and the accessible name also says what pressing it does.
 */
@Component({
  selector: 'app-theme-toggle',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <button type="button" class="btn btn-secondary w-full justify-start" (click)="cycle()">
      <app-icon [name]="icon()" class="size-5" />
      <span>Thème : {{ label() }}</span>
      <span class="sr-only"> — passer à {{ nextLabel() }}</span>
    </button>
  `,
})
export class ThemeToggle {
  private readonly theme = inject(ThemeService);

  protected readonly label = computed(() => LABELS[this.theme.mode()]);
  protected readonly nextLabel = computed(() => LABELS[NEXT[this.theme.mode()]]);
  protected readonly icon = computed(() => ICONS[this.theme.mode()]);

  protected cycle(): void {
    this.theme.setMode(NEXT[this.theme.mode()]);
  }
}
