import { Dialog } from '@angular/cdk/dialog';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {
  ActivatedRoute,
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { filter, firstValueFrom, map } from 'rxjs';
import { describeBackendError } from '../../core/parse/backend-error';
import { Leaseholder } from '../../core/models/leaseholder';
import { EmptyState } from '../../shared/ui/empty-state';
import { ErrorState } from '../../shared/ui/error-state';
import { NewTenantDialog, NewTenantDialogData } from './new-tenant-dialog';
import { TenantsState, leaseCountLabel } from './tenants-state';

const SKELETON = 'animate-pulse rounded bg-border';

/** Lower case, accents and diacritics removed: « Élodie » is found by « elodie ». */
export function searchKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('fr')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The tenants whose name or e-mail contains the search (every word of it), sorted by name. */
export function filterHolders(holders: readonly Leaseholder[], query: string): Leaseholder[] {
  const words = searchKey(query).split(' ').filter(Boolean);
  return holders
    .filter((holder) => {
      const haystack = searchKey(`${holder.name} ${holder.email}`);
      return words.every((word) => haystack.includes(word));
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
}

/**
 * Locataires: the list (search on name and e-mail, « + Nouveau locataire ») with the tenant's page
 * beside it (`/locataires/:id` is a child route, so the list stays mounted while another tenant opens).
 *
 * From 1024 px: list (17 rem, 22 rem from 1280 px) and detail side by side, each scrolling on its own.
 * Below: one pane at a time. The list alone, or the opened tenant full-screen with « Retour » (browser
 * Back works: the tenant is a route). Every tenant is listed, one with no lease as « Aucun bail ».
 *
 * The data is reloaded each time the page opens; rows already in memory stay while it runs and a
 * failed reload only adds a notice. The skeleton shows only when there is nothing yet.
 */
@Component({
  selector: 'app-tenants',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, EmptyState, ErrorState],
  providers: [TenantsState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block lg:h-full' },
  template: `
    @if (view() === 'error') {
      @if (state.failure(); as failed) {
        <h1 class="sr-only">Locataires</h1>
        <app-error-state
          class="rounded-xl border border-dashed border-border-strong"
          [error]="failed.cause"
          [retrying]="state.loading()"
          (retry)="state.refresh()"
        />
      }
    } @else {
      <div
        class="flex flex-col gap-4 lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]"
      >
        <section aria-label="Liste des locataires" [class]="listClass()">
          <div class="flex flex-col gap-3 lg:shrink-0">
            <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <h1 class="shrink-0 text-2xl font-semibold tracking-tight">Locataires</h1>
              <button type="button" class="btn btn-primary shrink-0" (click)="openNew()">
                + Nouveau locataire
              </button>
            </div>

            @if (staleNotice(); as info) {
              <div
                role="alert"
                class="flex flex-col gap-2 rounded-xl border border-warn/40 bg-warn-soft px-3 py-2.5 text-sm text-text"
              >
                <p>
                  <span class="font-semibold">{{ info.title }}.</span>
                  Les données affichées peuvent ne pas être à jour.
                </p>
                @if (info.retryable) {
                  <button
                    type="button"
                    class="btn btn-secondary self-start"
                    [disabled]="state.loading()"
                    [attr.aria-busy]="state.loading()"
                    (click)="state.refresh()"
                  >
                    Réessayer
                  </button>
                }
              </div>
            }

            <div>
              <label for="locataires-recherche" class="sr-only">Rechercher un locataire</label>
              <input
                id="locataires-recherche"
                type="search"
                class="field-input"
                placeholder="Rechercher par nom ou e-mail"
                autocomplete="off"
                autocapitalize="none"
                spellcheck="false"
                enterkeyhint="search"
                [value]="query()"
                (input)="onSearch($event)"
              />
            </div>
          </div>

          <div
            class="overflow-hidden rounded-xl border border-border bg-bg lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
          >
            @switch (view()) {
              @case ('content') {
                <p class="sr-only" aria-live="polite">{{ resultSentence() }}</p>
                @if (shown().length > 0) {
                  <ul class="divide-y divide-border">
                    @for (holder of shown(); track holder.objectId) {
                      <li>
                        <a
                          [routerLink]="['/locataires', holder.objectId]"
                          routerLinkActive
                          ariaCurrentWhenActive="page"
                          class="flex min-h-14 flex-col justify-center gap-0.5 px-4 py-2.5 hover:bg-surface aria-[current=page]:bg-accent-soft"
                        >
                          <span class="flex items-baseline justify-between gap-3">
                            <span
                              class="min-w-0 truncate text-sm font-semibold"
                              [attr.title]="holder.name"
                              >{{ holder.name || 'Locataire sans nom' }}</span
                            >
                            <span class="shrink-0 text-xs whitespace-nowrap text-muted">{{
                              leaseCount(holder)
                            }}</span>
                          </span>
                          <span class="truncate text-xs text-muted" [attr.title]="holder.email">{{
                            holder.email || "Pas d'adresse e-mail"
                          }}</span>
                        </a>
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="px-4 py-8 text-center text-sm text-muted">
                    Aucun locataire ne correspond à « {{ query().trim() }} ».
                  </p>
                }
              }
              @case ('skeleton') {
                <div aria-busy="true">
                  <p class="sr-only">Chargement des locataires en cours.</p>
                  <ul aria-hidden="true" class="divide-y divide-border">
                    @for (n of placeholders; track n) {
                      <li class="flex min-h-14 flex-col justify-center gap-1.5 px-4 py-2.5">
                        <span class="${SKELETON} block h-4 w-2/3"></span>
                        <span class="${SKELETON} block h-3 w-1/2"></span>
                      </li>
                    }
                  </ul>
                </div>
              }
              @case ('empty') {
                <app-empty-state
                  heading="Aucun locataire"
                  message="Ajoutez votre premier locataire pour lui associer un bail."
                  icon="users"
                >
                  <button type="button" class="btn btn-primary" (click)="openNew()">
                    + Nouveau locataire
                  </button>
                </app-empty-state>
              }
            }
          </div>
        </section>

        <section #detail [class]="detailClass()" aria-label="Fiche du locataire">
          <router-outlet />
          @if (!hasDetail()) {
            <app-empty-state
              class="rounded-xl border border-dashed border-border-strong"
              heading="Sélectionnez un locataire"
              message="Choisissez un locataire dans la liste pour voir et modifier son contact et ses baux."
              icon="users"
            />
          }
        </section>
      </div>
    }
  `,
})
export class TenantsPage {
  protected readonly state = inject(TenantsState);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(Dialog);
  private readonly detailPane = viewChild<ElementRef<HTMLElement>>('detail');

  protected readonly query = signal('');
  protected readonly placeholders = [0, 1, 2, 3, 4, 5];

  /** A tenant is open (the child route is active). */
  protected readonly hasDetail = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map(() => this.route.firstChild !== null),
    ),
    { initialValue: this.route.firstChild !== null },
  );

  protected readonly shown = computed(() => filterHolders(this.state.holders(), this.query()));

  /**
   * Rows in memory always win (fresh or stale); with none, a failure is the error state; otherwise the
   * skeleton while loading; otherwise there is truly nothing: the empty state.
   */
  protected readonly view = computed<'content' | 'error' | 'skeleton' | 'empty'>(() => {
    if (this.state.holders().length > 0) {
      return 'content';
    }
    if (this.state.failure()) {
      return 'error';
    }
    return this.state.loading() ? 'skeleton' : 'empty';
  });

  /** On rows that are already on screen, a failed reload says so. */
  protected readonly staleNotice = computed(() => {
    const failed = this.state.failure();
    return failed && this.state.holders().length > 0 ? describeBackendError(failed.cause) : null;
  });

  protected readonly resultSentence = computed(() => {
    const count = this.shown().length;
    return `${count} ${count === 1 ? 'locataire' : 'locataires'}`;
  });

  /** Below 1024 px one pane at a time: the list is hidden while a tenant is open, and the reverse. */
  protected readonly listClass = computed(
    () =>
      `flex min-h-0 flex-col gap-3 lg:flex lg:min-w-0 ${this.hasDetail() ? 'max-lg:hidden' : ''}`,
  );
  protected readonly detailClass = computed(
    () =>
      `min-w-0 lg:block lg:min-h-0 lg:overflow-y-auto ${this.hasDetail() ? '' : 'max-lg:hidden'}`,
  );

  constructor() {
    void this.state.refresh();
    // The detail pane is the scroller from 1024 px: a new tenant opens at its top.
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe(() => {
        const pane = this.detailPane()?.nativeElement;
        if (pane) {
          pane.scrollTop = 0;
        }
      });
  }

  protected leaseCount(holder: Leaseholder): string {
    return leaseCountLabel(holder.leases.length);
  }

  protected onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected async openNew(): Promise<void> {
    const ref = this.dialog.open<string | undefined, NewTenantDialogData, NewTenantDialog>(
      NewTenantDialog,
      {
        data: { state: this.state },
        role: 'dialog',
        ariaModal: true,
        ariaLabelledBy: 'new-tenant-title',
        width: 'min(28rem, calc(100vw - 2rem))',
        hasBackdrop: true,
        autoFocus: 'first-tabbable',
        restoreFocus: true,
        closeOnNavigation: true,
      },
    );
    const createdId = await firstValueFrom(ref.closed, { defaultValue: undefined });
    if (createdId) {
      this.query.set('');
      await this.router.navigate(['/locataires', createdId]);
    }
  }
}
