/** Puts the map into the page. The map keeps running while the person looks at other screens: its place is kept and moved back in. */
import '@xyflow/react/dist/style.css';
import './map.css';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { MapScreen } from './MapScreen.js';
import type { MapProps } from './MapScreen.js';

let root: Root | null = null;
const host = document.createElement('div');
host.className = 'bw-host';

/** The element that holds the map. The same element every time, so the map is not rebuilt each time the page is drawn. */
export function mapHost(): HTMLElement { return host; }

export function renderMap(props: MapProps): void {
  root ??= createRoot(host);
  root.render(<MapScreen {...props} />);
}
