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
import { formatEuro, formatLeaseAddress } from '../../core/format/fr';
import { Icon } from '../../shared/ui/icon';
import { Avatar } from '../../shared/ui/avatar';
import { EmptyState } from '../../shared/ui/empty-state';
import { ErrorState } from '../../shared/ui/error-state';
import { NewTenantDialog, NewTenantDialogData } from './new-tenant-dialog';
import { TenantsState, leaseCountLabel } from './tenants-state';

const SKELETON = 'animate-pulse rounded-md bg-border/70';

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
  imports: [Avatar, RouterOutlet, RouterLink, RouterLinkActive, EmptyState, ErrorState, Icon],
  providers: [TenantsState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block lg:h-full' },
  template: `
    @if (view() === 'error') {
      @if (state.failure(); as failed) {
        <h1 class="sr-only">Locataires</h1>
        <app-error-state
          class="rounded-2xl border border-dashed border-border-strong bg-card/50"
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
              <h1 class="shrink-0 text-2xl font-semibold tracking-tight md:text-[1.75rem]">Locataires</h1>
              <button type="button" class="btn btn-primary shrink-0" (click)="openNew()"><app-icon name="plus" class="size-4" />
                Nouveau locataire
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
                  ><app-icon name="refresh" class="size-4" />
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
            class="overflow-hidden card lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
          >
            @switch (view()) {
              @case ('content') {
                <p class="sr-only" aria-live="polite">{{ resultSentence() }}</p>
                @if (shown().length > 0) {
                  <ul class="flex flex-col divide-y divide-border" aria-label="Locataires et leurs baux">
                    @for (holder of shown(); track holder.objectId) {
                      <li class="group/holder relative p-2 has-[[data-holder-row][aria-current=page]]:bg-accent-soft/40">
                        <a
                          [routerLink]="['/locataires', holder.objectId]"
                          routerLinkActive
                          ariaCurrentWhenActive="page"
                          data-holder-row
                          class="flex items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-surface aria-[current=page]:bg-card aria-[current=page]:shadow-sm aria-[current=page]:ring-1 aria-[current=page]:ring-accent/30"
                        >
                          <app-avatar [name]="holder.name" />
                          <span class="min-w-0 flex-1">
                            <span
                              class="block truncate text-sm font-semibold"
                              [attr.title]="holder.name"
                              >{{ holder.name || 'Locataire sans nom' }}</span
                            >
                            <span class="block truncate text-xs text-muted" [attr.title]="holder.email">{{
                              holder.email || "Pas d'adresse e-mail"
                            }}</span>
                          </span>
                          <span
                            class="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-muted ring-1 ring-border"
                            >{{ leaseCount(holder) }}</span
                          >
                        </a>

                        <ul
                          class="mt-0.5 ml-3 flex flex-col gap-0.5"
                          [attr.aria-label]="'Baux de ' + (holder.name || 'ce locataire')"
                        >
                          @for (lease of holder.leases; track lease.objectId) {
                            <li>
                              <a
                                [routerLink]="['/locataires', holder.objectId]"
                                [fragment]="'bail-' + lease.objectId"
                                routerLinkActive
                                ariaCurrentWhenActive="location"
                                [routerLinkActiveOptions]="leaseActiveOptions"
                                class="group/lease flex min-h-10 items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface aria-[current=location]:bg-accent-soft"
                              >
                                <span class="grid size-7 shrink-0 place-items-center rounded-lg bg-surface text-muted ring-1 ring-border group-aria-[current=location]/lease:bg-accent group-aria-[current=location]/lease:text-on-accent group-aria-[current=location]/lease:ring-0">
                                  <app-icon name="home" class="size-3.5" />
                                </span>
                                <span class="min-w-0 flex-1">
                                  <span class="block truncate text-[13px] font-medium group-aria-[current=location]/lease:font-semibold group-aria-[current=location]/lease:text-accent">{{
                                    lease.name || 'Bail sans nom'
                                  }}</span>
                                  <span class="block truncate text-xs text-muted">{{
                                    leaseAddress(lease)
                                  }}</span>
                                </span>
                                <span class="shrink-0 text-xs font-semibold whitespace-nowrap tabular-nums">{{
                                  formatEuro(lease.price)
                                }}</span>
                              </a>
                            </li>
                          } @empty {
                            <li class="px-2 py-1.5 text-xs text-muted italic">Aucun bail</li>
                          }
                        </ul>
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
                  <button type="button" class="btn btn-primary" (click)="openNew()"><app-icon name="plus" class="size-4" />
                    Nouveau locataire
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
              class="rounded-2xl border border-dashed border-border-strong bg-card/50"
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

  protected initials(holder: Leaseholder): string {
    const letters = holder.name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word.charAt(0).toLocaleUpperCase('fr'))
      .join('');
    return letters || '?';
  }

  protected leaseAddress = formatLeaseAddress;

  protected readonly formatEuro = formatEuro;
  /** A lease is active when the address names it (`#bail-<id>`), not just the tenant. */
  protected readonly leaseActiveOptions = {
    paths: 'exact',
    queryParams: 'ignored',
    fragment: 'exact',
    matrixParams: 'ignored',
  } as const;

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
