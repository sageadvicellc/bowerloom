/** Small outline icons for the nodes of the harness graph. Drawn here as paths: no emoji, no outside icon set, no markup built from text. */
import type { ReactElement } from 'react';
import type { HarnessNode } from '../../shared/proto/harnessmodel.js';

/** The icons: one per kind of node, one per kind of tool, and `hook` and `runs-code` for the badge on a hook, and `saved` for the result panel. */
export type HarnessIconName = 'scope' | 'interface' | 'skill' | 'agent' | 'tool-mcp' | 'tool-prompt' | 'tool-hook' | 'slice' | 'group' | 'hook' | 'runs-code' | 'saved';

const PATHS: Readonly<Record<HarnessIconName, readonly string[]>> = {
  // A folder with a flag: the place a harness lives.
  scope: ['M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z', 'M9 13h6'],
  // A window with a title bar: the program a person talks to.
  interface: ['M3.5 5.5h17v13h-17z', 'M3.5 9.5h17', 'M6.5 7.5h.01', 'M9 7.5h.01'],
  // A bolt: a quick, reusable move.
  skill: ['M13 3 5 13h6l-1 8 8-10h-6z'],
  // A head and shoulders: a named role.
  agent: ['M12 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6', 'M9.5 5.2h-.01', 'M14.5 5.2h-.01'],
  // A plug: a server an agent connects to.
  'tool-mcp': ['M9 3v5', 'M15 3v5', 'M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0z', 'M12 17v4'],
  // A speech bubble with a line of text: a saved prompt.
  'tool-prompt': ['M4 5h16v11H9l-5 4z', 'M8 9h8', 'M8 12.5h5'],
  // A hook: a script that runs on its own.
  'tool-hook': ['M12 3v9', 'M12 12a4 4 0 1 0 8 0', 'M9.5 5.5 12 3l2.5 2.5'],
  // Three stacked pages with a cut corner: a chosen part of the knowledge base.
  slice: ['M5 4.5h10l4 4v11H5z', 'M15 4.5v4h4', 'M8.5 12h7', 'M8.5 15.5h5'],
  // A box with a stack behind it: a library of items.
  group: ['M5 9h12v10H5z', 'M8 6h12v10', 'M10.5 13.5h4'],
  // The same hook, for the small badge.
  hook: ['M12 3v9', 'M12 12a4 4 0 1 0 8 0', 'M9.5 5.5 12 3l2.5 2.5'],
  // A play triangle in a ring: it runs.
  'runs-code': ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'M10 8.5 15.5 12 10 15.5z'],
  // A check in a ring: it worked, and the result is saved.
  saved: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'M8 12.2l2.8 2.8L16 9.5'],
};

/** The icon that goes with a node: by kind, and by tool kind for a tool. */
export function iconNameOf(n: Pick<HarnessNode, 'kind' | 'toolKind'>): HarnessIconName {
  switch (n.kind) {
    case 'tool': return n.toolKind === 'hook' ? 'tool-hook' : n.toolKind === 'prompt' ? 'tool-prompt' : 'tool-mcp';
    case 'context-slice': return 'slice';
    default: return n.kind;
  }
}

/** One icon, drawn from its paths. It is decoration: the words next to it say the same thing, so it is hidden from a screen reader. */
export function HarnessIcon({ name, size = 18 }: { name: HarnessIconName; size?: number }): ReactElement {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{PATHS[name].map(d => <path key={d} d={d} />)}</svg>;
}

/** Every icon name, for a test or a legend. */
export const HARNESS_ICON_NAMES: readonly HarnessIconName[] = Object.keys(PATHS) as HarnessIconName[];

/** The paths of one icon, for a place that draws its own `svg`, such as the navigation. */
export const iconPaths = (name: HarnessIconName): readonly string[] => PATHS[name];
