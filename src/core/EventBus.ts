
export class EventBus {
  private channels: Map<string, Set<(...args: unknown[]) => void>> = new Map();

  on<T extends unknown[]>(
    event: string,
    handler: (...args: T) => void
  ): () => void {
    if (!this.channels.has(event)) {
      this.channels.set(event, new Set());
    }
    const handlers = this.channels.get(event)!;
    const typedHandler = handler as (...args: unknown[]) => void;
    handlers.add(typedHandler);

    return () => {
      handlers.delete(typedHandler);
      if (handlers.size === 0) {
        this.channels.delete(event);
      }
    };
  }

  emit<T extends unknown[]>(event: string, ...args: T): void {
    const handlers = this.channels.get(event);
    if (!handlers) return;

    for (const handler of handlers) {
      handler(...args);
    }
  }

  removeAll(event?: string): void {
    if (event === undefined) {
      this.channels.clear();
    } else {
      this.channels.delete(event);
    }
  }
}

export const eventBus = new EventBus();
