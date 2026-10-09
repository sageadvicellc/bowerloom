import record from '../../../release/beta.json' with { type: 'json' };

// Operational facts remain unchanged. Reader wording describes release-time use;
// it is not a publication receipt or permission to activate a supported action.
export const release = record;
export const docsPath = new URL(release.urls.docs).pathname;
export const installAvailable = release.npm.published && release.state === 'published';
export function releasePresentation(source: typeof record = record) {
  return {
    label: 'Open beta', version: source.version, release: source.release,
    capabilities: {
      setup: 'Prepare a personal-agent profile, team definition, and working agreement in a new or existing project. Exact approval writes the planned files.',
      skills: 'Pin skills from npm or GitHub with skills add, then install them for Claude Code and Codex with skills sync. A copy in the project does not prove that Claude Code or Codex finds or runs it.',
      revision: 'Plan a change to an installed setup, then approve its exact revision before replacement.',
      execution: 'Setup does not start workers, grant runtime access, or authorize connected actions.',
      harnesses: 'Synthetic configuration commands support Codex and Claude Code fixtures. They do not run models or change live agent configuration.',
      connections: 'MCP planning reads selected synthetic files. Local backend installation requires a separate plan and exact approval.',
      company: "Shared company access, retrieval, offboarding, and deletion are outside this beta's documented setup path.",
    },
    platforms: `These guides use ${source.systems.tested.map(system=>`${system.os} ${system.architecture} and Node ${system.node}`).join('; ')}. Other host systems are outside this documented installation path.`,
    beyondSetup: 'Running a team needs separate runtime permissions and controls. The setup commands do not grant them.',
    unattended: 'Shared company access and unattended services are outside this setup walkthrough.',
    setupCommands: `${source.npm.installCommand}\nbowerloom --version\nbowerloom --help`,
    installNote: 'Use the path where you saved the file.',
  };
}
export const readerRelease = releasePresentation();
export const setupRequirements = `node ${release.requirements.node}; npm ${release.requirements.npm}.`;
export const setupCommands = readerRelease.setupCommands;
