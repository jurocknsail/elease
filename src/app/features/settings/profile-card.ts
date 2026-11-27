import { Icon } from '../../shared/ui/icon';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { isSessionError } from '../../core/auth/session-error';
import { NOW } from '../../core/clock';
import { rentCallBody, rentCallSubject } from '../../core/email/rent-call-email';
import { billingPeriod } from '../../core/billing/period';
import { PDF_RENDERER } from '../../core/pdf/pdf-render';
import { buildRentCallDefinition } from '../../core/pdf/rent-call-definition';
import type { Lease } from '../../core/models/lease';
import type { Leaseholder } from '../../core/models/leaseholder';
import { PdfViewer } from '../../shared/ui/pdf-viewer';
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

const SAMPLE_LEASE: Lease = {
  isPro: false,
  name: 'Appartement T3',
  lot: 12,
  streetNumber: 8,
  streetName: 'rue des Lilas',
  optionalAddressInfo: '2e étage',
  postalCode: 13600,
  city: 'LA CIOTAT',
  price: 850,
  charge: 60,
  additionalCharges: [],
  lastSendDate: 0,
  renewalDate: null,
} as unknown as Lease;

const SAMPLE_HOLDER: Leaseholder = {
  name: 'Jean DUPONT',
  email: 'jean.dupont@exemple.fr',
  phone: '',
  leases: [SAMPLE_LEASE],
};

/**
 * « Profil bailleur »: the name, address, issue city, legal notice and e-mail signature printed in every
 * rent-call PDF and e-mail. Loaded through the repository (a first-time user gets the profile pre-filled
 * with the values that were hard-coded before, so nothing changes until they edit it). « Enregistrer » is
 * available only for a valid, changed form, and saves once at a time. A live preview shows what the
 * PDF header and the e-mail signature will look like.
 */
@Component({
  selector: 'app-profile-card',
  imports: [Icon, ReactiveFormsModule, TextField, ErrorState, PdfViewer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="card" aria-labelledby="profile-title">
      <header class="flex items-start gap-3 border-b border-border px-4 py-4 md:px-5">
          <span class="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"><app-icon name="users" class="size-[18px]" /></span>
          <div class="min-w-0">
        <h2 id="profile-title" class="text-[15px] font-semibold">Profil bailleur</h2>
        <p class="mt-0.5 text-sm text-muted">
          Ces informations figurent sur chaque appel de loyer (PDF) et dans la signature des
          e-mails.
        </p>
      </div>
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

            <div class="form-panel flex flex-col gap-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="form-section-title">Aperçu complet</p>
                <p class="text-xs text-muted">Mis à jour pendant la saisie, avec un locataire d'exemple.</p>
              </div>
              <div class="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <div
                  class="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm"
                  role="group"
                  aria-label="Aperçu de l'e-mail"
                >
                  <div class="flex items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
                    <app-icon name="mail" class="size-4 text-accent" />
                    <span class="text-xs font-semibold">E-mail envoyé au locataire</span>
                  </div>
                  <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-b border-border px-4 py-3 text-xs">
                    <dt class="text-muted">De</dt>
                    <dd class="truncate font-medium">{{ preview().name || '—' }}</dd>
                    <dt class="text-muted">À</dt>
                    <dd class="truncate">jean.dupont&#64;exemple.fr</dd>
                    <dt class="text-muted">Objet</dt>
                    <dd class="truncate font-medium">{{ subject() }}</dd>
                  </dl>
                  <p class="flex-1 px-4 py-4 text-[13px] leading-relaxed whitespace-pre-line break-words">{{ emailBody() }}</p>
                  <div class="m-3 mt-0 flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs">
                    <span class="grid size-7 place-items-center rounded-md bg-danger text-[9px] font-bold text-white">PDF</span>
                    <span class="truncate font-medium">Appel de loyer.pdf</span>
                  </div>
                </div>
                <div
                  class="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm"
                  role="group"
                  aria-label="Aperçu du PDF"
                >
                  <div class="flex items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
                    <span class="grid size-4 place-items-center rounded-sm bg-danger text-[6px] font-bold text-white">PDF</span>
                    <span class="text-xs font-semibold">Appel de loyer (pièce jointe)</span>
                    @if (pdfBusy()) {
                      <span class="ml-auto text-xs text-muted">Mise à jour…</span>
                    }
                  </div>
                  <div class="h-[28rem] overflow-y-auto bg-canvas xl:h-[34rem]">
                    <app-pdf-viewer [blob]="pdfBlob()" />
                  </div>
                </div>
              </div>
            </div>

            @if (error(); as message) {
              <p
                role="alert"
                class="rounded-xl border border-danger/40 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger"
              >
                {{ message }}
              </p>
            }
            <div class="form-actions sm:items-center">
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
              ><app-icon name="x" class="size-4" />
                Annuler les modifications
              </button>
              <button
                type="submit"
                class="btn btn-primary"
                [disabled]="!canSave()"
                [attr.aria-busy]="saving()"
              ><app-icon name="check" class="size-4" />
                {{ saving() ? 'Enregistrement…' : 'Enregistrer' }}
              </button>
            </div>
          </form>
        } @else if (loadError(); as failed) {
          <app-error-state [error]="failed.cause" [retrying]="loading()" (retry)="load()" />
        } @else {
          <div class="flex flex-col gap-4" aria-busy="true" aria-label="Chargement du profil">
            @for (row of [0, 1, 2, 3]; track row) {
              <div class="h-10 animate-pulse rounded-md bg-border/70"></div>
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
  protected readonly emailBody = computed(() => rentCallBody(this.preview()));
  protected readonly subject = computed(() => rentCallSubject(billingPeriod(this.now())));

  /** The real PDF, rebuilt from the form (debounced) with an example tenant and lease. */
  private readonly render = inject(PDF_RENDERER);
  protected readonly pdfBlob = signal<Blob | null>(null);
  protected readonly pdfBusy = signal(false);
  private pdfTimer: ReturnType<typeof setTimeout> | undefined;
  private pdfRun = 0;
  private readonly pdfEffect = effect((onCleanup) => {
    const profile = this.preview();
    if (!this.form()) return;
    this.pdfBusy.set(true);
    this.pdfTimer = setTimeout(() => void this.renderPdf(profile), 450);
    onCleanup(() => clearTimeout(this.pdfTimer));
  });

  private async renderPdf(profile: LandlordProfile): Promise<void> {
    const run = ++this.pdfRun;
    try {
      const now = this.now();
      const { blob } = await this.render(
        buildRentCallDefinition({ leaseholder: SAMPLE_HOLDER, lease: SAMPLE_LEASE, profile, callDate: now, now }),
      );
      if (run === this.pdfRun) this.pdfBlob.set(blob);
    } catch {
      // The preview is a convenience: on failure the previous PDF stays.
    } finally {
      if (run === this.pdfRun) this.pdfBusy.set(false);
    }
  }
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
