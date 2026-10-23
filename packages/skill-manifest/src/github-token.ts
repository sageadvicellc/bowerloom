/**
 * The GitHub token of a private store remote (spec 07, owner decision 21 on sageadvicellc/bowerloom#80). It comes from
 * one environment variable, BOWERLOOM_GITHUB_TOKEN, read from the `env` object a CLI command passes in. Nothing here
 * reads process.env.
 *
 * The value lives in a private field. Only authorization() reads it, and only the public transport calls that, to set
 * the Authorization header of an approved api.github.com request. Every other way to turn the object into text gives
 * `[redacted]`: toString, toJSON, util.inspect, and a template. The object has no own property and is frozen. A wrong
 * value refuses GITHUB_TOKEN_INVALID, whose message is fixed and never holds any part of the value.
 */
import { manifestRefusal } from './refusal.js';

export const GITHUB_TOKEN_VARIABLE = 'BOWERLOOM_GITHUB_TOKEN' as const;
/** A classic token (ghp_...), a fine-grained token (github_pat_...), and the other GitHub token forms. Not trimmed. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,255}$/;
const REDACTED = '[redacted]';
// Only fromEnv makes a token: the constructor refuses unless this is set, for the one synchronous call that sets it.
let minting = false;

type Env = NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>;
/** The raw value of the variable: undefined when unset or empty, null when it is not a string or the env is not an object. */
function rawOf(env: unknown): string | undefined | null {
  if (env === null || typeof env !== 'object') return null;
  if (!Object.hasOwn(env, GITHUB_TOKEN_VARIABLE)) return undefined;
  const value = (env as Record<string, unknown>)[GITHUB_TOKEN_VARIABLE];
  if (value === undefined || value === '') return undefined;
  return typeof value === 'string' ? value : null;
}

export class GithubToken {
  readonly #value: string;
  private constructor(value: string) {
    if (!minting) throw new TypeError('A GithubToken is made by GithubToken.fromEnv only.');
    this.#value = value;
    Object.freeze(this);
  }
  /** Null when the variable is unset or empty. Throws GITHUB_TOKEN_INVALID when it is set to a value outside the shape. */
  static fromEnv(env: Env): GithubToken | null {
    const raw = rawOf(env);
    if (raw === undefined) return null;
    if (raw === null || !TOKEN_SHAPE.test(raw)) throw manifestRefusal('GITHUB_TOKEN_INVALID');
    minting = true;
    try { return new GithubToken(raw); } finally { minting = false; }
  }
  /** What `store status` reports. Never throws and never returns any part of the value. */
  static status(env: Env): 'set' | 'not-set' | 'invalid' {
    const raw = rawOf(env);
    if (raw === undefined) return 'not-set';
    return raw !== null && TOKEN_SHAPE.test(raw) ? 'set' : 'invalid';
  }
  /** True only for an object fromEnv made: a brand check on the private field, which instanceof alone is not. */
  static isToken(value: unknown): value is GithubToken { return typeof value === 'object' && value !== null && #value in value; }
  /** The Authorization header value. The public transport is its only caller. */
  authorization(): string { return `Bearer ${this.#value}`; }
  toString(): string { return REDACTED; }
  toJSON(): string { return REDACTED; }
  [Symbol.for('nodejs.util.inspect.custom')](): string { return REDACTED; }
}
Object.freeze(GithubToken.prototype);
Object.freeze(GithubToken);
