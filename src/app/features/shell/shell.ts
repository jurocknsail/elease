import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  ActivatedRouteSnapshot,
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { Icon, IconName } from '../../shared/ui/icon';
import { ThemeToggle } from '../../shared/ui/theme-toggle';

/**
 * Sidebar entry (>= 768 px): 44 px for a finger, 36 px for a mouse (`dense:`, see styles.css). The
 * active state hangs on `aria-current`, set by `routerLinkActive`.
 */
const SIDEBAR_LINK =
  'relative flex min-h-11 dense:min-h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-transparent hover:bg-bg hover:text-text aria-[current=page]:bg-accent-soft aria-[current=page]:font-semibold aria-[current=page]:text-accent aria-[current=page]:before:bg-accent';

/** Bottom-bar tab (< 768 px): at least 56 px tall. */
const TAB_LINK =
  'relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium text-muted before:absolute before:inset-x-6 before:top-0 before:h-[3px] before:rounded-b-full before:bg-transparent aria-[current=page]:font-semibold aria-[current=page]:text-accent aria-[current=page]:before:bg-accent';

/** Whether the deepest active route asks for the full width (`data: { fullWidth: true }`). */
function wantsFullWidth(route: ActivatedRouteSnapshot): boolean {
  let current: ActivatedRouteSnapshot | null = route;
  let wanted = false;
  while (current) {
    wanted = current.data['fullWidth'] === true;
    current = current.firstChild;
  }
  return wanted;
}

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
}

/**
 * The frame of the signed-in app. From 768 px: a 240 px sidebar (logo, « Appels de loyer »,
 * « Locataires », and at the bottom « Réglages », the user and the theme toggle) beside a content area
 * that scrolls on its own. Below 768 px: the content fills the screen and a three-tab bar sits at the
 * bottom, clear of the iPhone home indicator (the theme toggle then lives in Réglages).
 *
 * Only one of the two navigations is displayed at a time (the other is `display: none`, so it is
 * neither read out nor reachable with Tab). The active item is marked with `aria-current="page"`, and
 * styled by it: bold, with a bar, and not by colour alone.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, ThemeToggle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <a
      href="#contenu"
      class="sr-only z-50 bg-accent text-sm font-semibold text-on-accent focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:rounded-lg focus:px-4 focus:py-3"
      (click)="skipToContent($event)"
    >
      Aller au contenu principal
    </a>

    <div
      class="flex h-dvh flex-col bg-bg pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] md:flex-row"
    >
      <aside class="hidden w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <a
          routerLink="/appels"
          class="mx-3 mt-4 mb-2 flex min-h-11 items-center gap-3 rounded-lg px-3 dense:min-h-9"
          aria-label="E-Lease, Appels de loyer"
        >
          <img
            src="icons/icon-192.png"
            alt=""
            width="32"
            height="32"
            class="size-8 rounded-lg shadow-sm"
          />
          <span class="text-base font-semibold tracking-tight">E-Lease</span>
        </a>

        <nav aria-label="Navigation principale" class="flex flex-1 flex-col px-3 pb-3">
          <ul class="flex flex-col gap-1">
            @for (item of mainItems; track item.path) {
              <li>
                <a
                  [routerLink]="item.path"
                  routerLinkActive
                  ariaCurrentWhenActive="page"
                  [class]="sidebarLink"
                >
                  <app-icon [name]="item.icon" class="size-5" />
                  <span class="truncate">{{ item.label }}</span>
                </a>
              </li>
            }
          </ul>

          <ul class="mt-auto flex flex-col gap-1 border-t border-border pt-3">
            <li>
              <a
                [routerLink]="settings.path"
                routerLinkActive
                ariaCurrentWhenActive="page"
                [class]="sidebarLink"
              >
                <app-icon [name]="settings.icon" class="size-5" />
                <span class="truncate">{{ settings.label }}</span>
              </a>
            </li>
          </ul>
        </nav>

        <div class="flex flex-col gap-2 border-t border-border px-3 py-3">
          @if (auth.user(); as user) {
            <p class="truncate px-3 text-xs text-muted" [attr.title]="user.username">
              Connecté en tant que
              <span class="font-semibold text-text">{{ user.username }}</span>
            </p>
          }
          <app-theme-toggle variant="ghost" />
        </div>
      </aside>

      <main
        #contenu
        id="contenu"
        tabindex="-1"
        class="min-h-0 flex-1 overflow-y-auto focus:outline-none focus-visible:outline-none"
      >
        <div [class]="contentClass()">
          <router-outlet />
        </div>
      </main>

      <nav
        aria-label="Navigation principale"
        class="shrink-0 border-t border-border bg-bg pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul class="grid grid-cols-3">
          @for (item of tabs; track item.path) {
            <li>
              <a
                [routerLink]="item.path"
                routerLinkActive
                ariaCurrentWhenActive="page"
                [class]="tabLink"
              >
                <app-icon [name]="item.icon" class="size-6" />
                <span class="max-w-full truncate">{{ item.label }}</span>
              </a>
            </li>
          }
        </ul>
      </nav>
    </div>
  `,
})
export class Shell {
  protected readonly auth = inject(AuthService);
  protected readonly sidebarLink = SIDEBAR_LINK;
  protected readonly tabLink = TAB_LINK;
  /** Optional: the first navigation ends before the shell has rendered its first view. */
  private readonly content = viewChild<ElementRef<HTMLElement>>('contenu');

  private readonly router = inject(Router);
  /** The screen asked for the whole width and height (route data `fullWidth`): two-pane screens. */
  private readonly fullWidth = signal(false);
  protected readonly contentClass = computed(() =>
    this.fullWidth()
      ? 'h-full w-full px-4 py-4 md:px-6 md:py-5'
      : 'mx-auto w-full max-w-6xl px-4 py-6 md:px-8 md:py-8',
  );

  constructor() {
    this.fullWidth.set(wantsFullWidth(this.router.routerState.snapshot.root));
    // `main` is the only scroller and is never re-created: without this, a screen opened from a long,
    // scrolled one would open scrolled too. `scrollTop` rather than `scrollTo()` (absent from jsdom).
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        this.fullWidth.set(wantsFullWidth(this.router.routerState.snapshot.root));
        const element = this.content()?.nativeElement;
        if (element) {
          element.scrollTop = 0;
        }
      });
  }

  protected readonly mainItems: readonly NavItem[] = [
    { path: '/appels', label: 'Appels de loyer', icon: 'mail' },
    { path: '/locataires', label: 'Locataires', icon: 'users' },
  ];
  protected readonly settings: NavItem = { path: '/reglages', label: 'Réglages', icon: 'sliders' };
  protected readonly tabs: readonly NavItem[] = [...this.mainItems, this.settings];

  /**
   * The skip link: moves the focus to the content. Not a plain `#contenu` link, which with
   * `<base href="/">` would navigate to the home page.
   */
  protected skipToContent(event: Event): void {
    event.preventDefault();
    this.content()?.nativeElement.focus();
  }
}
