// The speed test page: the real map, with a made-up map of the size asked for in the address (?n=500).
import { renderMap, mapHost } from '../../renderer/map/mount.js';
import { applyMotionTokens } from '../../renderer/motion-tokens.js';
import { syntheticSnapshot } from './synthetic.js';
import type { ViewerApi } from '../../shared/types.js';

const n = Number(new URLSearchParams(location.search).get('n') ?? '200');
applyMotionTokens();
document.documentElement.setAttribute('data-theme', 'light');
const api = { listSketches: async () => ({ ok: true, value: [], message: null }) } as unknown as ViewerApi;
// The same frame as the app: a shell with a side column and a main area that holds the map page.
const shell = document.createElement('div'); shell.className = 'shell';
const side = document.createElement('aside'); side.className = 'sidebar';
const main = document.createElement('main'); main.id = 'main';
const page = document.createElement('div'); page.className = 'page wide map-page';
const footer = document.createElement('footer'); footer.className = 'footer'; footer.textContent = 'Footer';
page.append(mapHost()); main.append(page); shell.append(side, main, footer); document.body.append(shell);
renderMap({ snapshot: syntheticSnapshot(n), saved: {}, api, onOpen: () => undefined, onLayout: () => undefined });
(window as unknown as { __ready: boolean }).__ready = true;
