// Fixture harnesses for the dive tests: plain data built on the Overview sample, so no file and no clock is read.
import { createSampleOverviewState } from '../shared/harness/sample.js';
import type { Harness, HarnessState, Part } from '../shared/harness/types.js';

export const NOW = { daysAgo: 0, time: '10:00' };

const harness = (id: string, name: string, partIds: readonly string[], extra: Partial<Harness> = {}): Harness =>
  ({ id, name, summary: `${name} summary.`, partIds, links: [], positions: {}, missing: [], newPartIds: [], ...extra });

/** The Overview sample, with three fixture harnesses added: a mixed one, an empty one, and one that names a part it does not hold. */
export function fixtureState(): HarnessState {
  const base = createSampleOverviewState(NOW);
  const alpha = base.parts.filter(p => p.origin === 'src-alpha');
  const folderPart: Part = {
    id: 'agent-folder-held', kind: 'agent', name: 'Folder agent', summary: 'Held by a folder.', description: 'An agent a folder harness names.', path: 'weekly-report/.bowerloom/agents',
    source: 'weekly-report (Bowerloom)', origin: 'place-1', fileText: '', cannotUse: [], inLibrary: true, fromHarness: 'weekly-report',
  };
  const hidden: Part = { ...alpha[0]!, id: 'agent-hidden', name: 'Hidden agent', inLibrary: false };
  const mixed = harness('harness-mixed', 'Mixed fixture', [...alpha.map(p => p.id), 'agent-hidden'], { missing: [{ id: 'skill-gone', kind: 'skill', name: 'Gone skill' }] });
  const empty = harness('harness-empty', 'Empty fixture', []);
  return { ...base, parts: [...base.parts, folderPart, hidden], harnesses: [...base.harnesses, mixed, empty] };
}
