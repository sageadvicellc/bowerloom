/**
 * The data of the harness-first preview (`--sample`). Plain data only: no React, no clock, no file. Everything is in memory, so nothing is written anywhere.
 * A harness is a saved list of parts (agents, skills, tools, context). It is installed into a project, once for each interface (Claude Code, Codex, OpenCode).
 */

export type PartKind = 'agent' | 'skill' | 'tool' | 'context';
export const PART_KINDS: readonly PartKind[] = Object.freeze(['agent', 'skill', 'tool', 'context']);

/** The first engine set of the preview. Hermes is not an engine of 0.8, so it is not in it. */
export type InterfaceId = 'claude-code' | 'codex' | 'opencode';
export const INTERFACE_IDS: readonly InterfaceId[] = Object.freeze(['claude-code', 'codex', 'opencode']);

/** The interfaces that Bowerloom can write files for. OpenCode has no writer yet, so the preview shows its files as not written yet. */
export const WRITER_INTERFACE_IDS: readonly InterfaceId[] = Object.freeze(['claude-code', 'codex']);
export const hasWriter = (id: InterfaceId): boolean => WRITER_INTERFACE_IDS.includes(id);
/** What a screen says in place of the files of an interface that has no writer. */
export const noWriterWords = (name: string): string => `Not written yet. Bowerloom has no writer for ${name}, so it creates no ${name} files.`;

/** The state of one harness in one project for one interface. */
export type InstallState = 'installed' | 'out-of-date' | 'conflict' | 'not-installed';

/** How an interface was found on this computer. */
export type InterfaceHealth = 'ready' | 'problem' | 'not-found';

/** A day and a time of day, as the person reads them. The store never reads a clock: the page hands it a stamp. */
export interface Stamp { readonly daysAgo: number; readonly time: string }

/** One part of a harness: an agent, a skill, a tool or a piece of context. */
export interface Part {
  readonly id: string;
  readonly kind: PartKind;
  readonly name: string;
  /** A few words, drawn on the node of the graph: "Finds sources." */
  readonly summary: string;
  /** One sentence, drawn in the details and the Library: "Finds sources and summarizes articles." */
  readonly description: string;
  /** Where the file lives, for example `agents/researcher.md`. */
  readonly path: string;
  /** The label shown beside it: "Made by you", "Caveman plug-in" or "Open skills library". */
  readonly source: string;
  /** The scan source it came from (`ScanSource.id`). */
  readonly origin: string;
  readonly version?: string;
  /** The first lines of the file, as text. Always drawn as plain text. */
  readonly fileText: string;
  /** The interfaces that cannot use this part. */
  readonly cannotUse: readonly InterfaceId[];
  /** Real mode: what the reader said about the model setting of an agent, for example "Claude Code only". */
  readonly badge?: string;
  /** False for a part that a harness holds but the Library tabs do not list. */
  readonly inLibrary: boolean;
  /** Real mode, a tool only: what kind of tool the reader found. Set by the real reader (real-map.ts) and by the Overview sample. */
  readonly toolKind?: 'mcp' | 'prompt' | 'hook';
  /**
   * Real mode: the content hash of the file the reader read for this part (`FoundAt.contentHash`, a hash of the whole text of that file, also when the reader cut
   * the text it keeps). It is absent when the file had no readable text. For a skill it is the hash of its SKILL.md text only: the reader reads no script beside it,
   * so two skills with equal SKILL.md text and different scripts read as the same skill, and the Overview says "same text", not "same files". Equal hashes mark
   * skills shared. The real reader fills it (real-map.ts), and so does the Overview sample; the plain sample world has none.
   */
  readonly contentHash?: string;
  /**
   * Real mode: the name of the folder whose own `.bowerloom` harness holds this part, for an agent or a notes folder that the reader knows only from that harness's settings.
   * Its file was not read (`fileText` is empty), and that harness counts as one that holds it. Absent for every other part.
   */
  readonly fromHarness?: string;
  /** Real mode, a connection only: true when the reader found a secret set in its config (a variable or a header that holds a key). The Engines and usage module shows only this fact and never the name of the variable. The world item that the reader builds still holds that name (shared/real/map-world.ts), as it did before this field. Absent otherwise. */
  readonly hasSecret?: boolean;
}

/** An agent uses a skill, a tool or a piece of context. The link is kept in the harness manifest, never in the agent's file. */
export interface Link { readonly from: string; readonly to: string }

