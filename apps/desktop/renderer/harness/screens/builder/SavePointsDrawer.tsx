/**
 * The Builder's "Save points" drawer: the folder's save points from the shared editor (FolderEditor.tsx), newest first, each with "Go back", and "Set old save
 * points aside" when the record is damaged. Go back opens the save sheet on its review step with that plan, reviewed and approved there; nothing here writes.
 */
import type { ReactElement } from 'react';
import type { Answer, VersionView } from '../../../../shared/engine/types.js';
import { Drawer } from '../../../home/kit/Drawer.js';
import { SavePoints } from '../../FolderEditor.js';
import type { SetAsideParts } from '../../FolderEditor.js';
import { ENGINE_WORDS } from '../../words-engine.js';

export interface SavePointsDrawerProps {
  open: boolean;
  versions: Answer<readonly VersionView[]> | null;
  held: boolean;
  setAside: SetAsideParts;
  onGoBack(version: string): void;
  onClose(): void;
  returnTo(): HTMLElement | null;
}

export function SavePointsDrawer({ open, versions, held, setAside, onGoBack, onClose, returnTo }: SavePointsDrawerProps): ReactElement {
  return (
    <Drawer open={open} title={ENGINE_WORDS.label.savePoints} onClose={onClose} dataSlot="save-points" returnTo={returnTo}>
      <SavePoints versions={versions} held={held} onGoBack={onGoBack} setAside={setAside} />
    </Drawer>
  );
}
