import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { isSessionError } from '../../core/auth/session-error';
import { NOW } from '../../core/clock';
import { rentCallBody } from '../../core/email/rent-call-email';
import { formatDate } from '../../core/format/fr';
import { LandlordProfile } from '../../core/models/landlord-profile';
import { describeBackendError, isConnectionError } from '../../core/parse/backend-error';
import { LandlordProfileRepository } from '../../core/parse/landlord-profile.repository';
import { ErrorState } from '../../shared/ui/error-state';
import { TextField } from '../tenants/text-field';
import {
  LEGAL_NOTICE_MAX,
  ProfileForm,
  buildProfileForm,
  isProfileChanged,
  profileFromForm,
} from './landlord-profile-form';

/** Why a save failed, in a sentence. Saving a profile is idempotent: retrying is always safe. */
function profileSaveError(error: unknown): string {
  return isConnectionError(error)
    ? describeBackendError(error).message
    : "L'enregistrement a échoué. Réessayez dans un instant.";
}

/**
 * « Profil bailleur »: the name, address, issue city, legal notice and e-mail signature printed in every
 * rent-call PDF and e-mail. Loaded through the repository (a first-time user gets the profile pre-filled
 * with the values that were hard-coded before, so nothing changes until they edit it). « Enregistrer » is
 * available only for a valid, changed form, and saves once at a time. A live preview shows what the
 * PDF header and the e-mail signature will look like.
 */
