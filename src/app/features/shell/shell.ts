import { NextActionHint } from './next-action-hint';
import { UpdateBanner } from './update-banner';
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
  'group relative flex min-h-11 dense:min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted transition-colors before:absolute before:inset-y-2.5 before:-left-3 before:w-[3px] before:rounded-r-full before:bg-transparent hover:bg-white/5 hover:text-text aria-[current=page]:bg-accent-soft aria-[current=page]:font-semibold aria-[current=page]:text-text aria-[current=page]:before:bg-accent [&[aria-current=page]_app-icon]:text-accent';

/** Bottom-bar tab (< 768 px): at least 56 px tall. */
const TAB_LINK =
  'relative flex min-h-14 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium text-muted transition-colors aria-[current=page]:font-semibold aria-[current=page]:text-accent [&_app-icon]:rounded-full [&_app-icon]:px-4 [&_app-icon]:py-0.5 [&_app-icon]:box-content [&_app-icon]:transition-colors [&[aria-current=page]_app-icon]:bg-accent-soft';

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
 * that scrolls on its own. Below 768 px: the content fills the screen and a four-tab bar sits at the
 * bottom, clear of the iPhone home indicator (the theme toggle then lives in Réglages).
 *
 * Only one of the two navigations is displayed at a time (the other is `display: none`, so it is
 * neither read out nor reachable with Tab). The active item is marked with `aria-current="page"`, and
 * styled by it: bold, with a bar, and not by colour alone.
 */
@Component({
  selector: 'app-shell',
  imports: [
    NextActionHint,
    UpdateBanner,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    Icon,
    ThemeToggle,
  ],
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
      class="flex h-dvh flex-col bg-canvas pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] md:flex-row"
    >
      <aside class="sidebar-scope hidden w-64 shrink-0 flex-col md:flex">
        <a
          routerLink="/appels"
          class="mx-3 mt-5 mb-4 flex min-h-11 items-center gap-3 rounded-xl px-3 dense:min-h-9"
          aria-label="E-Lease, Appels de loyer"
        >
          <img
            src="logos/e-lease-symbol.png"
            alt=""
            width="32"
            height="32"
            class="size-9 rounded-xl bg-white p-1 shadow-lg shadow-black/30"
          />
          <span class="flex flex-col leading-tight">
            <span class="text-base font-bold tracking-tight">E-Lease</span>
            <span class="text-[11px] font-medium text-muted">Gestion locative</span>
          </span>
        </a>
        <p class="px-6 pb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">Menu</p>

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

          <ul class="mt-auto flex flex-col gap-1 pt-3">
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

        <div class="m-3 flex flex-col gap-1 rounded-2xl border border-border bg-white/[0.03] p-2">
          @if (auth.user(); as user) {
            <div class="flex items-center gap-3 px-2 py-1.5" [attr.title]="user.username">
              <span
                aria-hidden="true"
                class="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 text-sm font-bold text-white uppercase"
                >{{ user.username.charAt(0) }}</span
              >
              <p class="min-w-0 text-xs leading-tight text-muted">
                Connecté en tant que
                <span class="block truncate text-sm font-semibold text-text">{{
                  user.username
                }}</span>
              </p>
            </div>
          }
          <app-theme-toggle variant="ghost" />
        </div>
      </aside>

      <!-- Phones: a slim brand bar (the sidebar with the logo is hidden below 768 px). -->
      <div class="flex h-12 shrink-0 items-center px-4 md:hidden">
        <a
          routerLink="/appels"
          class="-ml-1 flex min-h-11 items-center gap-2 rounded-lg px-1"
          aria-label="E-Lease, Appels de loyer"
        >
          <img
            src="logos/e-lease-symbol.png"
            alt=""
            width="28"
            height="28"
            class="size-7 rounded-lg bg-white p-[3px] shadow-sm ring-1 ring-border"
          />
          <span class="text-[15px] font-bold tracking-tight">E-Lease</span>
        </a>
      </div>

      <main
        #contenu
        id="contenu"
        tabindex="-1"
        class="min-h-0 flex-1 overflow-y-auto focus:outline-none focus-visible:outline-none"
      >
        <div [class]="contentClass()">
          <app-update-banner />
          @if (!fullWidth()) {
            <app-next-action-hint />
          }
          <router-outlet />
        </div>
      </main>

      <nav
        aria-label="Navigation principale"
        class="shrink-0 border-t border-border bg-card/85 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_20px_-8px_rgb(15_23_42/0.12)] backdrop-blur-lg md:hidden"
      >
        <ul class="grid grid-cols-4">
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
  protected readonly fullWidth = signal(false);
  protected readonly contentClass = computed(() =>
    this.fullWidth()
      ? 'h-full w-full px-4 pt-4 pb-3 md:px-6 md:pt-5 md:pb-4'
      : 'mx-auto w-full max-w-6xl px-4 py-6 md:px-10 md:py-10',
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
    { path: '/statistiques', label: 'Statistiques', icon: 'chart' },
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
