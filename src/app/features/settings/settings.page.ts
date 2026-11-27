import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { InstallService } from '../../core/pwa/install.service';
import { ThemeMode, ThemeService } from '../../core/theme/theme.service';
import { Icon, IconName } from '../../shared/ui/icon';
import { BackupCard } from './backup-card';
import { ProfileCard } from './profile-card';

interface ThemeOption {
  mode: ThemeMode;
  label: string;
  icon: IconName;
}

/**
 * Réglages: one scrollable column of cards. Profil bailleur (printed on every PDF and e-mail),
 * Apparence (Système / Clair / Sombre: on a phone this is the only place to change it), Sauvegarde,
 * Application (installation as an app, hidden once installed) and Compte (sign out).
 */
@Component({
  selector: 'app-settings',
  imports: [Icon, ProfileCard, BackupCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto flex w-full max-w-[720px] flex-col gap-6">
      <h1 class="text-2xl font-semibold tracking-tight md:text-[1.75rem]">Réglages</h1>

      <app-profile-card />

      <section class="rounded-xl border border-border bg-bg" aria-labelledby="appearance-title">
        <header class="border-b border-border px-4 py-3 md:px-5">
          <h2 id="appearance-title" class="text-sm font-semibold">Apparence</h2>
          <p class="mt-0.5 text-sm text-muted">
            « Système » suit le réglage clair ou sombre de votre appareil.
          </p>
        </header>
        <div class="px-4 py-4 md:px-5">
          <div role="radiogroup" aria-labelledby="appearance-title" class="grid grid-cols-3 gap-2">
            @for (option of themes; track option.mode) {
              <label
                class="flex min-h-11 min-w-0 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border-strong px-2 text-sm font-medium select-none has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent dense:min-h-9"
              >
                <input
                  type="radio"
                  name="theme"
                  class="sr-only"
                  [value]="option.mode"
                  [checked]="theme.mode() === option.mode"
                  (change)="theme.setMode(option.mode)"
                />
                <app-icon [name]="option.icon" class="size-5 shrink-0" />
                <span class="truncate">{{ option.label }}</span>
              </label>
            }
          </div>
        </div>
      </section>

      <app-backup-card />

      @if (!install.isStandalone()) {
        <section class="rounded-xl border border-border bg-bg" aria-labelledby="install-title">
          <header class="border-b border-border px-4 py-3 md:px-5">
            <h2 id="install-title" class="text-sm font-semibold">Application</h2>
            <p class="mt-0.5 text-sm text-muted">
              Installez E-Lease pour l'ouvrir comme une application, dans sa propre fenêtre.
            </p>
          </header>
          <div class="flex flex-col gap-3 px-4 py-4 text-sm md:px-5">
            @if (install.canPrompt()) {
              <div>
                <button
                  type="button"
                  class="btn btn-primary w-full sm:w-auto"
                  (click)="installApp()"
                >
                  Installer l'application
                </button>
              </div>
            } @else if (asked()) {
              <p>
                Si vous avez accepté, ouvrez E-Lease depuis son icône : sur votre bureau, dans vos
                applications ou sur votre écran d'accueil.
              </p>
            } @else if (install.platform === 'ios') {
              <p class="font-medium">Sur iPhone et iPad</p>
              <ol class="flex list-decimal flex-col gap-1 pl-5">
                <li>Ouvrez E-Lease dans Safari.</li>
                <li>Touchez « Partager » (le carré avec une flèche vers le haut).</li>
                <li>Choisissez « Sur l'écran d'accueil », puis « Ajouter ».</li>
              </ol>
              <p class="text-muted">Cette procédure demande iOS 16.4 ou plus récent.</p>
            } @else {
              <p class="font-medium">
                {{
                  install.platform === 'android' ? 'Sur Android' : 'Sur ordinateur (Chrome, Edge)'
                }}
              </p>
              <ol class="flex list-decimal flex-col gap-1 pl-5">
                <li>Ouvrez le menu du navigateur (les trois points en haut à droite).</li>
                <li>
                  Choisissez « Installer l'application » (ou « Ajouter à l'écran d'accueil »).
                </li>
                <li>Confirmez : E-Lease s'ouvre alors dans sa propre fenêtre.</li>
              </ol>
              <p class="text-muted">
                Si l'option n'apparaît pas, le navigateur ne la propose pas : Firefox et Safari sur
                ordinateur n'installent pas les applications web.
              </p>
            }
          </div>
        </section>
      }

      <section class="rounded-xl border border-border bg-bg" aria-labelledby="account-title">
        <header class="border-b border-border px-4 py-3 md:px-5">
          <h2 id="account-title" class="text-sm font-semibold">Compte</h2>
        </header>
        <div class="flex flex-col gap-4 px-4 py-4 md:px-5">
          @if (auth.user(); as user) {
            <dl class="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
              <div class="min-w-0">
                <dt class="text-xs font-medium text-muted">Identifiant</dt>
                <dd class="mt-0.5 truncate text-sm font-semibold" [attr.title]="user.username">
                  {{ user.username }}
                </dd>
              </div>
              @if (user.email) {
                <div class="min-w-0">
                  <dt class="text-xs font-medium text-muted">Adresse e-mail</dt>
                  <dd class="mt-0.5 truncate text-sm" [attr.title]="user.email">
                    {{ user.email }}
                  </dd>
                </div>
              }
            </dl>
          }
          <div>
            <button type="button" class="btn btn-secondary w-full sm:w-auto" (click)="logout()">
              <app-icon name="log-out" class="size-5" />
              Se déconnecter
            </button>
          </div>
        </div>
      </section>
    </div>
  `,
})
export class SettingsPage {
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  protected readonly install = inject(InstallService);
  private readonly router = inject(Router);

  protected readonly themes: readonly ThemeOption[] = [
    { mode: 'system', label: 'Système', icon: 'monitor' },
    { mode: 'light', label: 'Clair', icon: 'sun' },
    { mode: 'dark', label: 'Sombre', icon: 'moon' },
  ];
  /** The installation dialog was shown: the steps below it would be misleading now. */
  protected readonly asked = signal(false);

  protected async installApp(): Promise<void> {
    await this.install.prompt();
    this.asked.set(true);
  }

  protected async logout(): Promise<void> {
    // Not awaited: the user and the in-memory data are gone before the first `await` inside, and the
    // wait for the server to revoke the session (up to 3 s) must not delay the redirect.
    void this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
