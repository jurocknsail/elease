import {
  ChangeDetectionStrategy,
  Component,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { NOW } from '../../core/clock';
import { LeaseholderRepository } from '../../core/parse/leaseholder.repository';
import { nextAction } from '../../core/stats/next-action';
import { Icon } from '../../shared/ui/icon';

/**
 * Hints closed during this visit. In memory only: the hint comes back at the next opening of the app
 * and after a new sign-in, and a hint whose sentence changed shows again.
 */
@Injectable({ providedIn: 'root' })
export class DismissedHints {
  private readonly ids = signal<ReadonlySet<string>>(new Set());

  constructor() {
    inject(AuthService).onLogout(() => this.ids.set(new Set()));
  }

  has(id: string): boolean {
    return this.ids().has(id);
  }

  dismiss(id: string): void {
    this.ids.update((ids) => new Set([...ids, id]));
  }
}

/** One discreet line at the top of every screen: the owner's next action. Closable. */
@Component({
  selector: 'app-next-action-hint',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon],
  template: `
    @if (action(); as a) {
      <div
        role="note"
        aria-label="Prochaine action"
        class="mb-4 flex items-start gap-2.5 rounded-xl border px-3 py-2 text-sm md:mb-6"
        [class]="a.tone === 'todo' ? 'border-accent/30 bg-accent/5' : 'border-border bg-card/60'"
      >
        <app-icon
          [name]="a.tone === 'todo' ? 'send' : 'calendar'"
          class="mt-0.5 size-4 shrink-0"
          [class]="a.tone === 'todo' ? 'text-accent' : 'text-muted'"
        />
        <p class="min-w-0 flex-1 leading-snug text-muted">
          <span class="text-text">{{ a.text }}</span>
          @if (a.link; as link) {
            <a
              [routerLink]="link.path"
              [fragment]="link.fragment"
              class="ml-1 font-semibold whitespace-nowrap text-accent underline-offset-2 hover:underline"
              >{{ link.label }}</a
            >
          }
        </p>
        <button
          type="button"
          class="-my-1 -mr-1.5 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-text/5 hover:text-text"
          title="Masquer jusqu'à la prochaine connexion"
          (click)="dismissed.dismiss(a.id)"
        >
          <app-icon name="x" class="size-4" />
          <span class="sr-only">Masquer</span>
        </button>
      </div>
    }
  `,
})
export class NextActionHint {
  private readonly repository = inject(LeaseholderRepository);
  private readonly now = inject(NOW);
  protected readonly dismissed = inject(DismissedHints);

  protected readonly action = computed(() => {
    const action = nextAction(this.repository.leaseholders(), this.now());
    return action && !this.dismissed.has(action.id) ? action : null;
  });
}
