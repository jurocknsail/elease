import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { parseError } from '../../core/parse/testing/fake-parse-client';
import { BackendTimeoutError } from '../../core/parse/with-timeout';
import { ErrorState } from './error-state';

@Component({
  imports: [ErrorState],
  template: `<app-error-state
    [error]="error()"
    [retrying]="retrying()"
    (retry)="retries = retries + 1"
  />`,
})
class Host {
  readonly error = signal<unknown>(new BackendTimeoutError());
  readonly retrying = signal(false);
  retries = 0;
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const root = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    root,
    button: () => root.querySelector('button') as HTMLButtonElement | null,
  };
}

describe('ErrorState', () => {
  it('Back4App hanging: says a connection is required and offers « Réessayer », never a spinner', () => {
    const { root, button } = render();

    expect(root.querySelector('h2')?.textContent?.trim()).toBe('Connexion requise');
    expect(root.textContent).toContain('Le serveur ne répond pas');
    expect(button()?.textContent?.trim()).toBe('Réessayer');
    expect(root.querySelector('[role="progressbar"], [aria-busy="true"]')).toBeNull();
  });

  it('announces itself to assistive technology', () => {
    const { root } = render();
    expect(root.querySelector('app-error-state')?.getAttribute('role')).toBe('alert');
  });

  it('emits retry when « Réessayer » is pressed', () => {
    const { fixture, button } = render();

    button()?.click();
    button()?.click();

    expect(fixture.componentInstance.retries).toBe(2);
  });

  it('disables the button while a retry is running, so a second tap cannot start another request', () => {
    const { fixture, button } = render();
    fixture.componentInstance.retrying.set(true);
    fixture.detectChanges();

    expect(button()?.disabled).toBe(true);
    expect(button()?.getAttribute('aria-busy')).toBe('true');
  });

  it('describes the error that is given, and updates when it changes', () => {
    const { fixture, root } = render();

    fixture.componentInstance.error.set(parseError(141, 'Cloud Code failure'));
    fixture.detectChanges();

    expect(root.querySelector('h2')?.textContent?.trim()).toBe('Une erreur est survenue');
    expect(root.textContent).not.toContain('Cloud Code failure');
  });

  it('draws a "no connection" icon for a missing connection and a warning for anything else', () => {
    const { fixture, root } = render();
    expect(root.querySelector('app-icon')?.getAttribute('data-icon')).toBe('wifi-off');

    fixture.componentInstance.error.set(parseError(100, 'XMLHttpRequest failed'));
    fixture.detectChanges();
    expect(root.querySelector('app-icon')?.getAttribute('data-icon')).toBe('wifi-off');

    fixture.componentInstance.error.set(parseError(141, 'Cloud Code failure'));
    fixture.detectChanges();
    expect(root.querySelector('app-icon')?.getAttribute('data-icon')).toBe('alert');
  });

  it('offers no retry for an expired session (the login screen takes over)', () => {
    const { fixture, button, root } = render();

    fixture.componentInstance.error.set(parseError(209));
    fixture.detectChanges();

    expect(root.querySelector('h2')?.textContent?.trim()).toBe('Session expirée');
    expect(button()).toBeNull();
  });
});
