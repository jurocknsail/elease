import { TestBed } from '@angular/core/testing';
import { environment } from '../../environments/environment';
import { APP_ENV, AppEnv } from './app-env';

describe('APP_ENV', () => {
  it('is the environment of the build by default (production comes from fileReplacements)', () => {
    // Identity check through Object.is: a failing `toBe` would print the whole environment.
    expect(Object.is(TestBed.inject(APP_ENV), environment)).toBe(true);
    expect(typeof TestBed.inject(APP_ENV).production).toBe('boolean');
    expect(typeof TestBed.inject(APP_ENV).sandbox).toBe('boolean');
  });

  it('can be replaced by a specs-only environment', () => {
    const fake: AppEnv = { production: true, sandbox: false, testRecipientEmail: 'a@example.test' };
    TestBed.configureTestingModule({ providers: [{ provide: APP_ENV, useValue: fake }] });
    expect(TestBed.inject(APP_ENV)).toBe(fake);
  });
});
