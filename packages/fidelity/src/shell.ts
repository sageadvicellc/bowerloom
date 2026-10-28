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
  collect(text.replace(/\\\r?\n/g, ' '), out);
  return out;
}

function collect(text: string, out: string[]): void {
  let current = '';
  const nested: string[] = [];
  let quote: '"' | "'" | null = null;
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
      // A here-document: its body is data, not commands. The operator stays on the command; the body is skipped.
      const marker = /^<<-?[ \t]*(['"]?)([A-Za-z0-9_]+)\1/.exec(text.slice(i));
      const newline = text.indexOf('\n', i);
      if (marker && newline !== -1) {
        const word = marker[2] as string;
        current += text.slice(i, newline);
        const close = text.indexOf(`\n${word}`, newline);
        i = close === -1 ? text.length : close + word.length;
        continue;
      }
    }
    const op = OPERATORS.find(o => text.startsWith(o, i));
    if (op && !(op === '&' && (text[i - 1] === '>' || text[i + 1] === '>'))) { flush(); i += op.length - 1; continue; }
    current += c;
  }
  flush();
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

/**
 * The command without the wrappers in front of it. Bowerloom's reading of wrapper options: `timeout` takes options and
 * then one duration; `nice` and `stdbuf` take options; `time` takes `-p`; `command` and bare `xargs` count only with no
 * option, because `command -v` and `xargs -I` change what runs. A wrapper with nothing after it is kept.
 */
export function stripWrappers(command: string): string {
  let words = rawWords(command);
  for (;;) {
    const first = words[0]?.text;
    if (first === undefined || !(WRAPPERS as readonly string[]).includes(first)) break;
    let i = 1;
    const takesValue = OPTION_VALUES[first] ?? [];
    if (first === 'command' || first === 'xargs' || first === 'builtin' || first === 'noglob' || first === 'nohup') {
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

/** True when the first word is a wrapper that Claude Code strips. */
export function startsWithWrapper(command: string): boolean {
  return stripWrappers(command) !== command;
}
