/**
 * Compares the copies of an item that was found with different text (spec 6.2). Each copy is compared with the first one, line by line,
 * so the screen can mark the lines that differ. Pure: text in, lines out. The marks are words as well as a background, never colour alone.
 */

/** One line of a copy, and whether it differs from the first copy. */
export interface DiffLine { readonly text: string; readonly changed: boolean }

/** `lines` is every line of the copy, in order. `changed` counts the lines the first copy does not have. `missing` counts the lines of the first copy that this copy does not have. */
export interface LineDiff { readonly lines: readonly DiffLine[]; readonly changed: number; readonly missing: number }

/** A text as lines. A line break at the very end does not make an extra empty line, and the two kinds of line break are the same. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Above this many pairs of lines the exact comparison would be slow, so a looser one (is the line anywhere in the other copy) is used. */
const EXACT_LIMIT = 4_000_000;

/** Compares `other` with `base`. A line of `other` that is not part of what the two share in order is `changed`. */
export function diffLines(base: string, other: string): LineDiff {
  const a = splitLines(base), b = splitLines(other);
  const keptA = new Array<boolean>(a.length).fill(false), keptB = new Array<boolean>(b.length).fill(false);
  if (a.length * b.length > EXACT_LIMIT) {
    const inA = new Set(a), inB = new Set(b);
    a.forEach((line, i) => { keptA[i] = inB.has(line); });
    b.forEach((line, i) => { keptB[i] = inA.has(line); });
  } else {
    // The longest run of lines that both copies have in the same order. Everything else differs.
    const width = b.length + 1, table = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i -= 1) {
      for (let j = b.length - 1; j >= 0; j -= 1) {
        table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
      }
    }
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { keptA[i] = true; keptB[j] = true; i += 1; j += 1; } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) i += 1; else j += 1;
    }
  }
  const lines = b.map((text, n): DiffLine => ({ text, changed: !keptB[n] }));
  return { lines, changed: lines.filter(l => l.changed).length, missing: keptA.filter(k => !k).length };
}

/** A copy with no comparison: every line is as it is. The first copy is shown this way. */
export function plainLines(text: string): DiffLine[] {
  return splitLines(text).map(line => ({ text: line, changed: false }));
}

/**
 * A path in two parts, for a line that cuts the middle of the path and keeps both ends: `head` may be cut short at the end, `tail` is
 * always shown whole (the last folder and the file name). The two parts join back into the path.
 */
export function splitPath(path: string): { head: string; tail: string } {
  const cut = path.lastIndexOf('/', path.lastIndexOf('/') - 1);
  return cut <= 0 ? { head: '', tail: path } : { head: path.slice(0, cut), tail: path.slice(cut) };
}
