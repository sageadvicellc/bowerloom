/**
 * Where the prototype gets its world. One function, so a later slice can point it at the sample generator without touching a screen.
 * For now it is the empty world: three interfaces, one global scope, nothing else. A fresh object on every call.
 */
import type { World } from '../../shared/proto/types.js';
import { createEmptyWorld } from './fakeApi.js';

export function loadWorld(): World {
  return createEmptyWorld();
}
