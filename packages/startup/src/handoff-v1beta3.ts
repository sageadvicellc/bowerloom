import type { NormalizedBrief } from './scaffold-v1beta3.js';

// User-supplied names and goals stay visible data, not Markdown or HTML instructions.
const plain = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/[\\`*_{}\[\]()#+.!|~-]/g, '\\$&');
export const projectSummary = (brief: NormalizedBrief): string =>
  `**Project:** ${plain(brief.projectName)}\n\n**Your goal:**\n\n${brief.goal.replace(/\r\n?/g, '\n').split('\n').map(line => `> ${plain(line)}`).join('\n')}`;

export const refinementGuidance = 'Goal refinements are discussion proposals only until you approve an exact revision plan. Ask your agent to inspect the installed setup, prepare a revise plan with the full proposed brief, and show the old goal, new goal, affected managed files, and approval revision. Revise apply requires both the exact old installation revision and the new plan approval. Do not edit one copy of the brief or delete the existing .bowerloom folder to force an update.\n\nRevision refuses changed or unexpected managed files, preserves unrelated project files, and keeps the old installation as a private backup. It grants no execution permission and does not carry old connection or runtime approvals onto the new specification. If interrupted, status reports revision-pending: keep work stopped and ask your agent to use revise recover with the exact original revision approval and an explicit resume or rollback choice. Do not treat a mixed or pending setup as ready. A finalized update retains its history; recovery is not permission to delete it.';

export const personalAgentRequest = '> Read this project’s .bowerloom setup files for me, including its brief, assistant profile, working agreement, milestones, and team specification. Explain my saved project and goal, each proposed role, the limits, and the first milestone in plain English. Ask whether the direction fits. Treat changes we discuss as proposals only; do not edit or reapprove this installation. If I ask for a changed setup, show the installed revision and exact new revision plan. Obtain my approval of that plan before replacing managed files. Do not read other project files, import settings, start workers, or execute the team during this review.';

export const optionalControls = `# Optional connections and stopping work

You can finish setup review without a connection, backend, or running team. Ask your personal agent to explain these controls only when you need them. None runs during setup.

## Connect two existing local setups

A connection lets one local team read one explicitly selected definition from another installed root. It does not merge projects, grant writes or execution, or provide access to other files. It starts no server or synchronization service.

Ask your agent to check both installations with \`init status --target\`, select the exact source file with you, and prepare a \`link plan\`. The plan shows the shared contents, receiving root, and exact approval revision. A brief may contain private information. Approve only the content you intend to share.

The following examples run from the built Bowerloom checkout. Paths and REVISION are placeholders for your agent to replace, not commands to run unchanged. The private receipt directory must already exist with owner-only access (0700); keep it outside both project roots. The receipt file must be new.

\`\`\`sh
node dist/apps/cli/src/main.js init status --target /absolute/source-root
node dist/apps/cli/src/main.js init status --target /absolute/receiving-root
node dist/apps/cli/src/main.js link plan --from /absolute/source-root --to /absolute/receiving-root --file working-agreement.md --out /absolute/private-links/agreement.json
\`\`\`

Only after you approve that exact plan may your agent apply the same inputs:

\`\`\`sh
node dist/apps/cli/src/main.js link apply --from /absolute/source-root --to /absolute/receiving-root --file working-agreement.md --out /absolute/private-links/agreement.json --approve REVISION
node dist/apps/cli/src/main.js link read --connection /absolute/private-links/agreement.json --target /absolute/receiving-root
\`\`\`

## Revoke the connection

Tell your agent to revoke the selected connection:

\`\`\`sh
node dist/apps/cli/src/main.js link revoke --connection /absolute/private-links/agreement.json
\`\`\`

Revocation prevents future reads through this connection and preserves its receipt. Repeating it is safe. It does not erase copies already read, stop a team, or limit unrelated programs using your operating-system account. Changed source contents or root identities also block reads; a new connection needs a new plan and approval.

## Stop registered local work

This setup enrolls no work and starts no workers. Before a later supported execution, your agent must obtain separate approval to register its team and private installation. A connection grants no stop authority.

For a separately registered first team, ask your agent to stop its work:

\`\`\`sh
node dist/apps/cli/src/main.js destruct first-team --root /absolute/project-root
\`\`\`

To request a stop for every team in the same local registry:

\`\`\`sh
node dist/apps/cli/src/main.js destruct all
\`\`\`

The default registry is \`~/.local/state/bowerloom\`. If registration used a different registry, append \`--registry /absolute/private-registry\` to the stop command. \`all\` means that one registry, not every machine, user, or process. It cannot stop an unrelated personal-agent session or unregistered work. No handoff is required.

\`destruct\` requests a stop for registered Bowerloom work. It preserves project files, definitions, outputs, saved history, and backend services. It does not delete your setup or undo accepted external actions.

Read the reported result:

- \`STOPPED\`: The registered owner reported completed cleanup.
- \`NOT_RUNNING\`: No execution began, or earlier executions finished.
- \`STOP_UNCONFIRMED\`: Cleanup remains uncertain.

Repeating the command observes the existing request. Do not treat a timeout as success. Do not restart work while its stop remains unresolved. A stopped team needs a separately approved new registration before work resumes.
`;
