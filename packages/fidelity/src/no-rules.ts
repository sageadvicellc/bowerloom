/**
 * Pi and DeepSeek Harness have no permission rule list (locked-in parts spec, section 10; definition spec, section
 * 13.1). Every guardrail rule is `absent`, so an enforced one is refused unless a recorded approval exists (check 12).
 *
 * - Pi 1.4.0 has no sandbox either, so a sandbox requirement is `absent`.
 * - DeepSeek Harness 0.2.2-alpha.2 has sandbox modes, but at the pinned tag a mode covers file effects only, a session
 *   can switch it, and no patch row that sets it is confirmed. A sandbox requirement is `absent` (ruling B13).
 */
import type { GuardrailRule, SandboxRequirement } from '../../harness-definition/src/index.js';
import { escapeSentence } from './escapes.js';
import { Collector, type EngineDefault, type SandboxForm, type Translation } from './translation.js';

export interface NoRulesForm {
  readonly engine: 'pi' | 'deepseek-harness';
  readonly sandbox?: SandboxForm;
  readonly defaults: EngineDefault;
}

/** The default of each engine with no rule list (ruling R8). Neither engine has a place to write one. */
export const NO_RULES_DEFAULTS: Readonly<Record<NoRulesForm['engine'], EngineDefault>> = Object.freeze({
  pi: { decision: 'allow', written: false, reason: 'Pi has no permission rules, so every action runs without asking. Pi has no place to write a default.' },
  'deepseek-harness': { decision: 'default', written: false, reason: 'DeepSeek Harness applies its approval mode. Bowerloom writes no mode, and the research notes do not record what the default mode decides; the live check of step 5 records it.' },
});

const WHY: Readonly<Record<NoRulesForm['engine'], string>> = {
  pi: 'Pi has no permission rules, so the engine does not enforce this rule.',
  'deepseek-harness': 'DeepSeek Harness has sandbox and approval modes and no allow or deny rule list, so the engine does not enforce this rule.',
};

/** Why a DeepSeek Harness sandbox requirement is absent. Read from the pinned tag on 2026-10-28. */
export const DSH_SANDBOX_REASON = 'DeepSeek Harness has sandbox modes, but at the pinned tag a mode governs file effects only: network is outside its vocabulary. '
  + 'A mode is a session default that a person can switch with /permission, and an approved retry can run outside it. '
  + 'Bowerloom has no confirmed patch row that sets the mode at that tag, so it writes nothing, and the requirement is absent.';

export function translateNoRules(engine: NoRulesForm['engine'], rules: readonly GuardrailRule[], sandbox: readonly SandboxRequirement[], out: Collector): Translation<NoRulesForm> {
  for (const rule of rules) out.line(rule, 'absent', `${WHY[engine]}${rule.action === 'shell' ? ` ${escapeSentence(engine)}` : ''}`);
  for (const s of sandbox) out.line(s, 'absent', engine === 'pi' ? 'Pi has no sandbox.' : DSH_SANDBOX_REASON);
  return out.done<NoRulesForm>({ engine, defaults: NO_RULES_DEFAULTS[engine] });
}
