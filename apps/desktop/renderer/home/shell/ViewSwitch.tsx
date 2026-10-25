/**
 * The switch in the top bar that moves between the two places of the app, "Agents" and "Library". It is a real tab list: one tab is in the Tab order, the
 * arrow keys (and Home and End) move to the other tab and choose it, and the chosen tab says so with `aria-selected`. The two places are panels in the page
 * (HomeApp), and each tab names the panel it controls. It is quiet: plain words in a 32 px control, with the chosen one filled and edged like every other
 * segmented control here, never marked with a check.
 */
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { WORDS } from '../words.js';
import './shell.css';

export type View = 'agents' | 'library';
export const VIEWS: readonly View[] = Object.freeze(['agents', 'library'] as const);

const NAMES: Readonly<Record<View, string>> = Object.freeze({ agents: WORDS.label.viewAgents, library: WORDS.label.viewLibrary });

/** The ids of a tab and of the panel it controls. */
export const viewTabId = (view: View): string => `hm-view-tab-${view}`;
export const viewPanelId = (view: View): string => `hm-view-${view}`;

export function ViewSwitch({ view, onChange }: { view: View; onChange(view: View): void }): ReactElement {
  const key = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const at = VIEWS.indexOf(view), n = VIEWS.length;
    const go = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (at + 1) % n : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (at + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (go === null) return;
    e.preventDefault();
    const next = VIEWS[go]!;
    onChange(next);
    requestAnimationFrame(() => document.getElementById(viewTabId(next))?.focus());
  };
  return (
    <div className="hm-switch" role="tablist" aria-label={WORDS.label.viewSwitch} data-tour="switch" onKeyDown={key}>
      {VIEWS.map(v => (
        <button key={v} type="button" role="tab" className="hm-switch-tab" id={viewTabId(v)} aria-selected={v === view} aria-controls={viewPanelId(v)} tabIndex={v === view ? 0 : -1} data-view={v} onClick={() => onChange(v)}>{NAMES[v]}</button>
      ))}
    </div>
  );
}
