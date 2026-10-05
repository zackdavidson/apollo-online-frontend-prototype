import { useCallback } from 'react';
import type { PointerEvent } from 'react';
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

/** Interface 3, the controls list. */
export function HelpInterface(_: InterfaceViewProps) {
  const { controls } = useServices();
  return (
    <div className="hud hud-help">
      <h3>Controls</h3>
      <dl>
        {controls.map(([key, what]) => (
          <>
            <dt key={`${key}-k`}>{key}</dt>
            <dd key={`${key}-d`}>{what}</dd>
          </>
        ))}
      </dl>
      <p className="muted">Esc or the Controls tab closes this.</p>
    </div>
  );
}

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
