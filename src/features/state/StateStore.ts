
import { eventBus } from '../../core';

export abstract class StateStore<T extends object> {
  protected abstract state: T;
  private listeners = new Set<(state: Readonly<T>) => void>();

  subscribe(listener: (state: Readonly<T>) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): Readonly<T> {
    return this.state;
  }

  protected update(partial: Partial<T>, eventName?: string, eventPayload?: unknown): void {
    if (Object.keys(partial).length > 0) {
      // 使用Object.assign就地修改，保持隐藏类稳定
      Object.assign(this.state, partial);
    }
    this.notifyListeners();
    if (eventName) {
      const payload = eventPayload !== undefined ? eventPayload : this.getState();
      eventBus.emit(eventName, payload);
    }
  }

  protected reset(): void {
    this.listeners.clear();
  }

  private notifyListeners(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
