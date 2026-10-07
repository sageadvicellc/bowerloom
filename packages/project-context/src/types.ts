/**
 * Day 0 contracts for the Bowerloom 0.7.0 beta project layer (build plan 01, section 4).
 * Types only: this module has no runtime code. packages/project-context/src/index.ts implements them in M1.
 */
import type { DirectoryIdentity } from '../../startup/src/index.js';

export type { DirectoryIdentity };

declare const heldProjectLock: unique symbol;

/** One directory pinned by path and identity. */
export interface PinnedDirectory {
  readonly path: string;
  readonly identity: DirectoryIdentity;
}

/**
 * A discovered project: the nearest parent folder with a real, owned, non-symlinked `.bowerloom/`.
 * The fields match the `project` binding of the sync plan, plus the project id.
 */
export interface ProjectContext {
  /** Real absolute path of the project folder, the parent of `.bowerloom/`. */
  readonly dir: string;
  readonly identity: DirectoryIdentity;
  /** Every directory from the file system root down to the parent of `dir`, in that order. */
  readonly ancestry: readonly PinnedDirectory[];
  readonly bowerloomIdentity: DirectoryIdentity;
  /** The first 32 hex characters of sha256 over the real path, device and inode. */
  readonly projectId: string;
}

/**
 * Proof that `withProjectLock` holds the project lock.
 * The lock uses the one shared slot, `lockSlot` in ./index.ts, keyed on the project folder's device and inode, as do
 * `locked` in managed-skills and `withLock` in startup/src/revision.ts, so all of them exclude each other.
 * Only `withProjectLock` creates a token. The brand stops a literal from type-checking, and the
 * implementation also checks the token at run time. A token is valid only inside the work callback that received it.
 */
export interface HeldProjectLock {
  readonly [heldProjectLock]: true;
  /** Real absolute path of the project folder that keys the lock. */
  readonly dir: string;
  /** Aborts when the lock is released or the locked run is cancelled. */
  readonly signal: AbortSignal;
  /** Throws `PROJECT_LOCKED` when the lock is no longer held, or when `dir` is not the locked project. */
  assertHeld(dir: string): void;
}

/** The registered owners of paths inside `.bowerloom/`. */
export type OwnerName = 'authoring' | 'manifest' | 'managed';
export type OwnedEntryKind = 'file' | 'directory';
/** `edited` is authored content a person or agent changed. It is reported, not treated as drift. */
export type OwnerVerdict =
  | { readonly result: 'verified' }
  | { readonly result: 'edited' }
  | { readonly result: 'refused'; readonly code: string };

/**
 * An owner of paths inside `.bowerloom/`, passed to `inspectStartup` (M2).
 * Paths are relative to `.bowerloom/`, use `/` separators and have no trailing slash.
 * `claims` is a pure path test and reads nothing.
 * `verify` reads the claimed entry with the full guards: no symlink, a single link, the owner uid,
 * no group or world write, and size bounds. A claimed directory is verified as a whole.
 * A path passes only when exactly one owner claims it and `verify` returns `verified` or `edited`.
 */
export interface OwnerVerifier {
  readonly owner: OwnerName;
  claims(path: string, kind: OwnedEntryKind): boolean;
  verify(path: string, kind: OwnedEntryKind, signal: AbortSignal): Promise<OwnerVerdict>;
}

/**
 * A change that runs through the approval wrapper.
 * `revision` is 64 lowercase hex characters that bind every input the plan read.
 * `apply` plans again and refuses with `STALE_APPROVAL` unless the new revision equals the approved one.
 */
export interface PlannedChange<P> {
  plan(): Promise<P>;
  revision(plan: P): string;
  review(plan: P): string;
  apply(revision: string): Promise<unknown>;
}
