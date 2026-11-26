import { InjectionToken } from '@angular/core';
import { environment } from '../../environments/environment';

/**
 * The part of the build environment that decides what may leave the application. `production` comes
 * from the build (`fileReplacements` swap `environment.ts` for `environment.prod.ts`), never from user
 * input or from a setting stored in the backend.
 */
export interface AppEnv {
  /** True only in the production build. */
  production: boolean;
  /** Mailjet sandbox flag of the production build; ignored (forced to true) everywhere else. */
  sandbox: boolean;
  /** The only recipient of an e-mail outside production. */
  testRecipientEmail?: string;
}

/**
 * The environment of the build. Code that sends e-mail reads it from here so that specs can supply
 * `{ production: false, ... }` or `{ production: true, ... }` without touching the real values.
 */
export const APP_ENV = new InjectionToken<AppEnv>('APP_ENV', {
  providedIn: 'root',
  factory: (): AppEnv => environment,
});
