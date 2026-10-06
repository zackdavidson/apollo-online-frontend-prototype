import { createRoot, type Root } from 'react-dom/client';
import { MapEditor, type MapEditorProps } from './MapEditor';

export interface MapEditorHandle {
  dispose(): void;
}

/** Mount the editor into a host element; `dispose` unmounts it. */
export function mountMapEditor(host: HTMLElement, props: MapEditorProps): MapEditorHandle {
  const root: Root = createRoot(host);
  root.render(<MapEditor {...props} />);
  return {
    dispose: () => root.unmount(),
  };
}

export type { MapEditorProps } from './MapEditor';
