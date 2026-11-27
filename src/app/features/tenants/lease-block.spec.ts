import { Component, inject } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NOW } from '../../core/clock';
import { formatEuro } from '../../core/format/fr';
import { InseeService, InseeUnavailableError } from '../../core/insee/insee.service';
import { LeaseholderRepository } from '../../core/parse/leaseholder.repository';
import { ParseClient } from '../../core/parse/parse-client';
import { FakeParseClient, parseError, pointer } from '../../core/parse/testing/fake-parse-client';
import { ConfirmDialog, ConfirmDialogOptions } from '../../shared/ui/confirm-dialog';
import { LeaseBlock } from './lease-block';
import { TenantsState } from './tenants-state';

@Component({
  imports: [LeaseBlock],
  providers: [TenantsState],
  template: `
    @for (holder of repository.leaseholders(); track holder.objectId) {
      @for (lease of holder.leases; track lease.objectId) {
        <app-lease-block [holderId]="holder.objectId!" [lease]="lease" />
      }
    }
  `,
})
class Host {
  protected readonly repository = inject(LeaseholderRepository);
}

/** Today is 20 January 2026: the anniversary of 1 March is 40 days away. */
const TODAY = new Date(2026, 0, 20);

/** Fictitious ILAT lease: rent 1091.08, reference 2025-T2 = 133.69, anniversary 1 March 2026. */
function storedLease(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    isPro: true,
    name: 'Commerce',
    lot: 0,
    streetNumber: 3,
    streetName: 'rue des Tests',
    optionalAddressInfo: '',
    postalCode: 13600,
    city: 'Ville-Test',
    lastSendDate: 0,
    price: 1091.08,
    charge: null,
    additionalCharges: [],
    renewalDate: new Date(2026, 2, 1).getTime(),
    indexType: 'ILAT',
    referenceIndexQuarter: '2025-T2',
    referenceIndexValue: 133.69,
    ...overrides,
  };
}

const text = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

interface Options {
  lease?: Record<string, unknown>;
  /** What INSEE answers, in order (the last one repeats). */
  answers?: (Map<string, number> | Error)[];
  confirm?: boolean;
}

async function setup(options: Options = {}) {
  const fake = new FakeParseClient();
  fake.seed('Lease', 'l1', storedLease(options.lease));
  fake.seed('Leaseholder', 'h1', {
    name: 'Dupont',
    email: 'dupont@example.test',
    phone: '',
    leases: [pointer('Lease', 'l1')],
  });
  const answers = [...(options.answers ?? [new Map([['2026-Q2', 136.42]])])];
  const observations = vi.fn(async () => {
    const next = answers.length > 1 ? answers.shift()! : answers[0];
    if (next instanceof Error) {
      throw next;
    }
    return next;
  });
  const dialogs: ConfirmDialogOptions[] = [];
  TestBed.configureTestingModule({
    providers: [
      { provide: ParseClient, useValue: fake },
      { provide: NOW, useValue: () => new Date(TODAY) },
      { provide: InseeService, useValue: { observations } },
      {
        provide: ConfirmDialog,
        useValue: {
          open: async (config: ConfirmDialogOptions) => {
            dialogs.push(config);
            return options.confirm ?? true;
          },
        },
      },
    ],
  });
  await TestBed.inject(LeaseholderRepository).load();
  const fixture: ComponentFixture<Host> = TestBed.createComponent(Host);
  const view = {
    fake,
    fixture,
    observations,
    dialogs,
    get root(): HTMLElement {
      return fixture.nativeElement as HTMLElement;
    },
    async settle() {
      for (let i = 0; i < 6; i++) {
        fixture.detectChanges();
        for (let j = 0; j < 40; j++) {
          await Promise.resolve();
        }
      }
      fixture.detectChanges();
    },
    slot: () => view.root.querySelector('[data-slot="revision"]'),
    pills: () => [...view.root.querySelectorAll('app-pill')].map((pill) => text(pill)),
    button(label: string): HTMLButtonElement | undefined {
      return [...view.root.querySelectorAll('button')].find((b) => text(b) === label);
    },
    async click(label: string) {
      view.button(label)!.click();
      await view.settle();
    },
  };
  await view.settle();
  return view;
}

/** What `text()` returns for a string: every kind of space becomes a plain one. */
const flat = (value: string) => value.replace(/\s+/g, ' ');

