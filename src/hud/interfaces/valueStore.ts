/** The smallest possible external store: a value, a setter and subscribers. React reads it through `useStoreValue`. */
export class ValueStore<T> {
  private readonly listeners = new Set<() => void>();

  constructor(private value: T) {}

  readonly get = (): T => this.value;

  set(value: T): void {
    if (Object.is(value, this.value)) return;
    this.value = value;
    for (const listener of this.listeners) listener();
  }

  update(change: (current: T) => T): void {
    this.set(change(this.value));
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}