/** A part an agent names that the harness does not hold. */
export interface MissingRef { readonly id: string; readonly kind: PartKind; readonly name: string }

export interface Point { readonly x: number; readonly y: number }

export interface Harness {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly partIds: readonly string[];
  readonly links: readonly Link[];
  /** Where each node sits in the builder's graph, saved in the manifest. A node with no entry gets the default place (layout.ts). */
  readonly positions: Readonly<Record<string, Point>>;
  readonly missing: readonly MissingRef[];
  /** Parts added since the harness was made. They show a dot. */
  readonly newPartIds: readonly string[];
}

export interface Project { readonly id: string; readonly name: string; readonly path: string }

/** One harness in one project. A state is recorded only for the interfaces that were looked at. */
export interface Install {
  readonly projectId: string;
  readonly harnessId: string;
  readonly states: Readonly<Partial<Record<InterfaceId, InstallState>>>;
}

export interface Interface {
  readonly id: InterfaceId;
  readonly name: string;
  /** "Found at ~/.claude". */
  readonly foundAt: string;
  readonly health: InterfaceHealth;
  /** "Ready", "Config file has a problem" or "Not found". */
  readonly healthWords: string;
  /** Whether Bowerloom offers it in the install and start sheets. */
  readonly on: boolean;
  /** The files Bowerloom writes for it. */
  readonly writes: readonly string[];
  /** What this interface cannot use, as one sentence. */
  readonly cannotUseNote: string;
}

export type RunStatus = 'running' | 'done' | 'closed';
export type Rating = 'better' | 'same' | 'worse';

export interface Run {
  readonly id: string;
  readonly harnessId: string;
  readonly projectId: string;
  readonly interfaceId: InterfaceId;
  readonly instruction: string;
  readonly started: Stamp;
  readonly status: RunStatus;
  /** Runs of one instruction that were started together share a group, for Compare. Null for a run on its own. */
  readonly groupId: string | null;
  readonly rating: Rating | null;
  readonly notes: string;
}

/** One step back: the inverse of a change. Applying the steps of an entry puts back what the change replaced. */
export type UndoStep =
  | { readonly op: 'restore-install'; readonly projectId: string; readonly harnessId: string; readonly before: Install | null }
  | { readonly op: 'delete-harness'; readonly harnessId: string }
  | { readonly op: 'remove-link'; readonly harnessId: string; readonly link: Link }
  | { readonly op: 'add-link'; readonly harnessId: string; readonly link: Link }
  | { readonly op: 'remove-part'; readonly harnessId: string; readonly partId: string }
  | { readonly op: 'add-part'; readonly harnessId: string; readonly partId: string; readonly links: readonly Link[]; readonly position: Point | null; readonly wasNew: boolean }
  | { readonly op: 'restore-missing'; readonly harnessId: string; readonly missing: readonly MissingRef[]; readonly links: readonly Link[] }
  | { readonly op: 'set-interface'; readonly interfaceId: InterfaceId; readonly on: boolean };

export interface HistoryEntry {
  readonly id: string;
  readonly text: string;
  readonly stamp: Stamp;
  readonly person: string;
  readonly computer: string;
  /** How many files the change wrote. 0 for a change to a manifest only. */
  readonly filesWritten: number;
  /** For a change to a manifest: whether it was made or changed. */
  readonly manifest: 'created' | 'changed' | null;
  /** The steps that undo it, or null when it cannot be undone. */
  readonly undo: readonly UndoStep[] | null;
  readonly undone: boolean;
}

/** A place that was found by the first scan. */
export interface ScanSource {
  readonly id: string;
  readonly name: string;
  readonly interfaceName: string;
  readonly harnessName: string;
  readonly partIds: readonly string[];
  /** The links the files themselves name (real mode): an agent to the skills and connections it uses. Absent in the sample, where a harness made from the source gets one automatic link for each part. */
  readonly links?: readonly Link[];
  /** Real mode: `home` for the home folder, `project` for a work folder or a folder the person picked. Set by the real reader (real-map.ts) and by the Overview sample. */
  readonly scope?: 'home' | 'project';
  /** Real mode: the folder the source was found in, written with `~` for the home folder (`~`, `~/Projects/alpha`). Never a full path. Set by the real reader; a source without it reads as a project named by its name. */
  readonly label?: string;
  /** Real mode: the id of the `HarnessPlace` of the same folder, on the source of a `.bowerloom` folder that also holds a harness. The Overview lists the two as one group. */
  readonly harnessPlaceId?: string;
}

