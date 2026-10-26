/**
 * The left navigation of the home app, drawn as a branching tree. From the top: the collapse button (the "sidebar left" icon, at the very top-left) with the app mark and name;
 * "Add", the one primary item; the section "Workspace" with "Agents" and "Library" (Library is a folder: open, its four children, Skills, Agents, Tools and Notes, hang off a thin
 * branch line with a curved elbow into each); the section "More" with "Find more", "Share" and "Version history"; and at the foot "Help" and the "Preview" mark ("Read-only" in
 * read-only mode). A section header has a chevron that folds the section. A folder opens when you open the Library page, or with the chevron, or with the Right arrow; Left closes it.
 * It has three looks: open (232 px, icon and words), a rail (48 px, icons only, each with a tooltip, no headers and no branch lines) and hidden (under 900 px, where the toggle in the
 * top row of the page opens it over the page, and Escape or a press outside closes it). The item you are on is shown by a soft fill and a medium weight, with `aria-current="page"`,
 * never a check mark. The pointer is followed by one soft highlight that glides from item to item (one box that moves, not a flash on each item).
 * The items are one Tab stop with the arrow keys inside (Up and Down, Home and End; Enter or Space presses): the stop is the item that had the focus last, else the one you are on.
 * The collapse button and the Preview mark are Tab stops of their own. `data-tour` marks Add ("add"), the pair Share and Version history ("share") and Help ("help") for the tour;
 * the bar itself is "bar". It stays a `nav` of buttons (no `role="tree"`).
 */
import { useEffect, useRef, useState } from 'react';
import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactElement, ReactNode, Ref } from 'react';
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
import { branchGeometry, foldMove, glideBox, keyShortcuts, onMac, roveTarget, toggleTip } from './shell-state.js';
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
  /** True for a folder: it shows a small chevron at the right, and the Right and Left arrows open and close it. */
  folder?: boolean;
  onClick(): void; ref?: Ref<HTMLButtonElement> | undefined;
}

function Item({ navKey, icon, label, stop, rail, current, expanded, controls, haspopup, primary, sub, tour, folder, onClick, ref }: ItemProps): ReactElement {
  return (
    <Tooltip text={label} side="right" off={!rail}>
      {aria => (
        <button ref={ref} type="button" className="hm-nav-item" data-nav-item="" data-nav-key={navKey} data-primary={primary === true ? '' : undefined} data-sub={sub === true ? '' : undefined} data-fold={folder === true ? 'folder' : undefined} data-parent={sub === true ? 'library' : undefined} data-tour={tour}
          tabIndex={stop === navKey ? 0 : -1} aria-current={current === true ? 'page' : undefined} aria-expanded={expanded} aria-controls={controls} aria-haspopup={haspopup} onClick={onClick} {...aria}>
          <KitIcon name={icon} size={20} /><span className="hm-nav-label">{label}</span>
          {folder === true ? <span className="hm-nav-chev" data-unfolded={expanded === true ? '' : undefined} aria-hidden="true"><KitIcon name="chevron" size={16} /></span> : null}
        </button>
      )}
    </Tooltip>
  );
}

/** A part of the list that opens and closes by the height of its grid row. Closed, it is inert and unseen, so nothing in it takes the focus. */
function Fold({ open, children, id }: { open: boolean; children: ReactNode; id?: string }): ReactElement {
  return <div className="hm-fold" id={id} data-unfolded={open ? '' : undefined}><div className="hm-fold-inner" inert={!open}>{children}</div></div>;
}

/** The thin line of a folder: a trunk and a curved elbow into each child. Drawn from `branchGeometry`, with the colour of the border. */
function Branch({ count }: { count: number }): ReactElement {
  const g = branchGeometry(count);
  return (
    <svg className="hm-branch" width={12} height={g.height} viewBox={`0 0 12 ${g.height}`} fill="none" stroke="currentColor" strokeWidth={1} strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d={g.trunk} />
      {g.elbows.map(d => <path key={d} d={d} />)}
    </svg>
  );
}

/** The small muted header of a section, with a chevron that folds it. */
function SectionHead({ navKey, label, open, controls, stop, onToggle }: { navKey: string; label: string; open: boolean; controls: string; stop: string; onToggle(): void }): ReactElement {
  return (
    <button type="button" className="hm-nav-section" data-nav-item="" data-nav-key={navKey} data-fold="section" tabIndex={stop === navKey ? 0 : -1} aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      <span>{label}</span><span className="hm-nav-chev" data-unfolded={open ? '' : undefined} aria-hidden="true"><KitIcon name="chevron" size={16} /></span>
    </button>
  );
}

