/**
 * The left navigation of the preview, drawn as a branching tree like the home app's (renderer/home/shell/Sidebar.tsx): the collapse button and the app mark, "New harness" (the one primary item),
 * the section "Workspace" with Harnesses, Library (a folder: Agents, Skills, Tools and Context hang off a thin branch line), Projects and Runs; and at the foot Interfaces, Version history,
 * Help and the "Preview" mark. It has three looks: open (232 px), a rail (48 px, icons only, each with a tooltip) and hidden (under 900 px, where the toggle in the top row opens it over the page).
 * The place you are on is a soft fill with `aria-current="page"`, never a tick. A kind of the Library that is open says `aria-current="true"` and has no fill of its own: the design fills Library. The items are one Tab stop with the arrow keys inside; the collapse button and the Preview mark are Tab stops of their own.
 */
import { useEffect, useRef, useState } from 'react';
import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react';
import { IconButton } from '../home/kit/IconButton.js';
import { Tooltip } from '../home/kit/Tooltip.js';
import { branchGeometry, foldMove, glideBox, keyShortcuts, onMac, roveTarget, toggleTip } from '../home/shell/shell-state.js';
import type { NavMode } from '../home/shell/shell-state.js';
import '../home/shell/shell.css';
import { PART_KINDS } from '../../shared/harness/types.js';
import type { PartKind } from '../../shared/harness/types.js';
import type { NavKey } from '../../shared/harness/route.js';
import { HIcon, KIND_ICON } from './icons.js';
import type { HarnessIconName } from './icons.js';
import { PreviewMark } from './parts/PreviewMark.js';
import { KIND_PLURAL, WORDS } from './words.js';

export interface NavigationProps {
  mode: NavMode;
  /** True when the hidden navigation is drawn over the page. */
  overlay: boolean;
  current: NavKey | null;
  onToggle(): void;
  onNewHarness(): void;
  onHarnesses(): void;
  onLibrary(kind: PartKind | null): void;
  onProjects(): void;
  onRuns(): void;
  onInterfaces(): void;
  onHistory(): void;
  onHelp(): void;
}

interface ItemProps {
  navKey: string; icon: HarnessIconName; label: string; stop: string; rail: boolean;
  current?: boolean; expanded?: boolean; controls?: string; primary?: boolean; sub?: boolean; folder?: boolean;
  onClick(): void;
}

function Item({ navKey, icon, label, stop, rail, current, expanded, controls, primary, sub, folder, onClick }: ItemProps): ReactElement {
  return (
    <Tooltip text={label} side="right" off={!rail}>
      {aria => (
        <button type="button" className="hm-nav-item" data-nav-item="" data-nav-key={navKey} data-primary={primary === true ? '' : undefined} data-sub={sub === true ? '' : undefined}
          data-fold={folder === true ? 'folder' : undefined} data-parent={sub === true ? 'library' : undefined} tabIndex={stop === navKey ? 0 : -1}
          aria-current={current !== true ? undefined : sub === true ? 'true' : 'page'} aria-expanded={expanded} aria-controls={controls} onClick={onClick} {...aria}>
          <HIcon name={icon} size={20} /><span className="hm-nav-label">{label}</span>
          {folder === true ? <span className="hm-nav-chev" data-unfolded={expanded === true ? '' : undefined} aria-hidden="true"><HIcon name="chevron" size={16} /></span> : null}
        </button>
      )}
    </Tooltip>
  );
}

/** A part of the list that opens and closes by the height of its grid row. Closed, it is inert and unseen. */
function Fold({ open, children, id }: { open: boolean; children: ReactNode; id?: string }): ReactElement {
  return <div className="hm-fold" id={id} data-unfolded={open ? '' : undefined}><div className="hm-fold-inner" inert={!open}>{children}</div></div>;
}

function Branch({ count }: { count: number }): ReactElement {
  const g = branchGeometry(count);
  return (
    <svg className="hm-branch" width={12} height={g.height} viewBox={`0 0 12 ${g.height}`} fill="none" stroke="currentColor" strokeWidth={1} strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d={g.trunk} />
      {g.elbows.map(d => <path key={d} d={d} />)}
    </svg>
  );
}

