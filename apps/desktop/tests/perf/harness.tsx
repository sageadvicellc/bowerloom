// The speed test page: the real map, with a made-up map of the size asked for in the address (?n=500).
import { renderMap, mapHost } from '../../renderer/map/mount.js';
import { applyMotionTokens } from '../../renderer/motion-tokens.js';
import { syntheticSnapshot } from './synthetic.js';
import type { ViewerApi } from '../../shared/types.js';

const n = Number(new URLSearchParams(location.search).get('n') ?? '200');
applyMotionTokens();
document.documentElement.setAttribute('data-theme', 'light');
const api = { listSketches: async () => ({ ok: true, value: [], message: null }) } as unknown as ViewerApi;
const host = document.createElement('main'); host.style.cssText = 'padding:16px'; document.body.append(host); host.append(mapHost());
renderMap({ snapshot: syntheticSnapshot(n), saved: {}, api, onOpen: () => undefined, onLayout: () => undefined });
(window as unknown as { __ready: boolean }).__ready = true;
