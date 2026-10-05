import { createContext, useContext, useSyncExternalStore } from 'react';
import type { ComponentType } from 'react';
import type { ChatController } from './chat';
import type { InterfaceProps, InterfaceStore } from './store';
import type { ValueStore } from './valueStore';

/** What an interface view receives: its id, its live props from the store, and a way to close itself. */
export interface InterfaceViewProps {
  readonly id: number;
  readonly props: InterfaceProps;
  close(): void;
}

export type InterfaceView = ComponentType<InterfaceViewProps>;

/** A tab of the side panel: an id (its component id), a label, an optional glyph and the component that renders it. */
export interface InventoryTab {
  readonly id: number;
  readonly label: string;
  readonly icon?: string;
  readonly Component: ComponentType;
}

/** The HUD-side bridge for the map window: React owns the frame, the HUD draws the canvas. */
export interface MapWindowBridge {
  readonly title: ValueStore<string>;
  readonly cursor: ValueStore<string>;
  /** React hands the canvas over on mount (and null on unmount); the HUD sizes and draws it. */
  attach(canvas: HTMLCanvasElement | null): void;
  onPointerDown(event: PointerEvent): void;
  onPointerMove(event: PointerEvent): void;
  onPointerLeave(): void;
}

/** Everything interface views may reach: shared stores, controllers and the HUD's actions. */
export interface HudServices<Info = unknown, Actions = unknown> {
  readonly interfaces: InterfaceStore<InterfaceView>;
  readonly chat: ChatController;
  readonly tabs: ValueStore<readonly InventoryTab[]>;
  readonly info: ValueStore<Info | null>;
  /** Item sprite data URLs by item id, rendered once by the scene. */
  readonly itemIcons: ValueStore<Readonly<Record<string, string>>>;
  readonly actions: Actions;
  readonly controls: ReadonlyArray<readonly [string, string]>;
  readonly map: MapWindowBridge;
}

export const ServicesContext = createContext<HudServices | null>(null);

export function useServices<Info = unknown, Actions = unknown>(): HudServices<Info, Actions> {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('Interface rendered outside the HUD services provider');
  return services as HudServices<Info, Actions>;
}

export function useStoreValue<T>(store: ValueStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
