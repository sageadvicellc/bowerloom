import record from '../../../release/beta.json' with { type: 'json' };

/** The release record is read here and never written. Another change owns it. The build keeps only the fields read below. */
const { urls, npm, state } = record;
export const docsPath = new URL(urls.docs).pathname;
export const repositoryUrl = urls.repository;
/** The releases page. The page names no download file, so it stays true for every build. */
export const releasesUrl = `${urls.repository}/releases`;
export const installCommand = npm.installCommand;
/** The one npm gate: the command shows only after the record says the package is published. */
const published = (source: { state: string; npm: { published: boolean } }) => source.npm.published && source.state === 'published';
export const installAvailable = published(record);

/** The label has no version number until npm publishes. */
export const readerRelease = {
  label: 'Open beta',
  description: 'Define your skills, agents, tools, rules, and context once. Bowerloom installs them into Claude Code and Codex.',
  availability: 'Before it writes a file, it shows what each engine can carry and what it cannot.',
} as const;

/** The 0.8 shape of the release record. The capability wording comes from the record, never from this file. */
export type ReleaseRecord = {
  version: string;
  release: string;
  state: string;
  npm: { installCommand: string; published: boolean };
  capabilities: {
    setup: string; adopt: string; install: string; fidelity: string; drift: string; remove: string;
    save: string; notes: string; skills: string; desktop: string; execution: string; limits: string[];
  };
};

/**
 * What the record says, for the documentation build, which imports this function. The landing page does not call it,
 * so the bundle drops it. It uses the same npm gate as `installAvailable`.
 */
export function releasePresentation(source: ReleaseRecord = record as unknown as ReleaseRecord) {
  const { capabilities: c } = source;
  return {
    label: readerRelease.label,
    version: source.version,
    release: source.release,
    installCommand: source.npm.installCommand,
    installAvailable: published(source),
    capabilities: {
      setup: c.setup, adopt: c.adopt, install: c.install, fidelity: c.fidelity, drift: c.drift, remove: c.remove,
      save: c.save, notes: c.notes, skills: c.skills, desktop: c.desktop, execution: c.execution,
    },
    limits: c.limits,
  };
}
