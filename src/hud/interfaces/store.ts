/**
 * The interface model, free of React and the DOM so it can be unit tested
 * and, one day, mirrored on a server. Five slots, one interface open per
 * slot, everything addressed by numeric id. React renders from
 * `getSnapshot()`; the session drives it through the methods or through
 * server-shaped `InterfaceCommand`s.
 */
export type InterfaceSlot = 'chat' | 'inventory' | 'main' | 'overlay' | 'full_overlay';

export const INTERFACE_SLOTS: readonly InterfaceSlot[] = ['overlay', 'chat', 'inventory', 'main', 'full_overlay'];

/** Server-friendly description of an interface. */
export interface InterfaceInfo {
  readonly id: number;
  readonly name: string;
  readonly slot: InterfaceSlot;
  readonly open: boolean;
}

export type InterfaceProps = Readonly<Record<string, unknown>>;

/**
 * An interface as the store knows it: id, slot, name and the view that
 * renders it. `View` is generic so this file needs no React; the React layer
 * instantiates it with a component type.
 */
export interface InterfaceDefinition<View> {
  readonly id: number;
  readonly slot: InterfaceSlot;
  readonly name: string;
  readonly view: View;
}

export interface OpenInterface {
  readonly id: number;
  readonly slot: InterfaceSlot;
  readonly props: InterfaceProps;
}

export interface InterfaceSnapshot {
  readonly open: readonly OpenInterface[];
}

/**
 * What a server (or a chat command standing in for one) can tell the client
 * to do. `props` are interface specific: the panel takes `{ title, lines }`,
 * the notice `{ title, body }`, the side panel `{ tab }`.
 */
export type InterfaceCommand =
  | { readonly type: 'interface-open'; readonly id: number; readonly props?: InterfaceProps }
  | { readonly type: 'interface-close'; readonly id: number }
  | { readonly type: 'interface-close-slot'; readonly slot: InterfaceSlot }
  | { readonly type: 'interface-set'; readonly id: number; readonly props: InterfaceProps };

export type InterfaceChange = { readonly id: number; readonly open: boolean };

export class InterfaceStore<View = unknown> {
  private readonly registry = new Map<number, InterfaceDefinition<View>>();
  private readonly openBySlot = new Map<InterfaceSlot, { id: number; props: InterfaceProps }>();
  private readonly listeners = new Set<() => void>();
  private readonly changeListeners = new Set<(change: InterfaceChange) => void>();
  private snapshot: InterfaceSnapshot = { open: [] };

  register(definition: InterfaceDefinition<View>): InterfaceDefinition<View> {
    const existing = this.registry.get(definition.id);
    if (existing) throw new Error(`Interface id ${definition.id} is already registered (${existing.name})`);
    this.registry.set(definition.id, definition);
    return definition;
  }

  get(id: number): InterfaceDefinition<View> | undefined {
    return this.registry.get(id);
  }

  list(): InterfaceInfo[] {
    return [...this.registry.values()].map((definition) => ({ id: definition.id, name: definition.name, slot: definition.slot, open: this.isOpen(definition.id) }));
  }

  isOpen(id: number): boolean {
    const definition = this.registry.get(id);
    return definition !== undefined && this.openBySlot.get(definition.slot)?.id === id;
  }

  /** The interface open in a slot, if any. */
  openIn(slot: InterfaceSlot): OpenInterface | null {
    const entry = this.openBySlot.get(slot);
    return entry ? { id: entry.id, slot, props: entry.props } : null;
  }

  propsOf(id: number): InterfaceProps {
    const definition = this.registry.get(id);
    const entry = definition && this.openBySlot.get(definition.slot);
    return entry?.id === id ? entry.props : {};
  }

  /** Open an interface by id; whatever was in its slot closes first. False for an unknown id. */
  open(id: number, props?: InterfaceProps): boolean {
    const definition = this.registry.get(id);
    if (!definition) return false;
    const current = this.openBySlot.get(definition.slot);
    if (current && current.id !== id) this.close(current.id);
    if (current?.id === id) {
      if (props) this.openBySlot.set(definition.slot, { id, props: { ...current.props, ...props } });
      this.publish();
      return true;
    }
    this.openBySlot.set(definition.slot, { id, props: props ?? {} });
    this.publish();
    this.emit({ id, open: true });
    return true;
  }

  close(id: number): boolean {
    const definition = this.registry.get(id);
    if (!definition || this.openBySlot.get(definition.slot)?.id !== id) return false;
    this.openBySlot.delete(definition.slot);
    this.publish();
    this.emit({ id, open: false });
    return true;
  }

