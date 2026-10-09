// Freeze security review of F (b68f557), finding 2: the apply review names every common form of a prompt that grants
// tools or runs shell commands. A notice is a review line only: more notices are safe, a missing one is not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promptNotices } from '../../../dist/packages/project-sync/src/prompts.js';

const cases = [
  // [name, text, expected]
  ['plain text', 'Summarize the week.\n', []],
  ['an inline shell command, as the Claude Code docs show it', 'Summarize.\n- Current git status: !`git status`\n', ['shell-lines']],
  ['a shell command at the start of a line', '!`git status`\n', ['shell-lines']],
  ['a line that starts with !', '!git status\n', ['shell-lines']],
  ['allowed-tools in the frontmatter', '---\nallowed-tools: Bash(git status:*)\n---\nText\n', ['allowed-tools']],
  ['a quoted allowed-tools key', '---\n"allowed-tools": Bash(*)\n---\nText\n', ['allowed-tools']],
  ['a single-quoted allowed-tools key', "---\n'allowed-tools': Bash(*)\n---\nText\n", ['allowed-tools']],
  ['allowed-tools in another case', '---\nAllowed-Tools: Bash(*)\n---\nText\n', ['allowed-tools']],
  ['an opener with a trailing space', '--- \nallowed-tools: Bash(*)\n---\nText\n', ['allowed-tools']],
  ['a closer with a trailing space', '---\nallowed-tools: Bash(*)\n---  \nText\n', ['allowed-tools']],
  ['an indented key', '---\n  allowed-tools: Bash(*)\n---\n', ['allowed-tools']],
  ['CRLF line ends', '---\r\nallowed-tools: Bash(*)\r\n---\r\nRun !`ls`\r\n', ['allowed-tools', 'shell-lines']],
  // F' review SEC 1: frontmatter that cannot be read safely fails closed, with both frontmatter notices.
  ['frontmatter YAML cannot parse still flags a key it names', '---\nallowed-tools: [Bash\n---\nText\n', ['allowed-tools', 'hooks']],
  ['both', '---\ndescription: d\nallowed-tools: Bash\n---\nNow: !`date`\n', ['allowed-tools', 'shell-lines']],
  ['allowed-tools outside the frontmatter is text', 'allowed-tools: none here\n', []],
  ['an exclamation in prose is text', 'Ship it!\nGreat work! `code` here.\n', []],
  // F' review SEC 1: a YAML alias makes the frontmatter unreadable to the bounded parser, so every frontmatter notice shows.
  ['an alias, then an explicit allowed-tools key', '---\na: &x 1\nb: *x\n? allowed-tools\n: Bash\n---\nText\n', ['allowed-tools', 'hooks']],
  ['an alias, then an escaped allowed-tools key', '---\na: &x 1\nb: *x\n"allowed\\x2dtools": Bash\n---\nText\n', ['allowed-tools', 'hooks']],
  ['a merge key from an anchored map', '---\nbase: &b {allowed-tools: Bash}\n<<: *b\n---\nText\n', ['allowed-tools', 'hooks']],
  ['frontmatter that is not a map', '---\n- a\n- b\n---\nText\n', ['allowed-tools', 'hooks']],
  // F' review SEC 2 (Claude Code skills docs): hooks keep running for the session; a ```! fence runs shell commands.
  ['a hooks key', '---\ndescription: d\nhooks:\n  PreToolUse: []\n---\nText\n', ['hooks']],
  ['a hooks key in another case, quoted', '---\n"Hooks": {}\n---\nText\n', ['hooks']],
  ['hooks outside the frontmatter is text', 'hooks: none here\n', []],
  ['a fenced block opened with ```!', 'Status:\n```!\ngit status\n```\n', ['shell-lines']],
  ['an indented ```! fence with a longer opener', 'Status:\n  ````!\n  date\n  ````\n', ['shell-lines']],
  ['a plain code fence is text', 'Example:\n```sh\nls\n```\n', []],
];

for (const [name, text, expected] of cases) {
  test(`promptNotices: ${name}`, () => { assert.deepEqual(promptNotices(text), expected); });
}
