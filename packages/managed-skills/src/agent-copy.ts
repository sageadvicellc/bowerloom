/**
 * The Claude Code copy of a team agent (spec 01a, section 4.4; spec 05, section 3.8). Without a guard the copy is the
 * source, byte for byte. With a guard, the copy gains one `PreToolUse` hook entry that runs `bowerloom-guard`. `adopt`,
 * `AGENT_TARGET_OCCUPIED`, drift and the closure text all compare against this function's output, never against the raw
 * source. Spec 01b adds its own changes first, then the guard entry. Managed-skills must not import project-sync, so the
 * one definition lives here; project-sync re-exports it.
 */
import { Scalar, YAMLMap, YAMLSeq, isMap, isSeq, parseDocument } from 'yaml';
import { splitFrontmatter } from '../../context-slices/src/frontmatter.js';
import { ManagedSkillError } from './observed.js';

export interface GuardExtras {
  role: string;
  /** The sorted guard list. */
  slices: string[];
  /** One `<slice id>:<32 hex>` for each listed slice whose root resolves, in the order of `slices`. */
  roots: string[];
  /** The real path of the project folder, and its project id. */
  projectDir: string;
  projectId: string;
}
export interface CopyExtras { guard: GuardExtras | null }

function frontmatterDoc(source: string): { fm: NonNullable<ReturnType<typeof splitFrontmatter>>; doc: ReturnType<typeof parseDocument> } | null {
  const fm = splitFrontmatter(source); if (fm === null) return null;
  const doc = parseDocument(fm.block, { uniqueKeys: true });
  return doc.errors.length ? null : { fm, doc };
}

/** True when the agent's `hooks` is not a map, or its `hooks.PreToolUse` is not a list: the guard cannot be added. */
export function guardConflict(source: string): boolean {
  try {
    const parsed = frontmatterDoc(source); if (parsed === null || !isMap(parsed.doc.contents)) return false;
    const root = parsed.doc.contents;
    if (!root.has('hooks')) return false;
    const hooks = root.get('hooks', true);
    if (!isMap(hooks)) return true;
    return hooks.has('PreToolUse') && !isSeq(hooks.get('PreToolUse', true));
  } catch { return false; }
}

const quoted = (value: string): Scalar => { const s = new Scalar(value); s.type = Scalar.QUOTE_DOUBLE; return s; };
/** The guard entry of spec 05, section 4.6. Every `args` element is a double-quoted scalar. */
function guardEntry(doc: ReturnType<typeof parseDocument>, g: GuardExtras): YAMLMap {
  const args = new YAMLSeq();
  const list = ['--agent', g.role, '--project', g.projectDir, '--project-id', g.projectId, ...g.slices.flatMap(id => ['--slice', id]), ...g.roots.flatMap(r => ['--root', r])];
  for (const a of list) args.items.push(quoted(a));
  const hook = doc.createNode({ type: 'command', command: 'bowerloom-guard' }) as YAMLMap;
  hook.set('args', args); hook.set('timeout', 10); hook.set('onFailure', 'block');
  const hooks = new YAMLSeq(); hooks.items.push(hook);
  const entry = doc.createNode({ matcher: 'Read|Grep|Glob' }) as YAMLMap;
  entry.set('hooks', hooks);
  return entry;
}

export function claudeCopyBytes(source: string, extras: CopyExtras): string {
  if (extras.guard === null) return source;
  if (guardConflict(source)) throw new ManagedSkillError('MANAGED_SKILL_REFUSED');
  const parsed = frontmatterDoc(source);
  if (parsed === null || !isMap(parsed.doc.contents)) throw new ManagedSkillError('MANAGED_SKILL_REFUSED');
  const { fm, doc } = parsed, root = doc.contents as YAMLMap, entry = guardEntry(doc, extras.guard);
  if (!root.has('hooks')) { const seq = new YAMLSeq(); seq.items.push(entry); const hooks = new YAMLMap(); hooks.set('PreToolUse', seq); root.set('hooks', hooks); }
  else {
    const hooks = root.get('hooks', true) as unknown as YAMLMap;
    if (!hooks.has('PreToolUse')) { const seq = new YAMLSeq(); seq.items.push(entry); hooks.set('PreToolUse', seq); }
    else (hooks.get('PreToolUse', true) as unknown as YAMLSeq).items.push(entry);
  }
  return `${fm.head}\n${doc.toString({ lineWidth: 0 })}${fm.tail}`;
}
