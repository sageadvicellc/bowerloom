/**
 * The fixed brief of a team kept in the store. A store team is built from this and a profile, and never from a
 * project's `brief.json`, so two stores that build the same team id from the same profile hold equal files.
 * Spec 06 reuses it for a project that has a config and no brief.
 *
 * Do not pass it through `startupInternals.normalize`: that function refuses a target that holds `.bowerloom`. The
 * fields are already in the normalized form (a test proves `normalize` returns them unchanged for a safe target).
 */
import type { StartupProfile } from '../../startup/src/profiles.js';
import type { NormalizedBrief } from '../../startup/src/scaffold.js';

export const STORE_BRIEF = Object.freeze({
  projectName: 'Store team',
  goal: 'A team kept in the Bowerloom store. A project that selects it sets its own goal.',
  assistantName: 'Personal assistant',
  teamName: 'Store team',
  reviewMode: 'milestones' as const,
});

/** The store brief with the chosen profile, engineer when none is given. A new object each call. */
export function storeBrief(profile: StartupProfile | undefined): NormalizedBrief {
  return { ...STORE_BRIEF, profile: profile ?? 'engineer' };
}
