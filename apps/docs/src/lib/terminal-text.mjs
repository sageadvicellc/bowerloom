// Browser-safe helpers for terminal samples. No Node imports here: the page script uses this file too.
/** The commands of a terminal, one per line. This is what the Copy button puts on the clipboard. */
export const terminalCopyText = terminal => terminal.lines.filter(line => line.kind === 'cmd').map(line => line.text).join('\n');
/** The same text from a rendered panel (or anything with querySelectorAll). */
export const commandsFromPanel = panel => [...panel.querySelectorAll('.vt-cmd')].map(node => node.textContent).join('\n');
