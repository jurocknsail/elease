import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EmptyState } from './empty-state';

@Component({
  imports: [EmptyState],
  template: `
    <app-empty-state heading="Bientôt disponible" message="Cet écran arrive." icon="clock" id="a">
      <button type="button">Action</button>
    </app-empty-state>
    <app-empty-state heading="Aucun bail" id="b" />
  `,
})
class Host {}

describe('EmptyState', () => {
  function render(): HTMLElement {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the heading, the message, the icon and the projected action', () => {
    const first = render().querySelector('#a') as HTMLElement;

    expect(first.querySelector('h2')?.textContent?.trim()).toBe('Bientôt disponible');
    expect(first.querySelector('p')?.textContent?.trim()).toBe('Cet écran arrive.');
    expect(first.querySelector('app-icon svg')).not.toBeNull();
    expect(first.querySelector('button')?.textContent?.trim()).toBe('Action');
  });

  it('leaves out what is not given: no paragraph, no icon', () => {
    const second = render().querySelector('#b') as HTMLElement;

    expect(second.querySelector('h2')?.textContent?.trim()).toBe('Aucun bail');
    expect(second.querySelector('p')).toBeNull();
    expect(second.querySelector('app-icon')).toBeNull();
  });
});
