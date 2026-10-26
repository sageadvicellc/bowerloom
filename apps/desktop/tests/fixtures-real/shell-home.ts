/**
 * A made-up home folder for the real-mode shell (its unit tests and its end-to-end run). Every name, text and key is invented, and no name is one the sample world uses, so a
 * sample name on a screen can only come from the sample. It is built in a temporary folder that the caller removes. It holds: Claude Code, Codex, OpenCode and Hermes at home; a
 * folder of projects that a person would pick (one project with its own .claude folder and a notes folder); a second folder of projects for "Find more"; one skill found in two programs
 * with two different texts; and a connection with a made-up key value that must never reach a screen.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** A made-up key value. If it shows up anywhere in a page, something kept a value it should have dropped. */
export const SHELL_SECRET = 'xq4-NOT-A-REAL-VALUE-5519';

export interface ShellHome {
  /** The temporary folder that holds everything below. */
  readonly root: string;
  readonly home: string;
  /** The first folder a person picks: it holds one project with an agent, a skill and notes. */
  readonly orchard: string;
  /** The second folder, picked in "Find more": it holds one project with an agent. */
  readonly cellar: string;
  readonly cleanup: () => void;
}

/** What the fixture holds, by the names a person sees, for the tests to check against. */
export const SHELL_AGENTS = Object.freeze({
  home: ['Ledger keeper', 'Garden planner', 'Seed sorter', 'Bench scribe', 'Lantern'],
  orchard: ['Graft helper'],
  cellar: ['Label printer'],
});
export const SHELL_COPIES_SKILL = 'Shared tally';

const put = (file: string, text: string): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };

const TALLY_A = '---\nname: Shared tally\ndescription: Adds up the household totals again.\n---\n\nAdd each column. Compare with the total.\n';
const TALLY_B = '---\nname: Shared tally\ndescription: Adds up the household totals again.\n---\n\nAdd each column twice. Compare with the total and last month.\n';

export function buildShellHome(): ShellHome {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bowerloom-shell-home-')));
  const home = join(root, 'home'), orchard = join(home, 'orchard'), cellar = join(home, 'cellar');
  mkdirSync(home, { recursive: true });

  // Claude Code, at home.
  const claude = join(home, '.claude');
  put(join(claude, 'agents', 'ledger-keeper.md'), '---\nname: Ledger keeper\ndescription: Keeps the household ledger tidy and flags odd entries.\nskills: [pantry-check, shared-tally]\ntools: Read, mcp__ledger-sync__list\n---\nYou keep the ledger.\n');
  put(join(claude, 'agents', 'garden-planner.md'), '---\nname: Garden planner\ndescription: Decides what to sow in each season.\n---\nYou sow.\n');
  put(join(claude, 'skills', 'pantry-check', 'SKILL.md'), '---\nname: Pantry check\ndescription: Lists what is running low in the pantry.\n---\n\nLook at the shelves. List what is low.\n');
  put(join(claude, 'skills', 'shared-tally', 'SKILL.md'), TALLY_A);
  put(join(home, '.claude.json'), JSON.stringify({ mcpServers: { 'ledger-sync': { command: 'node', args: ['sync.js', `--token=${SHELL_SECRET}`], env: { LEDGER_API_KEY: SHELL_SECRET } } } }));

  // Codex.
  const codex = join(home, '.codex');
  put(join(codex, 'agents', 'seed-sorter.toml'), 'name = "Seed sorter"\ndescription = "Sorts seed packets by planting date."\ndeveloper_instructions = """\nSort the packets.\n"""\n');
  put(join(codex, 'skills', 'shared-tally', 'SKILL.md'), TALLY_B);

  // OpenCode.
  put(join(home, '.config', 'opencode', 'agent', 'bench-scribe.md'), '---\nname: Bench scribe\ndescription: Writes up what happened at the workshop bench.\nmode: subagent\n---\nWrite it down.\n');

  // Hermes.
  const hermes = join(home, '.hermes');
  put(join(hermes, 'profiles', 'lantern', 'SOUL.md'), 'Lantern watches the greenhouse lights and reports at dusk.\n');
  put(join(hermes, 'config.yaml'), `model: x\nmcp_servers:\n  greenhouse-feed:\n    command: npx\n    env:\n      FEED_TOKEN: ${SHELL_SECRET}\n`);

  // A folder of projects, as a person would pick it.
  put(join(orchard, 'apple-row', '.claude', 'agents', 'graft-helper.md'), '---\nname: Graft helper\ndescription: Explains how to graft a branch onto a tree.\n---\nExplain.\n');
  put(join(orchard, 'apple-row', '.claude', 'skills', 'graft-notes', 'SKILL.md'), '---\nname: Graft notes\ndescription: Keeps notes on every graft.\n---\nNotes.\n');
  put(join(orchard, 'apple-row', 'notes', 'harvest.md'), '---\ntitle: Harvest calendar\ntags: [harvest, autumn]\n---\nWhen each tree is ready to pick.\n');
  put(join(orchard, 'apple-row', 'notes', 'pruning.md'), '# Pruning\n\nWhen and how to prune.\n');
  put(join(orchard, 'apple-row', 'notes', 'frost.md'), '# Frost\n\nWhat to do on a cold night.\n');

  // A second folder of projects, for "Find more".
  put(join(cellar, 'bottle-log', '.claude', 'agents', 'label-printer.md'), '---\nname: Label printer\ndescription: Prints a label for every new bottle.\n---\nPrint.\n');

  return { root, home, orchard, cellar, cleanup: () => { rmSync(root, { recursive: true, force: true }); } };
}
