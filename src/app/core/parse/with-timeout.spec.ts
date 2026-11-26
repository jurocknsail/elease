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

  it('honours a custom delay', async () => {
    const outcome = withTimeout(new Promise<never>(() => undefined), 500).then(
      () => 'resolved',
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(500);

    expect(await outcome).toBeInstanceOf(BackendTimeoutError);
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

  it('clears its timer once a slow promise settles in time', async () => {
    let resolve: (value: string) => void = () => undefined;
    const slow = new Promise<string>((r) => (resolve = r));
    const result = withTimeout(slow, 1000);

    await vi.advanceTimersByTimeAsync(999);
    resolve('late but in time');

    await expect(result).resolves.toBe('late but in time');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not leak an unhandled rejection when the promise fails after the timeout', async () => {
    let reject: (reason: unknown) => void = () => undefined;
    const slow = new Promise<never>((_, r) => (reject = r));
    const outcome = withTimeout(slow, 100).then(
      () => 'resolved',
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(100);
    expect(await outcome).toBeInstanceOf(BackendTimeoutError);

    // The Vitest run fails on any unhandled rejection: this one must be swallowed.
    reject(new Error('too late'));
    await vi.advanceTimersByTimeAsync(10);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps instanceof and name working for the subclass', () => {
    const error = new BackendTimeoutError();

    expect(error instanceof BackendTimeoutError).toBe(true);
    expect(error instanceof Error).toBe(true);
    expect(error.name).toBe('BackendTimeoutError');
    expect(Object.prototype.toString.call(error)).toBe('[object Error]');
  });
});
