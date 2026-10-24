/**
 * How each wire is drawn, worked out so that pointing at a thing changes only the wires next to it. Every wire object keeps its
 * identity while its state is the same, so the canvas does not redraw the others.
 */
import type { Edge } from '@xyflow/react';
import type { MapEdge, MapNode } from '../../shared/mapmodel.js';

/** `dim`: drawn faintly (the default). `plain`: drawn normally (show all wires). `active`: next to the chosen thing. `faded`: not next to it, while all are shown. */
export type WireState = 'dim' | 'plain' | 'active' | 'faded';

export function wireState(e: Pick<MapEdge, 'from' | 'to'>, activeId: string | null, showAll: boolean): WireState {
  if (activeId !== null && (e.from === activeId || e.to === activeId)) return 'active';
  if (activeId !== null) return showAll ? 'faded' : 'dim';
  return showAll ? 'plain' : 'dim';
}
const CLASS: Record<WireState, string> = { dim: ' is-dim', plain: '', active: ' is-active', faded: ' is-faded' };

export interface WireCache { edges(list: readonly MapEdge[], activeId: string | null, showAll: boolean): Edge[] }

export function createWireCache(): WireCache {
  const made = new Map<string, Edge>();
  return {
    edges(list, activeId, showAll) {
      const live = new Set<string>();
      const out = list.map(e => {
        const state = wireState(e, activeId, showAll), key = `${e.id}|${e.rel}|${state}`; live.add(key);
        let edge = made.get(key);
        if (edge === undefined) { edge = { id: e.id, source: e.from, target: e.to, type: 'smoothstep', className: `bw-edge rel-${e.rel}${CLASS[state]}`, selectable: false, focusable: false, data: { rel: e.rel } }; made.set(key, edge); }
        return edge;
      });
      // Forget wires that are no longer on the map, so the cache does not grow.
      if (made.size > live.size * 4) for (const k of made.keys()) if (!live.has(k) && !k.endsWith('|active')) made.delete(k);
      return out;
    },
  };
}

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
/** True when two nodes say the same thing, so the first one's object can be kept and the canvas does not redraw it. */
export function sameNode(a: MapNode, b: MapNode): boolean {
  return a.id === b.id && a.kind === b.kind && a.label === b.label && a.scope === b.scope && a.description === b.description && a.status === b.status && a.owner === b.owner && a.unlisted === b.unlisted && same(a.reasons, b.reasons)
    && (a.cluster?.count ?? 0) === (b.cluster?.count ?? 0) && JSON.stringify(a.link) === JSON.stringify(b.link);
}
