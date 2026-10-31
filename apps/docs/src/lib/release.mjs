import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {releasePresentation} from '../../../landing/src/release.ts';
import {sourcePaths} from './build-paths.mjs';
const literal = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The registry form installs the package by its dist-tag or by its exact version, with -g or --global.
// latest is the stable stream, so a beta record never names it.
const registry = r => typeof r.npm.distTag === 'string' && /^[a-z][a-z0-9-]*$/.test(r.npm.distTag) && r.npm.distTag !== 'latest'
  ? new RegExp(`^npm install (?:-g|--global) ${literal(r.npm.packageName)}@(?:${literal(r.npm.distTag)}|${literal(r.version)})$`) : null;
// A public beta stream installs from the registry under its dist-tag.
// A private archive (a colleague beta) installs the packed file and is never published.
// The archive path may be relative (./), under the home folder (~/), or absolute (/). Inside Claude Code a cd
// outside the project does not last, so the docs show a full path such as ~/Downloads/<archive>.
// Folder names hold letters, digits, dots, underscores and hyphens only: no space and no shell character.
export function expectedInstallCommand(r) {
  const d = r.distribution;
  if (d === undefined) return registry(r);
  if (d && d.kind === 'npm-beta-stream') return Object.keys(d).length === 2 && d.distTag === r.npm.distTag ? registry(r) : null;
  const archive = `${r.npm.packageName}-${r.version}.tgz`;
  if (!d || Object.keys(d).length !== 3 || d.kind !== 'private-archive' || d.archive !== archive || d.npmPublication !== false || r.npm.published !== false || r.state !== 'unreleased') return null;
  return new RegExp(`^npm install -g (?:\\./|~/(?:[A-Za-z0-9._-]+/)*|/(?:[A-Za-z0-9._-]+/)*)${literal(archive)}$`);
}
export function installCommandAccepted(r) {
  const expected = expectedInstallCommand(r);
  return expected !== null && typeof r.npm.installCommand === 'string' && expected.test(r.npm.installCommand);
}
// The 0.8 capability keys. Each holds a sentence, and limits holds a list of sentences.
export const capabilityKeys = ['setup','adopt','install','fidelity','drift','remove','save','notes','skills','desktop','execution'];
export const capabilitiesComplete = c => c && capabilityKeys.every(key => typeof c[key] === 'string' && c[key].length > 0)
  && Array.isArray(c.limits) && c.limits.length > 0 && c.limits.every(x => typeof x === 'string' && x.length > 0);
export async function readRelease() {
  const raw = await readFile(sourcePaths.release,'utf8');
  const r = JSON.parse(raw);
  if (r.schema !== 'bowerloom/release/v1' || !/^\d+\.\d+\.\d+-beta\.\d+$/.test(r.version)
    || !installCommandAccepted(r) || !capabilitiesComplete(r.capabilities)
    || (r.state === 'published') !== r.npm.published
    || (r.npm.published && (!r.npm.ownershipVerified || !r.npm.publishingIdentityVerified || !r.systems.releaseQualified.length))) {
    throw new Error('Inconsistent release metadata; documentation publication is refused.');
  }
  return {...r,sourceRecordSha256:createHash('sha256').update(raw).digest('hex')};
}
export function releaseReference(r) {
  const support = new URL('status/',r.urls.docs.endsWith('/')?r.urls.docs:r.urls.docs+'/').href;
  return `Version: ${r.version} · Release: ${r.release}.\n\n[Source repository](${r.urls.repository}) · [Current support and limits](${support})`;
}
// The systems sentence comes from the record: the tested rows and the record's own note.
export function systemSupport(r) {
  const tested = r.systems.tested.map(system => `${system.os} ${system.architecture} and Node ${system.node}`).join('; ');
  return `These guides use ${tested}. ${r.systems.note}`;
}
// The one npm gate is the landing presentation's. The command shows only when the record says the package is published.
export function installPublished(r) {
  return releasePresentation(r).installAvailable;
}
const capabilityLabel = key => key === 'skills' ? 'Portable skills' : key[0].toUpperCase() + key.slice(1);
export function releaseSections(r) {
  const reader=releasePresentation(r);
  const status=`${reader.label} · ${reader.version}\n\n${reader.capabilities.execution}`;
  const docker='Harness commands and first-team setup do not need Docker. The separate local backend requires Docker Desktop and its own plan and approval.';
  // The install command shows only after npm publishes the package. Until then the block says it arrives later.
  const install=reader.installAvailable
    ? `Install the beta CLI with Node \`${r.requirements.node}\` and npm \`${r.requirements.npm}\`.\n\n\`\`\`sh\n${reader.installCommand}\nbowerloom --version\nbowerloom --help\n\`\`\`\n\nThe \`${r.npm.distTag}\` dist-tag follows the beta stream, so the command keeps you on it.\n\n${docker}\n\n${systemSupport(r)}`
    : `Bowerloom needs Node \`${r.requirements.node}\` and npm \`${r.requirements.npm}\`. The npm package \`${r.npm.packageName}\` is not published yet. The install command arrives when the beta publishes, under the \`${r.npm.distTag}\` dist-tag.\n\n${docker}\n\n${systemSupport(r)}`;
  const rows=Object.entries(reader.capabilities).map(([key,value])=>`| ${capabilityLabel(key)} | ${value} |`).join('\n');
  const limits=reader.limits.map(limit=>`- ${limit}`).join('\n');
  const support=`${status}\n\n| Capability | Current boundary |\n| --- | --- |\n${rows}\n\n${systemSupport(r)}\n\nLimits of this beta:\n\n${limits}`;
  return {status,install,support};
}
export function expandRelease(markdown, release) {
  const sections = releaseSections(release);
  const text = markdown.replace(/<!-- release:(status|install|support):start -->[\s\S]*?<!-- release:\1:end -->/g,(_,kind)=>sections[kind]);
  if (/<!--\s*release:/.test(text)) throw new Error('Unknown or unmatched release marker.');
  return text;
}
