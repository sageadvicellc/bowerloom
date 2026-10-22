/**
 * `bowerloom context show|measure|guard` (spec 05, sections 3.9 to 3.11). `show` and `measure` read only and never use the
 * network. `guard` is the read guard: the hook form reads stdin and writes a deny line or nothing; `--explain` prints the
 * decision for one path.
 */
import { DefinitionError } from '../../../packages/contracts/src/index.js';
import { discoverProject, privateStateRoot } from '../../../packages/project-context/src/index.js';
import { measureContext, showSlice } from '../../../packages/project-sync/src/context-measure.js';
import type { MeasureAgent, MeasureResult, ShowResult } from '../../../packages/project-sync/src/context-measure.js';
import { ESTIMATE_BAND, formatPercent, formatThousands, parseBytesPerToken } from '../../../packages/context-slices/src/estimate.js';
import { newCommandJson, plainText, shellWord } from './human.js';

const SHOW_USAGE = 'Use bowerloom context show <slice> [--json].';
const MEASURE_USAGE = 'Use bowerloom context measure [--agent <role>]... [--team <team>] [--from <folder>] [--baseline <folder>] [--bytes-per-token <number>] [--user] [--json].';
const usage = (text: string): never => { throw new DefinitionError('USAGE', text); };

export function renderShow(r: ShowResult): string {
  const where = r.registered !== null ? `registered folder ${r.registered} (${r.root ?? 'unknown'})` : r.root === null ? 'an unknown folder' : r.root === '.' ? 'the project folder' : r.root;
  const lines = [
    `Slice ${r.id}: ${r.members.length} files from ${where}`,
    `Index: .claude/skills/slice-${r.id}/SKILL.md, ${r.index === null ? 'not built' : `${r.index.bytes} bytes`} (${r.installed})`,
    `Guard: ${r.guard ?? 'none'}`,
    `Agents: ${r.agents.length ? r.agents.join(', ') : 'none'}`,
  ];
  if (r.hold !== null) lines.push(`Held: ${r.hold.code}. Next: ${r.hold.next}`);
  const n = r.notes, notes: string[] = [];
  const list = (paths: readonly string[]): string => { const head = paths.slice(0, 3), joined = head.length <= 1 ? (head[0] ?? '') : `${head.slice(0, -1).join(', ')} and ${head[head.length - 1]}`; return `${joined}${paths.length > 3 ? `, and ${paths.length - 3} more` : ''}`; };
  if (n.unparsed.length) notes.push(`left out ${n.unparsed.length} files whose frontmatter does not parse: ${list(n.unparsed)}.`);
  if (n.unresolvedLinks > 0 || n.ambiguousLinks > 0) notes.push(`has ${n.unresolvedLinks} links that point to no file and ${n.ambiguousLinks} links that point to more than one file.`);
  for (const p of n.emptyPatterns) notes.push(`the pattern ${p} matches no file.`);
  if (n.notText > 0) notes.push(`left out ${n.notText} files that are not UTF-8 text or have unusual names.`);
  if (n.oversize.length) notes.push(`lists ${n.oversize.length} files over 1 MiB without a summary.`);
  if (n.skippedEntries > 0) notes.push(`skipped ${n.skippedEntries} entries that are not files or folders, or are links that no pattern selects.`);
  if (n.truncatedLinks > 0) notes.push(`follows the first 512 links of ${n.truncatedLinks} files and skips the rest.`);
  if (n.outsideProject) notes.push(`reads ${r.root}, outside this project. Claude Code may ask before it reads there. Start Claude Code with --add-dir ${shellWord(r.folder ?? r.root ?? '')}, or add the folder to permissions.additionalDirectories.`);
  if (r.copies !== null) {
    const c = r.copies;
    notes.push(c.summary === 'none' ? `copies no text from ${c.folder}, only the paths of ${c.count} files.` : c.summary === 'heading' ? `copies the first heading of ${c.count} files from ${c.folder} into .claude/skills/slice-${r.id}/SKILL.md.` : `copies frontmatter key ${c.key} of ${c.count} files from ${c.folder} into .claude/skills/slice-${r.id}/SKILL.md.`);
  }
  if (n.wholeProject) notes.push('guards the whole project folder. An agent that names it reads only the slice\'s files there with Read, Grep, and Glob.');
  if (notes.length) lines.push('Notes:', ...notes.map(x => `  ${x}`));
  return `${lines.join('\n')}${r.index === null ? '' : `\n\n${r.index.text}`}`;
}