@Component({
  selector: 'app-profile-card',
  imports: [ReactiveFormsModule, TextField, ErrorState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="rounded-xl border border-border bg-bg" aria-labelledby="profile-title">
      <header class="border-b border-border px-4 py-3 md:px-5">
        <h2 id="profile-title" class="text-sm font-semibold">Profil bailleur</h2>
        <p class="mt-0.5 text-sm text-muted">
          Ces informations figurent sur chaque appel de loyer (PDF) et dans la signature des
          e-mails.
        </p>
      </header>

      <div class="px-4 py-4 md:px-5">
        @if (form(); as f) {
          <form [formGroup]="f" class="flex flex-col gap-4" (ngSubmit)="save()" novalidate>
            <app-text-field
              inputId="profile-name"
              label="Nom ou raison sociale"
              [control]="f.controls.name"
              hint="Ce nom est imprimé dans « Établie par la … » : saisissez une forme du type « SCI … »."
            />
            <div class="grid gap-4 sm:grid-cols-2">
              <app-text-field
                inputId="profile-address-1"
                label="Adresse (ligne 1)"
                [control]="f.controls.addressLine1"
                autocomplete="off"
              />
              <app-text-field
                inputId="profile-address-2"
                label="Adresse (ligne 2)"
                [control]="f.controls.addressLine2"
                [optional]="true"
              />
            </div>
            <app-text-field
              inputId="profile-city"
              label="Ville d'émission"
              [control]="f.controls.issueCity"
              hint="Imprimée avant la date de l'appel de loyer, par exemple « LA CIOTAT »."
            />
            <app-text-field
              inputId="profile-legal"
              label="Mentions légales"
              [control]="f.controls.legalNotice"
              [multiline]="true"
              [rows]="3"
              [optional]="true"
              [hint]="legalHint"
            />
            <app-text-field
              inputId="profile-signature"
              label="Signature des e-mails"
              [control]="f.controls.emailSignature"
              hint="Termine chaque e-mail d'appel de loyer, par exemple « Pierre MARGERIT »."
            />

            <div>
              <h3 class="mb-2 text-sm font-medium">Aperçu</h3>
              <div class="grid gap-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <div
                  class="min-w-0 rounded-lg border border-border bg-white p-4 text-[13px] leading-snug text-neutral-900"
                  role="group"
                  aria-label="Aperçu de l'en-tête du PDF"
                >
                  <p class="font-semibold whitespace-pre-line break-words">{{ letterhead() }}</p>
                  <p class="mt-3 text-right text-neutral-500">
                    NOM DU LOCATAIRE<br />Adresse du bail
                  </p>
                  <p class="mt-3 break-words">{{ preview().issueCity }}<br />Le {{ today() }}</p>
                  <p class="mt-3 font-semibold">FACTURE DU LOYER pour …</p>
                  <p class="mt-2 break-words">Établie par la {{ preview().name }}</p>
                  <p
                    class="mt-3 text-[11px] whitespace-pre-line break-words text-neutral-600 italic"
                  >
                    {{ preview().legalNotice }}
                  </p>
                </div>
                <div
                  class="min-w-0 rounded-lg border border-border bg-surface p-4 text-[13px] leading-snug"
                  role="group"
                  aria-label="Aperçu de la signature des e-mails"
                >
                  <p class="mb-1 text-xs font-medium text-muted">Fin de l'e-mail</p>
                  <p class="whitespace-pre-line break-words">{{ emailEnd() }}</p>
                </div>
              </div>
            </div>

            @if (error(); as message) {
              <p
                role="alert"
                class="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger"
              >
                {{ message }}
              </p>
            }
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
              <p class="text-sm text-muted sm:mr-auto" role="status">
                @if (saving()) {
                  Enregistrement…
                } @else if (changed()) {
                  Modifications non enregistrées
                } @else if (justSaved()) {
                  Profil enregistré.
                }
              </p>
              <button
                type="button"
                class="btn btn-secondary"
                [disabled]="!changed() || saving()"
                (click)="discard()"
              >
                Annuler les modifications
              </button>
              <button
                type="submit"
                class="btn btn-primary"
                [disabled]="!canSave()"
                [attr.aria-busy]="saving()"
              >
                {{ saving() ? 'Enregistrement…' : 'Enregistrer' }}
              </button>
            </div>
          </form>
        } @else if (loadError(); as failed) {
          <app-error-state [error]="failed.cause" [retrying]="loading()" (retry)="load()" />
        } @else {
          <div class="flex flex-col gap-4" aria-busy="true" aria-label="Chargement du profil">
            @for (row of [0, 1, 2, 3]; track row) {
              <div class="h-10 animate-pulse rounded bg-border"></div>
            }
          </div>
        }
      </div>
    </section>
  `,
})
export class ProfileCard {
  private readonly fb = inject(FormBuilder);
  private readonly repository = inject(LandlordProfileRepository);
  private readonly destroyRef = inject(DestroyRef);
  private readonly now = inject(NOW);

  protected readonly legalHint = `Imprimées en bas de l'appel de loyer, plusieurs lignes possibles (${LEGAL_NOTICE_MAX} caractères au maximum).`;
  protected readonly form = signal<ProfileForm | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<{ cause: unknown } | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly justSaved = signal(false);

  /** The profile as stored (the id comes from it). */
  private readonly saved = signal<LandlordProfile | null>(null);
  /** What the untouched form describes: « changed » is measured against it, so spaces never count. */
  private readonly baseline = signal<LandlordProfile | null>(null);
  /** Bumped at every event of the form (value, status, touched). */
  private readonly tick = signal(0);

  /** The profile the form describes right now, valid or not. */
  protected readonly preview = computed<LandlordProfile>(() => {
    this.tick();
    const form = this.form();
    const saved = this.saved();
    return form && saved
      ? profileFromForm(form.getRawValue(), saved)
      : { name: '', addressLines: [], issueCity: '', legalNotice: '', emailSignature: '' };
  });
  protected readonly changed = computed(() => {
    const base = this.baseline();
    return base !== null && isProfileChanged(this.preview(), base);
  });
  protected readonly canSave = computed(() => {
    this.tick();
    return !!this.form()?.valid && this.changed() && !this.saving();
  });
  protected readonly letterhead = computed(() =>
    [this.preview().name, ...this.preview().addressLines].join('\n'),
  );
  protected readonly emailEnd = computed(() => {
    const body = rentCallBody(this.preview());
    return '[…]\n' + body.slice(body.indexOf('Bonne reception'));
  });
  protected readonly today = computed(() => formatDate(this.now().getTime()));

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      const profile = await this.repository.get();
      const form = buildProfileForm(this.fb, profile);
      form.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
        this.tick.update((n) => n + 1);
      });
      this.saved.set(profile);
      this.baseline.set(profileFromForm(form.getRawValue(), profile));
      this.form.set(form);
      this.loadError.set(null);
      if (form.invalid) {
        // A stored profile that no longer passes the rules: say which fields, right away.
        form.markAllAsTouched();
      }
    } catch (error) {
      // An expired session: the repository is already sending the user to the login screen.
      if (!isSessionError(error)) {
        this.loadError.set({ cause: error });
      }
    } finally {
      this.loading.set(false);
    }
  }

  protected discard(): void {
    const form = this.form();
    const saved = this.saved();
    if (form && saved && !this.saving()) {
      form.reset(buildProfileForm(this.fb, saved).getRawValue());
      this.error.set(null);
    }
  }

  protected async save(): Promise<void> {
    const form = this.form();
    const saved = this.saved();
    if (!form || !saved || this.saving()) {
      return;
    }
    if (form.invalid) {
      form.markAllAsTouched();
      return;
    }
    const profile = profileFromForm(form.getRawValue(), saved);
    this.saving.set(true);
    this.error.set(null);
    this.justSaved.set(false);
    try {
      await this.repository.save(profile);
      this.saved.set(profile);
      this.baseline.set(profile);
      this.justSaved.set(true);
    } catch (error) {
      if (!isSessionError(error)) {
        this.error.set(profileSaveError(error));
      }
    } finally {
      this.saving.set(false);
    }
  }
}
