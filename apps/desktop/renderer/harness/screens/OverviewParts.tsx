/**
 * The two small parts every place of the Overview draws, in the graph, the list and the details: the mark that says whether the place is in Bowerloom, and its one button.
 * A place that main knows, with a harness, says "In Bowerloom" and offers "Open in builder". A place under home that main does not know says "Not in Bowerloom yet" and offers
 * "Choose this folder". A place outside home says nothing about itself (main knows such a folder by its full path, which the window never holds) and offers "Choose this folder".
 * The buttons only move: "Open in builder" goes to the builder's address, and "Choose this folder" opens the system chooser. Nothing is written.
 */
import type { ReactElement } from 'react';
import type { OverviewGroup } from '../../../shared/harness/overview.js';
import { HButton, StateDot } from '../parts/controls.js';
import { WORDS, openFolderName } from '../words.js';
import { OVERVIEW, chooseFolderName } from '../words-overview.js';
import { placeAction, placeStatus } from './OverviewModel.js';

/** What the screen lets a place do. */
export interface PlaceTools {
  /** False when the window has no engine bridge: main cannot be asked, so no button is drawn. */
  readonly available: boolean;
  /** True while the system chooser is open. */
  readonly busy: boolean;
  open(group: OverviewGroup): void;
  choose(group: OverviewGroup): void;
}

/** "In Bowerloom" or "Not in Bowerloom yet" as a dot and words; nothing for a place outside home, which the Overview cannot tell. */
export function PlaceMark({ group }: { group: OverviewGroup }): ReactElement | null {
  const status = placeStatus(group);
  if (status === 'unknown') return null;
  return <StateDot tone={status === 'in' ? 'good' : 'quiet'} className="hxo-mark" >{status === 'in' ? OVERVIEW.label.inBowerloom : OVERVIEW.label.notInBowerloom}</StateDot>;
}

/** The one button of a place, or nothing when the window cannot ask main. */
export function PlaceAction({ group, tools }: { group: OverviewGroup; tools: PlaceTools }): ReactElement | null {
  if (!tools.available) return null;
  if (placeAction(group) === 'open') {
    return <HButton icon="harness" size="small" data-open-builder={group.folderId ?? undefined} aria-label={openFolderName(group.name)} onClick={() => tools.open(group)}>{WORDS.label.openInBuilder}</HButton>;
  }
  return <HButton icon="folder" size="small" data-choose-folder={group.id} aria-label={chooseFolderName(group.name)} disabled={tools.busy} onClick={() => tools.choose(group)}>{OVERVIEW.label.chooseThisFolder}</HButton>;
}
