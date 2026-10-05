export type Listener<T> = (state: T, previous: T) => void;
export type Unsubscribe = () => void;

/** Minimal observable value holder. State is treated as immutable. */
export class Store<T> {
  private state: T;
  private readonly listeners = new Set<Listener<T>>();

  constructor(initial: T) {
    this.state = initial;
  }

  get(): T {
    return this.state;
  }

  set(next: T): void {
    if (Object.is(next, this.state)) return;
    const previous = this.state;
    this.state = next;
    for (const listener of this.listeners) listener(next, previous);
  }

  update(reducer: (state: T) => T): void {
    this.set(reducer(this.state));
  }

  subscribe(listener: Listener<T>): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
