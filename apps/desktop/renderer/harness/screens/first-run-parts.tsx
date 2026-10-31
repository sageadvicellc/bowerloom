/**
 * The parts the two list screens of the first run share (Choose sources, Read sources): the brand line with the three steps over them, and the facts about one source (what it holds
 * and the interface it belongs to). The facts are computed from the sample world, so they match the Library.
 */
import type { ReactElement } from 'react';
import { KitIcon } from '../../home/kit/icons.js';
import { Stepper } from '../../home/kit/Stepper.js';
import { countsWords, partById } from '../../../shared/harness/status.js';
import { PART_KINDS } from '../../../shared/harness/types.js';
import type { HarnessState, PartKind, ScanSource } from '../../../shared/harness/types.js';
import { StateDot } from '../parts/controls.js';
import { WORDS } from '../words.js';
import { FLOW } from '../words-flow.js';
import './first-run.css';

const STEPS: readonly string[] = Object.freeze([FLOW.label.stepLook, FLOW.label.stepChoose, FLOW.label.stepRead]);

/** The leaf, the name and the steps. `current` is the index of the step the person is on: 0 is Look, 2 is Read. */
export function FirstHead({ current }: { current: number }): ReactElement {
  return (
    <>
      <p className="hxf-brand"><KitIcon name="leaf" size={20} /><span>{WORDS.label.appName}</span></p>
      <div className="hxf-steps"><Stepper steps={STEPS} current={current} label={FLOW.label.firstSteps} doneWord={FLOW.label.stepDone} /></div>
    </>
  );
}

/** "4 agents · 14 skills", from the parts the source holds. */
export function sourceCountsWords(state: HarnessState, source: ScanSource): string {
  const counts: Record<PartKind, number> = { agent: 0, skill: 0, tool: 0, context: 0 };
  for (const id of source.partIds) { const part = partById(state, id); if (part !== undefined) counts[part.kind] += 1; }
  return countsWords(counts);
}

/** The names of the parts a source holds, in plain words, kind by kind. */
export function sourceNames(state: HarnessState, source: ScanSource): string {
  const out: string[] = [];
  for (const kind of PART_KINDS) for (const id of source.partIds) { const part = partById(state, id); if (part !== undefined && part.kind === kind) out.push(part.name); }
  return out.join(', ');
}

/** The interface a source belongs to: a dot and its name. */
export function SourceVia({ source }: { source: ScanSource }): ReactElement {
  return <StateDot tone="good" className="hxf-via">{source.interfaceName}</StateDot>;
}
