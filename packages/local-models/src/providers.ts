/** The providers the engine knows, as a plain list. There is no plugin system: a new provider is a file and a line here. */
import { llamaServer } from './providers/llama-server.js';
import type { LocalModelProvider } from './provider.js';
import type { ProviderId } from './types.js';

export const PROVIDERS: readonly LocalModelProvider[] = Object.freeze([llamaServer]);

/** The provider with this id, or undefined when the package has none for it yet (ollama and lm-studio in this version). */
export function providerFor(id: ProviderId, providers: readonly LocalModelProvider[] = PROVIDERS): LocalModelProvider | undefined {
  return providers.find(p => p.id === id);
}
