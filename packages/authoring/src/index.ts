import { resolve } from 'node:path';
import { assertPortablePath, canonicalJson, digest, validateDefinition } from '../../contracts/src/index.js';
import type { CompiledPlan } from '../../contracts/src/index.js';
import { compileCrew } from '../../crew/src/index.js';
import { pinGraph } from '../../graph/src/index.js';
import type { GraphInput } from '../../graph/src/index.js';
import { copyJson } from '../../graph/src/validation.js';
import { validateTestManifestPlan } from '../../controlled-tests/src/index.js';
import { AUTHORING_LIMITS, checked, EVIDENCE, fail, FORMATS, parseJson, parseScenario } from './contracts.js';
import type { AuthoringManifest, RelayMap, RelayRoute, SkillDefinition, VinesMap } from './contracts.js';
import { readSource, sourceLocation } from './source.js';
export * from './contracts.js';

export interface AuthoredCrew {
  format: typeof FORMATS.bundle;
  plan: CompiledPlan;
  assets: Record<string, string>;
  manifestAsset: string;
  scenarioDigest: string;
  authoringRevision: string;
}
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const sorted = <T>(items: T[]): T[] => [...items].sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0);
const exact = (value: unknown, keys: string[]) => value !== null && typeof value === 'object' && !Array.isArray(value) && same(Object.keys(value).sort(), [...keys].sort());
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
function checkBody(body: Omit<AuthoredCrew, 'authoringRevision'>, frozenScenario: string): void {
  if (body.format !== FORMATS.bundle || !exact(body, ['format','plan','assets','manifestAsset','scenarioDigest'])) fail('AUTHORING_BUNDLE');
  const plan = body.plan;
  if (!plan || typeof plan !== 'object') fail('AUTHORING_BUNDLE');
  const definition = plan.definition;
  validateDefinition(definition);
  // Synthetic validation identities are discarded. Actual identities come only from the trusted installation controller.
  pinGraph({ workspaceId: 'authoring-validation', runId: 'authoring-validation', plan, assets: body.assets,
    owners: Object.fromEntries(definition.owners.map(owner => [owner.id, { subject: `authoring:${owner.id}`, epoch: 1 }])) });
  let totalBytes = 0;
  for (const [name, asset] of Object.entries(plan.assets)) {
    const source = body.assets[name]!; totalBytes += Buffer.byteLength(source);
    if (asset.bytes > AUTHORING_LIMITS.assetBytes) fail('AUTHORING_LIMIT');
  }
  if (totalBytes > AUTHORING_LIMITS.sourceBytes) fail('AUTHORING_LIMIT');
  const jsonAsset = <T>(name: string, kind: Parameters<typeof checked>[0]): T => {
    if (!Object.hasOwn(body.assets, name) || plan.assets[name]?.mediaType !== 'application/json') fail('AUTHORING_ASSET');
    return checked<T>(kind, parseJson(body.assets[name]!));
  };
  const manifest = jsonAsset<AuthoringManifest>(body.manifestAsset, 'authoring');
  assertPortablePath(manifest.crew);
  if (manifest.id !== definition.id) fail('AUTHORING_CREW_BINDING');
  const contractAssets = [body.manifestAsset, manifest.brief, ...manifest.skills, manifest.relay, manifest.vines, manifest.scenario];
  if (new Set(contractAssets).size !== contractAssets.length) fail('AUTHORING_ASSET_ALIAS');
  if (!plan.assets[manifest.brief]?.mediaType.startsWith('text/')) fail('AUTHORING_BRIEF');
  const scenario = parseScenario(frozenScenario);
  if (body.scenarioDigest !== digest(frozenScenario) || body.assets[manifest.scenario] !== frozenScenario) fail('AUTHORING_SCENARIO_BINDING');
  jsonAsset(manifest.scenario, 'scenario');
  if (manifest.brief !== scenario.brief.asset || definition.tasks.length !== scenario.taskCount) fail('AUTHORING_SCENARIO_BINDING');
  const pins = [scenario.brief, ...scenario.inputs];
  if (new Set(pins.map(pin => pin.asset)).size !== pins.length) fail('AUTHORING_SCENARIO_BINDING');
  for (const pin of pins) {
    const asset = plan.assets[pin.asset];
    if (!asset || pin.digest !== asset.digest || pin.bytes !== asset.bytes) fail('AUTHORING_SCENARIO_INPUT');
  }
  const manifestBytes = body.assets['test-manifest'];
  if (!manifestBytes) fail('TEST_MANIFEST_REQUIRED');
  validateTestManifestPlan(plan, manifestBytes);
  const ordered = plan.taskOrder.map(id => definition.tasks.find(task => task.id === id)!);
  const [first, second] = ordered;
  if (!first || !second || first.dependsOn.length || !same(second.dependsOn, [first.id])
    || !Object.values(second.inputs).some(input => 'task' in input.source && input.source.task === first.id
      && input.type.kind === 'artifact' && input.type.mediaType === 'text/html')) fail('AUTHORING_SCENARIO_SHAPE');
  const paths = new Set<string>();
  for (const [index, task] of ordered.entries()) {
    if (task.effects.filter(effect => effect.operation === 'command.test' && effect.command === scenario.testId).length !== 1) fail('AUTHORING_TEST_REQUIRED');
    const write = task.effects.find(effect => effect.operation === 'workspace.write')!;
    if (!write || !('path' in write) || write.path !== scenario.writePaths[index] || paths.has(write.path) || write.path === manifest.crew
      || Object.values(plan.assets).some(asset => asset.path === write.path)) fail('AUTHORING_WRITE_TARGET');
    paths.add(write.path);
    for (const pin of pins) if (!Object.values(task.inputs).some(input => 'asset' in input.source && input.source.asset === pin.asset)) fail('AUTHORING_SCENARIO_INPUT');
  }
  const skillIds = new Set<string>(), instructionAssets = new Set<string>();
  for (const assetId of manifest.skills) {
    const skill = jsonAsset<SkillDefinition>(assetId, 'skill');
    if (skillIds.has(skill.id) || instructionAssets.has(skill.instructions) || contractAssets.includes(skill.instructions)) fail('AUTHORING_SKILL_BINDING');
    skillIds.add(skill.id); instructionAssets.add(skill.instructions);
    if (!plan.assets[skill.instructions]?.mediaType.startsWith('text/')) fail('AUTHORING_SKILL_BINDING');
    const owners = definition.owners.filter(owner => owner.skills.includes(skill.instructions));
    if (!same(owners.map(owner => owner.id).sort(), [...skill.owners].sort())) fail('AUTHORING_SKILL_OWNERS');
    for (const capability of skill.requiredCapabilities) {
      if (!definition.requiredCapabilities.includes(capability)
        || definition.tasks.filter(task => skill.owners.includes(task.owner)).some(task => !task.requires.includes(capability))) fail('AUTHORING_SKILL_CAPABILITY');
    }
  }
  for (const owner of definition.owners) {
    if (!owner.skills.length || owner.skills.some(asset => !instructionAssets.has(asset))
      || !definition.tasks.some(task => task.owner === owner.id)) fail('AUTHORING_SKILL_BINDING');
  }
  const relay = jsonAsset<RelayMap>(manifest.relay, 'relay');
  if (!same([...relay.participants].sort(), definition.owners.map(owner => owner.id).sort())) fail('AUTHORING_RELAY_PARTICIPANTS');
  const routes: RelayRoute[] = [];
  for (const task of definition.tasks) for (const dependency of task.dependsOn) {
    const from = definition.tasks.find(value => value.id === dependency)!;
    const bindings = Object.entries(task.inputs).flatMap(([input, port]) => 'task' in port.source && port.source.task === dependency
      ? [{ output: port.source.output, input }] : []);
    routes.push({ fromOwner: from.owner, fromTask: dependency, toOwner: task.owner, toTask: task.id, delivery: 'accepted-output', bindings });
  }
  const normalized = (values: RelayRoute[]) => sorted(values.map(route => ({ ...route, bindings: sorted(route.bindings) })));
  if (!same(normalized(relay.routes), normalized(routes))) fail('AUTHORING_RELAY_ROUTE');
  const vines = jsonAsset<VinesMap>(manifest.vines, 'vines');
  const entries = definition.tasks.map(task => ({ task: task.id, owner: task.owner, evidence: [...EVIDENCE].sort(), sink: 'local-session' }));
  if (!same(sorted(vines.entries.map(entry => ({ ...entry, evidence: [...entry.evidence].sort() }))), sorted(entries))) fail('AUTHORING_VINES_ROUTE');
}
/** Reverify every byte and derived binding after transport. The scenario comes from the trusted Workbench selection, not the bundle. */
export function validateAuthoredCrew(value: unknown, frozenScenario: string): AuthoredCrew {
  const copy = copyJson(value, AUTHORING_LIMITS.bundleBytes) as AuthoredCrew;
  if (!copy || !exact(copy, ['format','plan','assets','manifestAsset','scenarioDigest','authoringRevision'])) fail('AUTHORING_BUNDLE');
  const { authoringRevision, ...body } = copy;
  if (authoringRevision !== digest(canonicalJson(body))) fail('AUTHORING_REVISION');
  checkBody(body, frozenScenario);
  return freeze(copy);
}
/** Offline compilation: reads only explicitly declared bounded files, and writes nothing. */
export async function compileAuthoring(file: string, options: { scenarioFile: string; root?: string }): Promise<AuthoredCrew> {
  const location = await sourceLocation(file, options.root);
  const manifestBytes = await readSource(location.root, location.path, AUTHORING_LIMITS.jsonBytes);
  const manifest = checked<AuthoringManifest>('authoring', parseJson(manifestBytes));
  assertPortablePath(manifest.crew);
  const plan = await compileCrew(resolve(location.root, manifest.crew), { root: location.root });
  const matches = Object.entries(plan.assets).filter(([, asset]) => asset.path === location.path);
  if (matches.length !== 1) fail('AUTHORING_MANIFEST_UNPINNED');
  const assets: Record<string, string> = {}; let remaining = AUTHORING_LIMITS.sourceBytes;
  for (const [name, asset] of Object.entries(plan.assets)) {
    assets[name] = await readSource(location.root, asset.path, Math.min(AUTHORING_LIMITS.assetBytes, remaining));
    remaining -= Buffer.byteLength(assets[name]!);
    if (digest(assets[name]!) !== asset.digest || Buffer.byteLength(assets[name]!) !== asset.bytes) fail('AUTHORING_SOURCE_CHANGED');
  }
  if (assets[matches[0]![0]] !== manifestBytes) fail('AUTHORING_SOURCE_CHANGED');
  const scenarioLocation = await sourceLocation(options.scenarioFile);
  const scenario = await readSource(scenarioLocation.root, scenarioLocation.path, AUTHORING_LIMITS.jsonBytes);
  const body = { format: FORMATS.bundle, plan, assets, manifestAsset: matches[0]![0], scenarioDigest: digest(scenario) };
  return validateAuthoredCrew({ ...body, authoringRevision: digest(canonicalJson(body)) }, scenario);
}
/** No launch or approval authority. The trusted controller separately supplies runtime identities and installation policy. */
export function authoredGraph(value: unknown, frozenScenario: string, bindings: Pick<GraphInput, 'workspaceId' | 'runId' | 'owners'>): GraphInput {
  const bundle = validateAuthoredCrew(value, frozenScenario);
  const runtime = copyJson(bindings, AUTHORING_LIMITS.jsonBytes);
  if (!exact(runtime, ['workspaceId','runId','owners'])) fail('AUTHORING_RUNTIME_BINDING');
  return pinGraph({ ...runtime, plan: bundle.plan, assets: bundle.assets });
}
