import { Icon } from '../../shared/ui/icon';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { DEFAULT_URL, safeReturnUrl } from '../../core/auth/return-url';
import { isConnectionError } from '../../core/parse/backend-error';
import { OBJECT_NOT_FOUND } from '../../core/parse/parse-client';

const WRONG_CREDENTIALS = 'Identifiant ou mot de passe incorrect';
const UNREACHABLE = 'Le serveur ne répond pas. Réessayez.';
const OTHER_FAILURE = 'Connexion impossible pour le moment. Réessayez.';

/**
 * The message for a failed sign-in. « Identifiant ou mot de passe incorrect » is reserved for Parse
 * code 101: a timeout, a network failure or any other error must never tell the user their password
 * is wrong. Never contains what the user typed.
 */
export function loginErrorMessage(error: unknown): string {
  if ((error as { code?: unknown } | null)?.code === OBJECT_NOT_FOUND) {
    return WRONG_CREDENTIALS;
  }
  return isConnectionError(error) ? UNREACHABLE : OTHER_FAILURE;
}

@Component({
  selector: 'app-login',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <main
      class="relative flex min-h-dvh items-center justify-center overflow-hidden bg-canvas bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_srgb,var(--color-accent)_16%,transparent),transparent)] px-4 py-10 pt-[max(2.5rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(2.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]"
    >
      <div class="w-full max-w-sm">
        <div class="mb-6 flex flex-col items-center gap-3">
          <img
            src="logos/e-lease-symbol.png"
            alt=""
            width="56"
            height="56"
            class="size-16 rounded-2xl bg-white p-1.5 shadow-xl shadow-accent/20 ring-1 ring-border"
          />
          <p class="text-xl font-bold tracking-tight">E-Lease</p><p class="-mt-2 text-sm text-muted">Vos appels de loyer, sans effort.</p>
        </div>

        <div class="card p-6 shadow-xl sm:p-8">
          <h1 class="text-xl font-semibold tracking-tight">Connexion</h1>
          <p class="mt-1 text-sm text-muted">
            Connectez-vous pour gérer vos locataires et vos appels de loyer.
          </p>

          <form class="mt-6 flex flex-col gap-4" novalidate (submit)="submit($event)">
            <div>
              <label for="login-username" class="mb-1.5 block text-sm font-medium">
                Identifiant
              </label>
              <input
                #username
                id="login-username"
                name="username"
                type="text"
                class="field-input"
                autocomplete="username"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
                enterkeyhint="next"
                required
                [attr.aria-invalid]="missing().username"
                [attr.aria-describedby]="missing().username ? 'login-username-error' : null"
              />
              @if (missing().username) {
                <p id="login-username-error" class="mt-1.5 text-sm text-danger">
                  Saisissez votre identifiant
                </p>
              }
            </div>

            <div>
              <label for="login-password" class="mb-1.5 block text-sm font-medium">
                Mot de passe
              </label>
              <input
                #password
                id="login-password"
                name="password"
                type="password"
                class="field-input"
                autocomplete="current-password"
                enterkeyhint="go"
                required
                [attr.aria-invalid]="missing().password"
                [attr.aria-describedby]="missing().password ? 'login-password-error' : null"
              />
              @if (missing().password) {
                <p id="login-password-error" class="mt-1.5 text-sm text-danger">
                  Saisissez votre mot de passe
                </p>
              }
            </div>

            @if (errorMessage(); as message) {
              <p
                role="alert"
                class="rounded-xl border border-danger/40 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger"
              >
                {{ message }}
              </p>
            }

            <button
              type="submit"
              class="btn btn-primary mt-2 w-full min-h-12 dense:min-h-11"
              [disabled]="pending()"
              [attr.aria-busy]="pending()"
            ><app-icon name="log-in" class="size-4" />
              {{ pending() ? 'Connexion…' : 'Se connecter' }}
            </button>
          </form>
        </div>
      </div>
    </main>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly usernameInput = viewChild.required<ElementRef<HTMLInputElement>>('username');
  private readonly passwordInput = viewChild.required<ElementRef<HTMLInputElement>>('password');

  protected readonly pending = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly missing = signal({ username: false, password: false });

  constructor() {
    afterNextRender(() => {
      // On a computer, start typing right away. Not on a phone: it would pop the keyboard up before
      // the user has seen the screen.
      if (
        typeof matchMedia === 'function' &&
        matchMedia('(hover: hover) and (pointer: fine)').matches
      ) {
        this.usernameInput().nativeElement.focus();
      }
    });
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.pending()) {
      return;
    }
    // Read from the fields at submit time: browsers and password managers can autofill without
    // firing an input event. The identifier is trimmed (phones add stray spaces); the password never is.
    const username = this.usernameInput().nativeElement.value.trim();
    const password = this.passwordInput().nativeElement.value;
    this.missing.set({ username: username === '', password: password === '' });
    if (username === '' || password === '') {
      (username === '' ? this.usernameInput() : this.passwordInput()).nativeElement.focus();
      return;
    }

    this.pending.set(true);
    this.errorMessage.set(null);
    try {
      await this.auth.login(username, password);
    } catch (error) {
      this.errorMessage.set(loginErrorMessage(error));
      if (loginErrorMessage(error) === WRONG_CREDENTIALS) {
        const field = this.passwordInput().nativeElement;
        field.value = '';
        field.focus();
      }
      this.pending.set(false);
      return;
    }
    // Signed in: back to where the guard stopped the user, if that is an internal address.
    const returnUrl = safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));
    await this.router.navigateByUrl(returnUrl ?? DEFAULT_URL);
    this.pending.set(false);
  }
}
