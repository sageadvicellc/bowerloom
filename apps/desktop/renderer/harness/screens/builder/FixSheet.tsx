/**
 * The Fix sheet: a short sheet that says what changes before it changes it. A missing part is one that an agent names and the harness does not hold. "Add" puts the part of the Library
 * with that name into the harness, and the agent's link goes to it. Only the manifest changes; no file does. If the Library has no such part, the sheet says so and offers only Cancel.
 */
import type { ReactElement } from 'react';
import { fixFor } from '../../../../shared/harness/store.js';
import type { Harness, HarnessState } from '../../../../shared/harness/types.js';
import { Button } from '../../../home/kit/Button.js';
import { Sheet } from '../../parts/Sheet.js';
import { WORDS, addName, fixName, willUse } from '../../words.js';

export interface FixSheetProps { open: boolean; state: HarnessState; harness: Harness; missingId: string | null; onClose(): void; onFix(missingId: string): void }

export function FixSheet({ open, state, harness, missingId, onClose, onFix }: FixSheetProps): ReactElement | null {
  const ref = missingId === null ? undefined : harness.missing.find(m => m.id === missingId);
  const fix = missingId === null ? undefined : fixFor(state, harness.id, missingId);
  const users = ref === undefined ? [] : harness.links.filter(l => l.to === ref.id).map(l => state.parts.find(p => p.id === l.from)?.name).filter((n): n is string => n !== undefined);
  const name = ref?.name ?? '';
  return (
    <Sheet open={open} title={fixName(name)} onClose={onClose} width={520} dataSlot="fix"
      actions={<>
        <Button onClick={onClose}>{WORDS.label.cancel}</Button>
        {fix === undefined ? null : <Button variant="primary" onClick={() => onFix(fix.ref.id)}>{addName(name)}</Button>}
      </>}>
      <div className="hx-fix-body">
        {fix === undefined
          ? <p className="hx-text" data-budget="paragraph">{`Your Library has no ${ref?.kind ?? 'part'} named ${name}.`}</p>
          : <>
            <p className="hx-text" data-budget="paragraph">{`Bowerloom adds the ${fix.ref.kind} ${name} from your Library to ${harness.name}.`}</p>
            {users.length === 0 ? null : <p className="hx-text">{willUse(users)}</p>}
            <p className="hx-text hx-muted">{WORDS.hint.fixManifest}</p>
          </>}
      </div>
    </Sheet>
  );
}
