// Reads the output of a test or type-check step. Used by tools/gates.mjs. Test and release tooling, never shipped.

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
export const stripAnsi = text => String(text ?? '').replace(ANSI, '');
const linesOf = text => stripAnsi(text).split('\n').map(line => line.replace(/\r$/, ''));

// A real failure line, strongest first. A passing test can print the words Error, Expected, or ensures, so the weaker tier is anchored to the line start.
const STRONG = [
  /^\s*(?:✖|✘)\s/,                  // node --test spec reporter, Playwright
  /^\s*not ok\b/,                   // TAP; "ok 1 - Expected value" does not match
  /\berror TS\d+:/,                 // tsc
  /^\s*npm (?:ERR!|error)\b/,       // npm
];
const WEAK = [
  /^\s*FAIL\b/,
  /^\s*\d+\)\s+\S/,                 // Playwright failure heading
  /^\s*AssertionError\b/,
  /^\s*(?:Uncaught\s+)?[A-Za-z]*Error(?: \[[A-Z_]+\])?:\s/,
];

/** The first line of a failed step's output that looks like a failure, trimmed to 200 characters. Falls back to the last non-empty line. Null for empty output. */
export function firstFailure(text) {
  const lines = linesOf(text).map(line => line.trim()).filter(line => line !== '');
  const found = lines.find(line => STRONG.some(re => re.test(line))) ?? lines.find(line => WEAK.some(re => re.test(line))) ?? lines.at(-1);
  return found === undefined ? null : found.slice(0, 200);
}

const NODE_LINE = /^\s*(?:ℹ|#)\s+(tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\s+([\d.]+)\s*$/;
// Playwright: "  3 passed (4.2s)" always has the duration; the others have none.
const PW_PASSED = /^\s*(\d+)\s+passed\s+\(.+\)\s*$/;
const PW_OTHER = /^\s*(\d+)\s+(failed|skipped|flaky|did not run|interrupted)\s*$/;
const PW_DETAIL = /^\s{3,}\S.* › /;

/** Every run of consecutive lines for which `isMember(line)` is true; lines for which `isGap(line)` is true may sit inside a run. */
function allBlocks(lines, isMember, isGap = () => false) {
  const blocks = [];
  let current = [];
  for (const line of lines) {
    if (isMember(line)) current.push(line);
    else if (current.length && (line.trim() === '' || isGap(line))) continue;
    else { if (current.length) blocks.push(current); current = []; }
  }
  if (current.length) blocks.push(current);
  return blocks;
}

const total = counts => ({
  pass: counts.reduce((sum, one) => sum + one.pass, 0),
  fail: counts.reduce((sum, one) => sum + one.fail, 0),
  skipped: counts.reduce((sum, one) => sum + one.skipped, 0),
});

/**
 * Reads the summary lines of one block into counts. `read(line)` returns [key, field, amount] or null. When a key repeats inside the block, the repeat starts a new
 * summary (two runs printed back to back), so an earlier run is never overwritten by a later one.
 */
function countBlock(block, read) {
  const results = [];
  let one = { pass: 0, fail: 0, skipped: 0 }, seen = new Set(), any = false;
  for (const line of block) {
    const entry = read(line);
    if (!entry) continue;
    const [key, field, amount] = entry;
    if (seen.has(key)) { results.push(one); one = { pass: 0, fail: 0, skipped: 0 }; seen = new Set(); }
    seen.add(key);
    any = true;
    if (field) one[field] += amount;
  }
  if (any) results.push(one);
  return results;
}

/**
 * Counts from the summaries in real tool output: node --test (spec `ℹ pass N`, tap `# pass N`) and Playwright (`N passed (Ts)`, `N failed`, `N skipped`,
 * `N interrupted`, `N did not run`). What it does, exactly:
 *  - Every summary block is read, node and Playwright alike, and `pass`, `skipped`, and `fail` are each the SUM over all blocks of both kinds. So a step with two
 *    runners (the first ran 0 tests, the second ran 5) is judged by the combined totals, and a failing block is never hidden by another block that passes.
 *  - A key that repeats inside a block (`pass` twice in a row) starts a new summary, so two runs printed back to back both count.
 *  - `cancelled` (node), and `interrupted` and `did not run` (Playwright), count as failures. `flaky` counts as neither: the test passed on retry.
 *  - A Playwright `N passed (Ts)` line counts wherever it sits, so a test that prints one adds to the totals. A node summary line must be a line of its own
 *    (`ℹ pass 7` or `# pass 7`); `this will pass 4 times` is not one.
 * Null when no summary is found. These counts are read only after the step has exited 0: a step that exits non-zero fails whatever the counts say (see judge in tools/gates.mjs).
 */
export function parseCounts(text) {
  const lines = linesOf(text);
  const counts = [];
  const nodeBlocks = allBlocks(lines, line => NODE_LINE.test(line));
  for (const block of nodeBlocks) {
    counts.push(...countBlock(block, line => {
      const [, key, value] = NODE_LINE.exec(line);
      if (key === 'pass') return [key, 'pass', Number(value)];
      if (key === 'fail' || key === 'cancelled') return [key, 'fail', Number(value)];
      if (key === 'skipped') return [key, 'skipped', Number(value)];
      return [key, null, 0]; // tests, suites, todo, duration_ms: not counted, but a repeat of one still starts a new summary
    }));
  }
  const isSummary = line => PW_PASSED.test(line) || PW_OTHER.test(line);
  const pwBlocks = allBlocks(lines, isSummary, line => PW_DETAIL.test(line)).filter(block => block.some(isSummary));
  for (const block of pwBlocks) {
    counts.push(...countBlock(block, line => {
      const passed = PW_PASSED.exec(line);
      if (passed) return ['passed', 'pass', Number(passed[1])];
      const other = PW_OTHER.exec(line);
      if (!other) return null;
      if (other[2] === 'failed' || other[2] === 'interrupted' || other[2] === 'did not run') return [other[2], 'fail', Number(other[1])];
      if (other[2] === 'skipped') return ['skipped', 'skipped', Number(other[1])];
      return null;
    }));
  }
  return counts.length === 0 ? null : total(counts);
}
