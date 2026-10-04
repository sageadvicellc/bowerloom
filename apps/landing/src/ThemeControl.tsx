import { useEffect, useState } from 'react';
import { applyTheme, resolveTheme, savedThemePreference, THEME_STORAGE_KEY, themePreference } from './theme';

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
  return <div className="theme-control">
    <label htmlFor="site-theme">Theme</label>
    <select id="site-theme" value={preference} onChange={event => {
      const next = themePreference(event.target.value);
      setPreference(next);
      applyTheme(resolveTheme(next, window.matchMedia('(prefers-color-scheme: dark)').matches));
      try { window.localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* The current-page preference still works without storage. */ }
    }}>
      <option value="system">System</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </div>;
}
