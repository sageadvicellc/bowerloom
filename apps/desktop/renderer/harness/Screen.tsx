/**
 * The frame of one screen inside the shell: the top row (the page title, the page's own buttons, and the details toggle last of all), then the stage and, at the right, the details column.
 * A screen passes its title, its tools, its stage and its details; the details column is put away and brought back by the toggle in the top row (or Cmd+Shift+B).
 * The stage is `main` and has the id `main`, so the page's "Skip to the content" link lands on it.
 */
import type { ReactElement, ReactNode } from 'react';
import { IconButton } from '../home/kit/IconButton.js';
import { keyShortcuts, onMac, toggleTip } from '../home/shell/shell-state.js';
import { useShell } from './Shell.js';
import { WORDS } from './words.js';

export interface ScreenProps {
  title: string;
  /** Muted words after the title, such as "11 parts". */
  count?: string;
  /** Muted words in the place of the count that carry a state, such as the dot of the file view. */
  titleExtra?: ReactNode;
  /** The page's own buttons, at the right of the top row. */
  tools?: ReactNode;
  /** The details column. Left out, the screen has no column and no toggle. */
  details?: ReactNode;
  /** A stage with no padding and no scroll, for the graph. */
  flush?: boolean;
  /** A drawer (the kit's Drawer) that opens over the right edge of the body. It is drawn inside the body, so it covers the details column while it is open. */
  drawer?: ReactNode;
  children?: ReactNode;
  /** The tests find a screen by this name. */
  slot: string;
}

export function Screen({ title, count, titleExtra, tools, details, flush = false, drawer, children, slot }: ScreenProps): ReactElement {
  const shell = useShell(), mac = onMac();
  const name = shell.detailsOpen ? WORDS.label.hideDetails : WORDS.label.showDetails;
  const hasDetails = details !== undefined && details !== null;
  return (
    <div className="hm-col" data-screen={slot}>
      <header className="hm-topbar">
        {shell.navButton()}
        <h1 className="kit-heading hx-title" tabIndex={-1}>{title}</h1>
        {count === undefined ? null : <span className="hx-count">{count}</span>}
        {titleExtra}
        <div className="hm-topbar-tools">
          {tools}
          {hasDetails ? <IconButton icon="sidebar-right" label={name} tip={toggleTip(name, 'details', mac)} side="below-end" aria-expanded={shell.detailsOpen} aria-controls="hm-panel" aria-keyshortcuts={keyShortcuts('details')} data-details-toggle="" onClick={shell.toggleDetails} /> : null}
        </div>
      </header>
      <div className="hm-body" data-details={!hasDetails || !shell.detailsOpen ? 'closed' : undefined}>
        <main id="main" className="hm-stage hx-stage" data-flush={flush ? '' : undefined}>{children}</main>
        {hasDetails && shell.detailsOpen ? <aside className="hm-panel hx-panel" id="hm-panel" aria-label={WORDS.label.detailsPanel}>{details}</aside> : null}
        {drawer}
      </div>
    </div>
  );
}

/** The head of a details column: a large tile, the name, and a muted line under it. */
export function DetailsHead({ tile, title, subtitle, children }: { tile: ReactNode; title: string; subtitle?: string; children?: ReactNode }): ReactElement {
  return (
    <div className="hx-dhead">
      {tile}
      <div className="hx-dhead-text">
        <h2 className="kit-heading hx-dtitle" id="hm-panel-title" tabIndex={-1}>{title}</h2>
        {subtitle === undefined ? null : <span className="hx-dsub">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}
