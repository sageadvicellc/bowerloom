/**
 * Reading shell command text, without running it. Used by the neutral matcher and by the engine matchers.
 *
 * - `splitCommand` gives the simple commands of a command line: it splits at `&&`, `||`, `;`, `|`, `|&`, `&`, and a
 *   newline outside quotes, and it adds the commands inside `$(...)`, `<(...)`, `>(...)`, and backticks. Claude Code
 *   documents this split (matching-semantics note, section 2). OpenCode reads every command node, nested ones too.
 * - `stripAssignments` and `stripWrappers` remove what Claude Code removes before it matches.
 *
 * Bowerloom's reading of loops and groups: a `for`, `case`, or `select` header is not a command; the words `if`,
 * `then`, `elif`, `else`, `do`, `while`, `until`, `!`, `{`, and `(` in front of a command are not part of it.
 */

const OPERATORS = ['&&', '||', '|&', ';;', ';', '|', '&', '\n'] as const;
const LEADING_WORDS = new Set(['if', 'then', 'elif', 'else', 'do', 'while', 'until', '!', '{', '(']);
const CLOSING_WORDS = new Set(['fi', 'done', 'esac', '}', ')']);
const HEADERS = new Set(['for', 'case', 'select', 'function']);

/** The simple commands of a command line, in order, outer ones first in each part. Empty parts are dropped. */
export function splitCommand(text: string): string[] {
  const out: string[] = [];
  // bash removes a backslash-newline, so `r\<newline>m` is `rm`.
  collect(joinLines(text), out);
  return out;
}

/** The text with each backslash-newline outside single quotes removed, as bash reads it. */
export function joinLines(text: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (quote === "'") { out += c; if (c === "'") quote = null; continue; }
    if (c === '\\' && text[i + 1] === '\n') { i++; continue; }
    if (c === '\\' && text[i + 1] === '\r' && text[i + 2] === '\n') { i += 2; continue; }
    if (c === '\\') { out += c + (text[i + 1] ?? ''); i++; continue; }
    if (quote === '"') { if (c === '"') quote = null; out += c; continue; }
    if (c === '"' || c === "'") quote = c;
    out += c;
  }
  return out;
}

function collect(text: string, out: string[]): void {
  let current = '';
  const nested: string[] = [];
  let quote: '"' | "'" | null = null;
  const pending: { word: string; dash: boolean; quoted: boolean }[] = [];
  const flush = () => {
    const part = cleanPart(current);
    if (part !== null) out.push(part);
    current = '';
    for (const inner of nested.splice(0)) collect(inner, out);
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (quote === "'") { current += c; if (c === "'") quote = null; continue; }
    if (c === '\\') { current += c + (text[i + 1] ?? ''); i++; continue; }
    const substitution = text[i + 1] === '(' && text[i + 2] !== '(' && (c === '$' || (quote === null && (c === '<' || c === '>')));
    if (substitution) {
      const end = closingParen(text, i + 2);
      nested.push(text.slice(i + 2, end));
      current += text.slice(i, end + 1);
      i = end;
      continue;
    }
    if (c === '`') {
      const end = text.indexOf('`', i + 1);
      const stop = end === -1 ? text.length : end;
      nested.push(text.slice(i + 1, stop));
      current += text.slice(i, stop + 1);
      i = stop;
      continue;
    }
    if (quote === '"') { current += c; if (c === '"') quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; current += c; continue; }
    if (c === '(' || c === ')') { flush(); continue; }
    if (c === '<' && text[i + 1] === '<' && text[i + 2] !== '<') {
      // A here-document (review finding C1). The operator stays on the command and the rest of the line is read on.
      // The body starts at the next newline and ends at a line that is the delimiter alone; with <<- leading tabs are
      // ignored. An unquoted delimiter lets the body expand, so its $(...) and backticks are commands.
      const marker = /^<<(-?)[ \t]*(['"]?)([A-Za-z0-9_]+)\2/.exec(text.slice(i));
      if (marker) {
        pending.push({ word: marker[3] as string, dash: marker[1] === '-', quoted: marker[2] !== '' });
        current += marker[0];
        i += marker[0].length - 1;
        continue;
      }
    }
    if (c === '\n' && pending.length) {
      flush();
      let at = i + 1;
      for (const doc of pending.splice(0)) {
        const body: string[] = [];
        for (;;) {
          if (at >= text.length) break;
          const end = text.indexOf('\n', at);
          const line = text.slice(at, end === -1 ? text.length : end);
          at = end === -1 ? text.length : end + 1;
          if ((doc.dash ? line.replace(/^\t+/, '') : line) === doc.word) break;
          body.push(line);
        }
        if (!doc.quoted) for (const inner of expansions(body.join('\n'))) collect(inner, out);
      }
      i = at - 1;
      continue;
    }
    const op = OPERATORS.find(o => text.startsWith(o, i));
    if (op && !(op === '&' && (text[i - 1] === '>' || text[i + 1] === '>'))) { flush(); i += op.length - 1; continue; }
    current += c;
  }
  flush();
}

/** The command text inside each $(...) and backtick pair of an expanding text, such as an unquoted here-document. */
function expansions(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === '$' && text[i + 1] === '(' && text[i + 2] !== '(') { const end = closingParen(text, i + 2); out.push(text.slice(i + 2, end)); i = end; continue; }
    if (text[i] === '`') { const end = text.indexOf('`', i + 1); if (end === -1) break; out.push(text.slice(i + 1, end)); i = end; }
  }
  return out;
}

