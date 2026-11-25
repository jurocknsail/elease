import { Injectable, computed, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';
export type EffectiveTheme = 'light' | 'dark';

const STORAGE_KEY = 'elease.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _mode = signal<ThemeMode>(this.readStoredMode());
  private readonly systemDark = signal(this.queryList()?.matches ?? false);

  readonly mode = this._mode.asReadonly();
  readonly effective = computed<EffectiveTheme>(() => {
    const mode = this._mode();
    if (mode === 'system') {
      return this.systemDark() ? 'dark' : 'light';
    }
    return mode;
  });

  constructor() {
    this.queryList()?.addEventListener?.('change', (event) => {
      this.systemDark.set(event.matches);
      this.apply();
    });
    this.apply();
  }

  setMode(mode: ThemeMode): void {
    this._mode.set(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Storage unavailable (private window, quota): the theme still applies for this session.
    }
    this.systemDark.set(this.queryList()?.matches ?? false);
    this.apply();
  }

  private apply(): void {
    const theme = this.effective();
    document.documentElement.dataset['theme'] = theme;
    document.documentElement.style.colorScheme = theme;
  }

  private readStoredMode(): ThemeMode {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      if (value === 'light' || value === 'dark' || value === 'system') {
        return value;
      }
    } catch {
      // Ignore unreadable storage.
    }
    return 'system';
  }

  private queryList(): MediaQueryList | null {
    return typeof matchMedia === 'function' ? matchMedia(DARK_QUERY) : null;
  }
}
