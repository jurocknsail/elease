import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { isSessionError } from '../../core/auth/session-error';
import { NOW } from '../../core/clock';
import { Leaseholder } from '../../core/models/leaseholder';
import { describeBackendError } from '../../core/parse/backend-error';
import { LeaseholderRepository } from '../../core/parse/leaseholder.repository';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { Icon } from '../../shared/ui/icon';
import {
  BackupFileError,
  RestorePlan,
  RestoreReport,
  applyRestore,
  backupFileName,
  downloadBlob,
  exportBackup,
  planCounts,
  planRestore,
  readBackupFile,
  restoreWarnings,
} from './backup';

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

interface PendingRestore {
  fileName: string;
  plan: RestorePlan;
  warnings: string[];
}

type Busy = 'export' | 'check' | 'restore' | null;

/**
 * « Sauvegarde »: exports the tenants and leases as a JSON file, and restores from one. A restore only
 * ever adds what is missing; it starts with a preview of what would be added and what is already there,
 * waits for a confirmation, and ends with a report that says exactly what was created and what failed.
 * Whatever the outcome the data is reloaded from the server afterwards.
 */
@Component({
  selector: 'app-backup-card',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="rounded-xl border border-border bg-bg" aria-labelledby="backup-title">
      <header class="border-b border-border px-4 py-3 md:px-5">
        <h2 id="backup-title" class="text-sm font-semibold">Sauvegarde</h2>
        <p class="mt-0.5 text-sm text-muted">
          Un fichier avec vos locataires et leurs baux, à conserver en lieu sûr. La restauration
          ajoute ce qui manque, sans rien modifier ni supprimer.
        </p>
      </header>

      <div class="flex flex-col gap-4 px-4 py-4 md:px-5">
        <div class="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            class="btn btn-secondary"
            [disabled]="busy() !== null"
            [attr.aria-busy]="busy() === 'export'"
            (click)="exportData()"
          >
            {{ busy() === 'export' ? 'Préparation…' : 'Exporter les données' }}
          </button>
          <button
            type="button"
            class="btn btn-secondary"
            [disabled]="busy() !== null"
            [attr.aria-busy]="busy() === 'check'"
            (click)="openChooser()"
          >
            {{ busy() === 'check' ? 'Lecture du fichier…' : 'Restaurer depuis un fichier' }}
          </button>
          <input
            #chooser
            type="file"
            accept=".json,application/json"
            class="hidden"
            tabindex="-1"
            aria-label="Fichier de sauvegarde à restaurer"
            (change)="onFile($event)"
          />
        </div>

        @if (exported(); as message) {
          <p role="status" class="flex items-start gap-2 text-sm text-ok">
            <app-icon name="check-circle" class="mt-0.5 size-4 shrink-0" />
            <span>{{ message }}</span>
          </p>
        }

        @if (problem(); as message) {
          <p
            role="alert"
            class="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger"
          >
            {{ message }}
          </p>
        }

        @if (pending(); as preview) {
          <div
            class="rounded-lg border border-border-strong bg-surface p-4"
            role="region"
            aria-label="Aperçu de la restauration"
          >
            <p class="text-sm font-semibold">{{ preview.fileName }}</p>
            <ul class="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm">
              <li>
                {{ newHoldersText() }}, {{ preview.plan.skipped }}
                {{ preview.plan.skipped === 1 ? 'déjà présent ignoré' : 'déjà présents ignorés' }}.
              </li>
              <li>{{ leasesText() }}</li>
            </ul>
            @for (warning of preview.warnings; track warning) {
              <p
                role="alert"
                class="mt-3 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-warn"
              >
                {{ warning }}
              </p>
            }
            @if (nothingToDo()) {
              <p class="mt-3 text-sm text-muted">
                Rien à restaurer : tout ce que contient ce fichier est déjà présent.
              </p>
            }
            <div class="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                class="btn btn-secondary"
                [disabled]="busy() !== null"
                (click)="cancelRestore()"
              >
                {{ nothingToDo() ? 'Fermer' : 'Annuler' }}
              </button>
              @if (!nothingToDo()) {
                <button
                  type="button"
                  class="btn btn-primary"
                  [disabled]="busy() !== null"
                  [attr.aria-busy]="busy() === 'restore'"
                  (click)="restore()"
                >
                  {{ busy() === 'restore' ? 'Restauration…' : 'Restaurer' }}
                </button>
              }
            </div>
          </div>
        }

        @if (report(); as result) {
          <div
            role="status"
            class="rounded-lg border p-4 text-sm"
            [class]="
              result.ok
                ? 'border-ok/40 bg-ok-soft text-text'
                : 'border-danger/40 bg-danger-soft text-text'
            "
          >
            <p class="font-semibold" [class.text-ok]="result.ok" [class.text-danger]="!result.ok">
              {{ result.ok ? 'Restauration terminée.' : 'Restauration incomplète.' }}
            </p>
            <p class="mt-1">
              {{ plural(result.holdersCreated, 'locataire créé', 'locataires créés') }},
              {{ plural(result.leasesCreated, 'bail créé', 'baux créés') }}.
              @if (result.leasesNotCreated > 0) {
                {{ plural(result.leasesNotCreated, 'bail non créé', 'baux non créés') }}.
              }
            </p>
            @if (result.stopped) {
              <p class="mt-1">
                Votre session a expiré : la suite n'a pas été essayée. Reconnectez-vous, puis
                relancez la restauration.
              </p>
            }
            @if (result.failures.length > 0) {
              <ul class="mt-2 flex list-disc flex-col gap-1 pl-5">
                @for (failure of result.failures.slice(0, 10); track $index) {
                  <li>
                    <span class="font-medium">{{ failure.holder }}</span>
                    @if (failure.lease) {
                      , bail « {{ failure.lease }} »
                    }
                    :
                    {{
                      failure.uncertain
                        ? 'pas de réponse du serveur, il a peut-être été créé'
                        : 'non créé'
                    }}.
                  </li>
                }
                @if (result.failures.length > 10) {
                  <li>… et {{ result.failures.length - 10 }} autres.</li>
                }
              </ul>
            }
            @if (!result.ok) {
              <p class="mt-2 text-muted">
                Vous pouvez relancer la restauration avec le même fichier : ce qui existe déjà est
                ignoré, seul ce qui manque est ajouté.
              </p>
            }
            @if (reloadFailed()) {
              <p class="mt-2 text-muted">
                Vos données n'ont pas pu être actualisées : ouvrez « Locataires » pour vérifier le
                résultat.
              </p>
            }
          </div>
        }
      </div>
    </section>
  `,
})
export class BackupCard {
  private readonly repository = inject(LeaseholderRepository);
  private readonly auth = inject(AuthService);
  private readonly confirm = inject(ConfirmDialog);
  private readonly now = inject(NOW);
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('chooser');

  protected readonly plural = plural;
  protected readonly busy = signal<Busy>(null);
  protected readonly exported = signal<string | null>(null);
  protected readonly problem = signal<string | null>(null);
  protected readonly pending = signal<PendingRestore | null>(null);
  protected readonly report = signal<RestoreReport | null>(null);
  protected readonly reloadFailed = signal(false);

  protected readonly counts = computed(() => {
    const restore = this.pending();
    return restore ? planCounts(restore.plan) : { newHolders: 0, completedHolders: 0, leases: 0 };
  });
  protected readonly nothingToDo = computed(() => this.pending()?.plan.toCreate.length === 0);
  protected readonly newHoldersText = computed(() => {
    const n = this.counts().newHolders;
    return n === 1 ? '1 locataire sera ajouté' : `${n} locataires seront ajoutés`;
  });
  protected readonly leasesText = computed(() => {
    const { leases, completedHolders } = this.counts();
    const skipped = this.pending()?.plan.skippedLeases ?? 0;
    const into =
      completedHolders > 0
        ? ` (dont des baux ajoutés à ${plural(completedHolders, 'locataire existant', 'locataires existants')})`
        : '';
    return `${leases === 1 ? '1 bail sera ajouté' : `${leases} baux seront ajoutés`}${into}, ${skipped} déjà ${skipped === 1 ? 'présent ignoré' : 'présents ignorés'}.`;
  });

  /** What went wrong, in French, for an error that is not a bad file. Null for a session that ended. */
  private describe(error: unknown): string | null {
    if (isSessionError(error)) {
      return null;
    }
    if (error instanceof BackupFileError) {
      return error.message;
    }
    return describeBackendError(error).message;
  }

  /** The current data, freshly loaded: a backup or a plan made from stale data would be wrong. */
  private async freshHolders(): Promise<readonly Leaseholder[]> {
    await this.repository.load();
    return this.repository.leaseholders();
  }

  protected openChooser(): void {
    this.fileInput().nativeElement.click();
  }

  protected async exportData(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set('export');
    this.resetMessages();
    try {
      const holders = await this.freshHolders();
      if (holders.length === 0) {
        this.problem.set("Il n'y a encore aucune donnée à exporter.");
        return;
      }
      const name = backupFileName(this.auth.user()?.username, this.now());
      downloadBlob(exportBackup(holders), name);
      const leases = holders.reduce((sum, holder) => sum + holder.leases.length, 0);
      this.exported.set(
        `${name} : ${plural(holders.length, 'locataire', 'locataires')} et ${plural(leases, 'bail', 'baux')} exportés.`,
      );
    } catch (error) {
      const message = this.describe(error);
      if (message) {
        this.problem.set(`Export impossible : ${message}`);
      }
    } finally {
      this.busy.set(null);
    }
  }

  protected async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset so that choosing the same file again fires `change` again.
    const reset = () => {
      input.value = '';
    };
    if (!file || this.busy()) {
      reset();
      return;
    }
    this.busy.set('check');
    this.resetMessages();
    this.pending.set(null);
    try {
      const fileHolders = await readBackupFile(file);
      const existing = await this.freshHolders();
      const plan = planRestore(fileHolders, existing);
      this.pending.set({
        fileName: file.name,
        plan,
        warnings: restoreWarnings({
          fileName: file.name,
          username: this.auth.user()?.username ?? null,
          fileHolders,
          existing,
          plan,
        }),
      });
    } catch (error) {
      const message = this.describe(error);
      if (message) {
        this.problem.set(
          error instanceof BackupFileError
            ? message
            : `Impossible de vérifier vos données actuelles : ${message}`,
        );
      }
    } finally {
      reset();
      this.busy.set(null);
    }
  }

  protected cancelRestore(): void {
    if (!this.busy()) {
      this.pending.set(null);
    }
  }

  protected async restore(): Promise<void> {
    const restore = this.pending();
    if (!restore || this.busy() || restore.plan.toCreate.length === 0) {
      return;
    }
    const counts = this.counts();
    const warnings = restore.warnings.length > 0 ? ` ${restore.warnings.join(' ')}` : '';
    const confirmed = await this.confirm.open({
      title: 'Restaurer ces données ?',
      message:
        `${this.newHoldersText()} et ${plural(counts.leases, 'bail', 'baux')} ${counts.leases === 1 ? 'sera créé' : 'seront créés'} dans votre compte. ` +
        `Rien d'existant n'est modifié ni supprimé.${warnings}`,
      confirmLabel: 'Restaurer',
    });
    if (!confirmed || this.busy()) {
      return;
    }
    this.busy.set('restore');
    this.resetMessages();
    try {
      const result = await applyRestore(restore.plan, this.repository);
      try {
        await this.repository.load();
      } catch (error) {
        if (!isSessionError(error)) {
          this.reloadFailed.set(true);
        }
      }
      this.report.set(result);
      this.pending.set(null);
    } finally {
      this.busy.set(null);
    }
  }

  private resetMessages(): void {
    this.exported.set(null);
    this.problem.set(null);
    this.report.set(null);
    this.reloadFailed.set(false);
  }
}
