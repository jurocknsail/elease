import { Dialog, DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Icon } from './icon';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel: string;
  /** Label of the cancel button (default « Annuler »). */
  cancelLabel?: string;
  /** A destructive action (deletion): the confirm button is red. */
  danger?: boolean;
  /**
   * Optional structured view of `message`: key figures, one per line (`strong` ones in bold), and
   * notes in coloured callouts. When given, `message` is kept for screen readers only.
   */
  details?: {
    summary: readonly { label: string; value: string; strong?: boolean }[];
    notes?: readonly { tone: 'warn' | 'info'; text: string }[];
  };
}

interface ConfirmDialogData extends ConfirmDialogOptions {
  id: string;
}

/**
 * The content of the dialog. Cancel comes first in the tab order and takes the initial focus: Enter
 * or Space right after the dialog opens can never confirm by accident. Both buttons are 44 px tall.
 */
@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'block w-full max-h-[calc(100dvh-2rem)] overflow-y-auto card p-5 text-text shadow-xl sm:p-6',
  },
  imports: [Icon],
  template: `
    <h2 [id]="data.id + '-title'" class="text-lg font-semibold">{{ data.title }}</h2>
    @if (data.details; as d) {
      <p [id]="data.id + '-message'" class="sr-only">{{ data.message }}</p>
      <dl
        class="mt-4 divide-y divide-border rounded-xl border border-border bg-surface/60 px-4"
        aria-hidden="true"
      >
        @for (row of d.summary; track row.label) {
          <div class="flex items-baseline justify-between gap-4 py-2.5 text-sm">
            <dt class="text-muted">{{ row.label }}</dt>
            <dd
              class="tabular-nums"
              [class]="row.strong ? 'text-base font-semibold' : 'font-medium'"
            >
              {{ row.value }}
            </dd>
          </div>
        }
      </dl>
      @for (note of d.notes ?? []; track note.text) {
        <p
          class="mt-3 flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm"
          [class]="
            note.tone === 'warn'
              ? 'border-warn/30 bg-warn-soft text-warn'
              : 'border-accent/25 bg-accent/5 text-text'
          "
          aria-hidden="true"
        >
          <app-icon
            [name]="note.tone === 'warn' ? 'alert' : 'check-circle'"
            class="mt-px size-4 shrink-0"
            [class.text-accent]="note.tone === 'info'"
          />
          <span class="font-medium">{{ note.text }}</span>
        </p>
      }
    } @else {
      <p [id]="data.id + '-message'" class="mt-2 text-sm text-muted">{{ data.message }}</p>
    }
    <div class="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <button type="button" class="btn btn-secondary" (click)="close(false)">
        {{ data.cancelLabel ?? 'Annuler' }}
      </button>
      <button
        type="button"
        class="btn"
        [class.btn-primary]="!data.danger"
        [class.btn-danger]="data.danger"
        (click)="close(true)"
      >
        {{ data.confirmLabel }}
      </button>
    </div>
  `,
})
export class ConfirmDialogContent {
  protected readonly data = inject<ConfirmDialogData>(DIALOG_DATA);
  private readonly ref = inject<DialogRef<boolean>>(DialogRef);

  protected close(confirmed: boolean): void {
    this.ref.close(confirmed);
  }
}

/**
 * A confirmation dialog (Angular CDK): `await inject(ConfirmDialog).open({ title, message, confirmLabel,
 * danger })` resolves `true` only when the user confirms. Cancel, Escape and a click on the backdrop
 * all resolve `false`. Focus is trapped inside while it is open and given back to the opener on close.
 * While one dialog is open another request resolves `false` at once (a double tap must not stack two
 * confirmations of a destructive action).
 */
@Injectable({ providedIn: 'root' })
export class ConfirmDialog {
  private readonly dialog = inject(Dialog);
  private sequence = 0;
  private active = false;

  async open(options: ConfirmDialogOptions): Promise<boolean> {
    if (this.active) {
      return false;
    }
    this.active = true;
    try {
      const id = `confirm-dialog-${(this.sequence += 1)}`;
      const ref = this.dialog.open<boolean, ConfirmDialogData, ConfirmDialogContent>(
        ConfirmDialogContent,
        {
          data: { ...options, id },
          role: 'alertdialog',
          ariaModal: true,
          ariaLabelledBy: `${id}-title`,
          ariaDescribedBy: `${id}-message`,
          width: 'min(28rem, calc(100vw - 2rem))',
          hasBackdrop: true,
          disableClose: false,
          autoFocus: 'first-tabbable',
          restoreFocus: true,
          closeOnNavigation: true,
        },
      );
      // Escape and the backdrop close without a value: only an explicit confirmation is `true`.
      return (await firstValueFrom(ref.closed, { defaultValue: false })) === true;
    } finally {
      this.active = false;
    }
  }
}
