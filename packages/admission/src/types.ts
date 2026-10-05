export type Role = 'lead' | 'reviewer' | 'worker' | 'support';
export interface AdmissionPolicy {
  thresholdPercent: number;
  maxWorkers: number;
  maxObservationAgeMs: number;
  headroomPercent: number;
  admittedRoutes: string[];
  completedResetPolicy: 'hold' | 'release-covered';
}
export interface UsageWindow {
  usedPercent: number;
  durationMs: number;
  resetAtMs: number;
  // Null means the observer cannot attest that usage through this instant is included.
  accountedThroughMs: number | null;
}
export interface Applicability { requiredWindows: string[]; optionalWindows: string[] }
export interface AccountObservation {
  observationId: string;
  accountId: string;
  observedAtMs: number;
  authentication: 'subscription' | 'none' | 'other';
  ordinaryUsageAllowed: boolean;
  windows: Record<string, UsageWindow | null>;
  routes: Record<string, Applicability | null>;
}
export interface ObservationReader {
  // Implement separately at the trusted controller boundary; no reader is wired by this package.
  read(accountAlias: string): Promise<AccountObservation>;
}
export interface ReservationRequest {
  accountAlias: string;
  jobId: string;
  candidateRevision: string;
  modelRoute: string;
  role: Role;
  attempt: 'initial' | 'retry';
  allowancePercent: Record<string, number>;
  paidFallback: false;
}
export interface RetainedAllowance { percent: number; resetAtMs: number; durationMs: number }
export interface ReconciliationProof {
  kind: 'not-started' | 'completed';
  proofRef: string;
  observedAtMs: number;
  processRef: string | null;
  // Trusted supervisor attestation: this named launcher is terminated or cannot dispatch again.
  fencedLauncherId: string | null;
}
export interface Reservation {
  request: ReservationRequest;
  requestDigest: string;
  reservationId: string;
  status: 'RESERVED' | 'LAUNCHING' | 'RUNNING' | 'UNKNOWN' | 'COMPLETED' | 'CANCELLED';
  createdAtMs: number;
  claimedAtMs: number | null;
  launcherId: string | null;
  completedAtMs: number | null;
  processRef: string | null;
  permitHash: string | null;
  retained: Record<string, RetainedAllowance>;
  proofs: ReconciliationProof[];
}
export interface AccountState {
  version: 1;
  accountId: string;
  aliases: string[];
  policy: AdmissionPolicy;
  observation: AccountObservation | null;
  highWater: Record<string, { usedPercent: number; resetAtMs: number; durationMs: number }>;
  reservations: Record<string, Reservation>;
}
export type CapacityDecision = { allowed: true; windows: string[] } | { allowed: false; reason: string };
export type ReservationView = Omit<Reservation, 'permitHash'>;
export type ReserveResult = { kind: 'accepted'; reservation: ReservationView; launchPermit: string }
  | { kind: 'existing'; reservation: ReservationView }
  | { kind: 'denied'; reason: string };
export type LaunchResult = { kind: 'started'; reservation: ReservationView }
  | { kind: 'denied'; reason: string };

/** Trusted host configuration. Never supplied by task text or a model. */
export interface AdmissionControlIdentity { installationId: string; databaseName: string }
export interface AdmissionControlBinding extends AdmissionControlIdentity {
  admissionSchema: string; launcherId: string; accountId: string; accountAlias: string;
  requestDigest: string; authorizationRevision: string; expiresAtMs: number;
}
export interface AdmissionControl {
  binding: AdmissionControlBinding;
  signal: AbortSignal;
  /** Synchronous host coordinator/local-control fence. A Promise result is refused. */
  assert(): void;
}
export interface AdmissionDispatchEnvelope {
  format: 'bowerloom/admission-dispatch/v1';
  binding: Readonly<AdmissionControlBinding>;
  reservationId: string; requestDigest: string; claimedAtMs: number;
  notAfterWallMs: number; notAfterHrNs: string; parentWallMs: number; parentHrNs: string;
}
export interface AdmissionDispatchGate {
  check(observation: unknown): Promise<void>;
  consume(): Readonly<AdmissionDispatchEnvelope>;
}
