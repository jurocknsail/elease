import { DestroyRef, Injectable, Signal, inject, signal } from '@angular/core';

export type InstallPlatform = 'ios' | 'android' | 'desktop';

/** The slice of `navigator` the detection reads (a plain object in specs). */
export interface NavigatorLike {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  /** iOS only: true when the page runs from the home screen. */
  standalone?: boolean;
}

/** Chrome's installation offer: not in the DOM typings. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const STANDALONE_QUERY = '(display-mode: standalone)';

/** iOS, Android or anything else. An iPad in "desktop site" mode reports a Mac: told apart by its touch screen. */
export function detectPlatform(nav: NavigatorLike): InstallPlatform {
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) {
    return 'ios';
  }
  if (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1) {
    return 'ios';
  }
  if (/Android/.test(nav.userAgent)) {
    return 'android';
  }
  return 'desktop';
}

/**
 * Whether the app runs as an installed app: `display-mode: standalone` (Chrome, Edge, Android) or the
 * iOS-only `navigator.standalone`. `matches` evaluates a media query.
 */
export function detectStandalone(nav: NavigatorLike, matches: (query: string) => boolean): boolean {
  return matches(STANDALONE_QUERY) || nav.standalone === true;
}

function currentNavigator(): NavigatorLike {
  return typeof navigator === 'undefined' ? { userAgent: '' } : (navigator as NavigatorLike);
}

function evaluateMedia(query: string): boolean {
  return typeof matchMedia === 'function' ? matchMedia(query).matches : false;
}

/**
 * Installing the app (PWA). Chrome, Edge and Android offer it through `beforeinstallprompt`, captured
 * here so a button can trigger it (`canPrompt`, `prompt()`); iOS has no such event, so the platform and
 * `isStandalone` let the Réglages screen show step-by-step help there, and hide the entry once installed.
 * No UI here: the « Installer l'application » entry of Réglages uses this service.
 */
@Injectable({ providedIn: 'root' })
export class InstallService {
  private offer: BeforeInstallPromptEvent | null = null;
  private readonly offered = signal(false);
  private readonly standalone = signal(detectStandalone(currentNavigator(), evaluateMedia));

  readonly platform: InstallPlatform = detectPlatform(currentNavigator());
  /** True while the browser has offered the installation and it can be shown with `prompt()`. */
  readonly canPrompt: Signal<boolean> = this.offered.asReadonly();
  readonly isStandalone: Signal<boolean> = this.standalone.asReadonly();

  constructor() {
    const onOffer = (event: Event): void => {
      // Keeps the browser's own mini-bar away: the app offers the installation where it chooses.
      event.preventDefault();
      this.offer = event as BeforeInstallPromptEvent;
      this.offered.set(true);
    };
    const onInstalled = (): void => {
      this.offer = null;
      this.offered.set(false);
      this.standalone.set(detectStandalone(currentNavigator(), evaluateMedia));
    };
    const onDisplayMode = (): void => {
      this.standalone.set(detectStandalone(currentNavigator(), evaluateMedia));
    };
    const displayMode = typeof matchMedia === 'function' ? matchMedia(STANDALONE_QUERY) : null;

    window.addEventListener('beforeinstallprompt', onOffer);
    window.addEventListener('appinstalled', onInstalled);
    displayMode?.addEventListener?.('change', onDisplayMode);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('beforeinstallprompt', onOffer);
      window.removeEventListener('appinstalled', onInstalled);
      displayMode?.removeEventListener?.('change', onDisplayMode);
    });
  }

  /**
   * Shows the browser's installation dialog and resolves once the user has answered. Does nothing
   * without an offer, and never throws. An offer can be shown once: afterwards `canPrompt` is false
   * until the browser offers again.
   */
  async prompt(): Promise<void> {
    const offer = this.offer;
    if (!offer) {
      return;
    }
    this.offer = null;
    this.offered.set(false);
    try {
      await offer.prompt();
      await offer.userChoice;
    } catch {
      // The browser refused to show the dialog (already used, no user gesture): nothing to report.
    }
  }
}
