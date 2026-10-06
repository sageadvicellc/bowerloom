import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {sourcePaths} from './build-paths.mjs';
export async function readRelease() {
  const raw = await readFile(sourcePaths.release,'utf8');
  const r = JSON.parse(raw);
  if (r.schema !== 'bowerloom/release/v1' || !/^\d+\.\d+\.\d+-beta\.\d+$/.test(r.version)
    || r.npm.installCommand !== `npm install --global ${r.npm.packageName}@${r.version}`
    || (r.state === 'published') !== r.npm.published
    || (r.npm.published && (!r.npm.ownershipVerified || !r.npm.publishingIdentityVerified || !r.systems.releaseQualified.length))) {
    throw new Error('Inconsistent release metadata; documentation publication is refused.');
  }
  return {...r,sourceRecordSha256:createHash('sha256').update(raw).digest('hex')};
}
export function releaseReference(r) {
  const support = new URL('status/',r.urls.docs.endsWith('/')?r.urls.docs:r.urls.docs+'/').href;
  return `Version: \`${r.version}\` · Release: ${r.release} · State: ${r.state} (${r.statusLabel}).\n\nSource: [${r.urls.repository}](${r.urls.repository}), shared \`release/beta.json\`. Release-record SHA256: \`${r.sourceRecordSha256}\`. This identifies the documentation release record, not an installed artifact or candidate commit.\n\n[Current support and limits](${support})`;
}
export function systemSupport(r) {
  const tested = r.systems.tested.length ? r.systems.tested.map(x=>`- ${x.os} ${x.architecture}, Node \`${x.node}\` — ${x.scope}.`).join('\n') : 'No tested systems are recorded.';
  const qualified = r.systems.releaseQualified.length ? r.systems.releaseQualified.map(x=>typeof x==='string'?`- ${x}`:`- ${x.os} ${x.architecture}${x.node?`, Node \`${x.node}\``:''}${x.scope?` — ${x.scope}`:''}.`).join('\n') : 'No operating system is recorded as release-qualified yet.';
  return `Recorded system checks (not release qualification):\n\n${tested}\n\nRelease-qualified systems for \`${r.version}\`:\n\n${qualified}\n\n${r.systems.note}`;
}
export function releaseSections(r) {
  const availability = r.npm.published
    ? 'This version is published. Check the qualified system and operation before installation.'
    : `**Unavailable until publication.** ${r.npm.availabilityNote}`;
  const status = `**${r.statusLabel}** · \`${r.version}\`\n\n${availability}\n\n${r.capabilities.execution}`;
  const install = `${availability}\n\n${r.npm.ownershipVerified ? 'Package ownership is recorded.' : 'Package ownership is not yet verified.'} Publication approval and system qualification remain separate.\n\n${r.npm.published ? 'Installation command:' : 'Planned command for review only. Do not run it before this exact version is published:'}\n\n\`\`\`sh\n${r.npm.installCommand}\n\`\`\`\n\nRequirements: Node \`${r.requirements.node}\` and \`npm\` ${r.requirements.npm}. ${r.requirements.backend}. Backend setup is separate from installing the CLI.\n\n${r.systems.tested.map(x=>`Recorded checks: ${x.os} ${x.architecture}, Node \`${x.node}\` — ${x.scope}.`).join('\n\n')}\n\n${r.systems.note} ${r.systems.releaseQualified.length ? '' : 'No operating system is recorded as release-qualified yet.'}`;
  const support = `${status}\n\n| Capability | Current boundary |\n| --- | --- |\n${[['Setup',r.capabilities.setup],['Revision',r.capabilities.revision],['Execution',r.capabilities.execution],['Harnesses',r.capabilities.harnesses],['Connections',r.capabilities.connections],['Company access',r.capabilities.company]].map(([k,v])=>`| ${k} | ${v} |`).join('\n')}\n\n${r.capabilities.limits.map(x=>`- ${x}`).join('\n')}\n\n${systemSupport(r)}`;
  return {status,install,support};
}
export function expandRelease(markdown, release) {
  const sections = releaseSections(release);
  const text = markdown.replace(/<!-- release:(status|install|support):start -->[\s\S]*?<!-- release:\1:end -->/g,(_,kind)=>sections[kind]);
  if (/<!--\s*release:/.test(text)) throw new Error('Unknown or unmatched release marker.');
  return text;
}
