import { ChangeDetectionStrategy, Component } from '@angular/core';
import { EmptyState } from '../../shared/ui/empty-state';

/** Placeholder: replaced by the monthly overview (Task 7). */
@Component({
  selector: 'app-rent-calls',
  imports: [EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="text-2xl font-semibold tracking-tight">Appels de loyer</h1>
    <app-empty-state
      class="mt-8 rounded-xl border border-dashed border-border-strong"
      heading="Bientôt disponible"
      message="Le suivi des appels de loyer du mois arrive dans une prochaine étape."
      icon="clock"
    />
  `,
})
export class RentCallsPage {}
