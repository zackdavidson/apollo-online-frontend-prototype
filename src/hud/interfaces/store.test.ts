import { describe, expect, it, vi } from 'vitest';
import { InterfaceStore, parseInterfaceCommand } from './store';

const store = (): InterfaceStore<string> => {
  const s = new InterfaceStore<string>();
  s.register({ id: 0, slot: 'chat', name: 'Chat', view: 'chat' });
  s.register({ id: 1, slot: 'inventory', name: 'Side panel', view: 'inv' });
  s.register({ id: 2, slot: 'main', name: 'Map', view: 'map' });
  s.register({ id: 3, slot: 'main', name: 'Controls', view: 'help' });
  s.register({ id: 4, slot: 'overlay', name: 'Panel', view: 'panel' });
  s.register({ id: 5, slot: 'full_overlay', name: 'Notice', view: 'notice' });
  return s;
};

describe('InterfaceStore', () => {
  it('opens one interface per slot, replacing what was there, and snapshots the open set', () => {
    const s = store();
    const listener = vi.fn();
    s.subscribe(listener);
    expect(s.open(0)).toBe(true);
    expect(s.open(2)).toBe(true);
    expect(s.getSnapshot().open.map((o) => o.id)).toEqual([0, 2]);
    s.open(3);
    expect(s.isOpen(2)).toBe(false);
    expect(s.isOpen(3)).toBe(true);
    expect(s.openIn('main')?.id).toBe(3);
    expect(s.open(99)).toBe(false);
    expect(listener).toHaveBeenCalled();
    expect(() => s.register({ id: 0, slot: 'chat', name: 'Again', view: 'x' })).toThrow(/already registered/);
  });

  it('carries props, merges updates, and keeps props sent to a closed interface for its next open', () => {
    const s = store();
    s.open(4, { title: 'Objectives', lines: ['a'] });
    expect(s.propsOf(4)).toEqual({ title: 'Objectives', lines: ['a'] });
    s.setProps(4, { lines: ['a', 'b'] });
    expect(s.propsOf(4)).toEqual({ title: 'Objectives', lines: ['a', 'b'] });
    s.close(4);
    expect(s.propsOf(4)).toEqual({});
    expect(s.apply({ type: 'interface-set', id: 5, props: { title: 'Later' } })).toBeNull();
    expect(s.apply({ type: 'interface-open', id: 5, props: { body: 'now' } })).toBeNull();
    expect(s.propsOf(5)).toEqual({ title: 'Later', body: 'now' });
  });

  it('closes the topmost layer first and reports changes', () => {
    const s = store();
    const changes: Array<{ id: number; open: boolean }> = [];
    s.onChange((change) => changes.push(change));
    s.open(2);
    s.open(5);
    expect(s.closeTopmost()?.id).toBe(5);
    expect(s.closeTopmost()?.id).toBe(2);
    expect(s.closeTopmost()).toBeNull();
    expect(changes).toEqual([
      { id: 2, open: true },
      { id: 5, open: true },
      { id: 5, open: false },
      { id: 2, open: false },
    ]);
    expect(s.toggle(3)).toBe(true);
    expect(s.toggle(3)).toBe(false);
  });

  it('applies server commands and explains bad ones', () => {
    const s = store();
    expect(s.apply({ type: 'interface-open', id: 1 })).toBeNull();
    expect(s.apply({ type: 'interface-open', id: 42 })).toMatch(/No interface with id 42/);
    expect(s.apply({ type: 'interface-close', id: 42 })).toMatch(/No interface/);
    expect(s.apply({ type: 'interface-close-slot', slot: 'inventory' })).toBeNull();
    expect(s.isOpen(1)).toBe(false);
    expect(s.apply({ type: 'interface-close-slot', slot: 'sideways' as never })).toMatch(/No slot/);
    expect(s.list().map((info) => `${info.id}:${info.slot}`)).toEqual(['0:chat', '1:inventory', '2:main', '3:main', '4:overlay', '5:full_overlay']);
  });
});

describe('parseInterfaceCommand', () => {
  it('parses open, close, set, close-slot and list', () => {
    expect(parseInterfaceCommand(['open', '4'])).toEqual({ type: 'interface-open', id: 4 });
    expect(parseInterfaceCommand(['open', '4', 'title=Objectives', 'lines=Mine', 'iron|Talk', 'to', 'the', 'Navigator'])).toEqual({
      type: 'interface-open',
      id: 4,
      props: { title: 'Objectives', lines: ['Mine iron', 'Talk to the Navigator'] },
    });
    expect(parseInterfaceCommand(['close', '2'])).toEqual({ type: 'interface-close', id: 2 });
    expect(parseInterfaceCommand(['set', '1', 'tab=2'])).toEqual({ type: 'interface-set', id: 1, props: { tab: 2 } });
    expect(parseInterfaceCommand(['close-slot', 'main'])).toEqual({ type: 'interface-close-slot', slot: 'main' });
    expect(parseInterfaceCommand(['list'])).toBe('list');
  });

  it('returns usage text for anything malformed', () => {
    expect(parseInterfaceCommand([])).toMatch(/Usage/);
    expect(parseInterfaceCommand(['open', 'chat'])).toMatch(/Usage/);
    expect(parseInterfaceCommand(['explode', '1'])).toMatch(/Usage/);
    expect(parseInterfaceCommand(['close-slot', 'sideways'])).toMatch(/Slots:/);
  });
});
