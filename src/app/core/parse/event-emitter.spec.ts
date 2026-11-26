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
