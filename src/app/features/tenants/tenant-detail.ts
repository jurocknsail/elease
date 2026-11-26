import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EmptyState } from '../../shared/ui/empty-state';

/** Placeholder: replaced by the tenant detail with per-block editing (Task 9). */
@Component({
  selector: 'app-tenant-detail',
  imports: [EmptyState, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="text-2xl font-semibold tracking-tight">Locataire</h1>
    <app-empty-state
      class="mt-8 rounded-xl border border-dashed border-border-strong"
      heading="Bientôt disponible"
      message="La fiche du locataire et de ses baux arrive dans une prochaine étape."
      icon="clock"
    >
      <a routerLink="/locataires" class="btn btn-secondary">Retour aux locataires</a>
    </app-empty-state>
  `,
})
export class TenantDetail {}
