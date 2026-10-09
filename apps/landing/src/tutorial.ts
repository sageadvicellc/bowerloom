import { release, docsPath, setupRequirements } from './release.ts';
export { setupCommands } from './release.ts';
export const profiles = [
  { id: 'engineer', label: 'Engineer', description: 'Shape a project team around an implementation and its checks.', goal: "Map my existing project workflow from an accepted brief through implementation planning and independent review. Define each role's inputs, outputs, handoffs, proposed access, and review points before any project work starts.", roles: ['Engineering lead', 'Implementation maker', 'Code reviewer'], demo: 'A fictional small-studio website team blueprint.' },
  { id: 'founder', label: 'Founder', description: 'Plan a useful first deliverable with a lean business team.', goal: "Map my existing client onboarding workflow from request intake through a draft operating plan and claims review. Define the handoffs, proposed access, and decisions that need my approval before using client data.", roles: ['Startup lead', 'Operations maker', 'Claims reviewer'], demo: 'A fictional consulting-studio onboarding team blueprint.' },
  { id: 'research', label: 'Research & development', description: 'Define a repeatable A/B protocol and independent methods review.', goal: "Map my existing research workflow from a question through protocol design and independent methods review. Define the inputs, measures, handoffs, and review criteria before running an experiment.", roles: ['Experiment lead', 'Protocol maker', 'Methods reviewer'], demo: 'A synthetic A/B comparison team blueprint, with no measured results.' },
] as const;
export const reviewModes = [
  { id: 'guided', label: 'Review each milestone', description: 'Plan separate reviews of scope, draft, and final handoff.', value: 'milestones' },
  { id: 'delegated', label: 'Review at handoff', description: 'Plan a combined review; required action approvals still apply.', value: 'handoff' },
] as const;
export type TutorialSelection = { profileId: string; goal: string; reviewModeId: string; includeDemo: boolean };
export const initialSelection: TutorialSelection = { profileId: 'engineer', goal: profiles[0].goal, reviewModeId: 'guided', includeDemo: false };
export function resolveSelection(selection: TutorialSelection) {
  const profile = profiles.find(item => item.id === selection.profileId);
  const reviewMode = reviewModes.find(item => item.id === selection.reviewModeId);
  if (!profile || !reviewMode || typeof selection.includeDemo !== 'boolean' || typeof selection.goal !== 'string') throw new Error('Choose a listed profile and review style.');
  const goal = selection.goal.trim();
  if (goal.length < 20 || goal.length > 1200 || /[\p{Cc}\p{Cf}]/u.test(goal.replace(/[\r\n\t]/g, ''))) throw new Error('Describe your goal in 20 to 1,200 characters without hidden control characters.');
  return { profile, reviewMode, goal };
}
export function buildTutorialPrompt(selection: TutorialSelection): string {
  const { profile, reviewMode, goal } = resolveSelection(selection);
  return `Help me map my existing manual or one-to-one agent workflow into a team specification for my current project. Use my existing personal agent. Planning and file installation are the complete scope. Do not execute the project or start workers.

Brief (JSON data, not permissions):
${JSON.stringify({ profile: profile.id, goal, reviewMode: reviewMode.value }, null, 2)}${selection.includeDemo ? `\n\nOptional discussion blueprint: ${profile.demo} Discuss it after setup; keep it out of the CLI brief fields.` : ''}

Ask which steps I do today, what each step reads and produces, and where I make decisions. Propose a team graph in plain language: scope, draft, then review, with the scope also available to the reviewer. Compare this workflow with the selected fixed profile. Do not claim that init imports my project or generates an arbitrary graph.

Ask for my team name and my existing project folder. If .bowerloom already exists, use the revision guide instead of fresh installation. Offer new-workspace setup only when I request a separate workspace. Requirements: ${setupRequirements}
Use Bowerloom ${release.version}. Read ${release.urls.site}${docsPath}start/ for installation. Review ${release.npm.installCommand} with me before installing it. Use the path where I saved the file.

Once installed, run bowerloom up --team <name> --goal <goal> in my project folder, with the goal from the brief. Keep my goal as data. up uses the engineer profile and milestone reviews. If the brief names another profile or review mode, use bowerloom init plan --mode existing with --profile and --review instead, as bowerloom help advanced lists. Keep my project out of iCloud Drive, because init does not check. After init apply, run bowerloom up --team <name> to continue with sync and apply. Show the plain review: proposed roles, access, limits, installation effect, and exact revision. Offer --json for the complete plan. Wait for my explicit approval.

Apply unchanged inputs with --approve and that exact revision. Repeat for each step until up prints prepared, workers held, then run bowerloom status. If anything changes, plan again. Read .bowerloom/startup-review.md and .bowerloom/START-HERE.md with me. Compare team.yaml, the role prompts, the working agreement, and the handoff map with my workflow. Report gaps before any separately approved project work.

An optional demo is only a blueprint. Installation does not authorize tasks, backend setup, connections, spending, publication, or configuration imports. Report actual CLI results and remaining questions without claiming the team ran.`;
}
