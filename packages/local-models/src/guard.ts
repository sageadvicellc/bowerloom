/**
 * The loopback guard. A local model server is reached on the address 127.0.0.1 and a port, and on nothing else. No host name, no IPv6 address, no private range and no
 * URL is ever accepted: the host is a fixed word, so a setting cannot point a probe at another machine. The check runs at parse time, before any connection is made.
 */
import { PROVIDER_IDS } from './types.js';
import type { ProviderId } from './types.js';

/** The only host the package connects to. */
export const LOOPBACK_HOST = '127.0.0.1';

/** True only for the exact text 127.0.0.1. Not `localhost`, not `127.1`, not an address with a space, not a non-string. */
export function isLoopbackHost(host: unknown): host is typeof LOOPBACK_HOST {
  return host === LOOPBACK_HOST;
}

/** A port is a whole number from 1 to 65535, given as a number. A string, a fraction, zero and anything above 65535 give null. */
export function parsePort(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535 ? value : null;
}

/** Why an endpoint was refused. NOT_LOOPBACK: a host or an address other than 127.0.0.1. BAD_PORT: not a port. UNKNOWN_PROVIDER: not a provider id. BAD_ENDPOINT: not an endpoint at all. */
export type EndpointRefusal = 'NOT_LOOPBACK' | 'BAD_PORT' | 'UNKNOWN_PROVIDER' | 'BAD_ENDPOINT';

export type EndpointCheck =
  | { readonly ok: true; readonly provider: ProviderId; readonly port: number }
  | { readonly ok: false; readonly code: EndpointRefusal };

/** The keys that carry a place to connect to. Any of them, written with anything but a plain 127.0.0.1 `host`, makes the endpoint NOT_LOOPBACK. */
const ADDRESS_KEYS: ReadonlySet<string> = new Set(['url', 'baseUrl', 'hostname', 'address', 'origin']);
const ENDPOINT_KEYS: ReadonlySet<string> = new Set(['provider', 'port', 'host']);

const isProviderId = (value: unknown): value is ProviderId => typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);

/**
 * Checks one endpoint as it was written in the local models file. An endpoint is `{ provider, port }`, and may name `host` only when it is exactly 127.0.0.1. The order of
 * the checks is fixed: the shape, then any address, then the provider, then the port. It never throws.
 */
export function checkEndpoint(raw: unknown): EndpointCheck {
  try {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, code: 'BAD_ENDPOINT' };
    const keys = Object.keys(raw);
    for (const key of keys) {
      if (!ENDPOINT_KEYS.has(key) && !ADDRESS_KEYS.has(key)) return { ok: false, code: 'BAD_ENDPOINT' };
    }
    const entry = raw as Readonly<Record<string, unknown>>;
    if (keys.some(key => ADDRESS_KEYS.has(key))) return { ok: false, code: 'NOT_LOOPBACK' };
    if (keys.includes('host') && !isLoopbackHost(entry['host'])) return { ok: false, code: 'NOT_LOOPBACK' };
    const provider = entry['provider'];
    if (!isProviderId(provider)) return { ok: false, code: 'UNKNOWN_PROVIDER' };
    const port = parsePort(entry['port']);
    if (port === null) return { ok: false, code: 'BAD_PORT' };
    return { ok: true, provider, port };
  } catch {
    return { ok: false, code: 'BAD_ENDPOINT' };
  }
}
