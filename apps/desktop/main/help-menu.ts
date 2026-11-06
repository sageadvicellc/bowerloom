/**
 * The Help menu of the application menu, as plain data so a test can read it without Electron. The two entries open a dialog that main builds: what a
 * problem report holds, and the usage log of this computer (main/diagnostics-dialogs.ts). Neither sends anything.
 */
export interface HelpMenuActions { readonly report: () => void; readonly usage: () => void }
export interface HelpMenuItem { label: string; click: () => void }
export interface HelpMenu { label: string; role: 'help'; submenu: HelpMenuItem[] }

export const HELP_LABELS = Object.freeze({ report: 'Report a problem…', usage: 'Usage log…' });

export function helpMenu(actions: HelpMenuActions): HelpMenu {
  return { label: 'Help', role: 'help', submenu: [{ label: HELP_LABELS.report, click: actions.report }, { label: HELP_LABELS.usage, click: actions.usage }] };
}
