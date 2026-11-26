import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

const DARK_QUERY = '(prefers-color-scheme: dark)';

interface MediaChangeEvent {
  matches: boolean;
}

interface MatchMediaStub {
  /** Simulates the OS switching between light and dark: updates `matches` and fires `change`. */
  setOsDark(dark: boolean): void;
}

function stubMatchMedia(dark: boolean): MatchMediaStub {
  let osDark = dark;
  const listeners = new Set<(event: MediaChangeEvent) => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return osDark && query === DARK_QUERY;
    },
    media: query,
    addEventListener: (_type: string, listener: (event: MediaChangeEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaChangeEvent) => void) => {
      listeners.delete(listener);
    },
  }));
  return {
    setOsDark(next: boolean): void {
      osDark = next;
      listeners.forEach((listener) => listener({ matches: next }));
    },
  };
}

function themeColorMeta(): HTMLMetaElement | null {
  return document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
}

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset['theme'];
    themeColorMeta()?.remove();
    stubMatchMedia(false);
  });

  afterEach(() => {
    themeColorMeta()?.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('applies an explicit dark mode to <html>', () => {
    const service = TestBed.inject(ThemeService);
    service.setMode('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(service.effective()).toBe('dark');
    expect(service.mode()).toBe('dark');
  });

  it('follows the system preference in system mode', () => {
    stubMatchMedia(true);
    const service = TestBed.inject(ThemeService);
    service.setMode('system');
    expect(service.effective()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('still applies the theme when localStorage.setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const service = TestBed.inject(ThemeService);
    expect(() => service.setMode('dark')).not.toThrow();
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(service.effective()).toBe('dark');
  });

  it('restores the persisted mode', () => {
    localStorage.setItem('elease.theme', 'dark');
    const service = TestBed.inject(ThemeService);
    expect(service.mode()).toBe('dark');
    expect(service.effective()).toBe('dark');
  });

  it('follows an OS preference change while in system mode', () => {
    const media = stubMatchMedia(false);
    const service = TestBed.inject(ThemeService);
    service.setMode('system');
    expect(service.effective()).toBe('light');

    media.setOsDark(true);
    expect(service.effective()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');

    media.setOsDark(false);
    expect(service.effective()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('keeps meta[name=theme-color] in sync with the effective theme', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '#ffffff';
    document.head.append(meta);

    const service = TestBed.inject(ThemeService);
    service.setMode('dark');
    expect(meta.content).toBe('#0f1115');
    service.setMode('light');
    expect(meta.content).toBe('#ffffff');
  });
});
