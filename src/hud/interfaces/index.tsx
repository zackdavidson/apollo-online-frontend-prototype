import { createRoot, type Root } from 'react-dom/client';
import { ServicesContext, type HudServices, type InterfaceView } from './context';
import { InterfaceRoot } from './InterfaceRoot';
import type { InterfaceChange, InterfaceCommand, InterfaceInfo, InterfaceProps, InterfaceSlot, InterfaceStore, OpenInterface } from './store';

export { ChatController } from './chat';
export type { ChatMessage, DialogueLine, DialogueScript } from './chat';
export { ChatInterface } from './ChatInterface';
export { InventoryInterface } from './InventoryInterface';
export { HelpInterface, MapInterface, NoticeInterface, PanelInterface } from './panels';
export { INTERFACE_SLOTS, InterfaceStore, parseInterfaceCommand } from './store';
export type { InterfaceCommand, InterfaceDefinition, InterfaceInfo, InterfaceSlot } from './store';
export { ServicesContext, useServices, useStoreValue } from './context';
export type { HudServices, InterfaceView, InterfaceViewProps, InventoryTab, MapWindowBridge, MenuState } from './context';
export { ValueStore } from './valueStore';

/** Well-known interface ids. The chat is 0 by decree; the rest follow. */
export const INTERFACE_IDS = { chat: 0, inventory: 1, map: 2, help: 3, panel: 4, notice: 5 } as const;

/**
 * Mounts the React interface tree into the HUD and exposes the store's
 * imperative API, so the session (and a server through `apply`) can open
 * and close interfaces without touching React.
 */
export class InterfaceManager {
  private readonly container: HTMLElement;
  private readonly reactRoot: Root;

  constructor(
    host: HTMLElement,
    private readonly store: InterfaceStore<InterfaceView>,
    services: HudServices,
  ) {
    this.container = document.createElement('div');
    this.container.className = 'ui-slots-host';
    host.append(this.container);
    this.reactRoot = createRoot(this.container);
    this.reactRoot.render(
      <ServicesContext.Provider value={services}>
        <InterfaceRoot store={store} />
      </ServicesContext.Provider>,
    );
  }

  open(id: number, props?: InterfaceProps): boolean {
    return this.store.open(id, props);
  }

  close(id: number): boolean {
    return this.store.close(id);
  }

  closeSlot(slot: InterfaceSlot): boolean {
    return this.store.closeSlot(slot);
  }

  closeTopmost(): OpenInterface | null {
    return this.store.closeTopmost();
  }

  toggle(id: number, props?: InterfaceProps): boolean {
    return this.store.toggle(id, props);
  }

  isOpen(id: number): boolean {
    return this.store.isOpen(id);
  }

  setProps(id: number, props: InterfaceProps): boolean {
    return this.store.setProps(id, props);
  }

  list(): InterfaceInfo[] {
    return this.store.list();
  }

  apply(command: InterfaceCommand): string | null {
    return this.store.apply(command);
  }

  onChange(listener: (change: InterfaceChange) => void): () => void {
    return this.store.onChange(listener);
  }

  dispose(): void {
    this.reactRoot.unmount();
    this.container.remove();
  }
}
