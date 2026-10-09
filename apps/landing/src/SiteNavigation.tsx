import { readerRelease, docsPath, betaGuidePath } from './release';
import { useEffect, useRef, useState } from 'react';
import { repository } from './content';

function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  return <>
    <a href="#recipe" onClick={onNavigate}>The Labs workflow</a>
    <a href="#build" onClick={onNavigate}>Build with your agent</a>
    <a href={betaGuidePath} onClick={onNavigate}>Beta guide</a>
    <a href={docsPath} onClick={onNavigate}>Docs</a>
    <a href={repository} target="_blank" rel="noopener noreferrer" onClick={onNavigate} aria-label="GitHub (opens in a new tab)">GitHub <span aria-hidden="true">↗</span></a>
  </>;
}

export default function SiteNavigation() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const panel = dialog.current!;
    const previousOverflow = document.body.style.overflow;
    panel.showModal();
    document.body.style.overflow = 'hidden';
    const desktop = window.matchMedia('(min-width: 1281px)');
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
    <nav className="desktop-navigation" aria-label="Main navigation"><NavigationLinks /></nav>
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
        <nav aria-label="Mobile navigation"><NavigationLinks onNavigate={close} /></nav>
        <p className="drawer-version">{readerRelease.label}</p>
      </div>
    </dialog>
  </>;
}
