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

/**
 * Counts from the summaries in real tool output: node --test (spec `ℹ pass N`, tap `# pass N`) or Playwright (`N passed (Ts)`, `N failed`, `N skipped`).
 * Every summary block is read. `pass` and `skipped` come from the LAST block. `fail` is the total over all blocks, so a failing block is never hidden by a
 * later block that passes (two runners in one command). `cancelled` tests count as failures. A node summary wins over a Playwright-looking line.
 * Null when no summary is found.
 */
export function parseCounts(text) {
  const lines = linesOf(text);
  const nodeBlocks = allBlocks(lines, line => NODE_LINE.test(line));
  if (nodeBlocks.length) {
    const counts = nodeBlocks.map(block => {
      const one = { pass: 0, fail: 0, skipped: 0 };
      for (const line of block) {
        const [, key, value] = NODE_LINE.exec(line);
        if (key === 'pass') one.pass = Number(value);
        else if (key === 'fail' || key === 'cancelled') one.fail += Number(value);
        else if (key === 'skipped') one.skipped = Number(value);
      }
      return one;
    });
    return { ...counts.at(-1), fail: counts.reduce((sum, one) => sum + one.fail, 0) };
  }
  const isSummary = line => PW_PASSED.test(line) || PW_OTHER.test(line);
  const pwBlocks = allBlocks(lines, isSummary, line => PW_DETAIL.test(line)).filter(block => block.some(isSummary));
  if (pwBlocks.length === 0) return null;
  const counts = pwBlocks.map(block => {
    const one = { pass: 0, fail: 0, skipped: 0 };
    for (const line of block) {
      let match = PW_PASSED.exec(line);
      if (match) { one.pass += Number(match[1]); continue; }
      match = PW_OTHER.exec(line);
      if (!match) continue;
      if (match[2] === 'failed' || match[2] === 'interrupted') one.fail += Number(match[1]);
      else if (match[2] === 'skipped') one.skipped += Number(match[1]);
    }
    return one;
  });
  return { ...counts.at(-1), fail: counts.reduce((sum, one) => sum + one.fail, 0) };
}
