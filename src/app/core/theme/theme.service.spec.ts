import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

function stubMatchMedia(dark: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: dark && query === '(prefers-color-scheme: dark)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset['theme'];
    stubMatchMedia(false);
  });

  afterEach(() => {
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
});
