// The notice rule for the `bowerloom` command. One fixed line, no arguments in it, because stderr often goes to logs.

export const NOTICE = 'Bowerloom is now Latebrake. This command still works. Install the new name: npm install -g latebrake';

/** True when the arguments ask for JSON output. */
const wantsJson = args => args.some(arg => arg === '--json' || arg.startsWith('--json='));

/** True when the arguments are the hook form, `context guard`. */
const isGuardForm = args => args[0] === 'context' && args[1] === 'guard';

/**
 * Decides whether the `bowerloom` command prints the notice. It prints on stderr, except in four cases: `--json` is in the
 * arguments, stdout is not a terminal, stderr is closed, or the arguments start with `context guard`.
 * `bowerloom-mcp` and `bowerloom-guard` never call this, because their stdout carries a protocol.
 */
export function shouldNotice({ args, stdoutIsTTY, stderrOpen }) {
  if (!Array.isArray(args)) return false;
  if (stdoutIsTTY !== true || stderrOpen !== true) return false;
  if (wantsJson(args) || isGuardForm(args)) return false;
  return true;
}
