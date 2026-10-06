import { useState } from 'react';
import { createPortal } from 'react-dom';
import { RESOURCES, RESOURCE_KINDS, inventoryValue } from '../../game/loot';
import { talentAssetPath, totalLevel } from '../../game/talents';
import type { HudActions, HudInfo } from '../hud';
import { useServices, useStoreValue, type InventoryTab } from './context';

/** Slots shown in the hold, filled first, the rest empty, like an old-school inventory. */
const INVENTORY_SLOTS = 16;

/** The latest HUD readout, refreshed a few times a second. */
function useHudInfo(): HudInfo | null {
  const { info } = useServices<HudInfo, HudActions>();
  return useStoreValue(info);
}

/** Old-school inventory: a grid of item sprites with stack counts, rendered once from each item's 3D model. */
export function CargoTab() {
  const info = useHudInfo();
  const { itemIcons } = useServices<HudInfo, HudActions>();
  const icons = useStoreValue(itemIcons);
  const { actions } = useServices<HudInfo, HudActions>();
  const held = RESOURCE_KINDS.filter((kind) => (info?.cargo[kind] ?? 0) > 0);
  const vacant = Math.max(0, INVENTORY_SLOTS - held.length);
  return (
    <>
      <div className="cargo-grid">
        {held.map((kind) => {
          const count = info?.cargo[kind] ?? 0;
          const icon = icons[kind];
          const target = { kind: 'inventory', item: kind, count } as const;
          return (
            <div
              key={kind}
              className="cargo-slot"
              title={`${RESOURCES[kind].label} × ${count} · right-click for options`}
              style={{ borderColor: RESOURCES[kind].colour }}
              onClick={(event) => actions.onItemMenu(target, event.clientX, event.clientY, true)}
              onContextMenu={(event) => {
                event.preventDefault();
                actions.onItemMenu(target, event.clientX, event.clientY, false);
              }}
            >
              {icon ? <img className="cargo-icon" src={icon} alt="" draggable={false} /> : <span className="cargo-icon-fallback" style={{ background: RESOURCES[kind].colour }} />}
              <span className="cargo-badge">{count}</span>
              <span className="cargo-name" style={{ color: RESOURCES[kind].colour }}>
                {RESOURCES[kind].label}
              </span>
            </div>
          );
        })}
        {Array.from({ length: vacant }, (_, index) => (
          <div key={`vacant-${index}`} className="cargo-slot vacant" />
        ))}
      </div>
      <div className="muted inv-footer">{held.length === 0 ? 'Hold empty' : info ? `worth ${inventoryValue(info.cargo)} · rocks broken ${info.rocksBroken}` : ''}</div>
    </>
  );
}

export function ShipTab() {
  const info = useHudInfo();
  const { actions, itemIcons } = useServices<HudInfo, HudActions>();
  const icons = useStoreValue(itemIcons);
  if (!info) return null;
  const { ship } = info;
  return (
    <>
      <div className="inv-ship-name">{ship.name}</div>
      <div className="muted">{ship.hullName}</div>
      <div className="inv-bar">
        <div className="label-fill label-fill-shield" style={{ width: `${(100 * ship.shield) / Math.max(1, ship.maxShield)}%` }} />
      </div>
      <div className="inv-bar-text">
        shield {Math.ceil(ship.shield)} / {ship.maxShield}
      </div>
      <div className="inv-bar">
        <div className="label-fill label-fill-hull" style={{ width: `${(100 * ship.hull) / Math.max(1, ship.maxHull)}%` }} />
      </div>
      <div className="inv-bar-text">
        hull {Math.ceil(ship.hull)} / {ship.maxHull}
      </div>
      <div className="inv-weapons">
        {info.fitted.length === 0 ? <div className="muted">Nothing fitted; the token nose gun will have to do.</div> : null}
        {info.fitted.map((fit) => {
          const target = { kind: 'equipped', itemId: fit.itemId, group: fit.group } as const;
          const active = info.weapons.find((group) => group.id === fit.group)?.active;
          return (
            <div
              key={fit.itemId}
              className={`fitted-item${active ? ' active' : ''}`}
              title="right-click for options"
              onClick={(event) => actions.onItemMenu(target, event.clientX, event.clientY, true)}
              onContextMenu={(event) => {
                event.preventDefault();
                actions.onItemMenu(target, event.clientX, event.clientY, false);
              }}
            >
              {icons[fit.itemId] ? <img className="fitted-icon" src={icons[fit.itemId]} alt="" draggable={false} /> : null}
              <span className="fitted-name">{fit.name}</span>
              <span className="muted fitted-group">
                {info.weapons.find((group) => group.id === fit.group)?.key} · {fit.mounts > 1 ? `×${fit.mounts}` : ''}
              </span>
            </div>
          );
        })}
      </div>
      <div className="muted inv-footer">
        kills {info.kills} · deaths {info.deaths}
      </div>
    </>
  );
}

/**
 * The talents tab: a skills grid in the old-school style, icon on the left
 * and current/base level on the right, with the total at the bottom and a
 * tooltip for whatever is hovered. Levels come from the HUD readout, so a
 * server can raise them later; nothing trains them yet.
 */
export function TalentsTab() {
  const info = useHudInfo();
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const talents = info?.talents ?? [];
  const shown = hover ? (talents.find((talent) => talent.id === hover.id) ?? null) : null;
  return (
    <>
      <div className="talent-grid">
        {talents.map((talent, index) => (
          <div
            key={talent.id}
            className={`talent-cell${hover?.id === talent.id ? ' hovered' : ''}`}
            data-component-id={index}
            data-talent={talent.id}
            onPointerEnter={(event) => setHover({ id: talent.id, x: event.clientX, y: event.clientY })}
            onPointerMove={(event) => setHover({ id: talent.id, x: event.clientX, y: event.clientY })}
            onPointerLeave={() => setHover((current) => (current?.id === talent.id ? null : current))}
          >
            <img className="talent-icon" src={`${import.meta.env.BASE_URL}${talentAssetPath(talent.icon)}`} alt={talent.name} draggable={false} />
            <span className="talent-levels">
              <span className="talent-level">{talent.level}</span>
              <span className="talent-slash">/</span>
              <span className="talent-base">{talent.base}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="talent-total">
        <span>Total level</span>
        <b>{totalLevel(talents)}</b>
      </div>
      {shown && hover
        ? createPortal(
            // On the body, not in the panel: the panel clips its overflow and would cut the tooltip off.
            <div className="talent-tooltip" style={{ right: window.innerWidth - hover.x + 12, bottom: window.innerHeight - hover.y + 12 }}>
              <div className="talent-tooltip-name">
                {shown.name} <span className="muted talent-tooltip-group">· {shown.group}</span>
              </div>
              <div>{shown.description}</div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** The side panel's default tabs: ship, cargo and talents; cargo opens first. Games add their own through the tabs store. */
export function defaultTabs(): InventoryTab[] {
  return [
    { id: 0, label: 'Ship', icon: '➤', Component: ShipTab },
    { id: 1, label: 'Cargo', icon: '◆', Component: CargoTab, default: true },
    { id: 2, label: 'Talents', icon: '✦', Component: TalentsTab },
  ];
}
