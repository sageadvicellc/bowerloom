import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

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
].join('; ');

// The temporary data folder rules of the made-up launches are shared with the launcher, which cannot load TypeScript. See temp-data.mjs.
export { E2E_PREFIX, SAMPLE_PREFIX, TEMP_PREFIXES, chooseUserData, isTempDataPath, makeTempDataDir, mayRemoveTempDir, removeAndReport, removeTempDataDir, userDataArg } from './temp-data.mjs';

/** The window's settings. `preload` is the bridge script; a made-up launch gets none (pass undefined), so its page has no bridge at all. */
export const webPreferences = (preload: string | undefined, packaged = false) => ({
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
  // The developer tools are available only in a build that is run from source.
  devTools: !packaged,
  ...(preload === undefined ? {} : { preload }),
}) as const;

/** The hosts the app may open in the person's browser. Each link must also be https, with no user name, password, or port. */
export const EXTERNAL_HOSTS: readonly string[] = Object.freeze(['github.com', 'www.npmjs.com', 'npmjs.com']);

export function isAllowedExternal(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f\u007f\s]/.test(value)) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  return url.protocol === 'https:' && url.username === '' && url.password === '' && url.port === '' && EXTERNAL_HOSTS.includes(url.hostname);
}

/** True when `url` is the app's own page, with any hash: same scheme, same host, same path, no query. */
export function isAppUrl(url: string, appIndexUrl: string): boolean {
  try { const a = new URL(url), b = new URL(appIndexUrl); return a.protocol === b.protocol && a.host === b.host && a.pathname === b.pathname && a.search === ''; } catch { return false; }
}

/** The page is served from this address, by the app itself (see `resolveAppFile`). The Chromium file loader is not used, because it cannot read the packaged archive reliably. */
export const APP_SCHEME = 'app';
export const APP_HOST = 'viewer';
export const APP_INDEX = `${APP_SCHEME}://${APP_HOST}/index.html`;

/**
 * The file a page address names, below `folder`, or null. The path is decoded, resolved, and compared as the folder plus a
 * separator, so `..`, an encoded `..`, a folder next to it with a longer name, and a NUL are all refused.
 */
export function resolveAppFile(folder: string, pathname: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const root = resolve(folder), file = resolve(root, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
  return file === root || file.startsWith(root.endsWith(sep) ? root : root + sep) ? file : null;
}

/** What to do with a request from the page to go elsewhere. Navigation is never allowed; an allowed https link opens outside. */
export function decideNavigation(url: string, appIndexUrl: string): 'allow-app' | 'open-external' | 'block' {
  if (isAppUrl(url, appIndexUrl)) return 'allow-app';
  return isAllowedExternal(url) ? 'open-external' : 'block';
}

/**
 * Whether the page that sent a call to the real-setup reader may be answered. The answer is yes only in real mode, and only for the app's
 * own page (any hash). `frameUrl` is null when there is no sender frame.
 */
export function isAllowedRealSender(realMode: boolean, frameUrl: string | null, appIndexUrl: string): boolean {
  return realMode && frameUrl !== null && decideNavigation(frameUrl, appIndexUrl) === 'allow-app';
}

/**
 * A request the session may let through: a file under the app's own `dist` folder (compared as a resolved path plus a separator,
 * so a folder next to it with a longer name is not let through), and nothing on the network.
 */
export function allowRequest(url: string, distDir: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol === 'devtools:') return true;
  if (u.protocol === `${APP_SCHEME}:`) return u.host === APP_HOST;
  if (u.protocol !== 'file:' || u.host !== '') return false;
  let path: string;
  try { path = resolve(fileURLToPath(u)); } catch { return false; }
  const root = resolve(distDir);
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}
