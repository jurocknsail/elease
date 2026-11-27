import { Icon } from '../../shared/ui/icon';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { isSessionError } from '../../core/auth/session-error';
import { LeaseholderRepository } from '../../core/parse/leaseholder.repository';
import { buildContactForm, contactFromForm } from './lease-form';
import { TenantsState, saveErrorMessage } from './tenants-state';
import { TextField, focusFirstInvalid } from './text-field';

/** What the list page hands to the dialog. */
export interface NewTenantDialogData {
  state: TenantsState;
}

/**
 * « Nouveau locataire »: the contact fields only (leases are added from the tenant's page). Closes with
 * the id of the tenant that was created, or without a value when cancelled. A failure stays inside the
 * dialog with what was typed; the dialog cannot be dismissed while the request runs.
 */
@Component({
  selector: 'app-new-tenant-dialog',
  imports: [Icon, ReactiveFormsModule, TextField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'block w-full max-h-[calc(100dvh-2rem)] overflow-y-auto card p-5 text-text shadow-xl sm:p-6',
  },
  template: `
    <h2 id="new-tenant-title" class="text-lg font-semibold">Nouveau locataire</h2>
    <p class="mt-1 text-sm text-muted">
      Vous ajouterez ses baux depuis sa fiche, une fois le locataire créé.
    </p>
    <form #formEl [formGroup]="form" class="mt-5 flex flex-col gap-4" (ngSubmit)="create()">
      <app-text-field inputId="new-tenant-name" label="Nom" [control]="form.controls.name" />
      <app-text-field
        inputId="new-tenant-email"
        label="Adresse e-mail"
        type="email"
        inputmode="email"
        [control]="form.controls.email"
        hint="L'adresse à laquelle les appels de loyer sont envoyés. Une seule adresse."
      />
      <app-text-field
        inputId="new-tenant-phone"
        label="Téléphone"
        type="tel"
        inputmode="tel"
        [optional]="true"
        [control]="form.controls.phone"
      />
      @if (error(); as message) {
        <p
          role="alert"
          class="rounded-xl border border-danger/40 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger"
        >
          {{ message }}
        </p>
      }
      <div class="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" class="btn btn-secondary" [disabled]="saving()" (click)="close()">
          Annuler
        </button>
        <button
          type="submit"
          class="btn btn-primary"
          [disabled]="blocked()"
          [attr.aria-busy]="saving()"
        ><app-icon name="plus" class="size-4" />
          {{ saving() ? 'Création…' : 'Créer le locataire' }}
        </button>
      </div>
    </form>
  `,
})
export class NewTenantDialog {
  private readonly data = inject<NewTenantDialogData>(DIALOG_DATA);
  private readonly ref = inject<DialogRef<string | undefined>>(DialogRef);
  private readonly repository = inject(LeaseholderRepository);
  private readonly injector = inject(Injector);

  protected readonly form = buildContactForm(inject(FormBuilder));
  private readonly formElement = viewChild<ElementRef<HTMLElement>>('formEl');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected blocked(): boolean {
    return this.saving() || (this.data.state.needsReload() && this.data.state.loading());
  }

  protected close(): void {
    if (!this.saving()) {
      this.ref.close(undefined);
    }
  }

  protected async create(): Promise<void> {
    if (this.blocked()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focusFirstInvalid(this.injector, this.formElement()?.nativeElement ?? null);
      return;
    }
    const contact = contactFromForm(this.form.getRawValue());
    this.saving.set(true);
    this.ref.disableClose = true;
    this.error.set(null);
    try {
      const holder = await this.data.state.attempt(() =>
        this.repository.createLeaseholder(contact),
      );
      this.ref.disableClose = false;
      this.ref.close(holder.objectId);
    } catch (error) {
      this.ref.disableClose = false;
      if (!isSessionError(error)) {
        this.error.set(saveErrorMessage(error));
      }
    } finally {
      this.saving.set(false);
    }
  }
}
