import { randomUUID, createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { RuntimeError, identifier } from './types.js';
export class Coordinator {
  readonly launcherId = `launcher-${randomUUID()}`;
  readonly #abort = new AbortController();
  readonly #client: PoolClient;
  readonly #keys: [number, number];
  #timer: ReturnType<typeof setInterval> | undefined;
  #closed = false;
  get signal(): AbortSignal { return this.#abort.signal; }
  private constructor(client: PoolClient, keys: [number, number]) {
    this.#client = client; this.#keys = keys;
    client.on('error', this.#lose); client.on('end', this.#lose);
  }
  #lose = (): void => { this.#abort.abort(); };
  static async acquire(pool: Pick<Pool, 'connect'>, installationId: string, database: string): Promise<Coordinator> {
    identifier(installationId);
    const hash = createHash('sha256').update(`trellis-runtime:${installationId}`).digest();
    const keys: [number, number] = [hash.readInt32BE(0), hash.readInt32BE(4)];
    const client = await pool.connect(); const coordinator = new Coordinator(client, keys);
    try {
      await client.query("SET statement_timeout='3s'");
      if ((await client.query('SELECT current_database() AS name')).rows[0].name !== database) throw new RuntimeError('DATABASE_BINDING');
      const result = await client.query('SELECT pg_try_advisory_lock($1,$2) AS admitted', keys);
      if (result.rows[0].admitted !== true) throw new RuntimeError('COORDINATOR_EXISTS');
      coordinator.#timer = setInterval(() => { void coordinator.guard().catch(() => {}); }, 500);
      coordinator.#timer.unref(); return coordinator;
    } catch (error) { await coordinator.close(); throw error instanceof RuntimeError ? error : new RuntimeError('LOCK_UNAVAILABLE'); }
  }
  assert(): void { if (this.#closed || this.signal.aborted) throw new RuntimeError('COORDINATOR_FENCED'); }
  async guard(): Promise<void> {
    this.assert();
    try {
      const result = await this.#client.query(`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid()
        AND locktype='advisory' AND classid=$1::oid AND objid=$2::oid AND objsubid=2 AND granted) AS held`,
      this.#keys.map(value => value >>> 0));
      if (result.rows[0].held !== true) throw new RuntimeError('LOCK_LOST');
      this.assert();
    } catch { this.#lose(); throw new RuntimeError('COORDINATOR_FENCED'); }
  }
  async close(): Promise<void> {
    if (this.#closed) return; this.#closed = true; this.#lose(); clearInterval(this.#timer);
    this.#client.removeListener('error', this.#lose); this.#client.removeListener('end', this.#lose);
    // Destroying this dedicated session releases its lock. Never return a lock-bearing session to the pool.
    this.#client.release(true);
  }
}