/** A notes folder a harness links that was not read, and why: the folder is gone, its stored path is not a form the reader takes, it needs the person's approval on this computer, the record of approvals is damaged, cannot be used on this computer (blocked) or is full, its `knowledge.json` cannot be read, or more is linked than is read. `label` is the stored path, or empty. */
export interface LinkProblem { readonly reason: 'gone' | 'form' | 'approval' | 'damaged' | 'blocked' | 'full' | 'not-moved' | 'unreadable' | 'limit'; readonly label: string }

/** A folder that holds a harness, read through the harness loader (real mode). The Overview shows it as a place; no screen of the read lists it. `label` is the folder in `~` form. */
export interface HarnessPlace {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  /** False when a file of the harness is not valid JSON, is over a limit or cannot be read; it then holds no part. That covers JSON, shape, repeated names and limits only: the full rules of the harness loader are not checked, so "Choose this folder" may still be refused later. A skill carries the hash of its text, so it is shared with an equal skill elsewhere. */
  readonly readable: boolean;
  /** The programs the harness lists, by name. */
  readonly engines: readonly string[];
  readonly parts: readonly { readonly id: string; readonly kind: PartKind; readonly name: string; readonly summary: string; readonly toolKind?: 'mcp' | 'hook'; readonly contentHash?: string }[];
  readonly links: readonly Link[];
  /** The linked notes folders that were not read, each with its reason. Absent when there are none. */
  readonly linkProblems?: readonly LinkProblem[];
}

/** What the reader of the person's own folders reports, kept beside the world (real mode only). */
export interface RealNotes {
  /** Things that were skipped: a file too big, a shortcut that leads away, a folder that would not open. */
  readonly couldNotRead: number;
  readonly stoppedEarly: boolean;
  /** Plain lines about what went wrong or was left out. */
  readonly notes: readonly string[];
  /** Texts the reader itself cut because they were too long (not the 60-line preview cut, which is shown on each file's page). */
  readonly textsCut: number;
  /** True when a place was only partly read because it hit the reader's file or depth limit. Absent when not. */
  readonly onlyPartRead?: boolean;
  /**
   * The reader's own notes for each place that was read and has one (files over 2 MB, files that are not text, things that could not be opened, shortcuts that lead outside, only part of it looked at).
   * They come from the first look at each folder (`RealPlace.details.notes`), so their counts can differ a little from the totals above, which are from the full read. Absent when no place has a note.
   * `toolHome` is true for a program's own folder at home: a smaller folder cannot be picked for it, so the page does not suggest one.
   */
  readonly places?: readonly { readonly name: string; readonly notes: readonly string[]; readonly toolHome?: boolean }[];
}

export interface HarnessState {
  readonly parts: readonly Part[];
  readonly harnesses: readonly Harness[];
  readonly projects: readonly Project[];
  readonly installs: readonly Install[];
  readonly interfaces: readonly Interface[];
  readonly runs: readonly Run[];
  /** Newest first. */
  readonly history: readonly HistoryEntry[];
  readonly sources: readonly ScanSource[];
  /** The sources the person kept ticked in the first scan. */
  readonly chosenSourceIds: readonly string[];
  /** A counter for the ids of new things, so the store needs no random number and no clock. */
  readonly nextId: number;
  /** Set only when the world was read from the person's own folders (the default launch). */
  readonly real?: RealNotes;
  /** Real mode: the folders that hold a harness. Absent when there are none. Only the Overview reads it. */
  readonly harnessPlaces?: readonly HarnessPlace[];
}

export type FileState = 'new' | 'update' | 'conflict' | 'same';
export interface PlannedFile { readonly path: string; readonly state: FileState }
export interface InstallPlan {
  readonly manifest: PlannedFile;
  readonly groups: readonly { readonly interfaceId: InterfaceId; readonly files: readonly PlannedFile[] }[];
  readonly counts: { readonly new: number; readonly update: number; readonly conflict: number; readonly total: number };
  readonly conflicts: readonly PlannedFile[];
}

/** How the person settles a file that already exists: keep theirs, use the harness copy, or keep both. */
export type ConflictChoice = 'keep-mine' | 'use-harness' | 'keep-both';
export const CONFLICT_CHOICES: readonly ConflictChoice[] = Object.freeze(['keep-mine', 'use-harness', 'keep-both']);
