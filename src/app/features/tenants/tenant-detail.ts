import { toSignal } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { isSessionError } from '../../core/auth/session-error';
import { Leaseholder } from '../../core/models/leaseholder';
import { LeaseholderRepository } from '../../core/parse/leaseholder.repository';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { EmptyState } from '../../shared/ui/empty-state';
import { ErrorState } from '../../shared/ui/error-state';
import { Icon } from '../../shared/ui/icon';
import { ContactBlock } from './contact-block';
import { LeaseBlock } from './lease-block';
import { TenantsState, leaseCountLabel, saveErrorMessage } from './tenants-state';

const SKELETON = 'animate-pulse rounded bg-border';

/**
 * The page of one tenant (`/locataires/:id`, inside the list page): the Contact block and one block per
 * lease, each editable on its own, « + Ajouter un bail », and the deletion of the tenant (after a
 * confirmation). A tenant without lease says « Aucun bail ». An id that does not exist says
 * « Locataire introuvable » with a way back; while the first load runs it is a skeleton, and a failed
 * first load is the error state (below 1024 px the list, which shows the same error, is hidden).
 *
 * The blocks are tied to the tenant's id: opening another tenant builds them again, so a form left
 * open never carries over to someone else.
 */
@Component({
  selector: 'app-tenant-detail',
  imports: [RouterLink, ContactBlock, LeaseBlock, EmptyState, ErrorState, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block @container' },
  template: `
    @for (holder of current(); track holder.objectId) {
      <div class="flex flex-col gap-5">
        <header class="flex flex-col gap-3">
          <a
            routerLink="/locataires"
            class="btn btn-ghost -ml-3 self-start lg:hidden"
            aria-label="Retour à la liste des locataires"
          >
            <app-icon name="arrow-left" class="size-5" />
            Retour
          </a>
          <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div class="min-w-0 flex-1 basis-48">
              <h2 class="truncate text-xl font-semibold tracking-tight" [attr.title]="holder.name">
                {{ holder.name || 'Locataire sans nom' }}
              </h2>
              <p class="text-sm text-muted">{{ leaseCount(holder) }}</p>
            </div>
            <button
              type="button"
              class="btn btn-secondary shrink-0 text-danger"
              [disabled]="deleting()"
              [attr.aria-busy]="deleting()"
              (click)="removeHolder(holder)"
            >
              {{ deleting() ? 'Suppression…' : 'Supprimer le locataire' }}
            </button>
          </div>
          @if (deleteError(); as message) {
            <p
              role="alert"
              class="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger"
            >
              {{ message }}
            </p>
          }
        </header>

        <app-contact-block [holder]="holder" />

        <section class="flex flex-col gap-3" aria-labelledby="baux-titre">
          <div class="flex items-center justify-between gap-3">
            <h3 id="baux-titre" class="text-sm font-semibold">Baux</h3>
            <button
              type="button"
              class="btn btn-secondary"
              [disabled]="adding()"
              (click)="adding.set(true)"
            >
              + Ajouter un bail
            </button>
          </div>

          @if (adding() && holder.objectId) {
            <app-lease-block [holderId]="holder.objectId" (closed)="adding.set(false)" />
          }

          @for (lease of holder.leases; track lease.objectId) {
            @if (holder.objectId) {
              <app-lease-block [holderId]="holder.objectId" [lease]="lease" />
            }
          } @empty {
            @if (!adding()) {
              <p
                class="rounded-xl border border-dashed border-border-strong px-4 py-8 text-center text-sm text-muted"
              >
                Aucun bail. Ajoutez le premier avec « + Ajouter un bail ».
              </p>
            }
          }
        </section>
      </div>
    } @empty {
      @if (state.loaded()) {
        <app-empty-state
          class="rounded-xl border border-dashed border-border-strong"
          heading="Locataire introuvable"
          message="Ce locataire n'existe pas ou n'existe plus. Il a peut-être été supprimé."
          icon="users"
        >
          <a routerLink="/locataires" class="btn btn-primary">Retour aux locataires</a>
        </app-empty-state>
      } @else if (state.failure(); as failed) {
        <app-error-state
          class="rounded-xl border border-dashed border-border-strong"
          [error]="failed.cause"
          [retrying]="state.loading()"
          (retry)="state.refresh()"
        />
      } @else {
        <div aria-busy="true" class="flex flex-col gap-5">
          <p class="sr-only">Chargement du locataire en cours.</p>
          <div aria-hidden="true" class="flex flex-col gap-5">
            <div>
              <span class="${SKELETON} block h-6 w-56"></span>
              <span class="${SKELETON} mt-2 block h-4 w-20"></span>
            </div>
            <div class="rounded-xl border border-border">
              <div class="border-b border-border px-5 py-4">
                <span class="${SKELETON} block h-4 w-16"></span>
              </div>
              <div class="grid gap-4 px-5 py-4 @md:grid-cols-3">
                <span class="${SKELETON} block h-8 w-full"></span>
                <span class="${SKELETON} block h-8 w-full"></span>
                <span class="${SKELETON} block h-8 w-full"></span>
              </div>
            </div>
            <div class="rounded-xl border border-border">
              <div class="border-b border-border px-5 py-4">
                <span class="${SKELETON} block h-4 w-40"></span>
              </div>
              <div class="grid gap-4 px-5 py-4 @lg:grid-cols-2">
                @for (n of placeholders; track n) {
                  <span class="${SKELETON} block h-10 w-full"></span>
                }
              </div>
            </div>
          </div>
        </div>
      }
    }
  `,
})
export class TenantDetail {
  protected readonly state = inject(TenantsState);
  private readonly repository = inject(LeaseholderRepository);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmDialog);
  private readonly route = inject(ActivatedRoute);

  private readonly id = toSignal(this.route.paramMap.pipe(map((params) => params.get('id'))), {
    initialValue: this.route.snapshot.paramMap.get('id'),
  });

  /** The tenant of the address, as a list of one (or none): `@for` ties the blocks to its id. */
  protected readonly current = computed<Leaseholder[]>(() => {
    const id = this.id();
    const holder = id ? this.state.holders().find((h) => h.objectId === id) : undefined;
    return holder ? [holder] : [];
  });

  protected readonly adding = signal(false);
  protected readonly deleting = signal(false);
  protected readonly deleteError = signal<string | null>(null);
  protected readonly placeholders = [0, 1, 2, 3, 4, 5];

  protected leaseCount(holder: Leaseholder): string {
    return leaseCountLabel(holder.leases.length);
  }

  protected async removeHolder(holder: Leaseholder): Promise<void> {
    const id = holder.objectId;
    if (!id || this.deleting()) {
      return;
    }
    const count = holder.leases.length;
    const confirmed = await this.confirm.open({
      title: `Supprimer définitivement « ${holder.name} » ?`,
      message:
        count === 0
          ? 'Le locataire sera effacé. Cette action est irréversible.'
          : `Le locataire et ${count === 1 ? 'son bail' : `ses ${count} baux`} seront effacés. Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    this.deleting.set(true);
    this.deleteError.set(null);
    try {
      await this.state.attempt(() => this.repository.deleteLeaseholder(id));
      await this.router.navigate(['/locataires']);
    } catch (error) {
      if (!isSessionError(error)) {
        this.deleteError.set(saveErrorMessage(error, 'delete'));
      }
    } finally {
      this.deleting.set(false);
    }
  }
}
