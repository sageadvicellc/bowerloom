/**
 * The fixed words of a team: formats, start and inbox words, delivery modes, and the names a team folder may hold.
 * Teams and relay spec, sections 4, 5, 6, and 9.
 */
import { FORMATS } from '../../authoring/src/contracts.js';

/** The format name and version in `team.json`. */
export const TEAM_FORMAT = 'bowerloom/team/v1beta1' as const;
/** The 0.7 relay map, kept as it is (section 5.1): `maps/relay.json`. */
export const RELAY_MAP_FORMAT = FORMATS.relay;
/** The only place a relay map lives, relative to the team folder (section 9). */
export const RELAY_MAP_PATH = 'maps/relay.json' as const;
/** The folder that keeps unchanged 0.7 files, and the block in `team.json` that keeps 0.7 fields (section 9). */
export const CREW_BLOCK = 'x-crew-v0.7' as const;
/** The format of the 0.7 crew file that adoption reads. */
export const CREW_FORMAT_07 = 'trellis/crew/v0.7-alpha' as const;
/** The format name and version of a start plan. */
export const START_PLAN_FORMAT = 'bowerloom/team-start-plan/v1beta1' as const;

/** How Bowerloom starts an instance (section 4.2). */
export const START_MODES = Object.freeze(['headless', 'server', 'manual'] as const);
export type StartMode = (typeof START_MODES)[number];
/** What an instance does with arriving messages (section 4.2). */
export const INBOX_MODES = Object.freeze(['accept', 'hold', 'refuse'] as const);
export type InboxMode = (typeof INBOX_MODES)[number];
/** How a message reaches an instance, strongest first (section 6). */
export const DELIVERY_MODES = Object.freeze(['push', 'turn', 'pull'] as const);
export type DeliveryMode = (typeof DELIVERY_MODES)[number];
/** The 0.7 model classes. Decision 5 drops them: a class is never a model name. */
export const MODEL_CLASSES = Object.freeze(['economy', 'standard', 'reasoning'] as const);
/** The value of `reports_to` for a member that reports to a person. */
export const HUMAN = 'human' as const;

/** Top-level names of a 0.8 team folder (section 9). */
export const TEAM_NAMES = Object.freeze(['team.json', 'maps', CREW_BLOCK] as const);
/**
 * Names a 0.7 team folder holds. A 0.8 loader neither reads nor changes them, so a team adopted in place still loads.
 * The list is a snapshot of the 0.7 store teams; a name 0.7 adds later must join it.
 */
export const TEAM_LEGACY_NAMES = Object.freeze(['team.yaml', 'agents', 'prompts', 'skills', 'assets'] as const);
/** Names in `maps/`: the relay map, and the 0.7 vines map that 0.8 does not read. */
export const MAP_NAMES = Object.freeze(['relay.json', 'vines.json'] as const);

/** Bounds on a team. */
export const TEAM_LIMITS = Object.freeze({
  members: 64,
  activeMembers: 64,
  messagesPerMember: 10_000,
  windowSeconds: 86_400,
  costUsd: 100_000,
  files: 1024,
  totalBytes: 32 * 1024 * 1024,
  keptDepth: 8,
  problems: 200,
});
