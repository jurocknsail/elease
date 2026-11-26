import { Dialog } from '@angular/cdk/dialog';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfirmDialog, ConfirmDialogOptions } from './confirm-dialog';

const OPTIONS: ConfirmDialogOptions = {
  title: 'Envoyer les appels de loyer ?',
  message: '2 e-mails à 2 locataires, total 3 400 €.',
  confirmLabel: 'Envoyer',
};

function setup() {
  const dialog = TestBed.inject(ConfirmDialog);
  const app = TestBed.inject(ApplicationRef);
  const opener = document.createElement('button');
  opener.textContent = 'Ouvrir';
  document.body.append(opener);
  opener.focus();

  /** Opens the dialog and renders it. */
  async function open(options: ConfirmDialogOptions = OPTIONS) {
    const result = dialog.open(options);
    app.tick();
    await vi.waitFor(() => expect(panel()).not.toBeNull());
    app.tick();
    return result;
  }
  return { dialog, app, opener, open };
}

function panel(): HTMLElement | null {
  return document.querySelector('app-confirm-dialog');
}

function buttons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('app-confirm-dialog button')];
}

function buttonLabelled(label: string): HTMLButtonElement {
  const found = buttons().find((button) => button.textContent?.trim() === label);
  expect(found, label).toBeDefined();
  return found as HTMLButtonElement;
}

describe('ConfirmDialog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.inject(Dialog).closeAll();
    document.body.querySelectorAll('button').forEach((button) => button.remove());
  });

  it('shows the title, the message and the two buttons, as an alert dialog', async () => {
    const { open } = setup();
    void open();
    await vi.waitFor(() => expect(panel()).not.toBeNull());

    expect(panel()?.querySelector('h2')?.textContent?.trim()).toBe(OPTIONS.title);
    expect(panel()?.textContent).toContain(OPTIONS.message);
    expect(buttons().map((b) => b.textContent?.trim())).toEqual(['Annuler', 'Envoyer']);
    const container = document.querySelector('.cdk-dialog-container');
    expect(container?.getAttribute('role')).toBe('alertdialog');
    expect(container?.getAttribute('aria-modal')).toBe('true');
    const labelledBy = container?.getAttribute('aria-labelledby') ?? '';
    expect(document.getElementById(labelledBy)?.textContent?.trim()).toBe(OPTIONS.title);
    const describedBy = container?.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toContain(OPTIONS.message);
  });

  it('resolves true when the user confirms', async () => {
    const { open } = setup();
    const result = open();
    await vi.waitFor(() => expect(panel()).not.toBeNull());

    buttonLabelled('Envoyer').click();

    expect(await result).toBe(true);
    expect(panel()).toBeNull();
  });

  it('resolves false when the user cancels', async () => {
    const { open } = setup();
    const result = open();
    await vi.waitFor(() => expect(panel()).not.toBeNull());

    buttonLabelled('Annuler').click();

    expect(await result).toBe(false);
  });

  it('resolves false on Escape', async () => {
    const { open } = setup();
    const result = open();
    await vi.waitFor(() => expect(panel()).not.toBeNull());

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }),
    );

    expect(await result).toBe(false);
    expect(panel()).toBeNull();
  });

  it('resolves false on a click on the backdrop', async () => {
    const { open } = setup();
    const result = open();
    await vi.waitFor(() => expect(panel()).not.toBeNull());

    (document.querySelector('.cdk-overlay-backdrop') as HTMLElement).click();

    expect(await result).toBe(false);
  });

  it('gives the initial focus to Cancel, keeps it inside, and gives it back to the opener', async () => {
    // jsdom has no layout, so the CDK would find nothing "visible" to focus: pretend every element has a box.
    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(
      () => [{ width: 1, height: 1 }] as unknown as DOMRectList,
    );
    const { open, opener } = setup();
    const result = open();
    await vi.waitFor(() => expect(panel()).not.toBeNull());

    await vi.waitFor(() => expect(document.activeElement).toBe(buttonLabelled('Annuler')));
    // Tab order: Annuler first, so Enter right after opening can never confirm.
    expect(buttons()[0].textContent?.trim()).toBe('Annuler');
    expect(panel()?.contains(document.activeElement)).toBe(true);

    buttonLabelled('Annuler').click();
    await result;

    await vi.waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('refuses a second dialog while one is open (a double tap must not stack two confirmations)', async () => {
    const { open, dialog } = setup();
    const first = open();
    await vi.waitFor(() => expect(panel()).not.toBeNull());

    expect(await dialog.open(OPTIONS)).toBe(false);
    expect(document.querySelectorAll('app-confirm-dialog')).toHaveLength(1);

    buttonLabelled('Envoyer').click();
    expect(await first).toBe(true);

    // Once closed, a new one opens normally.
    const again = open();
    await vi.waitFor(() => expect(panel()).not.toBeNull());
    buttonLabelled('Annuler').click();
    expect(await again).toBe(false);
  });
});
