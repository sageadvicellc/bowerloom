/**
 * "Did this do what you wanted?" in the done step of an install or a new harness. One tap records the answer in the local usage log on this computer. On
 * Partly or No, one more question asks what the person was trying to do; Save keeps the words, Skip keeps only the answer. Nothing leaves the computer.
 * A write that fails is not shown: the check is a courtesy and never stops the sheet.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import { CHECK_NOTE_LIMIT } from '../../../shared/engine/types.js';
import type { CheckAnswer } from '../../../shared/engine/types.js';
import { HButton } from '../parts/controls.js';
import { ENGINE_WORDS } from '../words-engine.js';
import { CHECK_START, checkNext } from './check-logic.js';
import type { CheckAction, CheckState } from './check-logic.js';

const W = ENGINE_WORDS;

export interface AfterApplyCheckProps {
  /** Records the answer. The note is the person's own words, or null. */
  readonly record: (answer: CheckAnswer, note: string | null) => Promise<unknown>;
  /** The step to start in. For tests; the sheet leaves it out. */
  readonly initial?: CheckState;
}

export function AfterApplyCheck({ record, initial = CHECK_START }: AfterApplyCheckProps): ReactElement {
  const [state, setState] = useState<CheckState>(initial);
  const act = (action: CheckAction): void => {
    const next = checkNext(state, action);
    setState(next.state);
    if (next.record !== null) void Promise.resolve().then(() => record(next.record!.answer, next.record!.note)).catch(() => undefined);
  };
  if (state.step === 'thanks') return <p className="hxe-text hxe-muted" role="status" data-check="thanks">{W.paragraph.checkThanks}</p>;
  if (state.step === 'why') {
    return (
      <div className="hxe-check" data-check="why">
        <label className="hxe-text" htmlFor="hxe-check-note">{W.paragraph.checkWhy}</label>
        <textarea id="hxe-check-note" className="hxe-check-note" rows={3} maxLength={CHECK_NOTE_LIMIT} value={state.note} autoFocus onChange={e => act({ kind: 'type', note: e.currentTarget.value })} />
        <div className="hxe-check-row"><HButton variant="primary" onClick={() => act({ kind: 'save' })}>{W.label.checkSave}</HButton><HButton onClick={() => act({ kind: 'skip' })}>{W.label.checkSkip}</HButton></div>
      </div>
    );
  }
  return (
    <div className="hxe-check" role="group" aria-labelledby="hxe-check-ask" data-check="ask">
      <p className="hxe-text" id="hxe-check-ask">{W.paragraph.checkAsk}</p>
      <div className="hxe-check-row">
        <HButton onClick={() => act({ kind: 'answer', answer: 'yes' })}>{W.label.checkYes}</HButton>
        <HButton onClick={() => act({ kind: 'answer', answer: 'partly' })}>{W.label.checkPartly}</HButton>
        <HButton onClick={() => act({ kind: 'answer', answer: 'no' })}>{W.label.checkNo}</HButton>
      </div>
    </div>
  );
}
