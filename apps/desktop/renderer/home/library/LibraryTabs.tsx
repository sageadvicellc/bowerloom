/**
 * The segmented control of the Library: one tab for each kind of thing (Skills, Agents, Tools, Notes), each with how many there are. It is a real tab list:
 * one tab is in the Tab order, the arrows (and Home and End) move between tabs and choose the one they land on, and the chosen tab says so with `aria-selected`.
 */
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { LIBRARY_KINDS } from '../../../shared/home/library-model.js';
import type { LibraryKind } from '../../../shared/home/library-model.js';
import { LIBRARY_WORDS, tabName } from './library-words.js';
import './library.css';

const L = LIBRARY_WORDS.label;
const NAMES: Readonly<Record<LibraryKind, string>> = Object.freeze({ skill: L.skills, agent: L.agents, tool: L.tools, note: L.notes });

export interface LibraryTabsProps {
  kind: LibraryKind;
  counts: Readonly<Record<LibraryKind, number>>;
  onChange(kind: LibraryKind): void;
  /** The id of the panel the tabs control. */
  panelId: string;
}

/** The id of the tab of a kind, so the panel can name the tab that labels it. */
export const tabId = (panelId: string, kind: LibraryKind): string => `${panelId}-tab-${kind}`;

export function LibraryTabs({ kind, counts, onChange, panelId }: LibraryTabsProps): ReactElement {
  const key = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const at = LIBRARY_KINDS.indexOf(kind), n = LIBRARY_KINDS.length;
    const go = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (at + 1) % n : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (at + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (go === null) return;
    e.preventDefault();
    const next = LIBRARY_KINDS[go]!;
    onChange(next);
    requestAnimationFrame(() => document.getElementById(tabId(panelId, next))?.focus());
  };
  return (
    <div className="lb-tabs" role="tablist" aria-label={L.tabs} onKeyDown={key}>
      {LIBRARY_KINDS.map(k => (
        <button key={k} type="button" role="tab" className="lb-tab" id={tabId(panelId, k)} aria-selected={k === kind} aria-controls={panelId} tabIndex={k === kind ? 0 : -1} data-kind={k} aria-label={tabName(NAMES[k], counts[k])} onClick={() => onChange(k)}>
          <span>{NAMES[k]}</span><span className="lb-tab-count" aria-hidden="true">{counts[k]}</span>
        </button>
      ))}
    </div>
  );
}
