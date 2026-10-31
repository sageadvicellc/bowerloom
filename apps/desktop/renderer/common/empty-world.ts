/** The empty world: the three interfaces, one global scope and nothing else. The home app's Add page, and the tests of the store, the bundle and the export, start from it. */
import type { World } from '../../shared/world/types.js';

/** A World with the three interfaces, one global scope and nothing else. Plain JSON, a fresh object on every call. */
export function createEmptyWorld(): World {
  return {
    interfaces: [
      { id: 'claude-code', installed: 'unknown', notice: null, enforcement: 'blocks reads' },
      { id: 'codex', installed: 'unknown', notice: null, enforcement: 'advisory only' },
      { id: 'opencode', installed: 'unknown', notice: null, enforcement: 'advisory only' },
    ],
    items: [],
    scopes: [{ id: 'global', kind: 'global', name: 'Global', parentId: null, path: '/sample/harness' }],
    overrides: [],
    wikiPages: [],
    slices: [],
    versions: [],
    libraries: [],
  };
}
