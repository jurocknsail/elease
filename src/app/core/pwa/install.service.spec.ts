import { TestBed } from '@angular/core/testing';
import { InstallService, NavigatorLike, detectPlatform, detectStandalone } from './install.service';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_MODE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0';

describe('detectPlatform', () => {
  it('recognises iPhone and an iPad that reports a Mac user agent, but not a real Mac', () => {
    expect(detectPlatform({ userAgent: IPHONE })).toBe('ios');
    expect(
      detectPlatform({ userAgent: IPAD_DESKTOP_MODE, platform: 'MacIntel', maxTouchPoints: 5 }),
    ).toBe('ios');
    expect(detectPlatform({ userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(
      'desktop',
    );
  });

  it('recognises Android', () => {
    expect(detectPlatform({ userAgent: ANDROID })).toBe('android');
  });

  it('falls back to desktop', () => {
    expect(detectPlatform({ userAgent: WINDOWS })).toBe('desktop');
    expect(detectPlatform({ userAgent: '' })).toBe('desktop');
  });
});

describe('detectStandalone', () => {
  const never = () => false;

  it('is true in the standalone display mode or when iOS says so, false in a normal tab', () => {
    const nav: NavigatorLike = { userAgent: ANDROID };
    expect(detectStandalone(nav, (query) => query === '(display-mode: standalone)')).toBe(true);
    expect(detectStandalone({ userAgent: IPHONE, standalone: true }, never)).toBe(true);
    expect(detectStandalone({ userAgent: MAC }, never)).toBe(false);
  });
});

describe('InstallService', () => {
  interface PromptEvent extends Event {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }

  function promptEvent(outcome: 'accepted' | 'dismissed' = 'accepted'): PromptEvent {
    const event = new Event('beforeinstallprompt', { cancelable: true }) as PromptEvent;
    event.prompt = vi.fn().mockResolvedValue(undefined);
    event.userChoice = Promise.resolve({ outcome });
    return event;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('captures beforeinstallprompt (and holds the browser mini-bar back) so a button can offer it', () => {
    const service = TestBed.inject(InstallService);
    const event = promptEvent();

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(service.canPrompt()).toBe(true);
  });

  it('prompt() shows the browser dialog once and then cannot prompt again with the same event', async () => {
    const service = TestBed.inject(InstallService);
    const event = promptEvent();
    window.dispatchEvent(event);

    await service.prompt();

    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(service.canPrompt()).toBe(false);
    await service.prompt();
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it('forgets the offer and becomes standalone once the app is installed', () => {
    const service = TestBed.inject(InstallService);
    window.dispatchEvent(promptEvent());
    expect(service.canPrompt()).toBe(true);

    window.dispatchEvent(new Event('appinstalled'));

    expect(service.canPrompt()).toBe(false);
  });
});
