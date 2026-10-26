/**
 * The left navigation of the home app, as in the desktop apps of Claude and ChatGPT. From the top: the collapse button (the "sidebar left" icon, at the very top-left) with the
 * app mark and name; "Add", the one primary item; the two places, "Agents" and "Library" (Library opens in place into Skills, Agents, Tools and Notes, each of which opens the
 * Library on that kind); a spacer; and the lower group: "Find more", "Share", "Version history", "Help", and the "Preview" mark (it says "Read-only" in read-only mode).
 * It has three looks: open (232 px, icon and words), a rail (48 px, icons only, each with a tooltip) and hidden (under 900 px, where the toggle in the top row of the page opens
 * it over the page, and Escape or a press outside closes it). The item you are on is shown by a tint and a 2 px edge, with `aria-current="page"`, never a check mark.
 * The items are one Tab stop with the arrow keys inside (Up and Down, Home and End; Enter or Space presses): the stop is the item that had the focus last, else the one
 * you are on. The collapse button and the Preview mark are Tab stops of their own. `data-tour` marks Add ("add"), the pair Share and Version history ("share") and Help
 * ("help") for the tour; the bar itself is "bar".
 */
import { useRef, useState } from 'react';
import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement, Ref } from 'react';
import { LIBRARY_KINDS } from '../../../shared/home/library-model.js';
import type { LibraryKind } from '../../../shared/home/library-model.js';
import { FIND_WORDS } from '../first-run/find-words.js';
import { HelpPopover } from '../kit/HelpPopover.js';
import { IconButton } from '../kit/IconButton.js';
import { KitIcon } from '../kit/icons.js';
import type { KitIconName } from '../kit/icons.js';
import { Tooltip } from '../kit/Tooltip.js';
import { LIBRARY_WORDS } from '../library/library-words.js';
import { HOW_WORDS } from '../trust/how-words.js';
import { WORDS } from '../words.js';
import { keyShortcuts, onMac, roveTarget, toggleTip } from './shell-state.js';
import type { NavMode, View } from './shell-state.js';
import './shell.css';

const KIND_NAMES: Readonly<Record<LibraryKind, string>> = Object.freeze({ skill: LIBRARY_WORDS.label.skills, agent: LIBRARY_WORDS.label.agents, tool: LIBRARY_WORDS.label.tools, note: LIBRARY_WORDS.label.notes });
const KIND_ICONS: Readonly<Record<LibraryKind, KitIconName>> = Object.freeze({ skill: 'skill', agent: 'agent', tool: 'tool', note: 'note' });

export interface SidebarProps {
  mode: NavMode;
  /** True when the hidden navigation is drawn over the page. */
  overlay: boolean;
  view: View;
  libraryKind: LibraryKind;
  /** True when the Library's four pages show under it. */
  libraryOpen: boolean;
  addOpen: boolean;
  historyOpen: boolean;
  findOpen: boolean;
  /** True in read-only mode: the Preview mark says so. */
  readOnly: boolean;
  /** Whether the setup on show is the person's own, which changes what the mark's popover says. */
  real: boolean;
  onToggle(): void;
  onAgents(): void;
  onLibrary(kind: LibraryKind | null): void;
  onAdd(): void;
  onFind(): void;
  onShare(): void;
  onHistory(): void;
  onTour(): void;
  onHow(): void;
  toggleRef?: Ref<HTMLButtonElement> | undefined;
  addRef?: Ref<HTMLButtonElement> | undefined;
  historyRef?: Ref<HTMLButtonElement> | undefined;
  findRef?: Ref<HTMLButtonElement> | undefined;
}

interface ItemProps {
  navKey: string; icon: KitIconName; label: string; stop: string; rail: boolean;
  current?: boolean; expanded?: boolean; controls?: string; haspopup?: 'dialog'; primary?: boolean; sub?: boolean; tour?: string;
  onClick(): void; ref?: Ref<HTMLButtonElement> | undefined;
}

function Item({ navKey, icon, label, stop, rail, current, expanded, controls, haspopup, primary, sub, tour, onClick, ref }: ItemProps): ReactElement {
  return (
    <Tooltip text={label} side="right" off={!rail}>
      {aria => (
        <button ref={ref} type="button" className="hm-nav-item" data-nav-item="" data-nav-key={navKey} data-primary={primary === true ? '' : undefined} data-sub={sub === true ? '' : undefined} data-tour={tour}
          tabIndex={stop === navKey ? 0 : -1} aria-current={current === true ? 'page' : undefined} aria-expanded={expanded} aria-controls={controls} aria-haspopup={haspopup} onClick={onClick} {...aria}>
          <KitIcon name={icon} size={20} /><span className="hm-nav-label">{label}</span>
        </button>
      )}
    </Tooltip>
  );
}

