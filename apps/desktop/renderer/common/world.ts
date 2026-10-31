/**
 * Where the prototype gets its world. One function, so no screen builds a world of its own.
 * It is the seeded sample world: invented names, the same every time, a fresh object on every call.
 */
import type { World } from '../../shared/world/types.js';
import { generateWorld } from '../../shared/world/sample.js';

export function loadWorld(): World {
  return generateWorld(1);
}
