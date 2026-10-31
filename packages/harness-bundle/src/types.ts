/**
 * The shapes of the harness bundle: the file one harness travels in (0.8 spec, section 6.7). These are the contract of Task 1, journey 4. The app and the
 * command line both build on them. Stage 2 lanes fill in the functions of `index.ts`; they do not change a name or a shape here without a new contract commit.
 */
import type { DefinitionFile, EngineId, KnowledgeKind, McpTransport, Problem } from '../../harness-definition/src/index.js';
import type { AddressFlag } from './address.js';
import type { CodeWhy } from './code-files.js';

// ---- the file --------------------------------------------------------------------------------------------------------------

/** How a file's bytes are written in the bundle: `utf8` when they decode as strict UTF-8 text with no BOM and no hidden control character, else `base64`. */
export type BundleEncoding = 'utf8' | 'base64';

/** One file of the definition as it sits in the bundle. `size` and `sha256` (lowercase hex) are of the decoded bytes. Closed shape: no other key. */
export interface BundleFileRecord {
  /** Relative to `.bowerloom`, with `/` separators. Never `knowledge.json`. */
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  readonly encoding: BundleEncoding;
  readonly data: string;
  /** Present, and true, only when the file has an execute bit. */
  readonly executable?: true;
}

/** A notes source as it leaves in a bundle: its kind and name, never its path. */
export interface BundleSource {
  readonly kind: KnowledgeKind;
  readonly name: string;
}

/**
 * The JSON object a bundle file holds. UTF-8, no BOM, canonical key order as listed here, 2-space indent, one final line feed. Files sort by path in byte order.
 * Unknown keys anywhere are refused.
 */
export interface BundleEnvelope {
  readonly format: 'bowerloom/harness-bundle/v1beta1';
  /** The harness id. */
  readonly harness: string;
  /** `bowerloom@<version>`. Informational. Never trusted and never shown as a fact. */
  readonly generator: string;
  /** `sha256:` plus `computeRevision` of the decoded files (the one prefixed revision form; every plan revision is bare hex). It catches damage and edits. It is not a signature. */
  readonly revision: string;
  readonly files: readonly BundleFileRecord[];
  readonly knowledge: readonly BundleSource[];
}

/** A bundle after `decodeBundle`: every check passed, and the files are decoded. */
export interface DecodedBundle {
  readonly format: BundleEnvelope['format'];
  readonly harness: string;
  readonly generator: string;
  /** The revision the file states, equal to the recomputed one. */
  readonly revision: string;
  /** Lowercase hex SHA-256 of the whole bundle file's bytes. A plan binds to it, so a swapped bundle cannot ride an approved revision. */
  readonly sha256: string;
  /** The size of the bundle file in bytes. */
  readonly bytes: number;
  /** The decoded files, in byte order of path. */
  readonly files: readonly DefinitionFile[];
  readonly knowledge: readonly BundleSource[];
}

// ---- what a bundle holds, for the person to read ---------------------------------------------------------------------------

/**
 * A tool the bundle holds, with what a person must read before it may run: the text of the command, the arguments, the host, the hook text. Every text is cut
 * to BUNDLE_LIMITS.displayChars (arguments: BUNDLE_LIMITS.displayArgs, each cut the same way) and is plain text for the screen; `sha256` covers the WHOLE entry as
 * the file holds it, so an acknowledgement binds the full text and not the cut one.
 *  - MCP server over stdio: `command` and `args`. Over http: `host`.
 *  - Hook: `event` and `command` (the hook's command text).
 * A tool needs a tick when it runs code (`runsCode`) OR reaches a host (`host` is set): a remote server is a host the file chose (decision R2-L2).
 */
