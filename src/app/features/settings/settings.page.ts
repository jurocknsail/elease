import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { ThemeToggle } from '../../shared/ui/theme-toggle';

/**
 * Placeholder: replaced by the full Réglages screen (Task 10). Meanwhile it carries what the app needs
 * to be usable: the theme toggle (on a phone the shell has none) and a way to sign out.
 */
@Component({
  selector: 'app-settings',
  imports: [EmptyState, ThemeToggle, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="text-2xl font-semibold tracking-tight">Réglages</h1>

    <section class="mt-6 max-w-md" aria-labelledby="appearance">
      <h2 id="appearance" class="mb-2 text-sm font-semibold">Apparence</h2>
      <app-theme-toggle />
    </section>

    <section class="mt-6 max-w-md" aria-labelledby="account">
      <h2 id="account" class="mb-2 text-sm font-semibold">Compte</h2>
      @if (auth.user(); as user) {
        <p class="mb-3 truncate text-sm text-muted">
          Connecté en tant que <span class="font-semibold text-text">{{ user.username }}</span>
        </p>
      }
      <button type="button" class="btn btn-secondary w-full justify-start" (click)="logout()">
        <app-icon name="log-out" class="size-5" />
        Se déconnecter
      </button>
    </section>

    <app-empty-state
      class="mt-8 rounded-xl border border-dashed border-border-strong"
      heading="Bientôt disponible"
      message="Le profil bailleur, la sauvegarde et l'installation de l'application arrivent dans une prochaine étape."
      icon="clock"
    />
  `,
})
export class SettingsPage {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected async logout(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
