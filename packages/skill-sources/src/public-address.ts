/**
 * The public IPv4 test of every Bowerloom network read: skill-sources npm.ts and git.ts, and skill-manifest
 * public-get.ts (review M3 4). One copy, so the three cannot drift apart.
 */
import { isIP } from 'node:net';

/** True only for an IPv4 address outside the private, loopback, link-local, shared, reserved and documentation ranges. */
export function publicIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number) as [number, number, number];
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 100 && b >= 64 && b <= 127 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 88 && c === 99) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
}