function closingParen(text: string, from: number): number {
  let depth = 1;
  let quote: '"' | "'" | null = null;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote) quote = null; else if (c === '\\' && quote === '"') i++; continue; }
    if (c === '\\') { i++; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return text.length;
}

function cleanPart(raw: string): string | null {
  let words = rawWords(raw);
  while (words.length && LEADING_WORDS.has(words[0]!.text)) words = words.slice(1);
  if (words.length === 0) return null;
  const first = words[0]!.text;
  if (CLOSING_WORDS.has(first) && words.length === 1) return null;
  if (HEADERS.has(first)) return null;
  let text = raw.slice(words[0]!.start).trim();
  if (text.endsWith(' }') || text === '}') text = text.slice(0, -1).trim();
  return text === '' ? null : text;
}

/** A word of a command as written, with its offset. Quotes stay in `text`. */
export interface RawWord {
  readonly text: string;
  readonly start: number;
}

/** The words of one simple command as written, quotes kept. */
export function rawWords(command: string): RawWord[] {
  const words: RawWord[] = [];
  let i = 0;
  while (i < command.length) {
    while (i < command.length && /\s/.test(command[i] as string)) i++;
    if (i >= command.length) break;
    const start = i;
    let quote: string | null = null;
    while (i < command.length) {
      const c = command[i] as string;
      if (quote) { if (c === quote) quote = null; else if (c === '\\' && quote === '"') i++; i++; continue; }
      if (/\s/.test(c)) break;
      if (c === '\\') { i += 2; continue; }
      if (c === '"' || c === "'") quote = c;
      i++;
    }
    words.push({ text: command.slice(start, i), start });
  }
  return words;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** True when the command starts with `NAME=value`. */
export function startsWithAssignment(command: string): boolean {
  const first = rawWords(command)[0];
  return first !== undefined && ASSIGNMENT.test(first.text);
}

/** The command without its leading `NAME=value` words, as Claude Code reads it for a deny or ask rule. */
export function stripAssignments(command: string): string {
  const words = rawWords(command);
  let n = 0;
  while (n < words.length && ASSIGNMENT.test(words[n]!.text)) n++;
  return n === 0 || n === words.length ? command : command.slice(words[n]!.start);
}

/** The wrappers Claude Code strips before it matches (locked-in parts spec, section 8.3 rule 6). */
export const WRAPPERS = Object.freeze(['timeout', 'time', 'nice', 'nohup', 'stdbuf', 'command', 'builtin', 'noglob', 'xargs'] as const);

/** Options of a wrapper that take the next word as their value. */
const OPTION_VALUES: Readonly<Record<string, readonly string[]>> = {
  timeout: ['-s', '--signal', '-k', '--kill-after'],
  nice: ['-n', '--adjustment'],
  stdbuf: ['-i', '-o', '-e', '--input', '--output', '--error'],
};

/** Options of `xargs` that take the next word as their value, when the value is not attached. */
const XARGS_VALUES = ['-I', '-n', '-L', '-d', '-E', '-s', '-P', '-a', '-i', '-l', '-e'];
/** A program word that is the same text at run time: no expansion, no quote, no brace. */
const LITERAL_PROGRAM = /^[A-Za-z0-9_./+@%:,=-]+$/;

export interface StripOptions {
  /**
   * Also strip `command -p` and `xargs` with options, when the program word after them is literal. The neutral model
   * does (ruling R4). Claude Code strips bare `xargs` only, so its matcher passes false. Default: true.
   */
  readonly options?: boolean;
}

/**
 * The command without the wrappers in front of it. Bowerloom's reading of wrapper options: `timeout` takes options and
 * then one duration; `nice` and `stdbuf` take options; `time` takes `-p`. `command -v` changes what runs, so it is never
 * stripped. `command -p` and `xargs` with options are stripped only with `options` on and a literal program word after
 * them. A wrapper with nothing after it is kept.
 */
export function stripWrappers(command: string, strip: StripOptions = {}): string {
  const withOptions = strip.options ?? true;
  let words = rawWords(command);
  for (;;) {
    const first = words[0]?.text;
    if (first === undefined || !(WRAPPERS as readonly string[]).includes(first)) break;
    let i = 1;
    const takesValue = OPTION_VALUES[first] ?? [];
    if (first === 'command') {
      if (words[1]?.text === '-p' && withOptions) i = 2;
      else if (words[1]?.text.startsWith('-')) break;
    } else if (first === 'xargs') {
      if (words[1]?.text.startsWith('-')) {
        if (!withOptions) break;
        while (i < words.length && words[i]!.text.startsWith('-')) i += XARGS_VALUES.includes(words[i]!.text) ? 2 : 1;
        if (!LITERAL_PROGRAM.test(words[i]?.text ?? '')) break;
      }
    } else if (first === 'builtin' || first === 'noglob' || first === 'nohup') {
      if (words[1]?.text.startsWith('-')) break;
    } else {
      while (i < words.length && words[i]!.text.startsWith('-') && words[i]!.text !== '-') {
        i += takesValue.includes(words[i]!.text) ? 2 : 1;
      }
      if (first === 'timeout') i++;
    }
    if (i >= words.length) break;
    words = words.slice(i);
  }
  // Every step slices the same array, so the offsets still point into `command`.
  const first = words[0];
  return first === undefined || first.start === 0 ? command : command.slice(first.start).trim();
}

/** True when the first word is a wrapper that Claude Code strips: no option forms. */
export function startsWithWrapper(command: string): boolean {
  return stripWrappers(command, { options: false }) !== command;
}

/** True when stripping differs only through `command -p` or `xargs` options (ruling R4). */
export function startsWithWrapperOptions(command: string): boolean {
  return stripWrappers(command) !== stripWrappers(command, { options: false });
}

/** The command with each unquoted run of spaces and tabs read as one space, trimmed (ruling R2). */
export function collapseWhitespace(command: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i] as string;
    if (quote) { out += c; if (c === quote) quote = null; else if (c === '\\' && quote === '"') { out += command[++i] ?? ''; } continue; }
    if (c === '\\') { out += c + (command[++i] ?? ''); continue; }
    if (c === '"' || c === "'") { quote = c; out += c; continue; }
    if (c === ' ' || c === '\t') { if (!out.endsWith(' ')) out += ' '; continue; }
    out += c;
  }
  return out.trim();
}

