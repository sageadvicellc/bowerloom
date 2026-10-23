/** The window's security settings and the rules for links and navigation. Pure, so tests can check them without Electron. */

/**
 * The page may load its own script and style files and nothing else: no inline script, no remote content, no
 * connection to any server, no frame, no form post.
 */
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const webPreferences = (preload: string) => ({
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  webviewTag: false,
  spellcheck: false,
  navigateOnDragDrop: false,
  preload,
}) as const;

/** The hosts the app may open in the person's browser. Each link must also be https, with no user name, password, or port. */
export const EXTERNAL_HOSTS: readonly string[] = Object.freeze(['github.com', 'www.npmjs.com', 'npmjs.com']);

export function isAllowedExternal(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f\u007f\s]/.test(value)) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === 'https:' && url.username === '' && url.password === '' && url.port === '' && EXTERNAL_HOSTS.includes(url.hostname);
}

/** True when `url` is the app's own page: the file the window loaded, with any hash. */
export function isAppUrl(url: string, appIndexUrl: string): boolean {
  try { const a = new URL(url), b = new URL(appIndexUrl); return a.protocol === 'file:' && a.pathname === b.pathname && a.search === ''; } catch { return false; }
}

/** What to do with a request from the page to go elsewhere. Navigation is never allowed; an allowed https link opens outside. */
export function decideNavigation(url: string, appIndexUrl: string): 'allow-app' | 'open-external' | 'block' {
  if (isAppUrl(url, appIndexUrl)) return 'allow-app';
  return isAllowedExternal(url) ? 'open-external' : 'block';
}

/** A request the session may let through: only files of the app itself. Everything on the network is cancelled. */
export function allowRequest(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'file:' || u.protocol === 'devtools:' || u.protocol === 'data:';
  } catch { return false; }
}
