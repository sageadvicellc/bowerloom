import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {releasePresentation} from '../../../landing/src/release.ts';
import {sourcePaths} from './build-paths.mjs';
// A private archive (a colleague beta) installs the packed file and is never published; otherwise npm.
export function expectedInstallCommand(r) {
  const d = r.distribution;
  if (d === undefined) return `npm install --global ${r.npm.packageName}@${r.version}`;
  const archive = `${r.npm.packageName}-${r.version}.tgz`;
  if (!d || Object.keys(d).length !== 3 || d.kind !== 'private-archive' || d.archive !== archive || d.npmPublication !== false || r.npm.published !== false || r.state !== 'unreleased') return null;
  return `npm install -g ./${archive}`;
}
export async function readRelease() {
  const raw = await readFile(sourcePaths.release,'utf8');
  const r = JSON.parse(raw);
  if (r.schema !== 'bowerloom/release/v1' || !/^\d+\.\d+\.\d+-beta\.\d+$/.test(r.version)
    || r.npm.installCommand !== expectedInstallCommand(r)
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
export function systemSupport(r) {
  return releasePresentation(r).platforms;
}
export function releaseSections(r) {
  const reader=releasePresentation(r);
  const status=`${reader.label} · ${reader.version}\n\n${reader.capabilities.execution}`;
  const install=`Install the beta CLI with Node \`${r.requirements.node}\` and npm \`${r.requirements.npm}\`.\n\n\`\`\`sh\n${reader.setupCommands}\n\`\`\`\n\nFirst-team setup does not need Docker. The separate local backend requires Docker Desktop and its own plan and approval.\n\n${systemSupport(r)}`;
  const support=`${status}\n\n| Capability | Current boundary |\n| --- | --- |\n${Object.entries(reader.capabilities).map(([key,value])=>`| ${key==='skills'?'Portable skills':key[0].toUpperCase()+key.slice(1)} | ${value} |`).join('\n')}\n\n${systemSupport(r)}\n\n${reader.beyondSetup} ${reader.unattended}`;
  return {status,install,support};
}
export function expandRelease(markdown, release) {
  const sections = releaseSections(release);
  const text = markdown.replace(/<!-- release:(status|install|support):start -->[\s\S]*?<!-- release:\1:end -->/g,(_,kind)=>sections[kind]);
  if (/<!--\s*release:/.test(text)) throw new Error('Unknown or unmatched release marker.');
  return text;
}
