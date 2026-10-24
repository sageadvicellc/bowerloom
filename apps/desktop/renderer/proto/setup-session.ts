/**
 * The session for a screen that must also render with no provider (the shell test renders every screen with only a `world`).
 * `session.tsx` does not export its context, so this wraps `useProtoStore` and answers null when it throws for want of a provider.
 * The wrapped hook throws before it calls any other hook, so the order of hooks is the same on every render of one screen.
 */
import { useProtoStore } from './session.js';
import type { ProtoSession } from './session.js';

export function useOptionalSession(): ProtoSession | null {
  try { return useProtoStore(); } catch { return null; }
}
