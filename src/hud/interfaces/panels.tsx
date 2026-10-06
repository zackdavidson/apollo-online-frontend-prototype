import { useCallback, useEffect, useState } from 'react';
import type { PointerEvent } from 'react';
import { PIXEL_LEVELS, type PixelScope } from '../../scene/pixelate';
import type { HudActions, HudInfo } from '../hud';
import { useServices, useStoreValue, type InterfaceViewProps } from './context';

/** Interface 2, the expanded map: React owns the frame, the HUD draws into the canvas through the map bridge. */
export function MapInterface(_: InterfaceViewProps) {
  const { map, actions } = useServices<unknown, { onWarp(): void }>();
  const title = useStoreValue(map.title);
  const cursor = useStoreValue(map.cursor);
  const waypoint = useStoreValue(map.waypoint);
  const attach = useCallback((canvas: HTMLCanvasElement | null) => map.attach(canvas), [map]);
  return (
    <div className="hud hud-bigmap">
      <div className="bigmap-title">
        <span>{title}</span>
        <span className="muted">click to set a waypoint · ship holds still while open · M or Esc closes</span>
      </div>
      <div className="bigmap-canvas-wrap">
        <canvas
          ref={attach}
          title="Click to set a waypoint"
          data-component-id={0}
          onPointerDown={(event: PointerEvent<HTMLCanvasElement>) => map.onPointerDown(event.nativeEvent)}
          onPointerMove={(event: PointerEvent<HTMLCanvasElement>) => map.onPointerMove(event.nativeEvent)}
          onPointerLeave={() => map.onPointerLeave()}
        />
        {waypoint ? (
          <button
            type="button"
            className={`bigmap-warp${waypoint.inRange ? ' ready' : ''}`}
            style={{ left: waypoint.x, top: waypoint.y }}
            disabled={!waypoint.inRange}
            data-component-id={1}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => actions.onWarp()}
          >
            {waypoint.inRange ? `Warp here · ${waypoint.distance.toFixed(0)} u` : `Out of range · ${waypoint.distance.toFixed(0)} / ${waypoint.range} u`}
          </button>
        ) : null}
      </div>
      <div className="bigmap-caption">
        <span className="muted">map coordinates, (0, 0) bottom-left</span>
        <span className="muted">{cursor}</span>
      </div>
    </div>
  );
}

/**
 * Interface 3, the settings window: camera and pixelation on one page, the
 * controls list on the other, and the way back to the hangar. Esc opens it
 * when nothing else is open and closes it again; so does the cog on the
 * minimap. Props: `tab` ('settings' | 'controls').
 */
export function SettingsInterface({ props, close }: InterfaceViewProps) {
  const { controls, actions, info: infoStore } = useServices<HudInfo, HudActions>();
  const info = useStoreValue(infoStore);
  const requested: SettingsPage = props['tab'] === 'controls' ? 'controls' : 'settings';
  const [page, setPage] = useState<SettingsPage>(requested);
  useEffect(() => setPage(requested), [requested]);
  const pages: ReadonlyArray<readonly [SettingsPage, string, string]> = [
    ['settings', 'Settings', '⚙'],
    ['controls', 'Controls', '?'],
  ];
  return (
    <div className="hud ui-settings ornate">
      <div className="settings-header">
        <span>Settings</span>
        <button type="button" className="settings-close" title="Close (Esc)" data-component-id={0} onClick={() => close()}>
          ×
        </button>
      </div>
      <div className="inv-tabs settings-tabs">
        {pages.map(([id, label, icon]) => (
          <button key={id} type="button" className={`inv-tab${page === id ? ' active' : ''}`} data-component-id={id === 'settings' ? 1 : 2} onClick={() => setPage(id)}>
            <span className="inv-tab-icon">{icon}</span>
            <span className="inv-tab-label">{label}</span>
          </button>
        ))}
      </div>
      {page === 'settings' ? (
        <div className="settings-body">
          <label className="settings-row">
            <span>Camera</span>
            <button type="button" onClick={() => actions.onToggleCamera()}>
              {info?.mode ?? 'perspective'} · C switches
            </button>
          </label>
          <label className="settings-row">
            <span>Pixelation</span>
            <select title="Pixelation level (P)" value={String(info?.pixelLevel ?? 0)} onChange={(event) => actions.onPixelLevel(Number(event.target.value))}>
              {PIXEL_LEVELS.map((level, index) => (
                <option key={level.label} value={String(index)}>
                  {level.label}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-row">
            <span>Pixelate</span>
            <select title="What gets pixelated (O)" value={info?.pixelScope ?? '3d'} onChange={(event) => actions.onPixelScope(event.target.value as PixelScope)}>
              <option value="3d">3D only</option>
              <option value="all">Everything</option>
            </select>
          </label>
        </div>
      ) : (
        <dl className="inv-controls settings-controls">
          {controls.map(([key, what]) => (
            <div key={key} style={{ display: 'contents' }}>
              <dt>{key}</dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="settings-actions">
        <button type="button" data-component-id={3} onClick={() => close()}>
          Resume
        </button>
        <button type="button" className="primary" data-component-id={4} onClick={() => actions.onExit()}>
          Back to hangar
        </button>
      </div>
    </div>
  );
}

type SettingsPage = 'settings' | 'controls';

/** Interface 4, a quiet text panel for the top-left overlay slot. Props: `title`, `lines` (array or string). */
export function PanelInterface({ props }: InterfaceViewProps) {
  const title = typeof props['title'] === 'string' ? props['title'] : 'Notice';
  const raw = props['lines'];
  const lines = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? [raw] : [];
  return (
    <div className="hud ui-panel">
      <div className="ui-panel-title" data-component-id={0}>
        {title}
      </div>
      <div className="ui-panel-lines" data-component-id={1}>
        {lines.map((line, index) => (
          <div key={index}>{line}</div>
        ))}
      </div>
    </div>
  );
}

/** Interface 5, a full-screen layer over everything: dimmed backdrop, centred title and body. Props: `title`, `body`. */
export function NoticeInterface({ props, close }: InterfaceViewProps) {
  const title = typeof props['title'] === 'string' ? props['title'] : 'Notice';
  const body = Array.isArray(props['body']) ? props['body'].map(String).join('\n') : typeof props['body'] === 'string' ? props['body'] : '';
  return (
    <div className="ui-notice" onPointerDown={() => close()}>
      <div className="ui-notice-card">
        <div className="ui-notice-title" data-component-id={0}>
          {title}
        </div>
        <div className="ui-notice-body" data-component-id={1}>
          {body}
        </div>
        <div className="muted ui-notice-hint">click or Esc to dismiss</div>
      </div>
    </div>
  );
}
