import { ChangeDetectionStrategy, Component } from '@angular/core';
import { EmptyState } from '../../shared/ui/empty-state';

/** Placeholder: replaced by the tenant list (Task 9). */
@Component({
  selector: 'app-tenants',
  imports: [EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="text-2xl font-semibold tracking-tight">Locataires</h1>
    <app-empty-state
      class="mt-8 rounded-xl border border-dashed border-border-strong"
      heading="Bientôt disponible"
      message="La liste de vos locataires et de leurs baux arrive dans une prochaine étape."
      icon="clock"
    />
  `,
})
export class TenantsPage {}
