type Listener = (...args: unknown[]) => void;

/**
 * A minimal event emitter for the Parse SDK. The SDK's browser build gets its emitter with
 * `require('events')` inside a try/catch, which no browser bundler resolves (`events` is a Node module
 * and not a dependency here): the require fails silently, the emitter stays undefined, and
 * `Parse.initialize` then throws « EventEmitter is not a constructor » (it builds its LiveQuery client
 * at start-up), so nothing could ever be sent to the server. `ensureSdk` hands this class to the SDK
 * before initializing it. LiveQuery is not used: this only has to exist and behave like a basic emitter.
 */
export class MinimalEventEmitter {
  private readonly handlers = new Map<
    string | symbol,
    Array<{ listener: Listener; once: boolean }>
  >();

  on(event: string | symbol, listener: Listener): this {
    return this.add(event, listener, false);
  }

  addListener(event: string | symbol, listener: Listener): this {
    return this.add(event, listener, false);
  }

  once(event: string | symbol, listener: Listener): this {
    return this.add(event, listener, true);
  }

  off(event: string | symbol, listener: Listener): this {
    return this.removeListener(event, listener);
  }

  removeListener(event: string | symbol, listener: Listener): this {
    const list = this.handlers.get(event);
    if (list) {
      const index = list.findIndex((entry) => entry.listener === listener);
      if (index !== -1) {
        list.splice(index, 1);
      }
    }
    return this;
  }

  removeAllListeners(event?: string | symbol): this {
    if (event === undefined) {
      this.handlers.clear();
    } else {
      this.handlers.delete(event);
    }
    return this;
  }

  emit(event: string | symbol, ...args: unknown[]): boolean {
    const list = this.handlers.get(event);
    if (!list || list.length === 0) {
      return false;
    }
    // A copy: listeners may add or remove listeners while they run.
    for (const entry of [...list]) {
      if (entry.once) {
        this.removeListener(event, entry.listener);
      }
      entry.listener(...args);
    }
    return true;
  }

  listenerCount(event: string | symbol): number {
    return this.handlers.get(event)?.length ?? 0;
  }

  private add(event: string | symbol, listener: Listener, once: boolean): this {
    const list = this.handlers.get(event) ?? [];
    list.push({ listener, once });
    this.handlers.set(event, list);
    return this;
  }
}
