/** Synthetic content claims only. No acquisition or publisher authentication. */
export type SkillLicense = 'MIT' | 'Apache-2.0';
export interface NpmSkillSource {
  kind: 'npm'; registry: 'https://registry.npmjs.org'; package: string; version: string;
  integrity: string; archiveSha256: string; metadataSha256: string; publisher: string; declaredLicense: SkillLicense;
}
export interface GitSkillSource {
  kind: 'git'; host: 'github.com'; repository: string; commit: string; tree: string;
  metadataSha256: string; declaredLicense: SkillLicense;
}
export interface SkillTextFile { path: string; sourcePath: string; text: string; sha256: string; mode: 420 }
export interface SkillSourceInput {
  format: 'bowerloom/synthetic-skill-source/v1beta1'; synthetic: true;
  source: NpmSkillSource | GitSkillSource;
  skill: { id: string; name: string; sourceRoot: string };
  files: SkillTextFile[]; references: { from: string; to: string }[];
  license: { spdx: SkillLicense; origin: 'included'; files: string[] };
}
export interface SkillSourceValidation {
  format: 'bowerloom/skill-source-validation/v1beta1'; input: SkillSourceInput; revision: string;
  evidence: 'synthetic-caller-supplied'; acquisitionVerified: false; publisherAuthenticated: false;
  referenceScope: 'declared-and-recognized-static-local-references';
  executionAuthorized: false; writesAuthorized: false; grantsAuthority: false;
}
