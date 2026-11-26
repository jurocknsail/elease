import { BackendTimeoutError, DEFAULT_TIMEOUT_MS, withTimeout } from './with-timeout';

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects with BackendTimeoutError when the promise never settles (default 20 s)', async () => {
    const outcome = withTimeout(new Promise<never>(() => undefined)).then(
      () => 'resolved',
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS - 1);
    expect(DEFAULT_TIMEOUT_MS).toBe(20000);
    // Still pending one millisecond before the deadline: race it against a sentinel.
    const pending = await Promise.race([outcome, Promise.resolve('pending')]);
    expect(pending).toBe('pending');

    await vi.advanceTimersByTimeAsync(1);
    const error = await outcome;
    expect(error).toBeInstanceOf(BackendTimeoutError);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe('BackendTimeoutError');
    expect((error as Error).message).toBe('Le serveur ne répond pas.');
  });

  it('resolves with the value and clears its timer', async () => {
    await expect(withTimeout(Promise.resolve(42))).resolves.toBe(42);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with the original error, unchanged, and clears its timer', async () => {
    const failure = Object.assign(new Error('Invalid session token'), { code: 209 });

    await expect(withTimeout(Promise.reject(failure))).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });
});
