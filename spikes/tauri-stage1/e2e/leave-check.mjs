// The rule for the Leave check of Gate 3. The close-guard spec ends the app with Leave, and the runner's `onComplete` hook checks that the app and its core ended.
// The check may be skipped only for a run of single specs that leave that spec out, and only when E2E_LEAVE_CHECK=off is set on purpose by scripts/e2e-spec-loop.mjs.
// A run that includes the close-guard spec never skips: if the switch is set there, the run fails and says why.

export const LEAVE_SWITCH = 'E2E_LEAVE_CHECK';
export const SKIP_MESSAGE = 'Leave check skipped';

/** True when the spec list is, or may expand to, the close-guard spec: a glob, a folder, or its own file name. An empty or missing list counts too (fail closed). */
const includesCloseGuard = specs => !Array.isArray(specs) || specs.length === 0 || specs.some(spec => /[*?]/.test(String(spec)) || /08-close-guard/.test(String(spec)) || !/\.spec\.[mc]?[jt]s$/.test(String(spec)));

/** What `onComplete` does: `{ run: true }`, `{ run: true, error }` (run it, and fail the run), or `{ run: false, message }` (skip it). */
export function decideLeaveCheck({ env, specs }) {
  if (env[LEAVE_SWITCH] !== 'off') return { run: true };
  if (includesCloseGuard(specs)) {
    return { run: true, error: `${LEAVE_SWITCH}=off is set, but this run includes the close-guard spec. The Leave check is not skipped. Unset ${LEAVE_SWITCH}.` };
  }
  return { run: false, message: SKIP_MESSAGE };
}

/** The environment for a full run: the skip switch removed, so a leak from a shell or CI cannot reach it. */
export function withoutLeaveSwitch(env) {
  const { [LEAVE_SWITCH]: _removed, ...rest } = env;
  return rest;
}
