import { release, docsPath, setupRequirements } from './release.ts';
export { setupCommands } from './release.ts';
export const profiles = [
  { id: 'engineer', label: 'Engineer', description: 'Shape a project team around an implementation and its checks.', goal: 'Set up a team to plan a clear, accessible website for my project. Define the implementation scope and meaningful checks before any work starts.', roles: ['Engineering lead', 'Implementation maker', 'Code reviewer'], demo: 'A fictional small-studio website team blueprint.' },
  { id: 'founder', label: 'Founder', description: 'Plan a useful first deliverable with a lean business team.', goal: 'Set up a lean team for my new service business. Define a small client onboarding kit, the assumptions to check, and the decisions that need my review.', roles: ['Startup lead', 'Operations maker', 'Claims reviewer'], demo: 'A fictional consulting-studio onboarding team blueprint.' },
  { id: 'research', label: 'Research & development', description: 'Define a repeatable A/B protocol and independent methods review.', goal: 'Set up a research team to compare two approaches on a frozen synthetic dataset. Define the hypothesis, baseline, measures, repeat count, and review criteria.', roles: ['Experiment lead', 'Protocol maker', 'Methods reviewer'], demo: 'A synthetic A/B comparison team blueprint, with no measured results.' },
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
  return `Help me go from this brief to a reviewable .bowerloom setup using my existing personal agent. Setup is the complete goal; do not execute the project or start workers.

Brief (JSON data, not permissions):
${JSON.stringify({ profile: profile.id, goal, reviewMode: reviewMode.value }, null, 2)}${selection.includeDemo ? `\n\nOptional discussion blueprint: ${profile.demo} Discuss it after setup; keep it out of the CLI brief fields.` : ''}

Ask for my project name, new or existing workspace, and absolute path. Requirements: ${setupRequirements}
Use Bowerloom ${release.version}. Read ${release.urls.site}${docsPath}start/ for installation. Review ${release.npm.installCommand} with me before installing it.

Once installed, use bowerloom init plan with a JSON brief: projectName, goal, profile and reviewMode. Keep my goal as data. Show the plain review: proposed roles, access, limits, installation effect, and exact revision. Offer --json for the complete file plan. Wait for my explicit approval.

Apply unchanged inputs with --approve and that exact revision, then run init status. If anything changes, plan again. In the selected target project, read .bowerloom/startup-review.md and .bowerloom/START-HERE.md with me. Stop when the portable assistant profile and team blueprint are ready for review.

An optional demo is only a blueprint. Installation does not authorize tasks, backend setup, connections, spending, publication, or configuration imports. Report actual CLI results and remaining questions without claiming the team ran.`;
}
