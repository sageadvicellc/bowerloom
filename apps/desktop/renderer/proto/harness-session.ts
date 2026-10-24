/**
 * An optional view of the prototype session. `useProtoStore` throws when no provider is above it; this one answers null instead, so the
 * harness screen can draw a plain line when it is rendered on its own (the shell test renders every screen with only a world).
 * It calls the same hooks in the same order on every render of a given tree, because a provider is either there or not for the whole life of the screen.
 */
import { useProtoStore } from './session.js';
import type { ProtoSession } from './session.js';

export function useOptionalProtoStore(): ProtoSession | null {
  try {
    return useProtoStore();
  } catch {
    return null;
  }
}