export function Sidebar(p: SidebarProps): ReactElement {
  const { mode, overlay, view } = p;
  const rail = mode === 'rail';
  const mac = onMac();
  const open = mode === 'open' || overlay;
  const nav = useRef<HTMLElement>(null);
  const current = view === 'agents' ? 'agents' : p.libraryOpen ? `lib-${p.libraryKind}` : 'library';
  const [last, setLast] = useState<string | null>(null);
  // The one Tab stop of the items: the item that had the focus last, if it is still there, else the item you are on.
  const keys = ['add', 'agents', 'library', ...(view === 'library' && p.libraryOpen ? LIBRARY_KINDS.map(k => `lib-${k}`) : []), 'find', 'share', 'history', 'help'];
  const stop = last !== null && keys.includes(last) ? last : current;
  const seen = (e: ReactFocusEvent<HTMLElement>): void => { const key = e.target instanceof HTMLElement ? e.target.getAttribute('data-nav-key') : null; if (key !== null) setLast(key); };
  const rove = (e: ReactKeyboardEvent<HTMLElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const items = [...(nav.current?.querySelectorAll<HTMLElement>('[data-nav-item]') ?? [])].filter(el => el.getClientRects().length > 0);
    const at = items.findIndex(el => el === document.activeElement);
    if (at < 0) return;
    const to = roveTarget(e.key, at, items.length);
    if (to === null) return;
    e.preventDefault();
    items[to]?.focus();
  };
  const toggleName = open ? WORDS.label.hideNav : WORDS.label.showNav;
  const item = { stop, rail };
  return (
    <nav className="hm-nav" id="hm-nav" ref={nav} aria-label={WORDS.label.mainMenu} data-tour="bar" data-mode={mode} data-overlay={overlay ? '' : undefined} onFocus={seen} onKeyDown={rove}>
      <div className="hm-nav-top">
        <IconButton ref={p.toggleRef} icon="sidebar-left" label={toggleName} tip={toggleTip(toggleName, 'nav', mac)} side="right" aria-expanded={open} aria-controls="hm-nav" aria-keyshortcuts={keyShortcuts('nav')} data-nav-toggle="" onClick={p.onToggle} />
        <div className="hm-brand"><KitIcon name="leaf" size={24} /><span>{WORDS.label.appName}</span></div>
      </div>
      <div className="hm-nav-body">
        <ul className="hm-nav-list">
          <li><Item {...item} navKey="add" icon="plus" label={WORDS.label.add} primary expanded={p.addOpen} tour="add" onClick={p.onAdd} ref={p.addRef} /></li>
          <li><Item {...item} navKey="agents" icon="agent" label={WORDS.label.viewAgents} current={current === 'agents'} onClick={p.onAgents} /></li>
          <li>
            <Item {...item} navKey="library" icon="library" label={WORDS.label.viewLibrary} current={current === 'library'} expanded={view === 'library' && p.libraryOpen} controls="hm-nav-library" onClick={() => p.onLibrary(null)} />
            {view === 'library' && p.libraryOpen ? (
              <ul className="hm-nav-sub" id="hm-nav-library" aria-label={WORDS.label.libraryPages}>
                {LIBRARY_KINDS.map(k => <li key={k}><Item {...item} navKey={`lib-${k}`} icon={KIND_ICONS[k]} label={KIND_NAMES[k]} sub current={current === `lib-${k}`} onClick={() => p.onLibrary(k)} /></li>)}
              </ul>
            ) : null}
          </li>
        </ul>
      </div>
      <div className="hm-nav-low">
        <ul className="hm-nav-list">
          <li><Item {...item} navKey="find" icon="search" label={FIND_WORDS.label.findMore} expanded={p.findOpen} controls="hm-panel" onClick={p.onFind} ref={p.findRef} /></li>
          <li className="hm-nav-pair" data-tour="share">
            <Item {...item} navKey="share" icon="share" label={WORDS.label.share} haspopup="dialog" onClick={p.onShare} />
            <Item {...item} navKey="history" icon="clock" label={WORDS.label.versionHistory} expanded={p.historyOpen} onClick={p.onHistory} ref={p.historyRef} />
          </li>
          <li>
            <HelpPopover word={WORDS.label.help} label={WORDS.label.help} text={WORDS.popover.help} place="above" dataTour="help" item={{ icon: 'help', navKey: 'help', tabIndex: stop === 'help' ? 0 : -1 }}
              tip={{ text: WORDS.label.help, side: 'right', off: !rail }} action={{ label: WORDS.label.showTour, onAction: p.onTour }} />
          </li>
        </ul>
        <div className="hm-preview" data-preview="">
          <HelpPopover pill={p.readOnly ? WORDS.label.readOnly : WORDS.label.preview} label={p.readOnly ? WORDS.label.aboutReadOnly : WORDS.label.aboutPreview} place="above"
            text={p.readOnly ? (p.real ? WORDS.popover.readOnlyReal : WORDS.popover.readOnlySample) : WORDS.popover.preview}
            tip={{ text: p.readOnly ? WORDS.label.readOnly : WORDS.label.preview, side: 'right', off: !rail }} action={{ label: HOW_WORDS.label.link, onAction: p.onHow, quiet: true }} />
        </div>
      </div>
    </nav>
  );
}
