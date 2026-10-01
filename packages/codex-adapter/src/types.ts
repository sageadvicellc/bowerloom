import type { AccountObservation } from '../../admission/src/types.js';
export interface Installation {
  nativePath: string; nativeSha256: string; version: '0.157.0' | '0.159.2';
  // Private, controller-owned parent. A fresh empty directory is created for each operation.
  workRoot: string;
}
export interface AccountBinding {
  canonicalAccountId: string; aliases: string[];
  // sha256('codex-chatgpt-account:v1\0' + authenticated account/rateLimits/read accountId).
  providerAccountSha256: string;
  requiredWindows: ('primary' | 'secondary')[];
  optionalWindows: ('primary' | 'secondary')[];
}
export interface ProcessIdentity { processRef: string; ownershipDigest: string; pid: number; groupId: number; launcherId: string }
export interface ModelProcess { identity: ProcessIdentity; result: Promise<string>; terminate(): Promise<void> }
export interface ModelAdapter { start(input: { launcherId: string; taskInput: string; modelRoute: string }, signal: AbortSignal): Promise<ModelProcess> }
export interface ObservationReader { read(accountAlias: string): Promise<AccountObservation> }
export interface AdapterEvidence {
  processRef: string; status: 'completed' | 'rejected'; reason: string | null;
  observedEventCounts: Record<string, number>; observedUsage: Record<string, number> | null;
  nativeInvocationDenialProved: false; totalEgressDenialProved: false; telemetryTransmissionProved: false;
}
