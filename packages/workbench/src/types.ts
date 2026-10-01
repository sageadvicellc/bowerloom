import type { AuthoredCrew } from '../../authoring/src/index.js';
import type { GraphInput, GraphStatus } from '../../graph/src/index.js';
import type { SessionPort } from '../../../apps/cli/src/session.js';

export interface WorkbenchInput {
  bundle: AuthoredCrew;
  frozenScenario: string;
  installedGraph: GraphInput;
  registeredManifest: string;
  softwareRevision: string;
  installationId: string;
  designation: 'authored' | 'reference';
}
export type WorkbenchCommand =
  | { command: 'up' | 'start'; tier: 'pro' | '5x' | '20x' }
  | { command: 'read' | 'review' | 'cancel' }
  | { command: 'approve'; candidate: string; action: string };
/** Trusted controller capability, bound to an already provisioned installation. Never supplied by an authored bundle. */
export interface InstalledSessions {
  installationId: string;
  open(mode: 'start' | 'read' | 'cancel'): Promise<SessionPort>;
}
export interface WorkbenchDependencies {
  sessions: InstalledSessions;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}
export interface WorkbenchBindings {
  softwareRevision: string;
  installationId: string;
  designation: 'authored' | 'reference';
  bundleDigest: string;
  candidateRevision: string;
  authoringRevision: string;
  graphId: string;
  graphDigest: string;
  scenario: { id: 'craft-shop-v1'; revision: 'r1'; digest: string; inputs: { asset: string; digest: string; bytes: number }[] };
  tester: { manifestDigest: string; testerDigest: string; environmentDigest: string };
}
export type WorkbenchOutcome = 'pending' | 'held' | 'cancelled' | 'acceptance-failed' | 'accepted' | 'incomplete' | 'unavailable';
export interface WorkbenchEvidence {
  format: 'trellis/workbench-session/v0.7-alpha';
  bindings: WorkbenchBindings;
  bindingsDigest: string;
  command: WorkbenchCommand;
  startedAtMs: number;
  endedAtMs: number | null;
  durationMs: number | null;
  commandStatus: 'completed' | 'failed';
  outcome: WorkbenchOutcome;
  errorCode: string | null;
  cleanup: 'not-opened' | 'closed' | 'unknown';
  graphStatus: GraphStatus | null;
  summary: object | null;
  calls: { open: number; status: number; run: number; advance: number; approve: number; cancel: number; close: number };
  observed: { proposals: number; writeReceipts: number; acceptedTests: number; completedTasks: number; completedModelOutcomes: number };
  // SessionPort exposes durable state, not provider counters or command-local launch/effect counts.
  executionCounts: { modelStarts: null; effectWrites: null; browserStarts: null };
  usage: { status: 'unavailable'; providerTokens: null; retainedAllowanceChange: null };
  capacityTierCalibration: 'unmeasured';
  comparison: 'not-evaluated';
}
