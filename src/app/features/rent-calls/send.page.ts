import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EmptyState } from '../../shared/ui/empty-state';

/** Placeholder: replaced by the one-screen send flow with PDF preview (Task 8). */
@Component({
  selector: 'app-send',
  imports: [EmptyState, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="text-2xl font-semibold tracking-tight">Envoi des appels de loyer</h1>
    <app-empty-state
      class="mt-8 rounded-xl border border-dashed border-border-strong"
      heading="Bientôt disponible"
      message="L'aperçu et l'envoi des appels de loyer arrivent dans une prochaine étape."
      icon="clock"
    >
      <a routerLink="/appels" class="btn btn-secondary">Retour aux appels de loyer</a>
    </app-empty-state>
  `,
})
export class SendPage {}
