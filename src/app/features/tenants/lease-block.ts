import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { isSessionError } from '../../core/auth/session-error';
import { computeTVA, computeTotalPrice } from '../../core/billing/amounts';
import { periodLabel } from '../../core/billing/period';
import { formatDate, formatEuro, formatPostalCode, toFieldNumber } from '../../core/format/fr';
import { INDEX_TYPES, IndexType, Lease } from '../../core/models/lease';
import { leaseToParseFields } from '../../core/parse/mapping';
import { LeaseholderRepository } from '../../core/parse/leaseholder.repository';
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
  'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border-strong bg-bg px-3 text-sm dense:min-h-10 has-checked:border-accent has-checked:bg-accent-soft has-checked:font-semibold';

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
  imports: [ReactiveFormsModule, TextField, Pill],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section
      #root
      class="rounded-xl border border-border bg-bg"
      [attr.aria-labelledby]="uid + '-title'"
    >
      <header
        class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3 md:px-5"
      >
        <div class="flex min-w-0 flex-1 basis-48 items-center gap-2">
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
          <div class="flex shrink-0 gap-2">
            <button
              #edit
              type="button"
              class="btn btn-secondary"
              [disabled]="deleting()"
              (click)="startEdit()"
            >
              Modifier
            </button>
            <button
              type="button"
              class="btn btn-secondary text-danger"
              [disabled]="blocked()"
              [attr.aria-busy]="deleting()"
              (click)="remove()"
            >
              {{ deleting() ? 'Suppression…' : 'Supprimer' }}
            </button>
          </div>
        }
      </header>

      @if (form(); as f) {
        <form
          [formGroup]="f"
          class="flex flex-col gap-5 px-4 py-4 md:px-5"
          (ngSubmit)="save()"
          (keydown.escape)="cancel()"
        >
          <div class="grid grid-cols-1 gap-4 @md:grid-cols-6">
            <app-text-field
              class="@md:col-span-6"
              [inputId]="uid + '-name'"
              label="Nom du bail"
              [control]="f.controls.name"
              hint="Par exemple : Appartement T3, Local commercial, Garage n° 13."
            />

            <fieldset class="@md:col-span-6">
              <legend class="mb-1.5 text-sm font-medium">Type de bail</legend>
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

          <fieldset class="flex flex-col gap-3">
            <legend class="mb-1 text-sm font-medium">Charges additionnelles</legend>
            @for (row of f.controls.additionalCharges.controls; track row; let i = $index) {
              <div
                class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-3 @md:grid-cols-[minmax(0,1fr)_9rem_auto]"
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
                  class="btn btn-secondary col-start-2 row-start-2 mt-[1.625rem] @md:col-start-3 @md:row-start-1"
                  [attr.aria-label]="'Retirer la charge additionnelle ' + (i + 1)"
                  (click)="removeCharge(i)"
                >
                  Retirer
                </button>
              </div>
            }
            <div>
              <button type="button" class="btn btn-secondary" (click)="addCharge()">
                + Ajouter une charge
              </button>
            </div>
          </fieldset>

          <div class="grid grid-cols-1 gap-4 @md:grid-cols-6">
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
              <label [for]="uid + '-indexType'" class="mb-1.5 block text-sm font-medium">
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
              class="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger"
            >
              {{ message }}
            </p>
          }
          <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
            >
              {{ saving() ? 'Enregistrement…' : 'Enregistrer' }}
            </button>
          </div>
        </form>
      } @else if (lease(); as l) {
        <dl class="grid grid-cols-1 gap-x-8 gap-y-4 px-4 py-4 md:px-5 @lg:grid-cols-2">
          <div class="min-w-0">
            <dt class="text-xs font-medium text-muted">Adresse</dt>
            <dd class="mt-0.5 text-sm break-words">
              <span class="block">{{ l.streetNumber }} {{ l.streetName }}</span>
              @if (l.optionalAddressInfo) {
                <span class="block">{{ l.optionalAddressInfo }}</span>
              }
              <span class="block">{{ postalCode(l) }} {{ l.city }}</span>
              @if (l.lot) {
                <span class="block text-muted">Lot {{ l.lot }}</span>
              }
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="text-xs font-medium text-muted">Loyer hors charges</dt>
            <dd class="mt-0.5 text-sm font-medium tabular-nums">{{ euro(l.price) }}</dd>
          </div>
          <div class="min-w-0">
            <dt class="text-xs font-medium text-muted">Avance sur charges</dt>
            <dd class="mt-0.5 text-sm tabular-nums">{{ l.charge ? euro(l.charge) : '—' }}</dd>
          </div>
          <div class="min-w-0">
            <dt class="text-xs font-medium text-muted">Charges additionnelles</dt>
            <dd class="mt-0.5 text-sm">
              @for (charge of l.additionalCharges; track $index) {
                <span class="flex justify-between gap-3">
                  <span class="min-w-0 truncate" [attr.title]="charge.title">{{
                    charge.title
                  }}</span>
                  <span class="shrink-0 tabular-nums">{{ euro(charge.amount) }}</span>
                </span>
              } @empty {
                —
              }
            </dd>
          </div>
          @if (l.isPro) {
            <div class="min-w-0">
              <dt class="text-xs font-medium text-muted">TVA (20 % du loyer)</dt>
              <dd class="mt-0.5 text-sm tabular-nums">{{ euro(tva(l)) }}</dd>
            </div>
          }
          <div class="min-w-0">
            <dt class="text-xs font-medium text-muted">Total de l'appel</dt>
            <dd class="mt-0.5 text-sm font-semibold tabular-nums">{{ euro(total(l)) }}</dd>
          </div>
          <div class="min-w-0">
            <dt class="text-xs font-medium text-muted">Date anniversaire</dt>
            <dd class="mt-0.5 text-sm">{{ l.renewalDate != null ? date(l.renewalDate) : '—' }}</dd>
          </div>
          <div class="min-w-0">
            <dt class="text-xs font-medium text-muted">Indice de référence</dt>
            <dd class="mt-0.5 text-sm">{{ index() ?? 'Non renseigné' }}</dd>
          </div>
          <div class="min-w-0">
            <dt class="text-xs font-medium text-muted">Dernier envoi</dt>
            <dd class="mt-0.5 text-sm">{{ lastSend() }}</dd>
          </div>
        </dl>

        <!--
          Slot for the annual revision (Task 11): the line « 1 091,08 € → 1 113,36 € (ILAT T2 2026) », the
          « Révision le 01/03 » pill (add it to \`pills\`) and the « Appliquer la révision » button go here,
          outside the details above.
        -->
        <div data-slot="revision" class="empty:hidden"></div>

        @if (error(); as message) {
          <p
            role="alert"
            class="mx-4 mb-4 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger md:mx-5"
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
  protected readonly state = inject(TenantsState);
  private readonly root = viewChild<ElementRef<HTMLElement>>('root');
  private readonly editButton = viewChild<ElementRef<HTMLButtonElement>>('edit');

  protected readonly uid = `lease-${(nextId += 1)}`;
  protected readonly indexTypes = INDEX_TYPES;
  protected readonly indexNames = INDEX_NAMES;
  protected readonly form = signal<LeaseForm | null>(null);
  protected readonly saving = signal(false);
  protected readonly deleting = signal(false);
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
    return pills;
  });

  protected readonly euro = formatEuro;
  protected readonly date = formatDate;
  protected readonly tva = computeTVA;
  protected readonly total = computeTotalPrice;
  protected postalCode(lease: Lease): string {
    return formatPostalCode(lease.postalCode);
  }

  ngOnInit(): void {
    if (this.lease() === null) {
      this.form.set(buildLeaseForm(this.fb));
    }
  }

  /** A request is running, or a time-out is still being sorted out by a reload: no second request. */
  protected blocked(): boolean {
    return this.saving() || this.deleting() || (this.state.needsReload() && this.state.loading());
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
