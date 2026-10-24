/** The one legend: what each kind of wire means, in the words the map and the sketch board both use. */
import type { ReactElement } from 'react';
import { EDGE_RELS, REL_WORDS } from '../../shared/mapmodel.js';
import type { EdgeRel } from '../../shared/mapmodel.js';

export function Legend({ rels = EDGE_RELS }: { rels?: readonly EdgeRel[] }): ReactElement {
  return <ul className="bw-legend" aria-label="What the wires mean">{rels.map(r => <li key={r}><svg width="34" height="10" aria-hidden="true"><path d="M1 5h32" className={`bw-edge rel-${r}`} /></svg>{REL_WORDS[r]}</li>)}</ul>;
}
