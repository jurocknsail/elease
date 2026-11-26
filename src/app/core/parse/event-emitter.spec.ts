import { MinimalEventEmitter } from './event-emitter';

describe('MinimalEventEmitter', () => {
  it('calls the listeners of an event, in order, with the arguments, and says whether any heard it', () => {
    const emitter = new MinimalEventEmitter();
    const calls: unknown[][] = [];
    emitter.on('open', (...args) => calls.push(['a', ...args]));
    emitter.addListener('open', (...args) => calls.push(['b', ...args]));

    expect(emitter.emit('open', 1, 'x')).toBe(true);
    expect(emitter.emit('close')).toBe(false);

    expect(calls).toEqual([
      ['a', 1, 'x'],
      ['b', 1, 'x'],
    ]);
  });

  it('once listeners run once', () => {
    const emitter = new MinimalEventEmitter();
    const listener = vi.fn();
    emitter.once('error', listener);

    emitter.emit('error', 'boom');
    emitter.emit('error', 'again');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('boom');
    expect(emitter.listenerCount('error')).toBe(0);
  });

  it('removes one listener or all of them', () => {
    const emitter = new MinimalEventEmitter();
    const kept = vi.fn();
    const removed = vi.fn();
    emitter.on('a', kept).on('a', removed);

    emitter.off('a', removed);
    emitter.emit('a');
    expect(kept).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
    expect(emitter.listenerCount('a')).toBe(1);

    emitter.on('b', kept);
    emitter.removeAllListeners('a');
    expect(emitter.listenerCount('a')).toBe(0);
    expect(emitter.listenerCount('b')).toBe(1);
    emitter.removeAllListeners();
    expect(emitter.listenerCount('b')).toBe(0);
  });

  it('tolerates listeners that add or remove listeners while running', () => {
    const emitter = new MinimalEventEmitter();
    const late = vi.fn();
    emitter.on('a', () => emitter.on('a', late));

    emitter.emit('a');
    expect(late).not.toHaveBeenCalled();
    emitter.emit('a');
    expect(late).toHaveBeenCalledTimes(1);
  });
});
