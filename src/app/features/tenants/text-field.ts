import {
  ChangeDetectionStrategy,
  Component,
  computed,
  Injector,
  afterNextRender,
  effect,
  input,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { errorMessage } from './lease-form';

/**
 * One labelled text field of the tenant forms: the label is bound to the input, and an invalid field
 * (once it has been left, or the form was submitted) gets `aria-invalid`, a message under it and
 * `aria-describedby` pointing at that message, as on the login page. Inputs are 16 px (the global
 * rule) and 44 px tall, 40 px with a mouse (`.field-input`).
 *
 * It follows the control through the `events` of the control, into a signal, so that a change made from
 * outside (`markAllAsTouched` when the form is submitted) is shown although this component is OnPush.
 */
@Component({
  selector: 'app-text-field',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0' },
  template: `
    <label [for]="id()" class="mb-1.5 block text-sm font-medium">
      {{ label() }}
      @if (optional()) {
        <span class="font-normal text-muted">(facultatif)</span>
      }
    </label>
    <input
      [id]="id()"
      [formControl]="control()"
      [type]="type()"
      class="field-input"
      [attr.inputmode]="inputmode()"
      [attr.autocomplete]="autocomplete()"
      [attr.enterkeyhint]="enterkeyhint()"
      [attr.maxlength]="maxlength()"
      [attr.aria-invalid]="shown().invalid"
      [attr.aria-describedby]="describedBy()"
      autocapitalize="none"
      autocorrect="off"
      spellcheck="false"
    />
    @if (hint(); as text) {
      <p [id]="id() + '-hint'" class="mt-1.5 text-xs text-muted">{{ text }}</p>
    }
    @if (shown().message; as text) {
      <p [id]="id() + '-error'" class="mt-1.5 text-sm text-danger">{{ text }}</p>
    }
  `,
})
export class TextField {
  readonly id = input.required<string>();
  readonly label = input.required<string>();
  readonly control = input.required<FormControl<string>>();
  readonly type = input<'text' | 'email' | 'tel' | 'date' | 'search'>('text');
  readonly inputmode = input<'text' | 'numeric' | 'decimal' | 'email' | 'tel' | null>(null);
  readonly autocomplete = input<string>('off');
  readonly enterkeyhint = input<string | null>(null);
  readonly maxlength = input<number | null>(null);
  readonly optional = input(false);
  readonly hint = input<string | null>(null);

  /** Bumped at every event of the control (value, status, touched). */
  private readonly version = signal(0);

  protected readonly shown = computed(() => {
    this.version();
    const control = this.control();
    const touched = control.touched && control.invalid;
    return { invalid: touched ? true : null, message: touched ? errorMessage(control) : null };
  });

  protected readonly describedBy = computed(() => {
    const ids = [
      this.hint() ? this.id() + '-hint' : null,
      this.shown().message ? this.id() + '-error' : null,
    ].filter((id): id is string => id !== null);
    return ids.length > 0 ? ids.join(' ') : null;
  });

  constructor() {
    effect((onCleanup) => {
      const subscription = this.control().events.subscribe(() => this.version.update((v) => v + 1));
      onCleanup(() => subscription.unsubscribe());
    });
  }
}

/** After the next render: puts the focus on the first invalid field of `root` (it is flagged by then). */
export function focusFirstInvalid(injector: Injector, root: HTMLElement | null): void {
  afterNextRender(() => root?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), {
    injector,
  });
}

/** After the next render: focuses the element `find` returns (a button that has just come back). */
export function focusAfterRender(
  injector: Injector,
  find: () => HTMLElement | null | undefined,
): void {
  afterNextRender(() => find()?.focus(), { injector });
}
