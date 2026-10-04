import { useEffect, useState } from 'react';
import type { ThemePreference } from './theme';
import { applyTheme, resolveTheme, savedThemePreference, THEME_STORAGE_KEY, nextThemePreference } from './theme';

const themeNames = { light: 'Light (day)', dark: 'Dark (night)', system: 'System (day and night)' };
function ThemeIcon({ preference }: { preference: ThemePreference }) {
  return <svg key={preference} className="theme-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {preference === 'light' ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>
      : preference === 'dark' ? <path d="M20.4 14.3A8.7 8.7 0 0 1 9.7 3.6a8.8 8.8 0 1 0 10.7 10.7Z" />
      : <><circle cx="12" cy="12" r="5" /><path d="M12 7a5 5 0 0 0 0 10Z" fill="currentColor" stroke="none" /><path d="M12 2v2m0 16v2M2 12h2M4.9 4.9l1.4 1.4m-1.4 12.8 1.4-1.4M20 7v3m-1.5-1.5h3" /></>}
  </svg>;
}

export default function ThemeControl() {
  const [preference, setPreference] = useState(savedThemePreference);
  useEffect(() => {
    const system = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => applyTheme(resolveTheme(preference, system.matches));
    update();
    system.addEventListener('change', update);
    const sync = (event: StorageEvent) => { if (event.key === THEME_STORAGE_KEY || event.key === null) setPreference(savedThemePreference()); };
    window.addEventListener('storage', sync);
    return () => { system.removeEventListener('change', update); window.removeEventListener('storage', sync); };
  }, [preference]);
  const next = nextThemePreference(preference);
  const label = `Theme: ${themeNames[preference]}. Switch to ${themeNames[next]}.`;
  return <button className="theme-control theme-toggle" id="site-theme" type="button" data-preference={preference} aria-label={label} title={label} onClick={() => {
    setPreference(next);
    applyTheme(resolveTheme(next, window.matchMedia('(prefers-color-scheme: dark)').matches));
    try { window.localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* The current-page preference still works without storage. */ }
  }}><ThemeIcon preference={preference} /></button>;
}
