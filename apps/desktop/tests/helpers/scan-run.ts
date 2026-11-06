// Run by tests/no-network.test.ts in a child process that has tests/helpers/deny.mjs loaded: it does what main does for a read of the person's setup (find the places, add a folder,
// read what was ticked, build the result), on the made-up home folder given as the first argument and the project folder given as the second. It prints the counts as JSON.
// If the reader started a process or touched the network, the denial would have thrown and written a line to DENY_LOG.
import { createScanner } from '../../main/real-scan.js';
import { buildRealResult } from '../../shared/real/map-world.js';

const [home, folder] = process.argv.slice(2);
if (home === undefined || folder === undefined) throw new Error('Usage: scan-run <home> <folder>');
const scanner = createScanner({ home });
const found = await scanner.discover();
const places = [...found.places, ...(await scanner.addFolder(folder)).places];
const batch = await scanner.read(places.map(place => place.id));
const result = buildRealResult(batch.reads, batch.tally, { nowMs: Date.UTC(2026, 9, 26), foldExtraApps: true });
process.stdout.write(JSON.stringify({ places: places.length, counts: result.counts }));
