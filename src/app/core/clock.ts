import { InjectionToken } from '@angular/core';

/**
 * The current date and time, as a `Date` (local time). Screens that depend on the day of the month
 * (the billing period, the reminder banner) read it from here, so that specs can supply a fixed one.
 * `SEND_CLOCK` is the sender's separate clock: it returns milliseconds, stamped on the leases of a send.
 */
export const NOW = new InjectionToken<() => Date>('NOW', {
  providedIn: 'root',
  factory: () => () => new Date(),
});
