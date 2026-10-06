import record from '../../../release/beta.json' with { type: 'json' };

export const release = record;
export const docsPath = new URL(release.urls.docs).pathname;
export const installAvailable = release.npm.published && release.state === 'published';
export const setupRequirements = `node ${release.requirements.node}; npm ${release.requirements.npm}.`;
export const setupCommands = `${installAvailable ? '' : '# After publication of this exact version only.\n'}${release.npm.installCommand}\nbowerloom --version\nbowerloom --help`;