export function Sidebar(p: SidebarProps): ReactElement {
  const { mode, overlay, view } = p;
  const rail = mode === 'rail';
  const mac = onMac();
  const open = mode === 'open' || overlay;
  const nav = useRef<HTMLElement>(null), glide = useRef<HTMLSpanElement>(null);
  const current = view === 'agents' ? 'agents' : p.libraryOpen ? `lib-${p.libraryKind}` : 'library';
  const onLibraryPage = view === 'library' && p.libraryOpen;
  const [last, setLast] = useState<string | null>(null);
  // The Library folder starts open on the Library page, and opens whenever that page is opened. The chevron and the arrow keys fold it. A section is open until its header folds it.
  const [libOpen, setLibOpen] = useState(onLibraryPage);
  // On the Library page the folder follows the page: opening the page opens it, and pressing Library again (which folds the page) folds it. Elsewhere the chevron and the keys decide.
  useEffect(() => { if (view === 'library') setLibOpen(p.libraryOpen); }, [view, p.libraryOpen]);
  const [shut, setShut] = useState<readonly string[]>([]);
  const fold = (key: string): void => setShut(list => (list.includes(key) ? list.filter(k => k !== key) : [...list, key]));
  // A rail has no headers, so every section shows in it.
  const workOpen = rail || !shut.includes('sec-work'), moreOpen = rail || !shut.includes('sec-more');
  // The one Tab stop of the items: the item that had the focus last, if it is still there, else the item you are on.
  const keys = ['add', ...(rail ? [] : ['sec-work']), ...(workOpen ? ['agents', 'library', ...(libOpen ? LIBRARY_KINDS.map(k => `lib-${k}`) : [])] : []), ...(rail ? [] : ['sec-more']), ...(moreOpen ? ['find', 'share', 'history'] : []), 'help'];
  const stop = last !== null && keys.includes(last) ? last : keys.includes(current) ? current : 'add';
  const seen = (e: ReactFocusEvent<HTMLElement>): void => { const key = e.target instanceof HTMLElement ? e.target.getAttribute('data-nav-key') : null; if (key !== null) setLast(key); };
  // The soft highlight: one box that moves under the pointer. It is placed with the box of the item, so it needs no state and no render.
  const hideGlide = (): void => { glide.current?.removeAttribute('data-on'); };
  const follow = (e: ReactPointerEvent<HTMLElement>): void => {
    const box = glide.current, host = nav.current;
    if (box === null || host === null || e.pointerType === 'touch') return;
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-nav-item]') : null;
    if (el === null || el.hasAttribute('data-primary') || el.closest('[inert]') !== null) { hideGlide(); return; }
    const at = glideBox(el.getBoundingClientRect(), host.getBoundingClientRect());
    const fresh = !box.hasAttribute('data-on');
    // It appears where the pointer is, then glides from there; it does not fly in from the last place.
    if (fresh) box.style.transition = 'none';
    box.style.transform = `translate(${at.left}px, ${at.top}px)`; box.style.width = `${at.width}px`; box.style.height = `${at.height}px`;
    if (fresh) { void box.offsetWidth; box.style.transition = ''; }
    box.setAttribute('data-on', '');
  };
  const rove = (e: ReactKeyboardEvent<HTMLElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const items = [...(nav.current?.querySelectorAll<HTMLElement>('[data-nav-item]') ?? [])].filter(el => el.getClientRects().length > 0 && el.closest('[inert]') === null);
    const at = items.findIndex(el => el === document.activeElement);
    if (at < 0) return;
    const here = items[at]!;
    const kind = here.getAttribute('data-fold');
    const move = foldMove(e.key, here.getAttribute('aria-expanded') === 'true', kind !== null, here.hasAttribute('data-parent'));
    if (move !== null) {
      e.preventDefault();
      if (move === 'in') items[at + 1]?.focus();
      else if (move === 'out') items.find(el => el.getAttribute('data-nav-key') === here.getAttribute('data-parent'))?.focus();
      else if (kind === 'section') fold(here.getAttribute('data-nav-key') ?? '');
      else setLibOpen(move === 'open');
      return;
    }
    const to = roveTarget(e.key, at, items.length);
    if (to === null) return;
    e.preventDefault();
    items[to]?.focus();
  };
  const toggleName = open ? WORDS.label.hideNav : WORDS.label.showNav;
  const item = { stop, rail };
  return (
    <nav className="hm-nav" id="hm-nav" ref={nav} aria-label={WORDS.label.mainMenu} data-tour="bar" data-mode={mode} data-overlay={overlay ? '' : undefined} onFocus={seen} onKeyDown={e => { hideGlide(); rove(e); }} onPointerMove={follow} onPointerLeave={hideGlide} onClick={hideGlide}>
      <span className="hm-nav-glide" ref={glide} aria-hidden="true" />
      <div className="hm-nav-top">
        <IconButton ref={p.toggleRef} icon="sidebar-left" label={toggleName} tip={toggleTip(toggleName, 'nav', mac)} side="right" aria-expanded={open} aria-controls="hm-nav" aria-keyshortcuts={keyShortcuts('nav')} data-nav-toggle="" onClick={p.onToggle} />
        <div className="hm-brand"><KitIcon name="leaf" size={24} /><span>{WORDS.label.appName}</span></div>
      </div>
      <div className="hm-nav-body" onScroll={hideGlide}>
        <ul className="hm-nav-list">
          <li><Item {...item} navKey="add" icon="plus" label={WORDS.label.add} primary expanded={p.addOpen} tour="add" onClick={p.onAdd} ref={p.addRef} /></li>
        </ul>
        <div className="hm-nav-group">
          <SectionHead navKey="sec-work" label={WORDS.label.navWorkspace} open={workOpen} controls="hm-nav-work" stop={stop} onToggle={() => fold('sec-work')} />
          <Fold id="hm-nav-work" open={workOpen}>
            <ul className="hm-nav-list">
              <li><Item {...item} navKey="agents" icon="agent" label={WORDS.label.viewAgents} current={current === 'agents'} onClick={p.onAgents} /></li>
              <li>
                <Item {...item} navKey="library" icon="library" label={WORDS.label.viewLibrary} folder current={current === 'library'} expanded={libOpen} controls="hm-nav-library" onClick={() => p.onLibrary(null)} />
                <Fold id="hm-nav-library" open={libOpen}>
                  <ul className="hm-nav-sub" aria-label={WORDS.label.libraryPages}>
                    <Branch count={LIBRARY_KINDS.length} />
                    {LIBRARY_KINDS.map(k => <li key={k}><Item {...item} navKey={`lib-${k}`} icon={KIND_ICONS[k]} label={KIND_NAMES[k]} sub current={current === `lib-${k}`} onClick={() => p.onLibrary(k)} /></li>)}
                  </ul>
                </Fold>
              </li>
            </ul>
          </Fold>
        </div>
        <div className="hm-nav-group">
          <SectionHead navKey="sec-more" label={WORDS.label.navMore} open={moreOpen} controls="hm-nav-more" stop={stop} onToggle={() => fold('sec-more')} />
          <Fold id="hm-nav-more" open={moreOpen}>
            <ul className="hm-nav-list">
              <li><Item {...item} navKey="find" icon="search" label={FIND_WORDS.label.findMore} expanded={p.findOpen} controls="hm-panel" onClick={p.onFind} ref={p.findRef} /></li>
              <li className="hm-nav-pair" data-tour="share">
                <Item {...item} navKey="share" icon="share" label={WORDS.label.share} haspopup="dialog" onClick={p.onShare} />
                <Item {...item} navKey="history" icon="clock" label={WORDS.label.versionHistory} expanded={p.historyOpen} onClick={p.onHistory} ref={p.historyRef} />
              </li>
            </ul>
          </Fold>
        </div>
      </div>
      <div className="hm-nav-low">
        <ul className="hm-nav-list">
          <li>
            <HelpPopover word={WORDS.label.help} label={WORDS.label.help} text={WORDS.popover.help} place="above" dataTour="help" item={{ icon: 'help', navKey: 'help', tabIndex: stop === 'help' ? 0 : -1 }}
              tip={{ text: WORDS.label.help, side: 'right', off: !rail }} action={{ label: WORDS.label.showTour, onAction: p.onTour }} />
          </li>
        </ul>
        <div className="hm-preview" data-preview="">
          <HelpPopover pill={p.readOnly ? WORDS.label.readOnly : WORDS.label.preview} label={p.readOnly ? WORDS.label.aboutReadOnly : WORDS.label.aboutPreview} place="above"
            text={p.readOnly ? (p.real ? `${WORDS.popover.readOnlyReal} ${WORDS.popover.readOnlyTemp}` : WORDS.popover.readOnlySample) : WORDS.popover.preview}
            tip={{ text: p.readOnly ? WORDS.label.readOnly : WORDS.label.preview, side: 'right', off: !rail }} action={{ label: HOW_WORDS.label.link, onAction: p.onHow, quiet: true }} />
        </div>
      </div>
    </nav>
  );
}
