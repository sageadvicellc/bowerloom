/**
 * "Discard N changes?" (owner decision Q1A): the person leaves a folder in the Builder while its draft holds unsaved changes. "Keep editing" stays, and
 * "Discard" drops the folder's draft and goes on. Nothing on the disk changes either way: the draft was never written.
 */
import type { ReactElement } from 'react';
import { Sheet } from '../../parts/Sheet.js';
import { HButton } from '../../parts/controls.js';
import { WORDS, discardWords } from '../../words.js';

export function DiscardSheet({ count, onKeep, onDiscard }: { count: number | null; onKeep(): void; onDiscard(): void }): ReactElement | null {
  return (
    <Sheet open={count !== null} title={discardWords(count ?? 0)} onClose={onKeep} width={480} dataSlot="discard"
      actions={<>
        <HButton onClick={onKeep}>{WORDS.label.keepEditing}</HButton>
        <HButton variant="primary" data-discard="" onClick={onDiscard}>{WORDS.label.discard}</HButton>
      </>}>
      <p className="hx-text">{WORDS.hint.discardNote}</p>
    </Sheet>
  );
}
