/**
 * The commands of each engine, from the vendors' own pages (read 2026-11-06): the "CLI commands" table of https://code.claude.com/docs/en/cli-reference, and the "Command overview" table
 * of https://developers.openai.com/codex/cli/reference (with the aliases it names: `a`, `cloud-tasks`, `e`). An engine reads a first argument that equals one of these as that command,
 * even when it is quoted, so a one-word instruction that equals one is refused. `help` is not in either table, so it is not listed.
 */
export const START_SUBCOMMANDS: Readonly<Record<'claude-code' | 'codex', readonly string[]>> = Object.freeze({
  'claude-code': Object.freeze(['agents', 'attach', 'auth', 'auto-mode', 'daemon', 'doctor', 'gateway', 'import', 'install', 'logs', 'mcp', 'plugin', 'purge', 'remote-control', 'respawn', 'rm', 'self-hosted-runner', 'setup-token', 'stop', 'ultrareview', 'update']),
  codex: Object.freeze(['a', 'agents', 'app', 'app-server', 'apply', 'archive', 'cloud', 'cloud-tasks', 'completion', 'debug', 'delete', 'doctor', 'e', 'exec', 'execpolicy', 'features', 'fork', 'login', 'logout', 'mcp', 'plugin', 'queue', 'remote-control', 'resume', 'review', 'sandbox', 'unarchive', 'update']),
});

