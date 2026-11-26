export const DEFAULT_TIMEOUT_MS = 20000;

/** The backend did not answer in time (Back4App requests can hang for a minute or more). */
export class BackendTimeoutError extends Error {
  constructor(message = 'Le serveur ne répond pas.') {
    super(message);
    // Native class syntax (ES2022 target): `instanceof` works without setPrototypeOf.
    this.name = 'BackendTimeoutError';
  }
}

/**
 * Settles like `promise`, or rejects with `BackendTimeoutError` after `ms`. The timer is always
 * cleared once the promise settles, and a late rejection of `promise` after the timeout is absorbed
 * (no unhandled rejection). The underlying request is not cancelled: the SDK offers no way to do it.
 */
export function withTimeout<T>(promise: Promise<T>, ms = DEFAULT_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new BackendTimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