export function Navigation(p: NavigationProps): ReactElement {
  const { mode, overlay, current } = p;
  const rail = mode === 'rail', open = mode === 'open' || overlay, mac = onMac();
  const nav = useRef<HTMLElement>(null), glide = useRef<HTMLSpanElement>(null);
  const [last, setLast] = useState<string | null>(null);
  const [libOpen, setLibOpen] = useState(true);
  const [workShut, setWorkShut] = useState(false);
  useEffect(() => { if (current !== null && current.startsWith('library')) setLibOpen(true); }, [current]);
  const workOpen = rail || !workShut;
  const keys = ['new', ...(rail ? [] : ['sec-work']), ...(workOpen ? ['harnesses', 'library', ...(libOpen ? PART_KINDS.map(k => `lib-${k}`) : []), 'projects', 'runs'] : []), 'interfaces', 'history', 'help'];
  const here = current === null ? null : current.startsWith('library') ? 'library' : current;
  const stop = last !== null && keys.includes(last) ? last : here !== null && keys.includes(here) ? here : 'new';
  const seen = (e: ReactFocusEvent<HTMLElement>): void => { const key = e.target instanceof HTMLElement ? e.target.getAttribute('data-nav-key') : null; if (key !== null) setLast(key); };
  const hideGlide = (): void => { glide.current?.removeAttribute('data-on'); };
  const follow = (e: ReactPointerEvent<HTMLElement>): void => {
    const box = glide.current, host = nav.current;
    if (box === null || host === null || e.pointerType === 'touch') return;
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-nav-item]') : null;
    if (el === null || el.hasAttribute('data-primary') || el.closest('[inert]') !== null) { hideGlide(); return; }
    const at = glideBox(el.getBoundingClientRect(), host.getBoundingClientRect());
    const fresh = !box.hasAttribute('data-on');
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
    const item = items[at]!, kind = item.getAttribute('data-fold');
    const move = foldMove(e.key, item.getAttribute('aria-expanded') === 'true', kind !== null, item.hasAttribute('data-parent'));
    if (move !== null) {
      e.preventDefault();
      if (move === 'in') items[at + 1]?.focus();
      else if (move === 'out') items.find(el => el.getAttribute('data-nav-key') === item.getAttribute('data-parent'))?.focus();
      else if (kind === 'section') setWorkShut(s => !s);
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
    <nav className="hm-nav" id="hm-nav" ref={nav} aria-label={WORDS.label.mainMenu} data-mode={mode} data-overlay={overlay ? '' : undefined} onFocus={seen} onKeyDown={e => { hideGlide(); rove(e); }} onPointerMove={follow} onPointerLeave={hideGlide} onClick={hideGlide}>
      <span className="hm-nav-glide" ref={glide} aria-hidden="true" />
      <div className="hm-nav-top">
        <IconButton icon="sidebar-left" label={toggleName} tip={toggleTip(toggleName, 'nav', mac)} side="right" aria-expanded={open} aria-controls="hm-nav" aria-keyshortcuts={keyShortcuts('nav')} data-nav-toggle="" onClick={p.onToggle} />
        <div className="hm-brand"><HIcon name="leaf" size={24} /><span>{WORDS.label.appName}</span></div>
      </div>
      <div className="hm-nav-body" onScroll={hideGlide}>
        <ul className="hm-nav-list">
          <li><Item {...item} navKey="new" icon="plus" label={WORDS.label.newHarness} primary onClick={p.onNewHarness} /></li>
        </ul>
        <div className="hm-nav-group">
          {rail ? null : (
            <button type="button" className="hm-nav-section" data-nav-item="" data-nav-key="sec-work" data-fold="section" tabIndex={stop === 'sec-work' ? 0 : -1} aria-expanded={workOpen} aria-controls="hm-nav-work" onClick={() => setWorkShut(s => !s)}>
              <span>{WORDS.label.workspace}</span><span className="hm-nav-chev" data-unfolded={workOpen ? '' : undefined} aria-hidden="true"><HIcon name="chevron" size={16} /></span>
            </button>
          )}
          <Fold id="hm-nav-work" open={workOpen}>
            <ul className="hm-nav-list">
              <li><Item {...item} navKey="harnesses" icon="harness" label={WORDS.label.harnesses} current={here === 'harnesses'} onClick={p.onHarnesses} /></li>
              <li>
                <Item {...item} navKey="library" icon="library" label={WORDS.label.library} folder current={here === 'library'} expanded={libOpen} controls="hm-nav-library" onClick={() => p.onLibrary(null)} />
                <Fold id="hm-nav-library" open={libOpen}>
                  <ul className="hm-nav-sub" aria-label={WORDS.label.libraryPages}>
                    <Branch count={PART_KINDS.length} />
                    {PART_KINDS.map(k => <li key={k}><Item {...item} navKey={`lib-${k}`} icon={KIND_ICON[k]} label={KIND_PLURAL[k]} sub current={current === `library-${k}`} onClick={() => p.onLibrary(k)} /></li>)}
                  </ul>
                </Fold>
              </li>
              <li><Item {...item} navKey="projects" icon="folder" label={WORDS.label.projects} current={here === 'projects'} onClick={p.onProjects} /></li>
              <li><Item {...item} navKey="runs" icon="play" label={WORDS.label.runs} current={here === 'runs'} onClick={p.onRuns} /></li>
            </ul>
          </Fold>
        </div>
      </div>
      <div className="hm-nav-low">
        <ul className="hm-nav-list">
          <li><Item {...item} navKey="interfaces" icon="monitor" label={WORDS.label.interfaces} current={here === 'interfaces'} onClick={p.onInterfaces} /></li>
          <li><Item {...item} navKey="history" icon="clock" label={WORDS.label.versionHistory} current={here === 'history'} onClick={p.onHistory} /></li>
          <li><Item {...item} navKey="help" icon="help" label={WORDS.label.help} current={here === 'help'} onClick={p.onHelp} /></li>
        </ul>
        <div className="hm-preview" data-preview=""><PreviewMark rail={rail} /></div>
      </div>
    </nav>
  );
}
