/**
 * What a person needs to trust a skill or a tool, read from the Library's own facts (library-model.ts, library-sample.ts) so the details panel and the Library page never differ:
 * for a skill that came from outside, who made it and which release it is; for a tool, what it reaches (a host, "This computer only", or nothing) and whether it can only
 * read or can change things. A skill the person made has none of this to show: "Made by you" says it. Pure: no React, no DOM, no clock.
 */
import type { World } from '../world/types.js';
import { libraryDetails } from './library-model.js';

/** Who made a skill and which release it is. */
export interface SkillTrust { readonly madeBy: string; readonly release: string | null }

/** What a tool reaches, and what it may do there. */
export interface ToolTrust { readonly reaches: string; readonly can: string }

const HOST = /^Reaches\s+/;

/** The maker and the release of a skill that came from outside, or null for a skill of the person's own (or one that is not there). */
export function skillTrust(world: World, id: string): SkillTrust | null {
  const d = libraryDetails(world, 'skill', id);
  return d === null || !d.origin.outside ? null : { madeBy: d.origin.author, release: d.origin.release };
}

/** What a tool reaches and what it can do, or null when the tool is not there. */
export function toolTrust(world: World, id: string): ToolTrust | null {
  const d = libraryDetails(world, 'tool', id);
  return d === null || d.reach === null || d.ability === null ? null : { reaches: d.reach.replace(HOST, ''), can: d.ability };
}
