import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Pill, PillTone } from './pill';

@Component({
  imports: [Pill],
  template: `<div class="w-8 flex"><app-pill [tone]="tone()">Révision le 01/03</app-pill></div>`,
})
class Host {
  readonly tone = signal<PillTone>('ok');
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const pill = (fixture.nativeElement as HTMLElement).querySelector('app-pill') as HTMLElement;
  return { fixture, pill };
}

describe('Pill', () => {
  it('shows its text', () => {
    expect(render().pill.textContent?.trim()).toBe('Révision le 01/03');
  });

  it('drops the previous tone when it changes', () => {
    const { fixture, pill } = render();
    expect(pill.classList.contains('bg-ok-soft')).toBe(true);

    fixture.componentInstance.tone.set('warn');
    fixture.detectChanges();

    expect(pill.classList.contains('bg-ok-soft')).toBe(false);
    expect(pill.classList.contains('bg-warn-soft')).toBe(true);
  });
});
