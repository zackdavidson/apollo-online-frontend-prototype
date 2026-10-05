import { useSyncExternalStore } from 'react';
import type { InterfaceView } from './context';
import { INTERFACE_SLOTS, type InterfaceStore } from './store';

/** Renders the five slot containers and whatever interface is open in each. */
export function InterfaceRoot({ store }: { store: InterfaceStore<InterfaceView> }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return (
    <div className="ui-slots">
      {INTERFACE_SLOTS.map((slot) => {
        const open = snapshot.open.find((entry) => entry.slot === slot);
        const definition = open ? store.get(open.id) : undefined;
        const View = definition?.view;
        return (
          <div key={slot} className={`ui-slot ui-slot-${slot}`} data-slot={slot}>
            {open && View ? (
              <div className="ui-interface" data-interface-id={open.id}>
                <View key={open.id} id={open.id} props={open.props} close={() => store.close(open.id)} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
