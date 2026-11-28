import { Icon } from '../../shared/ui/icon';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { isSessionError } from '../../core/auth/session-error';
import { Leaseholder } from '../../core/models/leaseholder';
import { LeaseholderRepository } from '../../core/parse/leaseholder.repository';
import { ContactForm, buildContactForm, contactFromForm } from './lease-form';
import { TenantsState, saveErrorMessage } from './tenants-state';
import { TextField, focusAfterRender, focusFirstInvalid } from './text-field';

let nextId = 0;

/**
 * The contact of a tenant (name, e-mail, phone): read-only, with « Modifier » opening the form in
 * place. « Annuler » (or Escape) closes it and persists nothing; « Enregistrer » saves through the
 * repository and keeps the form open, with the user's input, when it fails.
 */
@Component({
  selector: 'app-contact-block',
  imports: [Icon, ReactiveFormsModule, TextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section
      class="card"
      [attr.aria-labelledby]="uid + '-title'"
      #root
    >
      <header
        class="flex items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-5"
      >
        <h3 [id]="uid + '-title'" class="text-sm font-semibold">Contact</h3>
        @if (!form()) {
          <div class="toolbar">
            <button #edit type="button" class="btn btn-icon" title="Modifier le contact" (click)="startEdit()"><app-icon name="pencil" class="size-[18px]" /><span class="sr-only">Modifier</span></button>
          </div>
        }
      </header>

      <div class="px-4 py-4 md:px-5">
        @if (form(); as f) {
          <form
            [formGroup]="f"
            class="grid grid-cols-1 gap-4 @md:grid-cols-2"
            (ngSubmit)="save()"
            (keydown.escape)="cancel()"
          >
            <app-text-field
              [inputId]="uid + '-name'"
              label="Nom"
              [control]="f.controls.name"
              autocomplete="off"
            />
            <app-text-field
              [inputId]="uid + '-email'"
              label="Adresse e-mail"
              type="email"
              inputmode="email"
              [control]="f.controls.email"
              hint="L'adresse à laquelle les appels de loyer sont envoyés. Une seule adresse."
            />
            <app-text-field
              [inputId]="uid + '-phone'"
              label="Téléphone"
              type="tel"
              inputmode="tel"
              [control]="f.controls.phone"
              [optional]="true"
            />
            @if (error(); as message) {
              <p
                role="alert"
                class="@md:col-span-2 rounded-xl border border-danger/40 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger"
              >
                {{ message }}
              </p>
            }
            <div class="form-actions @md:col-span-2">
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
        } @else {
          <dl
            class="grid grid-cols-2 gap-x-4 gap-y-4 @md:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)_minmax(0,1fr)] @md:gap-x-8"
          >
            <div class="min-w-0">
              <dt class="meta-label">Nom</dt>
              <dd class="mt-1 truncate text-sm" [attr.title]="holder().name">
                {{ holder().name || '—' }}
              </dd>
            </div>
            <div class="col-span-2 order-last min-w-0 @md:order-none @md:col-span-1">
              <dt class="meta-label">Adresse e-mail</dt>
              <dd class="mt-1 truncate text-sm" [attr.title]="holder().email">
                {{ holder().email || '—' }}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="meta-label">Téléphone</dt>
              <dd class="mt-1 truncate text-sm">{{ holder().phone || '—' }}</dd>
            </div>
          </dl>
        }
      </div>
    </section>
  `,
})
export class ContactBlock {
  readonly holder = input.required<Leaseholder>();

  private readonly fb = inject(FormBuilder);
  private readonly injector = inject(Injector);
  private readonly repository = inject(LeaseholderRepository);
  protected readonly state = inject(TenantsState);
  private readonly root = viewChild<ElementRef<HTMLElement>>('root');
  private readonly editButton = viewChild<ElementRef<HTMLButtonElement>>('edit');

  protected readonly uid = `contact-${(nextId += 1)}`;
  protected readonly form = signal<ContactForm | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Saving, or a time-out that is still being sorted out by a reload: no second request. */
  protected blocked(): boolean {
    return this.saving() || (this.state.needsReload() && this.state.loading());
  }

  protected startEdit(): void {
    this.error.set(null);
    this.form.set(buildContactForm(this.fb, this.holder()));
    focusAfterRender(this.injector, () =>
      this.root()?.nativeElement.querySelector<HTMLElement>('input'),
    );
  }

  protected cancel(): void {
    if (this.saving()) {
      return;
    }
    this.form.set(null);
    this.error.set(null);
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
    const contact = contactFromForm(form.getRawValue());
    const current = this.holder();
    const id = current.objectId;
    if (!id) {
      this.error.set(saveErrorMessage(new Error('Locataire sans identifiant.')));
      return;
    }
    if (
      contact.name === current.name &&
      contact.email === current.email &&
      contact.phone === current.phone
    ) {
      // Nothing changed: nothing to send.
      this.cancel();
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.state.attempt(() => this.repository.updateContact(id, contact));
      this.form.set(null);
      focusAfterRender(this.injector, () => this.editButton()?.nativeElement);
    } catch (error) {
      if (!isSessionError(error)) {
        this.error.set(saveErrorMessage(error));
      }
    } finally {
      this.saving.set(false);
    }
  }
}
