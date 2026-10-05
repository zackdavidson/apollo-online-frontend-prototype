import { RESOURCES, RESOURCE_KINDS, inventoryValue } from '../../game/loot';
import { PIXEL_LEVELS, type PixelScope } from '../../scene/pixelate';
import type { HudActions, HudInfo } from '../hud';
import { useServices, useStoreValue, type InventoryTab } from './context';
import { INTERFACE_IDS } from './index';

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
  return (
    <>
      {held.length === 0 ? <div className="muted">Hold empty. Mine a rock and fly over what it drops.</div> : null}
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
      </div>
      <div className="muted inv-footer">{info ? `worth ${inventoryValue(info.cargo)} · rocks broken ${info.rocksBroken}` : ''}</div>
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

export function SettingsTab() {
  const { actions, interfaces } = useServices<HudInfo, HudActions>();
  const info = useHudInfo();
  return (
    <div className="inv-settings">
      <button type="button" onClick={() => actions.onToggleCamera()}>
        Camera: {info?.mode ?? 'perspective'}
      </button>
      <select title="Pixelation level (P)" value={String(info?.pixelLevel ?? 0)} onChange={(event) => actions.onPixelLevel(Number(event.target.value))}>
        {PIXEL_LEVELS.map((level, index) => (
          <option key={level.label} value={String(index)}>
            Pixels: {level.label}
          </option>
        ))}
      </select>
      <select title="What gets pixelated (O)" value={info?.pixelScope ?? '3d'} onChange={(event) => actions.onPixelScope(event.target.value as PixelScope)}>
        <option value="3d">3D only</option>
        <option value="all">Everything</option>
      </select>
      <button type="button" onClick={() => interfaces.toggle(INTERFACE_IDS.help)}>
        Controls
      </button>
      <button type="button" className="primary" onClick={() => actions.onExit()}>
        Back to hangar (Esc)
      </button>
    </div>
  );
}

export function ControlsTab() {
  const { controls } = useServices();
  return (
    <dl className="inv-controls">
      {controls.map(([key, what]) => (
        <div key={key} style={{ display: 'contents' }}>
          <dt>{key}</dt>
          <dd>{what}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The side panel's default tabs: cargo, ship, settings and controls. Games add their own through the tabs store. */
export function defaultTabs(): InventoryTab[] {
  return [
    { id: 0, label: 'Cargo', icon: '◆', Component: CargoTab },
    { id: 1, label: 'Ship', icon: '➤', Component: ShipTab },
    { id: 2, label: 'Settings', icon: '⚙', Component: SettingsTab },
    { id: 3, label: 'Controls', icon: '?', Component: ControlsTab },
  ];
}