/** True when the command holds a tab, or two spaces in a row, outside quotes. */
export function hasExtraWhitespace(command: string): boolean {
  return collapseWhitespace(command) !== command.trim();
}

/** The program word of one simple command: the first word after assignments and wrappers. */
export function programWord(command: string): string {
  return rawWords(stripWrappers(stripAssignments(command)))[0]?.text ?? '';
}

/**
 * The forms of a command line that the splitter does not fully parse (ruling R1). For any of them the neutral model
 * fails closed: it never allows from a rule.
 */
export type OpaqueForm = 'here-document' | 'comment' | 'ansi-c-quote' | 'case' | 'function' | 'eval' | 'exec' | 'coproc' | 'pipe-to-shell' | 'runtime-word';

const SHELL_PROGRAMS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);

export function opaqueForms(text: string): OpaqueForm[] {
  const command = joinLines(text);
  const found = new Set<OpaqueForm>();
  let quote: string | null = null;
  let word = '';
  const endWord = () => {
    if (word === 'case' || word === 'esac') found.add('case');
    if (word === 'function') found.add('function');
    word = '';
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i] as string;
    if (quote === "'") { if (c === "'") quote = null; continue; }
    if (quote === '"') { if (c === '"') quote = null; else if (c === '\\') i++; continue; }
    if (c === '\\') { i++; word += 'x'; continue; }
    if (c === "'" || c === '"') {
      if (c === "'" && command[i - 1] === '$') found.add('ansi-c-quote');
      quote = c; word += 'x'; continue;
    }
    if (c === '#' && (i === 0 || /[\s;&|()]/.test(command[i - 1] as string))) found.add('comment');
    if (c === '<' && command[i + 1] === '<' && command[i + 2] !== '<' && command[i - 1] !== '<') found.add('here-document');
    if (c === '|' && command[i + 1] !== '|' && command[i - 1] !== '|') {
      const rest = /^&?\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:\S*\/)?([A-Za-z]+)/.exec(command.slice(i + 1));
      if (rest && SHELL_PROGRAMS.has(rest[1] as string)) found.add('pipe-to-shell');
    }
    if (/[A-Za-z0-9_]/.test(c)) { word += c; continue; }
    endWord();
    if (c === '(' && command[i + 1] === ')' && command[i - 1] !== '$') found.add('function');
  }
  endWord();
  for (const part of splitCommand(command)) {
    const program = programWord(part);
    if (program === 'eval') found.add('eval');
    if (program === 'exec') found.add('exec');
    if (program === 'coproc') found.add('coproc');
    if (program !== '' && !LITERAL_PROGRAM.test(program) && !/^['"][A-Za-z0-9_./+@%:,=-]+['"]$/.test(program)) found.add('runtime-word');
  }
  return [...found];
}
