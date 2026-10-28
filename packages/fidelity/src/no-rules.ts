/**
 * Pi and DeepSeek Harness have no permission rule list (locked-in parts spec, section 10; definition spec, section
 * 13.1). Every guardrail rule is `absent`, so an enforced one is refused unless a recorded approval exists (check 12).
 *
 * - Pi 1.4.0 has no sandbox either, so a sandbox requirement is `absent`.
 * - DeepSeek Harness 0.2.2-alpha.2 has sandbox modes, so the capability matrix gives a sandbox requirement as
 *   `translated`, modes only. The form records what the requirement asks for; the mode it maps to is the writer's,
 *   for the pinned tag.
 */
import type { GuardrailRule, SandboxRequirement } from '../../harness-definition/src/index.js';
import { escapeSentence } from './escapes.js';
import { Collector, type SandboxForm, type Translation } from './translation.js';

export interface NoRulesForm {
  readonly engine: 'pi' | 'deepseek-harness';
  readonly sandbox?: SandboxForm;
}

const WHY: Readonly<Record<NoRulesForm['engine'], string>> = {
  pi: 'Pi has no permission rules, so the engine does not enforce this rule.',
  'deepseek-harness': 'DeepSeek Harness has sandbox and approval modes and no allow or deny rule list, so the engine does not enforce this rule.',
};

export function translateNoRules(engine: NoRulesForm['engine'], rules: readonly GuardrailRule[], sandbox: readonly SandboxRequirement[], out: Collector): Translation<NoRulesForm> {
  for (const rule of rules) out.line(rule, 'absent', `${WHY[engine]}${rule.action === 'shell' ? ` ${escapeSentence(engine)}` : ''}`);
  let box: SandboxForm | undefined;
  for (const s of sandbox) {
    if (engine === 'pi') { out.line(s, 'absent', 'Pi has no sandbox.'); continue; }
    box = { files: s.files || (box?.files ?? false), network: s.network || (box?.network ?? false) };
    out.wrote(s.id, 'sandbox');
    out.line(s, 'translated', 'DeepSeek Harness carries the requirement as one of its sandbox modes, which is a mode and not a rule list. Every release is a prerelease, so the writer checks the mode against the pinned tag.');
  }
  return out.done<NoRulesForm>({ engine, ...(box ? { sandbox: box } : {}) });
}
