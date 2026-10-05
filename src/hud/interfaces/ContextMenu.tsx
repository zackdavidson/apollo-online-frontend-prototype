import { useEffect, useRef } from 'react';
import { useServices, useStoreValue } from './context';

/**
 * The right-click option menu: "Choose Option", a list of verb + target
 * entries with the default first, and Cancel. Clicking an entry performs it;
 * clicking anywhere else, or Esc through the session, dismisses it.
 */
export function ContextMenu() {
  const { menu } = useServices();
  const state = useStoreValue(menu);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (ref.current && event.target instanceof Node && ref.current.contains(event.target)) return;
      menu.set(null);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [state, menu]);

  if (!state) return null;
  const width = 220;
  const rowHeight = 24;
  const height = 30 + rowHeight * (state.options.length + 1);
  const left = Math.max(4, Math.min(window.innerWidth - width - 4, state.x - 10));
  const top = Math.max(4, Math.min(window.innerHeight - height - 4, state.y - 10));

  return (
    <div ref={ref} className="ui-menu" style={{ left, top, width }} data-component-id={0} onContextMenu={(event) => event.preventDefault()}>
      <div className="ui-menu-title">Choose Option</div>
      {state.options.map((option, index) => (
        <button
          key={index}
          type="button"
          className={`ui-menu-option${index === 0 ? ' default' : ''}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            menu.set(null);
            state.onPick(index);
          }}
        >
          {option.label} <span className="ui-menu-target">{option.target}</span>
        </button>
      ))}
      <button type="button" className="ui-menu-option ui-menu-cancel" onClick={() => menu.set(null)}>
        Cancel
      </button>
    </div>
  );
}