  closeSlot(slot: InterfaceSlot): boolean {
    const current = this.openBySlot.get(slot);
    return current ? this.close(current.id) : false;
  }

  /** Close the topmost dismissable layer: a full overlay first, then the main window. Returns what closed. */
  closeTopmost(): OpenInterface | null {
    for (const slot of ['full_overlay', 'main'] as const) {
      const current = this.openIn(slot);
      if (current) {
        this.close(current.id);
        return current;
      }
    }
    return null;
  }

  toggle(id: number, props?: InterfaceProps): boolean {
    if (this.isOpen(id)) {
      this.close(id);
      return false;
    }
    return this.open(id, props);
  }

  /** Merge props into an open interface (a closed one just gets them when it opens next). */
  setProps(id: number, props: InterfaceProps): boolean {
    const definition = this.registry.get(id);
    if (!definition) return false;
    const current = this.openBySlot.get(definition.slot);
    if (current?.id === id) {
      this.openBySlot.set(definition.slot, { id, props: { ...current.props, ...props } });
      this.publish();
    } else {
      this.pendingProps.set(id, { ...(this.pendingProps.get(id) ?? {}), ...props });
    }
    return true;
  }
  private readonly pendingProps = new Map<number, InterfaceProps>();

  /** Apply a server command; returns an error message for a bad one, else null. */
  apply(command: InterfaceCommand): string | null {
    switch (command.type) {
      case 'interface-open': {
        const pending = this.pendingProps.get(command.id);
        this.pendingProps.delete(command.id);
        const props = pending || command.props ? { ...(pending ?? {}), ...(command.props ?? {}) } : undefined;
        return this.open(command.id, props) ? null : `No interface with id ${command.id}.`;
      }
      case 'interface-close':
        if (!this.registry.has(command.id)) return `No interface with id ${command.id}.`;
        this.close(command.id);
        return null;
      case 'interface-close-slot':
        if (!INTERFACE_SLOTS.includes(command.slot)) return `No slot named "${String(command.slot)}".`;
        this.closeSlot(command.slot);
        return null;
      case 'interface-set':
        return this.setProps(command.id, command.props) ? null : `No interface with id ${command.id}.`;
    }
  }

  // ---- subscriptions (React uses subscribe + getSnapshot) --------------------

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): InterfaceSnapshot => this.snapshot;

  onChange(listener: (change: InterfaceChange) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private publish(): void {
    this.snapshot = { open: INTERFACE_SLOTS.flatMap((slot) => this.openIn(slot) ?? []) };
    for (const listener of this.listeners) listener();
  }

  private emit(change: InterfaceChange): void {
    for (const listener of this.changeListeners) listener(change);
  }
}

/**
 * Parse a `/ui ...` chat command into an InterfaceCommand, standing in for a
 * server until there is one. Returns 'list' or a usage string otherwise.
 *
 *   /ui open 4 title=Objectives lines=Mine iron|Talk to the Navigator
 *   /ui close 4 · /ui close-slot main · /ui set 1 tab=2 · /ui list
 */
export function parseInterfaceCommand(args: readonly string[]): InterfaceCommand | 'list' | string {
  const [verb, target, ...rest] = args;
  const usage = 'Usage: /ui open <id> [key=value ...] · /ui close <id> · /ui close-slot <slot> · /ui set <id> key=value ... · /ui list';
  if (!verb || verb === 'help') return usage;
  if (verb === 'list') return 'list';
  if (verb === 'close-slot') {
    return target && (INTERFACE_SLOTS as readonly string[]).includes(target) ? { type: 'interface-close-slot', slot: target as InterfaceSlot } : `Slots: ${INTERFACE_SLOTS.join(', ')}.`;
  }
  const id = Number(target);
  if (!Number.isInteger(id)) return usage;
  const props = parseProps(rest);
  if (verb === 'open') return { type: 'interface-open', id, ...(Object.keys(props).length ? { props } : {}) };
  if (verb === 'close') return { type: 'interface-close', id };
  if (verb === 'set') return { type: 'interface-set', id, props };
  return usage;
}

/** `key=value` words; a value containing `|` becomes a list, a numeric one a number. */
function parseProps(words: readonly string[]): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const joined = words.join(' ');
  for (const match of joined.matchAll(/(\w+)=((?:(?!\s\w+=).)*)/g)) {
    const key = match[1]!;
    const raw = match[2]!.trim();
    props[key] = raw.includes('|') ? raw.split('|').map((part) => part.trim()) : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
  }
  return props;
}
