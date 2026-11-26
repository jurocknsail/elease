import { TestBed } from '@angular/core/testing';
import { NOW } from './clock';

describe('NOW', () => {
  it('defaults to the real current time, as a fresh Date each time', () => {
    const before = Date.now();
    const first = TestBed.inject(NOW)();
    const after = Date.now();

    expect(first).toBeInstanceOf(Date);
    expect(first.getTime()).toBeGreaterThanOrEqual(before);
    expect(first.getTime()).toBeLessThanOrEqual(after);
    // A new object every call: a caller that changes it cannot alter what the next one reads.
    expect(TestBed.inject(NOW)()).not.toBe(first);
  });

  it('can be replaced by a fixed date', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: NOW, useValue: () => new Date(2026, 10, 25, 9, 30) }],
    });

    expect(TestBed.inject(NOW)().getDate()).toBe(25);
  });
});