export interface BundleTool {
  readonly name: string;
  readonly kind: 'mcp' | 'hook';
  /** For an MCP server. */
  readonly transport?: McpTransport;
  /** True for a hook, and for an MCP server that starts a program (`command`). */
  readonly runsCode: boolean;
  /** The program of an MCP server, or the command of a hook. */
  readonly command?: string;
  /** The arguments of an MCP server, as written, at most BUNDLE_LIMITS.displayArgs of them. */
  readonly args?: readonly string[];
  /**
   * The host a client would reach for the server's `url`, from `addressOf`: parsed with `URL` after each `${NAME}` is masked, shown as `hostname` plus `:port` when
   * the port is not the scheme's own, with the references as written. If the address cannot be read, the fixed text `unreadable address`.
   */
  readonly host?: string;
  /** What is odd about the address (credentials in it, a backslash, an odd scheme, unreadable). Absent when nothing is. Each flag is shown on screen. */
  readonly addressFlags?: readonly AddressFlag[];
  /** For a hook, the event it runs on. */
  readonly event?: string;
  /** Lowercase hex SHA-256 of the canonical JSON of the whole entry (the server or the hook). */
  readonly sha256: string;
}
/**
 * A file that can run (`codeWhy` in code-files.ts). Every file of a bundle is code unless it passes the allowlist of data: a named data extension, valid UTF-8 for a
 * text one, and first bytes that are not `#!` or the magic of a program. `sha256` is of its decoded bytes.
 */
export interface BundleCodeFile {
  readonly path: string;
  readonly why: CodeWhy;
  readonly sha256: string;
}
/** Where a `${NAME}` or keychain reference goes: a field of a tool, and the host that field reaches. */
export type BundleSinkField = 'env' | 'header' | 'arg' | 'url' | 'command';
/**
 * The fields that can send a value where the file chooses: a URL, an argument, a command, or a header (a header goes to the host the file names, which may be anyone's).
 * A reference in one of these needs an acknowledgement. `env` is left out because it applies to a stdio server only, which runs code and is ticked as a tool.
 */
export const HIGH_RISK_SINK_FIELDS: readonly BundleSinkField[] = Object.freeze(['arg', 'header', 'url', 'command'] as const);
export interface BundleSink {
  /** The name of the MCP server or the hook id. */
  readonly tool: string;
  readonly field: BundleSinkField;
  /** The host the tool's `url` reaches, as `addressOf` reads it, when it has one. */
  readonly host?: string;
}
/**
 * A reference that the file READS from the importer's computer and PASSES to a tool: `${NAME}` in an MCP server's env, headers, args, url or command, or in a
 * hook command (`kind: 'env'`), or a `{ "keychain": "<entry>" }` reference (`kind: 'keychain'`). The name may already be set on this computer, so the screen never
 * tells a person to add it without showing where it goes. Names only, never a value. Duplicates are merged: one entry per name, with every sink.
 */
export interface BundleSecret {
  readonly kind: 'env' | 'keychain';
  readonly name: string;
  readonly sinks: readonly BundleSink[];
}
/** A notes source the agents read by name. A bundle holds the name only. */
export interface BundleNote {
  readonly name: string;
  readonly kind: KnowledgeKind;
  /** The agents that list it in `notes`. */
  readonly readBy: readonly string[];
}
export interface BundleBorrowed {
  readonly name: string;
  readonly marketplace: string;
  readonly version: string;
}
/** Text that looks like an absolute path or a home path. Reported, never rewritten. `line` counts from 1 and is absent for a file with no lines. */
export interface BundleForeignPath {
  /** The bundle file the text is in. */
  readonly path: string;
  readonly line?: number;
  /** The text that matched, cut to BUNDLE_LIMITS.displayChars. */
  readonly text: string;
  /** Lowercase hex SHA-256 of the whole matched text. */
  readonly sha256: string;
}
export interface BundleCounts {
  readonly skills: number;
  readonly agents: number;
  readonly mcp: number;
  readonly hooks: number;
  readonly guardrails: number;
  readonly scripts: number;
  readonly files: number;
  readonly bytes: number;
}
/** What a bundle holds. Pure data. The lists are complete here; the app caps what it sends to the window (`BUNDLE_LIMITS.listRows`). */
export interface BundleSummary {
  readonly harness: string;
  readonly engines: readonly EngineId[];
  readonly instructions: boolean;
  readonly counts: BundleCounts;
  readonly tools: readonly BundleTool[];
  readonly codeFiles: readonly BundleCodeFile[];
  readonly secrets: readonly BundleSecret[];
  readonly notes: readonly BundleNote[];
  readonly borrowed: readonly BundleBorrowed[];
  readonly foreignPaths: readonly BundleForeignPath[];
}

