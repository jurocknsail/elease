import { Icon } from '../../shared/ui/icon';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { isSessionError } from '../../core/auth/session-error';
import { computeTVA, computeTotalPrice } from '../../core/billing/amounts';
import { periodLabel } from '../../core/billing/period';
import { NOW } from '../../core/clock';
import { formatDate, formatEuro, formatPostalCode, toFieldNumber } from '../../core/format/fr';
import { InseeService, InseeUnavailableError } from '../../core/insee/insee.service';
import { INDEX_TYPES, IndexType, Lease } from '../../core/models/lease';
import { leaseToParseFields } from '../../core/parse/mapping';
import { LeaseholderRepository } from '../../core/parse/leaseholder.repository';
import { appliedRevision, revisionState } from '../../core/revision/revision';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { Pill, PillTone } from '../../shared/ui/pill';
import {
  LeaseForm,
  buildChargeGroup,
  buildLeaseForm,
  isLeaseIncomplete,
  leaseFromForm,
} from './lease-form';
import { TenantsState, saveErrorMessage } from './tenants-state';
import { TextField, focusAfterRender, focusFirstInvalid } from './text-field';

let nextId = 0;

const INDEX_NAMES: Record<IndexType, string> = {
  IRL: 'habitation',
  ILC: 'commerce et artisanat',
  ILAT: 'bureaux et autres activités',
};

/** '2025-T2' becomes « T2 2025 ». */
function quarterLabel(quarter: string): string {
  const match = /^(\d{4})-T([1-4])$/.exec(quarter);
  return match ? `T${match[2]} ${match[1]}` : quarter;
}

