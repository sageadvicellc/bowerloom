/**
 * Claude Code permission rules (`Tool(specifier)`) read back as neutral guardrail rules. Locked-in parts spec, sections
 * 8.2 and 8.4. A rule the neutral language cannot carry is given back with the reason, never guessed.
 *
 * - `Bash(x)` is a shell rule with the pattern `x`; a bare `Bash` is `*`.
 * - `Read(x)`, `Edit(x)`, `Write(x)` are path rules. Claude Code's `/x` is relative to the project, so it becomes `./x`.
 *   `//x` (absolute) and `~/x` (home) are outside the neutral path language. A bare tool is `**`.
 * - `WebFetch(domain:x)` is a web rule for the host `x`. A bare `WebFetch` deny or ask becomes the web pattern `*`, which
 *   also covers web search, so it blocks more; a bare `WebFetch` allow would widen, so it is not mapped. `WebSearch` has
 *   no search-only neutral form.
 * - `mcp__server`, `mcp__server__tool` are MCP rules `server` and `server/tool`.
 * - `Agent(x)` and `Task(x)` are subagent rules, `Skill(x)` a skill rule.
 * Deny and ask are `enforced`; allow is `advisory`.
 */
import { patternProblem } from '../../fidelity/src/index.js';
import type { GuardrailEffect } from '../../harness-definition/src/index.js';
import type { RuleShape } from './model.js';

export type RuleRead = { readonly rule: RuleShape; readonly note?: string } | { readonly reason: string };

const strengthOf = (effect: GuardrailEffect) => effect === 'allow' ? 'advisory' as const : 'enforced' as const;

function pathPattern(spec: string | undefined): string | { reason: string } {
  if (spec === undefined || spec === '' || spec === '**') return '**';
  if (spec.startsWith('//')) return { reason: 'An absolute path rule is outside the neutral path language: patterns are relative to the project.' };
  if (spec.startsWith('~')) return { reason: 'A home path rule is outside the neutral path language: patterns are relative to the project.' };
  if (spec.startsWith('/')) return `./${spec.slice(1)}`;
  return spec;
}

/** One Claude Code rule with its effect, as a neutral rule, or the reason it cannot be one. */
export function claudeRule(text: string, effect: GuardrailEffect): RuleRead {
  const strength = strengthOf(effect);
  const done = (rule: RuleShape, note?: string): RuleRead => {
    const problem = patternProblem(rule);
    return problem ? { reason: problem } : note === undefined ? { rule } : { rule, note };
  };
  const mcp = /^mcp__([A-Za-z0-9_-]+?)(?:__(.+))?$/.exec(text);
  if (mcp) {
    const tool = mcp[2] === '*' || mcp[2] === undefined ? undefined : mcp[2];
    return done({ action: 'mcp', pattern: tool === undefined ? mcp[1]! : `${mcp[1]}/${tool}`, effect, strength });
  }
  const m = /^([A-Za-z]+)(?:\((.*)\))?$/s.exec(text);
  if (!m) return { reason: 'This is not a Claude Code rule of the form Tool or Tool(specifier).' };
  const tool = m[1]!, spec = m[2];
  switch (tool) {
    case 'Bash':
      return spec === '' ? { reason: 'An empty Bash specifier has no neutral form.' } : done({ action: 'shell', pattern: spec ?? '*', effect, strength });
    case 'Read': case 'Edit': case 'Write': {
      const p = pathPattern(spec);
      if (typeof p !== 'string') return p;
      return done({ action: tool === 'Read' ? 'read' : tool === 'Edit' ? 'edit' : 'write', pattern: p, effect, strength });
    }
    case 'WebFetch': {
      if (spec === undefined) {
        if (effect === 'allow') return { reason: 'A bare WebFetch allow would become the web pattern *, which also allows web search: that is wider than the source.' };
        return done({ action: 'web', pattern: '*', effect, strength }, 'The web pattern * also covers web search, so this blocks more than the source.');
      }
      const host = /^domain:(.+)$/.exec(spec);
      return host ? done({ action: 'web', pattern: host[1]!, effect, strength }) : { reason: 'A WebFetch specifier other than domain:<host> has no neutral form.' };
    }
    case 'WebSearch':
      return { reason: 'The neutral web rule has no form for web search alone.' };
    case 'Agent': case 'Task':
      return spec === '' ? { reason: 'An empty subagent specifier has no neutral form.' } : done({ action: 'subagent', pattern: spec ?? '*', effect, strength });
    case 'Skill':
      return spec === '' ? { reason: 'An empty skill specifier has no neutral form.' } : done({ action: 'skill', pattern: spec ?? '*', effect, strength });
    default:
      return { reason: 'The neutral guardrail actions have no form for this tool.' };
  }
}

/**
 * The tool list of a skill's `allowed-tools` or `disallowed-tools`: a YAML list, or a string split on commas and
 * spaces outside parentheses. Null when the value is neither.
 */
export function toolList(value: unknown): string[] | null {
  if (Array.isArray(value)) return value.every(v => typeof v === 'string' && v.trim() !== '') ? value.map(v => (v as string).trim()) : null;
  if (typeof value !== 'string') return null;
  const out: string[] = [];
  let depth = 0, current = '';
  for (const c of value) {
    if (c === '(') depth++;
    if (c === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (c === ',' || /\s/.test(c))) { if (current) out.push(current); current = ''; continue; }
    current += c;
  }
  if (current) out.push(current);
  return depth === 0 && out.length ? out : null;
}
