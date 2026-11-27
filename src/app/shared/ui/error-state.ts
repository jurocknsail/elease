import { Icon } from './icon';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { describeBackendError, isConnectionError } from '../../core/parse/backend-error';
import { EmptyState } from './empty-state';
import { IconName } from './icon';

/**
 * What every screen shows when its data could not be loaded or saved: a clear title and sentence
 * (« Connexion requise » when the backend cannot be reached) and a « Réessayer » button. Never a
 * spinner that does not end. The screen reloads on `retry`; while it does, `retrying` disables the
 * button so a second tap cannot start a second request.
 */
@Component({
  selector: 'app-error-state',
  imports: [Icon, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', role: 'alert' },
  template: `
    <app-empty-state [heading]="info().title" [message]="info().message" [icon]="icon()">
      @if (info().retryable) {
        <button
          type="button"
          class="btn btn-primary"
          [disabled]="retrying()"
          [attr.aria-busy]="retrying()"
          (click)="retry.emit()"
        ><app-icon name="refresh" class="size-4" />
          Réessayer
        </button>
      }
    </app-empty-state>
  `,
})
export class ErrorState {
  /** The error that was caught (a Parse error, a `BackendTimeoutError`...). */
  readonly error = input.required<unknown>();
  readonly retrying = input(false);
  readonly retry = output<void>();

  protected readonly info = computed(() => describeBackendError(this.error()));
  protected readonly icon = computed<IconName>(() =>
    isConnectionError(this.error()) ? 'wifi-off' : 'alert',
  );
}