// ---- calls -----------------------------------------------------------------------------------------------------------------

export interface EncodeOptions {
  /** The exporting computer's home folder, matched literally in file text in addition to the shape of a path. */
  readonly home?: string;
  /** The exporting computer's user name, matched literally in file text. */
  readonly user?: string;
  /** Written into `generator`. Default: `bowerloom`. */
  readonly generator?: string;
}
export interface EncodedBundle {
  /** The bundle file, ready to write. */
  readonly bytes: Uint8Array;
  /** Lowercase hex SHA-256 of `bytes`. Equal definitions and options give equal bytes and an equal hash. */
  readonly sha256: string;
  readonly summary: BundleSummary;
}

/**
 * What the importer decides about the notes names a bundle lists. A name in neither collection is left out (decision T1-D3 A: leave out by default).
 *  - `link`: source name to the stored path of a notes folder, in the form `storedKnowledgePath` returns (relative to the harness folder, `.`, or `~/...`).
 *  - `leave`: names to leave out, which removes the name from every agent's `notes`.
 * The names come from a bundle, so they are untrusted keys (`constructor` is a valid name). The collections are a `Map` and a `Set` so a lookup never reaches
 * the object prototype. `importChoicesOf` builds this from plain input and checks it; `targetFromBundle` takes only this form. A name not in the bundle, a name
 * in both, a duplicate, a value that is not a string, or more than BUNDLE_LIMITS.notesNames names is `BUNDLE_USAGE`.
 */
export interface ImportChoices {
  readonly link: ReadonlyMap<string, string>;
  readonly leave: ReadonlySet<string>;
}

/**
 * The identity of a file on disk: what `writeBundleFile` compares before it replaces a file. Read with `bigint: true`, so a large inode number loses nothing.
 * Equal means every field is equal. Inode numbers can be reused soon after a delete, so the birth time, the size and the modification time are part of it.
 * `birthtimeNs` is 0n where the file system keeps none.
 */
export interface BundleFileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly birthtimeNs: bigint;
}

// ---- command-line plan output (`--json`) -----------------------------------------------------------------------------------

/** The plan of `bowerloom harness export`. The command prints it and applies nothing until it is run again with `--approve <revision>`. */
export interface ExportPlan {
  readonly format: 'bowerloom/harness-export-plan/v1beta1';
  readonly harness: string;
  /** The file the command would write, as the person gave it. */
  readonly file: string;
  readonly bytes: number;
  readonly summary: BundleSummary;
  /** The lowercase hex SHA-256 of the bundle bytes, 64 characters with no prefix. The approval names it. It is the same form as the app's `ExportView.revision`. */
  readonly revision: string;
  /** The hash an approval of foreign paths names (`exportAcknowledgement`), or null when the bundle has none. */
  readonly acknowledge: string | null;
}
/** The plan of `bowerloom harness import`. The write is a save of the folder's harness, so `changes` are `.bowerloom` paths. */
export interface ImportPlan {
  readonly format: 'bowerloom/harness-import-plan/v1beta1';
  readonly harness: string;
  readonly folder: string;
  readonly file: string;
  readonly summary: BundleSummary;
  readonly changes: readonly { readonly path: string; readonly action: 'create' | 'update' | 'delete' }[];
  /** The save plan's revision, lowercase hex with no prefix, the form of every save plan revision. */
  readonly revision: string;
  /** The hash of `importAcknowledgement` (tools that run code, references in a url, argument or command, files that can run, executables, foreign paths), or null when all are empty. */
  readonly acknowledge: string | null;
}

// ---- refusals --------------------------------------------------------------------------------------------------------------

/** The loader's problems or other detail a refusal can carry. Never a value from a file. */
export type BundleProblems = readonly Problem[];
