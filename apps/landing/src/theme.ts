export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'bowerloom.theme';
export function themePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}
export function nextThemePreference(preference: ThemePreference): ThemePreference {
  return preference === 'light' ? 'dark' : preference === 'dark' ? 'system' : 'light';
}
export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  return preference === 'system' ? systemDark ? 'dark' : 'light' : preference;
}
export function savedThemePreference(): ThemePreference {
  try { return themePreference(window.localStorage.getItem(THEME_STORAGE_KEY)); }
  catch { return 'system'; }
}
export function applyTheme(theme: ResolvedTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#27262B' : '#F6EEE8');
  document.querySelector('link[rel="icon"]')?.setAttribute('href', `/brand/rose-conservatory/${theme === 'dark' ? 's4-g3-icon-dark.svg' : 's4-g3-icon.svg'}`);
}
