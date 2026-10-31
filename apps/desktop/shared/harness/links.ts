/** One rule for the links of a harness that was made from a scan: each part that is not an agent goes to an agent in turn, so the graph is not empty. */
import type { Link } from './types.js';

export function autoLinks(agentIds: readonly string[], otherIds: readonly string[]): Link[] {
  return agentIds.length === 0 ? [] : otherIds.map((to, i) => ({ from: agentIds[i % agentIds.length]!, to }));
}
