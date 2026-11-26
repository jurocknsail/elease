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
  it('recognises iPhone and iPod', () => {
    expect(detectPlatform({ userAgent: IPHONE })).toBe('ios');
    expect(detectPlatform({ userAgent: IPHONE.replace('iPhone', 'iPod') })).toBe('ios');
  });

  it('recognises an iPad that reports a Mac user agent (touch screen on "MacIntel")', () => {
    expect(
      detectPlatform({ userAgent: IPAD_DESKTOP_MODE, platform: 'MacIntel', maxTouchPoints: 5 }),
    ).toBe('ios');
  });

  it('keeps a real Mac (no touch points) as desktop', () => {
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

  it('is true in the standalone display mode (Chrome, Edge, Android)', () => {
    const nav: NavigatorLike = { userAgent: ANDROID };
    expect(detectStandalone(nav, (query) => query === '(display-mode: standalone)')).toBe(true);
  });

  it('is true when iOS says navigator.standalone', () => {
    expect(detectStandalone({ userAgent: IPHONE, standalone: true }, never)).toBe(true);
  });

  it('is false in a normal browser tab', () => {
    expect(detectStandalone({ userAgent: MAC }, never)).toBe(false);
    expect(detectStandalone({ userAgent: IPHONE, standalone: false }, never)).toBe(false);
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

  it('cannot prompt until the browser offers the installation', () => {
    const service = TestBed.inject(InstallService);

    expect(service.canPrompt()).toBe(false);
    expect(service.isStandalone()).toBe(false);
    expect(['ios', 'android', 'desktop']).toContain(service.platform);
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

  it('prompt() without an offer does nothing and does not throw', async () => {
    const service = TestBed.inject(InstallService);

    await expect(service.prompt()).resolves.toBeUndefined();
  });

  it('prompt() never throws when the browser refuses to show the dialog', async () => {
    const service = TestBed.inject(InstallService);
    const event = promptEvent();
    event.prompt.mockRejectedValue(new DOMException('already used', 'InvalidStateError'));
    window.dispatchEvent(event);

    await expect(service.prompt()).resolves.toBeUndefined();
    expect(service.canPrompt()).toBe(false);
  });

  it('forgets the offer and becomes standalone once the app is installed', () => {
    const service = TestBed.inject(InstallService);
    window.dispatchEvent(promptEvent());
    expect(service.canPrompt()).toBe(true);

    window.dispatchEvent(new Event('appinstalled'));

    expect(service.canPrompt()).toBe(false);
  });

  it('follows the display mode when the app is moved into its own window', () => {
    let standalone = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() {
        return standalone && query === '(display-mode: standalone)';
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }));
    const service = TestBed.inject(InstallService);
    expect(service.isStandalone()).toBe(false);

    standalone = true;
    listeners.forEach((listener) => listener());

    expect(service.isStandalone()).toBe(true);
  });

  it('stops listening when it is destroyed', () => {
    const service = TestBed.inject(InstallService);
    TestBed.resetTestingModule();

    window.dispatchEvent(promptEvent());

    expect(service.canPrompt()).toBe(false);
  });
});
