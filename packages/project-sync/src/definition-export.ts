/**
 * The export bundle of one harness definition (0.8 spec, section 6.7). It holds the definition's files: skills, agents,
 * tool references, and the rest. It holds no secret value, since a definition holds none, and no page content, since a
 * definition holds none either. Of each knowledge source it holds the kind and the name only, never the path:
 * `knowledge.json` stays home. Agents keep their `notes` by name, so an import links or creates a source for each name.
 * Pure: it reads no disk.
 */
import type { Definition, DefinitionFile, KnowledgeKind } from '../../harness-definition/src/index.js';
import { KNOWLEDGE_FILE } from '../../harness-definition/src/index.js';

export const DEFINITION_BUNDLE_FORMAT = 'bowerloom/harness-bundle/v1beta1' as const;

/** A knowledge source as it leaves in a bundle: what it is and what it is called, not where it is. */
export interface BundledSource {
  readonly kind: KnowledgeKind;
  readonly name: string;
}

export interface DefinitionBundle {
  readonly format: typeof DEFINITION_BUNDLE_FORMAT;
  /** The id of the harness. */
  readonly harness: string;
  /** Every file of the definition but `knowledge.json`, in the definition's order, with its bytes and execute bit. */
  readonly files: readonly DefinitionFile[];
  readonly knowledge: readonly BundledSource[];
}

export function exportDefinitionBundle(def: Definition): DefinitionBundle {
  return {
    format: DEFINITION_BUNDLE_FORMAT,
    harness: def.harness.id,
    files: def.files.filter(f => f.path !== KNOWLEDGE_FILE).map(f => ({ path: f.path, bytes: Uint8Array.from(f.bytes), ...(f.executable ? { executable: true } : {}) })),
    knowledge: def.knowledge.map(k => ({ kind: k.kind, name: k.name })),
  };
}
