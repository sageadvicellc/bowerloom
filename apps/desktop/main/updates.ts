/**
 * Updates. Off until the first release exists. `UPDATES_ENABLED` is a build-time constant, not a setting: a file that a person
 * or a program can edit must not be able to turn on network calls. While it is false this module makes no network call and
 * does not even load the updater. Turning it on later is a code change, and needs a signed build on macOS (an unsigned app
 * cannot update itself there).
 */
export const UPDATES_ENABLED = false;
export const UPDATE_FEED = Object.freeze({ provider: 'github' as const, owner: 'sageadvicellc', repo: 'bowerloom' });
export const OFF_TEXT = 'Updates turn on after the first release';

export interface UpdateState { enabled: boolean; status: string }

export function initialUpdateState(enabled: boolean): UpdateState {
  return { enabled, status: enabled ? 'Updates are on. Not checked yet.' : OFF_TEXT };
}

/** Checks for an update. Returns plain words. With updates off it returns at once and touches nothing. */
export async function checkForUpdates(state: UpdateState, load: () => Promise<{ autoUpdater: { autoDownload: boolean; setFeedURL(feed: unknown): void; checkForUpdates(): Promise<unknown> } }> = () => import('electron-updater') as never): Promise<UpdateState> {
  if (!state.enabled) return { ...state, status: `${OFF_TEXT}.` };
  try {
    const { autoUpdater } = await load();
    autoUpdater.autoDownload = false;
    autoUpdater.setFeedURL(UPDATE_FEED);
    await autoUpdater.checkForUpdates();
    return { ...state, status: 'Checked just now.' };
  } catch {
    return { ...state, status: 'Could not check for updates. Try again later.' };
  }
}