/** « IRL · T2 2025 · 145,47 », whatever part is known; null when nothing is. */
export function indexLabel(lease: Lease): string | null {
  const parts = [
    lease.indexType,
    lease.referenceIndexQuarter ? quarterLabel(lease.referenceIndexQuarter) : undefined,
    lease.referenceIndexValue !== undefined ? toFieldNumber(lease.referenceIndexValue) : undefined,
  ].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * « Jamais » when nothing was ever sent (0 is 01/01/1970 as a date), else the date, and the period of
 * the call when it is known for THAT send: a later send from the old app only rewrites the date, so a
 * period recorded with another date is not shown next to it.
 */
export function lastSendLabel(lease: Lease): string {
  if (!lease.lastSendDate) {
    return 'Jamais';
  }
  const date = formatDate(lease.lastSendDate);
  const match = lease.lastSentPeriod ? /^(\d{4})-(\d{2})$/.exec(lease.lastSentPeriod) : null;
  if (match && lease.lastSentPeriodAt === lease.lastSendDate) {
    return `${date} · appel de ${periodLabel({ year: Number(match[1]), month: Number(match[2]) })}`;
  }
  return date;
}

const RADIO =
  'flex min-h-11 flex-1 cursor-pointer items-center gap-2.5 rounded-xl border border-border-strong bg-card px-3.5 text-sm shadow-sm transition-colors dense:min-h-10 hover:border-text/50 has-checked:border-accent has-checked:bg-accent-soft has-checked:font-semibold has-checked:ring-2 has-checked:ring-accent/20 sm:flex-none';

/**
 * One lease: read-only (address, rent, charges, total, anniversary date, index, last send), with
 * « Modifier » opening the form in place and « Supprimer » asking for a confirmation. Without a `lease`
 * it is the form for a NEW lease (« + Ajouter un bail »), open from the start; `closed` tells the page
 * when it was saved or cancelled.
 *
 * « Annuler » (or Escape) throws the typed values away and persists nothing. A failed save keeps the
 * form open with what was typed, and says why inside the block. Every button is disabled while a
 * request runs (one request at a time); after a time-out the data is reloaded before another attempt.
 *
 * The read-only view is built in separate parts (header, details, and a slot for the annual revision)
 * so that the revision proposal can be added to it without touching the rest.
 */
@Component({
  selector: 'app-lease-block',
  imports: [Icon, ReactiveFormsModule, TextField, Pill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section
      #root
      class="card"
      [attr.aria-labelledby]="uid + '-title'"
    >
      <header
        class="flex items-start justify-between gap-3 border-b border-border px-4 py-3 md:px-5"
      >
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5 pt-0.5">
          <h3 [id]="uid + '-title'" class="min-w-0 truncate text-sm font-semibold">
            {{ title() }}
          </h3>
          @if (!form()) {
            @for (pill of pills(); track pill.label) {
              <app-pill [tone]="pill.tone">{{ pill.label }}</app-pill>
            }
          }
        </div>
        @if (!form()) {
          <div class="toolbar">
            <button
              #edit
              type="button"
              class="btn btn-icon"
              title="Modifier le bail"
              [disabled]="deleting() || applying()"
              (click)="startEdit()"
            ><app-icon name="pencil" class="size-[18px]" /><span class="sr-only">Modifier</span></button>
            <button
              type="button"
              class="btn btn-icon btn-icon-danger"
              title="Supprimer le bail"
              [disabled]="blocked()"
              [attr.aria-busy]="deleting()"
              (click)="remove()"
            ><app-icon name="trash" class="size-[18px]" /><span class="sr-only">{{
              deleting() ? 'Suppression…' : 'Supprimer'
            }}</span></button>
          </div>
        }
      </header>

      @if (form(); as f) {
        <form
          [formGroup]="f"
          class="flex flex-col gap-4 px-4 py-4 md:px-5"
          (ngSubmit)="save()"
          (keydown.escape)="cancel()"
        >
          <div class="form-panel grid grid-cols-1 gap-4 @md:grid-cols-6">
            <p class="form-section-title @md:col-span-6">Bail et adresse</p>
            <app-text-field
              class="@md:col-span-6"
              [inputId]="uid + '-name'"
              label="Nom du bail"
              [control]="f.controls.name"
              hint="Par exemple : Appartement T3, Local commercial, Garage n° 13."
            />

            <fieldset class="@md:col-span-6">
              <legend class="form-label">Type de bail</legend>
              <div class="flex flex-wrap gap-2">
                <label class="${RADIO}">
                  <input
                    type="radio"
                    formControlName="isPro"
                    [value]="false"
                    class="size-4 accent-accent"
                  />
                  Habitation
                </label>
                <label class="${RADIO}">
                  <input
                    type="radio"
                    formControlName="isPro"
                    [value]="true"
                    class="size-4 accent-accent"
                  />
                  Professionnel
                </label>
              </div>
              <p class="mt-1.5 text-xs text-muted">
                Un bail professionnel est facturé avec 20 % de TVA sur le loyer.
              </p>
            </fieldset>

            <app-text-field
              class="@md:col-span-2"
              [inputId]="uid + '-streetNumber'"
              label="Numéro"
              inputmode="numeric"
              [control]="f.controls.streetNumber"
            />
            <app-text-field
              class="@md:col-span-4"
              [inputId]="uid + '-streetName'"
              label="Voie"
              autocomplete="off"
              [control]="f.controls.streetName"
            />
            <app-text-field
              class="@md:col-span-4"
              [inputId]="uid + '-optionalAddressInfo'"
              label="Complément d'adresse"
              [optional]="true"
              [control]="f.controls.optionalAddressInfo"
            />
            <app-text-field
              class="@md:col-span-2"
              [inputId]="uid + '-lot'"
              label="Lot"
              inputmode="numeric"
              [optional]="true"
              [control]="f.controls.lot"
            />
            <app-text-field
              class="@md:col-span-2"
              [inputId]="uid + '-postalCode'"
              label="Code postal"
              inputmode="numeric"
              autocomplete="off"
              [control]="f.controls.postalCode"
            />
            <app-text-field
              class="@md:col-span-4"
              [inputId]="uid + '-city'"
              label="Ville"
              [control]="f.controls.city"
            />

            <app-text-field
              class="@md:col-span-3"
              [inputId]="uid + '-price'"
              label="Loyer hors charges (€)"
              inputmode="decimal"
              [control]="f.controls.price"
              hint="Par mois, hors TVA et hors charges."
            />
            <app-text-field
              class="@md:col-span-3"
              [inputId]="uid + '-charge'"
              label="Avance sur charges (€)"
              inputmode="decimal"
              [optional]="true"
              [control]="f.controls.charge"
            />
          </div>

          <fieldset class="form-panel flex flex-col gap-3">
            <legend class="form-section-title float-left mb-1 w-full">Loyer et charges additionnelles</legend>
            @for (row of f.controls.additionalCharges.controls; track row; let i = $index) {
              <div
                class="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-start gap-x-2 @md:grid-cols-[minmax(0,1fr)_9rem_auto] @md:gap-x-3"
              >
                <app-text-field
                  [inputId]="uid + '-charge-' + i + '-title'"
                  label="Intitulé"
                  [control]="row.controls.title"
                />
                <app-text-field
                  [inputId]="uid + '-charge-' + i + '-amount'"
                  label="Montant (€)"
                  inputmode="decimal"
                  [control]="row.controls.amount"
                />
                <button
                  type="button"
                  class="btn btn-icon btn-icon-danger mt-[1.625rem]"
                  title="Retirer cette charge"
                  [attr.aria-label]="'Retirer la charge additionnelle ' + (i + 1)"
                  (click)="removeCharge(i)"
                ><app-icon name="trash" class="size-[18px]" /></button>
              </div>
            }
            <div>
              <button type="button" class="btn btn-quiet -ml-2.5" (click)="addCharge()"><app-icon name="plus" class="size-4" />
                Ajouter une charge
              </button>
            </div>
          </fieldset>

          <div class="form-panel grid grid-cols-1 gap-4 @md:grid-cols-6">
            <p class="form-section-title @md:col-span-6">Révision annuelle</p>
            <app-text-field
              class="@md:col-span-3"
              [inputId]="uid + '-renewalDate'"
              label="Date anniversaire"
              type="date"
              [optional]="true"
              [control]="f.controls.renewalDate"
              hint="Jour de la révision annuelle du loyer."
            />
            <div class="@md:col-span-3">
              <label [for]="uid + '-indexType'" class="form-label">
                Famille d'indice
              </label>
              <select [id]="uid + '-indexType'" formControlName="indexType" class="field-input">
                @for (type of indexTypes; track type) {
                  <option [value]="type">{{ type }} ({{ indexNames[type] }})</option>
                }
              </select>
            </div>
            <app-text-field
              class="@md:col-span-3"
              [inputId]="uid + '-referenceIndexQuarter'"
              label="Trimestre de l'indice de référence"
              [optional]="true"
              [control]="f.controls.referenceIndexQuarter"
              hint="Format 2025-T2."
            />
            <app-text-field
              class="@md:col-span-3"
              [inputId]="uid + '-referenceIndexValue'"
              label="Valeur de l'indice de référence"
              inputmode="decimal"
              [optional]="true"
              [control]="f.controls.referenceIndexValue"
            />
          </div>

          @if (error(); as message) {
            <p
              role="alert"
              class="rounded-xl border border-danger/40 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger"
            >
              {{ message }}
            </p>
          }
          <div class="form-actions">
            <button
              type="button"
              class="btn btn-secondary"
              [disabled]="saving()"
              (click)="cancel()"
            >
              Annuler
            </button>
            <button
              type="submit"
              class="btn btn-primary"
              [disabled]="blocked()"
              [attr.aria-busy]="saving()"
            ><app-icon name="check" class="size-4" />
              {{ saving() ? 'Enregistrement…' : 'Enregistrer' }}
            </button>
          </div>
        </form>
      } @else if (lease(); as l) {
        <div
          class="grid grid-cols-1 gap-x-8 gap-y-4 px-4 py-4 md:px-5 @xl:grid-cols-[minmax(0,1fr)_minmax(0,19rem)]"
        >
          <dl class="grid grid-cols-2 content-start gap-x-4 gap-y-4">
            <div class="col-span-2 min-w-0">
              <dt class="meta-label">Adresse</dt>
              <dd class="mt-1 text-sm break-words">
                {{ l.streetNumber }} {{ l.streetName }}@if (l.optionalAddressInfo) {<span>, {{ l.optionalAddressInfo }}</span>}
                <span class="block text-muted">
                  {{ postalCode(l) }} {{ l.city }}@if (l.lot) {<span> · Lot {{ l.lot }}</span>}
                </span>
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="meta-label">Date anniversaire</dt>
              <dd class="mt-1 text-sm tabular-nums">{{ l.renewalDate != null ? date(l.renewalDate) : '—' }}</dd>
            </div>
            <div class="min-w-0">
              <dt class="meta-label">Indice de référence</dt>
              <dd class="mt-1 text-sm break-words">{{ index() ?? 'Non renseigné' }}</dd>
            </div>
            <div class="col-span-2 min-w-0">
              <dt class="meta-label">Dernier envoi</dt>
              <dd class="mt-1 text-sm">{{ lastSend() }}</dd>
            </div>
          </dl>

          <dl
            class="self-start rounded-xl border border-border bg-surface/60 px-3.5 py-2.5 text-sm"
            aria-label="Montant de l'appel"
          >
            <div class="flex justify-between gap-3 py-1">
              <dt class="text-muted">Loyer hors charges</dt>
              <dd class="shrink-0 tabular-nums">{{ euro(l.price) }}</dd>
            </div>
            <div class="flex justify-between gap-3 py-1">
              <dt class="text-muted">Avance sur charges</dt>
              <dd class="shrink-0 tabular-nums">{{ l.charge ? euro(l.charge) : '—' }}</dd>
            </div>
            @if (l.isPro) {
              <div class="flex justify-between gap-3 py-1">
                <dt class="text-muted">TVA (20 % du loyer)</dt>
                <dd class="shrink-0 tabular-nums">{{ euro(tva(l)) }}</dd>
              </div>
            }
            @for (charge of l.additionalCharges; track $index) {
              <div class="flex justify-between gap-3 py-1">
                <dt class="min-w-0 truncate text-muted" [attr.title]="charge.title">{{ charge.title }}</dt>
                <dd class="shrink-0 tabular-nums">{{ euro(charge.amount) }}</dd>
              </div>
            }
            <div class="mt-1.5 flex items-baseline justify-between gap-3 border-t border-border pt-2.5 pb-0.5">
              <dt class="font-medium">Total de l'appel</dt>
              <dd class="shrink-0 text-base font-semibold tabular-nums">{{ euro(total(l)) }}</dd>
            </div>
          </dl>
        </div>

        <div data-slot="revision" class="empty:hidden">
          @if (revisionView(); as view) {
            <div
              class="mx-4 mb-4 flex flex-col gap-2 rounded-lg border border-border bg-surface px-3 py-3 md:mx-5"
              [attr.aria-busy]="applying()"
            >
              @if (view.line) {
                <p class="text-sm">
                  <span class="font-semibold tabular-nums">{{ view.line }}</span>
                  <span class="text-muted"> {{ view.suffix }}</span>
                </p>
                <p class="text-xs text-muted">{{ view.hint }}</p>
                <div>
                  <button
                    type="button"
                    class="btn btn-primary"
                    [disabled]="blocked()"
                    [attr.aria-busy]="applying()"
                    (click)="applyRevision()"
                  ><app-icon name="trending-up" class="size-4" />
                    {{ applying() ? 'Application…' : 'Appliquer la révision' }}
                  </button>
                </div>
              } @else if (view.status === 'error') {
                <p class="text-sm text-muted" role="status" [attr.title]="view.errorMessage">
                  Indices INSEE indisponibles —
                  <button
                    type="button"
                    class="inline-flex min-h-11 items-center rounded px-1 font-semibold text-accent underline underline-offset-2"
                    (click)="loadIndices(view.type)"
                  >
                    Réessayer
                  </button>
                </p>
              } @else if (view.status === 'loading') {
                <p class="text-sm text-muted" role="status">Chargement des indices INSEE…</p>
              } @else {
                <p class="text-sm text-muted">{{ view.pending }}</p>
              }
            </div>
          }
        </div>

        @if (error(); as message) {
          <p
            role="alert"
            class="mx-4 mb-4 rounded-xl border border-danger/40 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger md:mx-5"
          >
            {{ message }}
          </p>
        }
      }
    </section>
  `,
})
export class LeaseBlock implements OnInit {
  /** The tenant the lease belongs to. */
  readonly holderId = input.required<string>();
  /** The lease shown, or null for the form of a new lease. */
  readonly lease = input<Lease | null>(null);
  /** The form of a new lease was saved or cancelled. */
  readonly closed = output<void>();

  private readonly fb = inject(FormBuilder);
  private readonly injector = inject(Injector);
  private readonly repository = inject(LeaseholderRepository);
  private readonly confirm = inject(ConfirmDialog);
  private readonly insee = inject(InseeService);
  private readonly now = inject(NOW);
  protected readonly state = inject(TenantsState);
  private readonly root = viewChild<ElementRef<HTMLElement>>('root');
  private readonly editButton = viewChild<ElementRef<HTMLButtonElement>>('edit');

  protected readonly uid = `lease-${(nextId += 1)}`;
  protected readonly indexTypes = INDEX_TYPES;
  protected readonly indexNames = INDEX_NAMES;
  protected readonly form = signal<LeaseForm | null>(null);
  protected readonly saving = signal(false);
  protected readonly deleting = signal(false);
  protected readonly applying = signal(false);
  /** The INSEE values loaded for one index family (the lease's), or the state of that load. */
  private readonly indices = signal<{
    type: IndexType;
    status: 'loading' | 'ready' | 'error';
    map?: Map<string, number>;
    errorMessage?: string;
  } | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly title = computed(() => {
    const lease = this.lease();
    return lease ? lease.name || 'Bail sans nom' : 'Nouveau bail';
  });
  protected readonly index = computed(() => {
    const lease = this.lease();
    return lease ? indexLabel(lease) : null;
  });
  protected readonly lastSend = computed(() => {
    const lease = this.lease();
    return lease ? lastSendLabel(lease) : '';
  });

  /** « Pro » or « Habitation », and « À compléter » while the anniversary date or the index is missing. */
  protected readonly pills = computed<{ label: string; tone: PillTone }[]>(() => {
    const lease = this.lease();
    if (!lease) {
      return [];
    }
    const pills: { label: string; tone: PillTone }[] = [
      { label: lease.isPro ? 'Pro' : 'Habitation', tone: lease.isPro ? 'accent' : 'neutral' },
    ];
    if (isLeaseIncomplete(lease)) {
      pills.push({ label: 'À compléter', tone: 'warn' });
    }
    const revision = this.revision();
    if (revision?.kind === 'upcoming') {
      pills.push({
        label: `Révision le ${formatDate(revision.anniversary.getTime()).slice(0, 5)}`,
        tone: 'accent',
      });
    }
    return pills;
  });

  /** The values of the lease's own index family, once loaded. */
  private readonly observations = computed(() => {
    const indices = this.indices();
    return indices?.status === 'ready' && indices.type === this.lease()?.indexType
      ? indices.map
      : undefined;
  });

  /** Where the annual revision of the lease stands today (null for the form of a new lease). */
  protected readonly revision = computed(() => {
    const lease = this.lease();
    return lease ? revisionState(lease, this.now(), this.observations()) : null;
  });

  /** What the revision slot shows; null when there is nothing to say. */
  protected readonly revisionView = computed(() => {
    const lease = this.lease();
    const revision = this.revision();
    if (!lease || revision?.kind !== 'upcoming' || !lease.indexType) {
      return null;
    }
    const type = lease.indexType;
    const changes = appliedRevision(revision);
    const label = `${type} ${quarterLabel(revision.targetQuarter)}`;
    const indices = this.indices();
    const status = indices?.type === type ? indices.status : 'loading';
    if (revision.proposedRent !== undefined && changes) {
      return {
        type,
        status,
        line: `${formatEuro(lease.price)} \u2192 ${formatEuro(revision.proposedRent)}`,
        suffix: `(${label})`,
        hint: `Le loyer et l'indice de référence seront mis à jour. La prochaine date anniversaire passera au ${formatDate(changes.renewalDate)}.`,
        pending: '',
        errorMessage: '',
      };
    }
    const when = revision.publication ? formatDate(revision.publication.getTime()) : '';
    return {
      type,
      status,
      line: '',
      suffix: '',
      hint: '',
      pending: `Indice ${label} attendu vers le ${when}`,
      errorMessage: indices?.errorMessage ?? '',
    };
  });

  protected readonly euro = formatEuro;
  protected readonly date = formatDate;
  protected readonly tva = computeTVA;
  protected readonly total = computeTotalPrice;
  protected postalCode(lease: Lease): string {
    return formatPostalCode(lease.postalCode);
  }

  constructor() {
    // The INSEE values are only fetched when a revision is close, once per index family.
    effect(() => {
      const type = this.lease()?.indexType;
      const revision = this.revision();
      const indices = this.indices();
      if (type && revision?.kind === 'upcoming' && indices?.type !== type) {
        untracked(() => void this.loadIndices(type));
      }
    });
  }

  ngOnInit(): void {
    if (this.lease() === null) {
      this.form.set(buildLeaseForm(this.fb));
    }
  }

  /** Loads (or reloads, after a failure) the INSEE values of an index family. Never throws. */
  protected async loadIndices(type: IndexType): Promise<void> {
    if (this.indices()?.status === 'loading' && this.indices()?.type === type) {
      return;
    }
    this.indices.set({ type, status: 'loading' });
    try {
      const map = await this.insee.observations(type);
      this.indices.set({ type, status: 'ready', map });
    } catch (error) {
      this.indices.set({
        type,
        status: 'error',
        errorMessage: error instanceof InseeUnavailableError ? error.message : undefined,
      });
    }
  }

  /** A request is running, or a time-out is still being sorted out by a reload: no second request. */
  protected blocked(): boolean {
    return (
      this.saving() ||
      this.deleting() ||
      this.applying() ||
      (this.state.needsReload() && this.state.loading())
    );
  }

  protected startEdit(): void {
    this.error.set(null);
    this.form.set(buildLeaseForm(this.fb, this.lease() ?? undefined));
    focusAfterRender(this.injector, () =>
      this.root()?.nativeElement.querySelector<HTMLElement>('input[type="text"]'),
    );
  }

  protected addCharge(): void {
    this.form()?.controls.additionalCharges.push(buildChargeGroup(this.fb));
  }

  protected removeCharge(index: number): void {
    this.form()?.controls.additionalCharges.removeAt(index);
  }

  protected cancel(): void {
    if (this.saving()) {
      return;
    }
    this.error.set(null);
    if (this.lease() === null) {
      this.closed.emit();
      return;
    }
    this.form.set(null);
    focusAfterRender(this.injector, () => this.editButton()?.nativeElement);
  }

  protected async save(): Promise<void> {
    const form = this.form();
    if (!form || this.blocked()) {
      return;
    }
    if (form.invalid) {
      form.markAllAsTouched();
      focusFirstInvalid(this.injector, this.root()?.nativeElement ?? null);
      return;
    }
    const base = this.lease() ?? undefined;
    const lease = leaseFromForm(form.getRawValue(), base);
    if (
      base &&
      JSON.stringify(leaseToParseFields(lease)) === JSON.stringify(leaseToParseFields(base))
    ) {
      // Nothing changed: nothing to send.
      this.cancel();
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.state.attempt(async () => {
        if (base) {
          await this.repository.updateLease(lease);
        } else {
          await this.repository.addLease(this.holderId(), lease);
        }
      });
      if (base) {
        this.form.set(null);
        focusAfterRender(this.injector, () => this.editButton()?.nativeElement);
      } else {
        this.closed.emit();
      }
    } catch (error) {
      if (!isSessionError(error)) {
        this.error.set(saveErrorMessage(error));
      }
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Applies the proposed revision after a confirmation: the rent, the reference index and the next
   * anniversary date are written in ONE update (the repository sends only what changed). One request at
   * a time; after a time-out the data is reloaded before another attempt. What was confirmed is checked
   * again once the dialog closes: if the lease or the proposal moved meanwhile, nothing is written.
   */
  protected async applyRevision(): Promise<void> {
    const lease = this.lease();
    const type = lease?.indexType;
    const changes = appliedRevision(this.revision() ?? { kind: 'none' });
    if (!lease || !type || !changes || this.blocked()) {
      return;
    }
    const confirmed = await this.confirm.open({
      title: 'Appliquer la révision du loyer ?',
      message: `Le loyer passera de ${formatEuro(lease.price)} à ${formatEuro(changes.price)} (${type} ${quarterLabel(changes.referenceIndexQuarter)}, indice ${toFieldNumber(changes.referenceIndexValue)}). La prochaine date anniversaire passera au ${formatDate(changes.renewalDate)}.`,
      confirmLabel: 'Appliquer la révision',
    });
    if (!confirmed || this.blocked()) {
      return;
    }
    const current = this.lease();
    const latest = appliedRevision(this.revision() ?? { kind: 'none' });
    if (
      !current ||
      JSON.stringify(latest) !== JSON.stringify(changes) ||
      current.price !== lease.price
    ) {
      this.error.set('La proposition a changé entre-temps : vérifiez-la, puis réessayez.');
      return;
    }
    this.applying.set(true);
    this.error.set(null);
    try {
      await this.state.attempt(() => this.repository.updateLease({ ...current, ...changes }));
    } catch (error) {
      if (!isSessionError(error)) {
        this.error.set(saveErrorMessage(error));
      }
    } finally {
      this.applying.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const lease = this.lease();
    const id = lease?.objectId;
    if (!lease || !id || this.blocked()) {
      return;
    }
    const confirmed = await this.confirm.open({
      title: `Supprimer définitivement « ${lease.name} » ?`,
      message: 'Le bail sera effacé. Cette action est irréversible.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    this.deleting.set(true);
    this.error.set(null);
    try {
      await this.state.attempt(() => this.repository.deleteLease(this.holderId(), id));
    } catch (error) {
      if (!isSessionError(error)) {
        this.error.set(saveErrorMessage(error, 'delete'));
      }
    } finally {
      this.deleting.set(false);
    }
  }
}
