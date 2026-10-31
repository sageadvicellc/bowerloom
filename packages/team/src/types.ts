/** The shapes of a loaded team (teams and relay spec, sections 4, 5.1, and 9). */
import type { RelayMap, RelayRoute } from '../../authoring/src/contracts.js';
import type {
  ApprovalOptions, DefinitionFile, EngineId, GuardrailRule, JsonValue, Problem, SandboxRequirement,
} from '../../harness-definition/src/index.js';
import type { InboxMode, StartMode } from './words.js';

export type { RelayMap, RelayRoute };

/** The `x-<name>` blocks of an object, kept unchanged. */
export type Extensions = Readonly<Record<string, JsonValue>>;

/** Caps on active members, messages, and cost (section 7). */
export interface TeamLimits {
  readonly activeMembers: number;
  readonly messages?: { readonly perMember: number; readonly windowSeconds: number };
  readonly costUsd?: number;
}

/** Team guardrails, in the harness guardrail shape. They combine with each member's harness by restriction. */
export interface TeamGuardrails {
  readonly rules: readonly GuardrailRule[];
  readonly sandbox: readonly SandboxRequirement[];
}

/** A member as `team.json` writes it (section 4.2). */
export interface MemberFile {
  readonly id: string;
  readonly purpose: string;
  readonly engine: EngineId;
  readonly harness?: string;
  readonly model: string;
  readonly folder: string;
  readonly start: StartMode;
  readonly inbox: InboxMode;
  readonly reports_to: string;
  readonly extensions: Extensions;
}

/** `team.json` (section 4.1). */
export interface TeamFile {
  readonly format: string;
  readonly id: string;
  readonly description: string;
  readonly harness?: string;
  readonly members: readonly MemberFile[];
  /** The relay map pointer, always `maps/relay.json` when present. */
  readonly routes?: string;
  readonly limits: TeamLimits;
  readonly guardrails: TeamGuardrails;
  readonly extensions: Extensions;
}

/** A member with its harness resolved (decision 10) and its folder normalized. */
export interface TeamMember extends Omit<MemberFile, 'harness'> {
  readonly harness: string;
  /** Where the harness came from: the team default or the member's own. */
  readonly harnessFrom: 'team' | 'member';
  /** The folder, relative to the project, in normal form: `.`, `wt/maker`, or `../demo-maker`. */
  readonly folder: string;
}

/** A loaded team. */
export interface Team {
  /** The absolute path of the team folder, or null for a team checked in memory. */
  readonly folder: string | null;
  readonly file: TeamFile;
  readonly members: readonly TeamMember[];
  readonly relay: RelayMap | null;
  /** The files the revision covers, in byte order of path. */
  readonly files: readonly DefinitionFile[];
  readonly revision: string;
}

export type TeamLoadResult =
  | { readonly ok: true; readonly team: Team }
  | { readonly ok: false; readonly problems: readonly Problem[] };

export interface TeamOptions extends ApprovalOptions {
  /** Recorded fidelity approvals, from the app data folder (harness definition, "Approvals"). */
  readonly approvals?: readonly unknown[];
}
