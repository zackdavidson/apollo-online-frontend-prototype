import { useEffect, useState } from 'react';
import { useServices, useStoreValue, type InterfaceViewProps } from './context';

/**
 * Interface 1, the side panel: a strip of tab buttons over a content area,
 * old-school style. Tabs come from the shared `tabs` store so the game can
 * add or replace them at runtime; the active tab follows prop `tab` when a
 * server sets it, otherwise whatever the player clicked last.
 */
export function InventoryInterface({ props }: InterfaceViewProps) {
  const { tabs: tabStore } = useServices();
  const tabs = useStoreValue(tabStore);
  const requested = typeof props['tab'] === 'number' ? props['tab'] : null;
  const [active, setActive] = useState<number | null>(requested ?? tabs[0]?.id ?? null);

  useEffect(() => {
    if (requested !== null) setActive(requested);
  }, [requested]);

  const current = tabs.find((tab) => tab.id === active) ?? tabs[0] ?? null;
  const Content = current?.Component ?? null;

  return (
    <div className="hud ui-inventory ornate">
      <div className="inv-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`inv-tab${current?.id === tab.id ? ' active' : ''}`}
            title={tab.label}
            data-tab={tab.id}
            data-component-id={tab.id}
            onClick={() => setActive(tab.id)}
          >
            {tab.icon ? <span className="inv-tab-icon">{tab.icon}</span> : null}
            <span className="inv-tab-label">{tab.label}</span>
          </button>
        ))}
      </div>
      <div className="inv-content">{Content ? <Content key={current?.id} /> : null}</div>
    </div>
  );
}
