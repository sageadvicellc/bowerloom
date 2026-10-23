/** The only messages between the window and the main process. The preload exposes one function for each; main answers each. */
export const CHANNELS = Object.freeze({
  getInfo: 'viewer:get-info',
  getSettings: 'viewer:get-settings',
  getSnapshot: 'viewer:get-snapshot',
  getItemContent: 'viewer:get-item-content',
  getFileText: 'viewer:get-file-text',
  chooseMode: 'viewer:choose-mode',
  addRoot: 'viewer:add-root',
  removeRoot: 'viewer:remove-root',
  setTheme: 'viewer:set-theme',
  checkForUpdates: 'viewer:check-for-updates',
  openLink: 'viewer:open-link',
} as const);
export type ChannelName = keyof typeof CHANNELS;
