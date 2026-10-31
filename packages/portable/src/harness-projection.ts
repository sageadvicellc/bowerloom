/**
 * Local file layouts only. No native discovery, execution or model binding.
 *
 * The plan and the receipt of an installation are hashed and kept, so they store the engine as they always did: `harness`,
 * with `claude` for Claude Code. `projectionFor` takes that id and the current one, `claude-code`.
 */
import { engineFromOldId, isEngine } from '../../skill-manifest/src/engine.js';
import type { OldEngineId } from '../../skill-manifest/src/engine.js';
export type AdapterVersion = 'codex/local-skills/v1alpha1' | 'claude/project-skills/v1alpha1';
interface GuidancePlan {
  revision: string; bundleRevision: string; schemaVersion: string; adapterVersion: AdapterVersion;
  selected: string[]; dependencies: string[];
}
interface HarnessProjection {
  readonly harness: OldEngineId; readonly version: AdapterVersion; readonly skillRoot: string;
  guidance(plan: GuidancePlan): string;
}
const codex: HarnessProjection = Object.freeze({
  harness: 'codex', version: 'codex/local-skills/v1alpha1', skillRoot: '.agents/skills',
  // Legacy guidance stays byte-for-byte in the installer.
  guidance: () => { throw new Error('LEGACY_GUIDANCE_REQUIRED'); },
});
const claude: HarnessProjection = Object.freeze({
  harness: 'claude', version: 'claude/project-skills/v1alpha1', skillRoot: '.claude/skills',
  guidance: (plan: GuidancePlan) => `# Bowerloom local installation

This workspace contains selected portable parts prepared for Claude Code.

Plan revision: ${plan.revision}
Bundle revision: ${plan.bundleRevision}
Schema: ${plan.schemaVersion}
Adapter: ${plan.adapterVersion}

Selected: ${plan.selected.join(', ')}
Dependencies: ${plan.dependencies.join(', ') || 'none'}

Skill projections are under .claude/skills/bowerloom-<part-id>/SKILL.md. This project layout follows the documented Claude Code skill format, reviewed against retained version 2.1.288 evidence. Actual native discovery has not been observed. Review SKILL.md before opening or invoking a skill; this installer does not validate arbitrary native frontmatter or make its instructions safe.

Team definitions under .bowerloom/teams/ are data. This installer does not execute teams, start workers, grant permissions, or approve actions. Installation approval authorizes only these new files. No native roles or model routes are registered. Declared installer controls do not enforce future skill behavior. Retain the personal agent permission controls.

Origin hashes and projections are in .bowerloom/installation-receipt.json. No global or home configuration changed.
`,
});
export function projectionFor(harness: string): HarnessProjection | undefined {
  // `claude-code` is the current id of Claude Code and `claude` the old one; both name the same projection.
  const engine = isEngine(harness) ? harness : engineFromOldId(harness);
  if (engine === 'codex') return codex;
  if (engine === 'claude-code') return claude;
  return undefined;
}
