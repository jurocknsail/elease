import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate } from '@angular/service-worker';
import { filter } from 'rxjs';
import { Icon } from '../../shared/ui/icon';

/**
 * « Nouvelle version disponible — Recharger ». The service worker downloads a new version in the
 * background but the installed app keeps showing the old one until it is restarted: this banner lets
 * the owner switch at once. The app also asks for an update each time it comes back to the
 * foreground (an installed PWA is rarely reloaded). Nothing shows when the service worker is off
 * (development, unsupported browser).
 */
@Component({
  selector: 'app-update-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    @if (ready()) {
      <div
        role="status"
        class="mb-4 flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 px-3 py-2 text-sm md:mb-6"
      >
        <app-icon name="refresh" class="size-4 shrink-0 text-accent" />
        <p class="min-w-0 flex-1">Une nouvelle version d’E-Lease est disponible.</p>
        <button type="button" class="btn btn-primary min-h-8 shrink-0 px-3" (click)="reload()">
          Recharger
        </button>
      </div>
    }
  `,
})
export class UpdateBanner {
  /** Absent when the app is built without a service worker (and in unit tests). */
  private readonly updates = inject(SwUpdate, { optional: true });
  private readonly document = inject(DOCUMENT);
  protected readonly ready = signal(false);

  constructor() {
    if (!this.updates?.isEnabled) {
      return;
    }
    this.updates!.versionUpdates
      .pipe(
        filter((event) => event.type === 'VERSION_READY'),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.ready.set(true));

    const check = () => {
      if (this.document.visibilityState === 'visible') {
        this.updates!.checkForUpdate().catch(() => undefined);
      }
    };
    this.document.addEventListener('visibilitychange', check);
    inject(DestroyRef).onDestroy(() =>
      this.document.removeEventListener('visibilitychange', check),
    );
  }

  protected async reload(): Promise<void> {
    try {
      await this.updates?.activateUpdate();
    } finally {
      this.document.location.reload();
    }
  }
}
