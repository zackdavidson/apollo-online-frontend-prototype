/**
 * Undo history over immutable snapshots. `push` records a step; `replace`
 * amends the present without one (for the many moves inside a single drag),
 * so Ctrl+Z steps back over whole gestures.
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private current: T;

  constructor(
    initial: T,
    private readonly limit = 200,
  ) {
    this.current = initial;
  }

  get present(): T {
    return this.current;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  push(next: T): T {
    if (next === this.current) return next;
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.current = next;
    return next;
  }

  replace(next: T): T {
    this.current = next;
    return next;
  }

  undo(): T | null {
    const previous = this.past.pop();
    if (previous === undefined) return null;
    this.future.push(this.current);
    this.current = previous;
    return previous;
  }

  redo(): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.current);
    this.current = next;
    return next;
  }
}