describe('LeaseBlock annual revision', () => {
  it('shows the pill, the proposal and the button when the index is published', async () => {
    const view = await setup();
    expect(view.pills()).toEqual(['Pro', 'Révision le 01/03']);
    expect(text(view.slot())).toContain(
      flat(`${formatEuro(1091.08)} → ${formatEuro(1113.36)} (ILAT T2 2026)`),
    );
    expect(view.button('Appliquer la révision')).toBeDefined();
    expect(view.observations).toHaveBeenCalledTimes(1);
    expect(view.observations).toHaveBeenCalledWith('ILAT');
  });

  it('says when the index is expected, with no button, while it is not published', async () => {
    const view = await setup({ answers: [new Map([['2026-Q1', 136.1]])] });
    expect(view.pills()).toContain('Révision le 01/03');
    expect(text(view.slot())).toBe('Indice ILAT T2 2026 attendu vers le 30/09/2026');
    expect(view.button('Appliquer la révision')).toBeUndefined();
  });

  it('shows nothing, and asks INSEE nothing, when the anniversary is far or the lease incomplete', async () => {
    const far = await setup({ lease: { renewalDate: new Date(2026, 8, 1).getTime() } });
    expect(far.pills()).toEqual(['Pro']);
    expect(far.slot()?.children.length).toBe(0);
    expect(far.observations).not.toHaveBeenCalled();
    TestBed.resetTestingModule();

    const incomplete = await setup({ lease: { referenceIndexValue: undefined } });
    expect(incomplete.pills()).toEqual(['Pro', 'À compléter']);
    expect(incomplete.slot()?.children.length).toBe(0);
    expect(incomplete.observations).not.toHaveBeenCalled();
  });

  it('asks for a confirmation that says old to new rent, the quarter and the next date, and applies on confirm', async () => {
    const view = await setup();
    await view.click('Appliquer la révision');

    expect(view.dialogs.length).toBe(1);
    expect(view.dialogs[0].message).toContain(
      `${formatEuro(1091.08)} à ${formatEuro(1113.36)} (ILAT T2 2026`,
    );
    expect(view.dialogs[0].message).toContain(
      'La prochaine date anniversaire passera au 01/03/2027.',
    );

    const saves = view.fake.callsOf('save', 'Lease');
    expect(saves.length).toBe(1);
    // Exactly these four fields, whatever the order.
    expect(saves[0].ops).toHaveLength(4);
    expect(saves[0].ops).toContainEqual({ kind: 'set', key: 'price', value: 1113.36 });
    expect(saves[0].ops).toContainEqual({
      kind: 'set',
      key: 'referenceIndexQuarter',
      value: '2026-T2',
    });
    expect(saves[0].ops).toContainEqual({ kind: 'set', key: 'referenceIndexValue', value: 136.42 });
    expect(saves[0].ops).toContainEqual({
      kind: 'set',
      key: 'renewalDate',
      value: new Date(2027, 2, 1).getTime(),
    });
    // The proposal is gone: no second application is possible.
    expect(view.button('Appliquer la révision')).toBeUndefined();
    expect(view.pills()).toEqual(['Pro']);
    expect(text(view.root)).toContain(flat(formatEuro(1113.36)));
  });

  it('writes nothing when the confirmation is cancelled', async () => {
    const view = await setup({ confirm: false });
    await view.click('Appliquer la révision');
    expect(view.fake.callsOf('save', 'Lease').length).toBe(0);
    expect(view.button('Appliquer la révision')).toBeDefined();
  });

  it('keeps the proposal and says why when the save fails, then applies on the next try', async () => {
    const view = await setup();
    view.fake.failWhen((call) => call.op === 'save', parseError(141, 'secret detail'));
    await view.click('Appliquer la révision');
    expect(text(view.root.querySelector('[role="alert"]'))).toBe(
      "L'enregistrement a échoué. Réessayez dans un instant.",
    );
    expect(text(view.root)).not.toContain('secret detail');
    expect(view.button('Appliquer la révision')!.disabled).toBe(false);
    expect(view.fake.record('Lease', 'l1')!.attrs['price']).toBe(1091.08);

    await view.click('Appliquer la révision');
    expect(view.fake.record('Lease', 'l1')!.attrs['price']).toBe(1113.36);
    expect(view.button('Appliquer la révision')).toBeUndefined();
  });

  it('shows a quiet error line when INSEE is unavailable, keeps editing possible, and retries', async () => {
    const view = await setup({
      answers: [new InseeUnavailableError('http'), new Map([['2026-Q2', 136.42]])],
    });
    expect(text(view.slot())).toBe('Indices INSEE indisponibles — Réessayer');
    expect(text(view.slot())).not.toMatch(/cl[ée]/);
    expect(view.pills()).toEqual(['Pro', 'Révision le 01/03']);
    expect(view.button('Modifier')!.disabled).toBe(false);
    expect(view.button('Appliquer la révision')).toBeUndefined();

    await view.click('Réessayer');
    expect(text(view.slot())).toContain(flat(formatEuro(1113.36)));
    expect(view.observations).toHaveBeenCalledTimes(2);
  });
});
