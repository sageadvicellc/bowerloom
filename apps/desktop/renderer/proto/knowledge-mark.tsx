/** The mark of a domain folder in the key and in the rule builder: its colour and its shape, the same as on the graph. Decoration only: the folder's name is always beside it. */
import type { ReactElement } from 'react';
import { shapePath } from './knowledge-shapes.js';

export function DomainMark({ index }: { index: number }): ReactElement {
  return (
    <span className={`kn-sw kn-sw-${((index % 8) + 8) % 8}`} aria-hidden="true">
      <svg viewBox="-1.3 -1.3 2.6 2.6" focusable="false"><path d={shapePath(index)} /></svg>
    </span>
  );
}
