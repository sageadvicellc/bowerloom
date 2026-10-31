/** The small label that follows the pointer while a card is dragged. It is hidden from a screen reader, and takes no pointer events, so the drop target under it is found. */
import type { ReactElement } from 'react';
import type { DragView } from './drag.js';

export function DragFollower({ drag, followRef }: { drag: DragView | null; followRef(el: HTMLElement | null): void }): ReactElement | null {
  return drag === null ? null : <div className="kit-follow" data-follow="" aria-hidden="true" ref={followRef}>{drag.label}</div>;
}
