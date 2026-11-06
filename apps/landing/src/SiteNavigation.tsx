import { readerRelease, docsPath, releasesUrl } from './release';
import { watchSections } from './nav-current';
import { useEffect, useRef, useState } from 'react';
import { repository } from './content';

/** The destinations that sit on the page, in page order. The desktop bar shows only the first two. */
const pageLinks = [
  { id: 'how-it-works', label: 'How it works', desktop: true },
  { id: 'app', label: 'The app', desktop: true },
  { id: 'command-line', label: 'The command line', desktop: false },
  { id: 'install', label: 'Install', desktop: false },
] as const;

const GITHUB_NAME = 'GitHub (opens in a new tab)';
function GitHubMark() {
  return <svg viewBox="0 0 16 16" width="22" height="22" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" /></svg>;
}

/** The desktop bar: three text links, then the GitHub icon. Articles stays out of the navigation until there is content planned for release. The theme toggle and the Get the app button sit after it in the header. */
function DesktopLinks({ current }: { current: string | null }) {
  return <>
    {pageLinks.filter(link => link.desktop).map(link => <a key={link.id} className="nav-link" href={`#${link.id}`} aria-current={current === link.id ? 'true' : undefined}>{link.label}</a>)}
    <a className="nav-link" href={docsPath}>Docs</a>
    <a className="nav-github" href={repository} target="_blank" rel="noopener noreferrer" aria-label={GITHUB_NAME}><GitHubMark /></a>
  </>;
}

/** The menu below the desktop width: every destination, then the button. */
function DrawerLinks({ current, onNavigate }: { current: string | null; onNavigate: () => void }) {
  return <>
    {pageLinks.map(link => <a key={link.id} href={`#${link.id}`} onClick={onNavigate} aria-current={current === link.id ? 'true' : undefined}>{link.label}</a>)}
    <a href={docsPath} onClick={onNavigate}>Docs</a>
    <a href={repository} target="_blank" rel="noopener noreferrer" onClick={onNavigate} aria-label={GITHUB_NAME}>GitHub <span aria-hidden="true">↗</span></a>
    <a className="button primary nav-cta" href={releasesUrl} target="_blank" rel="noopener noreferrer" onClick={onNavigate}>{CTA_TEXT}<span className="sr-only">{CTA_SUFFIX}</span></a>
  </>;
}

const CTA_TEXT = 'Get the app';
/** The same words and link as the hero button, so the accessible name is "Get the app (beta) (opens in a new tab)". */
const CTA_SUFFIX = ' (beta) (opens in a new tab)';

/** The filled button at the right end of the desktop bar. */
export function NavCta() {
  return <a className="button primary nav-cta nav-cta-bar" href={releasesUrl} target="_blank" rel="noopener noreferrer">{CTA_TEXT}<span className="sr-only">{CTA_SUFFIX}</span></a>;
}

export default function SiteNavigation() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => watchSections(id => document.getElementById(id), setCurrent), []);
  useEffect(() => {
    if (!open) return;
    const panel = dialog.current!;
    const previousOverflow = document.body.style.overflow;
    panel.showModal();
    document.body.style.overflow = 'hidden';
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => { if (desktop.matches) panel.close(); };
    desktop.addEventListener('change', closeOnDesktop);
    closeOnDesktop();
    return () => {
      desktop.removeEventListener('change', closeOnDesktop);
      document.body.style.overflow = previousOverflow;
      if (panel.open) panel.close();
    };
  }, [open]);
  const close = () => dialog.current?.close();
  return <>
    <nav className="desktop-navigation" aria-label="Main navigation"><DesktopLinks current={current} /></nav>
    <button className="mobile-menu-toggle" type="button" aria-label="Open navigation" aria-expanded={open} aria-controls="mobile-navigation" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
    </button>
    <dialog id="mobile-navigation" ref={dialog} className="mobile-drawer" aria-labelledby="mobile-navigation-title" onClose={() => setOpen(false)} onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = event.currentTarget.querySelectorAll<HTMLElement>('button, a[href]');
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div className="mobile-drawer-content">
        <div className="mobile-drawer-heading"><h2 id="mobile-navigation-title">Explore Bowerloom</h2><button type="button" aria-label="Close navigation" onClick={close} autoFocus><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button></div>
        <nav aria-label="Mobile navigation"><DrawerLinks current={current} onNavigate={close} /></nav>
        <p className="drawer-version">{readerRelease.label}</p>
      </div>
    </dialog>
  </>;
}
