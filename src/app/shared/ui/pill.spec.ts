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

  it.each(['ok', 'warn', 'accent', 'neutral'] as PillTone[])(
    'never wraps, never shrinks, is 11 px semibold and fully rounded (%s)',
    (tone) => {
      const { fixture, pill } = render();
      fixture.componentInstance.tone.set(tone);
      fixture.detectChanges();

      for (const cls of [
        'whitespace-nowrap',
        'shrink-0',
        'rounded-full',
        'text-[11px]',
        'font-semibold',
        'inline-flex',
      ]) {
        expect(pill.classList.contains(cls), cls).toBe(true);
      }
    },
  );

  it.each([
    ['ok', 'bg-ok-soft', 'text-ok'],
    ['warn', 'bg-warn-soft', 'text-warn'],
    ['accent', 'bg-accent-soft', 'text-accent'],
    ['neutral', 'bg-surface', 'text-muted'],
  ] as Array<[PillTone, string, string]>)('uses the %s colours', (tone, background, text) => {
    const { fixture, pill } = render();
    fixture.componentInstance.tone.set(tone);
    fixture.detectChanges();

    expect(pill.classList.contains(background)).toBe(true);
    expect(pill.classList.contains(text)).toBe(true);
  });

  it('drops the previous tone when it changes', () => {
    const { fixture, pill } = render();
    expect(pill.classList.contains('bg-ok-soft')).toBe(true);

    fixture.componentInstance.tone.set('warn');
    fixture.detectChanges();

    expect(pill.classList.contains('bg-ok-soft')).toBe(false);
    expect(pill.classList.contains('bg-warn-soft')).toBe(true);
  });

  it('is neutral by default', () => {
    @Component({ imports: [Pill], template: '<app-pill>Pro</app-pill>' })
    class Bare {}
    const fixture = TestBed.createComponent(Bare);
    fixture.detectChanges();

    const pill = (fixture.nativeElement as HTMLElement).querySelector('app-pill') as HTMLElement;
    expect(pill.classList.contains('bg-surface')).toBe(true);
  });
});
