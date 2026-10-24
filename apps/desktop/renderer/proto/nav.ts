/**
 * How a screen asks the shell to show another screen. The shell provides it. Without a shell (a test that renders one screen alone),
 * `useNavigate` gives null, and a screen keeps its own plain fallback.
 */
import { createContext, useContext } from 'react';
import type { RouteId } from './words.js';

export type Navigate = (route: RouteId) => void;

export const NavContext = createContext<Navigate | null>(null);

/** The shell's way to change screen, or null when there is no shell. */
export function useNavigate(): Navigate | null {
  return useContext(NavContext);
}
