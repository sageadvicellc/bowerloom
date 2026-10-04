# Set up your first Bowerloom team

The setup builder prepares a short request for your existing personal agent. It does not call a model, start workers, or send your goal to a server.

Choose Engineer, Founder, or Research & development. Describe a goal and a future review cadence. An optional demo idea adds a fictional blueprint to discuss; it never asks the agent to run it.

Your complete result is a reviewable `.bowerloom/` setup. You do not need to finish a full project or launch a team during this exercise.

## Plan, review, install

Copy the prompt into your existing personal agent. It asks for your project name, an absolute directory, and whether that directory is new or an existing project.

Use an existing source checkout or review setup first. The source build requires Git, Node 24.11 or later within Node 24, and npm 11. The alpha has no published npm installer. Keep the source checkout separate from your selected project.

From the built source checkout:

```sh
node dist/apps/cli/src/main.js init plan --mode new --target /absolute/projects/my-team --profile engineer --name "My team" --goal "Plan an accessible project website and its meaningful checks."
```

Use `--mode existing` to add only a new `.bowerloom` directory to a current project. Existing source and agent settings remain unchanged and unread. A previous `.bowerloom` directory blocks installation.

The plain review describes the roles, access, limits, installation effect, and exact revision. Add `--json` to inspect the full generated file texts and hashes. A structured `--brief /absolute/brief.json` can replace the inline brief fields, including `profile`.

After reviewing, use `init apply` with the same inputs and `--approve EXACT_PLAN_REVISION`. A changed profile, goal, target, or template requires a new plan and approval. Then use `init status --target /absolute/projects/my-team` to inspect the actual files.

## Read the result together

Ask your personal agent to read `.bowerloom/startup-review.md` and `.bowerloom/START-HERE.md`. The review includes a plain explanation and an expandable technical snapshot. The setup includes a versioned explicit brief, personal-agent profile, first team, working agreement, and review milestones.

Engineer supplies an engineering lead, implementation maker, and code reviewer. Founder supplies a startup lead, operations maker, and claims reviewer. Research supplies an experiment lead, protocol maker, and methods reviewer. These are deterministic templates, not bespoke model-designed teams.

The team definitions declare at most two active workers, a 25 percent capacity reserve, no paid fallback, and exact approvals for future task writes. Those declarations need a supported runtime before work can execute. The installation approval only creates the reviewed setup files.

The research blueprint can define a repeatable A/B protocol. It does not establish that a comparison ran or improved anything. No profile imports settings, starts workers, sets up Docker, creates connections, publishes, or spends money.

Stop and review the setup. Later execution and connected applications need their own scope and authorization. The separate [Labs-to-blog recipe](../recipes/labs-to-blog.md) has its own runtime evidence and approval controls.

The page stores choices in React memory only. The short prompt is guidance for the personal agent. File validation, path safety, stale-approval checks, and receipt inspection remain in the Bowerloom CLI.
