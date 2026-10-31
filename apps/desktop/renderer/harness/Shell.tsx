/**
 * The shell of the preview: the left navigation (open, a rail, or a drawer over the page) and the place the route shows, in the three-column frame of the home app
 * (renderer/home/home.css): the navigation at the left, the middle column (a slim top row and the stage) and the details column at the right.
 * It holds the two toggles. The navigation hides and shows with its button and with Cmd+B (Ctrl+B); the details column with its button and Cmd+Shift+B (Ctrl+Shift+B). Both live in memory only.
 * A screen draws its own top row and columns with `Screen` (Screen.tsx), which reads the toggles from here.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { keyShortcuts, navModeOf, onMac, shellKey, toggleTip } from '../home/shell/shell-state.js';
import type { NavMode } from '../home/shell/shell-state.js';
import { useWindowWidth } from '../home/shell/useWindowWidth.js';
import { IconButton } from '../home/kit/IconButton.js';
import { navKeyOf } from '../../shared/harness/route.js';
import type { Route } from '../../shared/harness/route.js';
import { Navigation } from './Navigation.js';
import { go } from './router.js';
import { useHarnessStore } from './session.js';
import { WORDS } from './words.js';
import '../home/home-tokens.css';
import '../home/kit/kit.css';
import '../home/home.css';
import './harness.css';

export interface ShellValue {
  readonly mode: NavMode;
  readonly detailsOpen: boolean;
  toggleDetails(): void;
  toggleNav(): void;
  /** The button that shows the hidden navigation, drawn by the top row of a screen. */
  navButton(): ReactElement | null;
}

const Context = createContext<ShellValue | null>(null);

export function useShell(): ShellValue {
  const value = useContext(Context);
  if (value === null) throw new Error('The shell is missing. Draw the screen inside Shell.');
  return value;
}

export function Shell({ route, children, overlays }: { route: Route; children?: ReactNode; overlays?: ReactNode }): ReactElement {
  const store = useHarnessStore();
  const width = useWindowWidth(), mac = onMac();
  const [navChosen, setNavChosen] = useState<boolean | null>(null);
  const [overlay, setOverlay] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const mode = navModeOf(width, navChosen);
  const topToggle = useRef<HTMLButtonElement>(null), railToggle = useRef<HTMLElement | null>(null);

  const toggleNav = useCallback((): void => {
    if (mode === 'hidden') {
      const next = !overlay;
      setOverlay(next);
      if (!next) requestAnimationFrame(() => topToggle.current?.focus());
      return;
    }
    setNavChosen(mode !== 'open');
    requestAnimationFrame(() => (railToggle.current ?? document.querySelector<HTMLElement>('[data-nav-toggle]'))?.focus());
  }, [mode, overlay]);
  const toggleDetails = useCallback((): void => setDetailsOpen(open => !open), []);
  const latest = useRef({ toggleNav, toggleDetails });
  latest.current = { toggleNav, toggleDetails };

  // Cmd+B (Ctrl+B) puts the navigation away or brings it back, and Cmd+Shift+B (Ctrl+Shift+B) the details. Not while a sheet holds the page.
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      const which = shellKey(e);
      if (which === null || document.querySelector('[aria-modal="true"]') !== null) return;
      e.preventDefault();
      if (which === 'nav') latest.current.toggleNav(); else latest.current.toggleDetails();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  // The drawer over the page closes when the person goes somewhere.
  useEffect(() => { setOverlay(false); }, [route]);
  useEffect(() => {
    if (mode !== 'hidden' || !overlay) return undefined;
    const key = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); setOverlay(false); requestAnimationFrame(() => topToggle.current?.focus()); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [mode, overlay]);

  const navName = (mode === 'open' || overlay) ? WORDS.label.hideNav : WORDS.label.showNav;
  const value = useMemo<ShellValue>(() => ({
    mode, detailsOpen, toggleDetails, toggleNav,
    navButton: () => (mode === 'hidden'
      ? <span className="hm-topbar-nav"><IconButton ref={topToggle} icon="sidebar-left" label={navName} tip={toggleTip(navName, 'nav', mac)} side="below" aria-expanded={overlay} aria-controls="hm-nav" aria-keyshortcuts={keyShortcuts('nav')} data-nav-toggle="" onClick={toggleNav} /></span>
      : null),
  }), [mode, detailsOpen, toggleDetails, toggleNav, navName, mac, overlay]);

  return (
    <Context value={value}>
      <div className="hm-root" data-home="" data-shell="harness" data-nav={mode}>
        <Navigation mode={mode} overlay={mode === 'hidden' && overlay} current={navKeyOf(route)} onToggle={toggleNav}
          onNewHarness={() => { const id = store.createHarness(); go({ name: 'builder', id, view: 'graph' }); }}
          onHarnesses={() => go({ name: 'harnesses' })} onLibrary={kind => go({ name: 'library', kind: kind ?? 'skill' })} onProjects={() => go({ name: 'projects' })} onRuns={() => go({ name: 'runs' })}
          onInterfaces={() => go({ name: 'interfaces' })} onHistory={() => go({ name: 'history' })} onHelp={() => go({ name: 'help' })} />
        {mode === 'hidden' && overlay ? <div className="hm-nav-scrim" data-nav-scrim="" aria-hidden="true" onClick={() => { setOverlay(false); requestAnimationFrame(() => topToggle.current?.focus()); }} /> : null}
        {children}
        <div id="hx-layer" />
        {overlays}
      </div>
    </Context>
  );
}