/** The table and notes of the measure, in the shape of section 3.11. */
export function renderMeasure(r: MeasureResult): string {
  const tok = (n: number): string => formatThousands(n);
  const header = ['Agent', 'Prompt', 'Instructions', 'Skills', 'Slices', 'At start', 'On demand', 'Baseline', 'Start/baseline'];
  const milli = Math.round(Number(r.estimator.bytesPerToken) * 1000);
  const t = (bytes: number): string => tok(Math.ceil(bytes * 1000 / milli));
  const rows = r.agents.map((a: MeasureAgent) => [a.role, t(a.start.prompt), t(a.start.instructions.bytes), t(a.start.skills.files.reduce((x, f) => x + f.bytes, 0)), t(a.start.slices.reduce((x, s) => x + s.indexBytes, 0)), tok(a.start.tokens), tok(a.onDemand.tokens), tok(a.baseline.tokens), formatPercent(a.ratios.startToBaselinePpm)]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map(row => row[i]!.length)));
  const line = (cells: string[]): string => cells.map((c, i) => i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!)).join('  ').trimEnd();
  const band = r.estimator.calibrated === 'user' ? 'calibrated by you' : `assumed band ${ESTIMATE_BAND.low} to ${ESTIMATE_BAND.high} bytes per token, not calibrated`;
  const notes = r.agents.flatMap(a => a.notes.map(n => `  ${a.role}: ${n}`));
  const skippedImports = r.agents.reduce((n, a) => n + a.start.instructions.skippedImports.length, 0), skipped = r.baseline.skipped.hidden + r.baseline.skipped.links + r.baseline.skipped.notRegular;
  return [
    `Context per agent. Project: ${r.project}. Claude Code starts in: ${r.from}.`,
    `Unit: tokens, estimated as bytes / ${r.estimator.bytesPerToken} (${band}). Bytes are exact. Add --json to see them.`,
    '',
    line(header), ...rows.map(line),
    `Baseline: each agent with every .md file under ${r.baseline.folder} (${r.baseline.files} files) loaded at start, and its CLAUDE.md or AGENTS.md files.`,
    'Not counted: Claude Code\'s own system details and tool definitions, MCP tools, git status, the task message, managed policy files, agent memory, and files an agent reads beyond its slices.',
    ...r.held.map(h => `Held: ${h.role} is not measured (${h.code}). Next: ${h.next}`),
    ...(skippedImports > 0 || skipped > 0 ? [`Skipped: ${skippedImports} imports that name no readable file, and ${r.baseline.skipped.hidden} hidden entries, ${r.baseline.skipped.links} links and ${r.baseline.skipped.notRegular} special entries in the baseline.`] : []),
    ...(notes.length ? ['Notes:', ...notes] : []),
  ].join('\n');
}

/** `bowerloom context show|measure|guard`. Returns the exit code. */
export async function runContextCommand(args: readonly string[], cwd: string, home: string, write: (text: string) => void, env: NodeJS.ProcessEnv = process.env, stdin: AsyncIterable<unknown> = process.stdin, stderr: (text: string) => void = t => { process.stderr.write(t); }): Promise<number> {
  const sub = args[1], words = args.slice(2);
  if (sub === 'guard') {
    const { runGuard } = await import('./guard-run.js');
    return runGuard(words, { stdin, out: write, err: stderr, env, home, cwd }, true);
  }
  if (sub === 'show') {
    const json = words.includes('--json'), rest = words.filter(w => w !== '--json');
    if (words.filter(w => w === '--json').length > 1 || rest.length !== 1 || rest[0]!.startsWith('-')) usage(SHOW_USAGE);
    const project = discoverProject(cwd, home), result = await showSlice({ project, stateRoot: privateStateRoot(env, home), slice: rest[0]!, home });
    write(json ? newCommandJson(result) : `${plainText(renderShow(result), true)}\n`); return 0;
  }
  if (sub === 'measure') {
    const agents: string[] = []; let team: string | null = null, from: string | null = null, baseline: string | null = null, bpt: number | null = null, user = false, json = false;
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!, next = (): string => { const v = words[++i]; if (v === undefined || (v.startsWith('-') && w !== '--bytes-per-token')) usage(MEASURE_USAGE); return v!; };
      if (w === '--agent') { const v = next(); if (agents.includes(v)) usage(MEASURE_USAGE); agents.push(v); }
      else if (w === '--team') { if (team !== null) usage(MEASURE_USAGE); team = next(); }
      else if (w === '--from') { if (from !== null) usage(MEASURE_USAGE); from = next(); }
      else if (w === '--baseline') { if (baseline !== null) usage(MEASURE_USAGE); baseline = next(); }
      else if (w === '--bytes-per-token') { if (bpt !== null) usage(MEASURE_USAGE); bpt = parseBytesPerToken(next()); if (bpt === null) usage(MEASURE_USAGE); }
      else if (w === '--user') { if (user) usage(MEASURE_USAGE); user = true; }
      else if (w === '--json') { if (json) usage(MEASURE_USAGE); json = true; }
      else usage(MEASURE_USAGE);
    }
    const project = discoverProject(cwd, home);
    const result = await measureContext({ project, stateRoot: privateStateRoot(env, home), home, agents, team, from: from ?? cwd, baseline, bytesPerTokenMilli: bpt, user });
    write(json ? newCommandJson(stripNotes(result)) : `${plainText(renderMeasure(result), true)}\n`); return 0;
  }
  usage('Use bowerloom context show <slice>, bowerloom context measure, or bowerloom context guard. Run bowerloom help context.');
  return 2;
}
/** The JSON of the measure holds the fields of section 4.10; the per-agent notes are for the text output. */
function stripNotes(r: MeasureResult): unknown { return { ...r, agents: r.agents.map(({ notes: _notes, ...rest }) => rest) }; }
