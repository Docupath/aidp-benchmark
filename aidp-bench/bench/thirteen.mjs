/**
 * The thirteen AIDP-2K measures the AIDP Score keeps, on the reference run's board and on the held-out check's: their
 * equal-weight geometric mean with its 95% range, and its layers, as the paper and the READMEs report them. The
 * held-out check ran on AIDP-2K's documents only, so it is reported on these thirteen measures.
 *
 *   node bench/thirteen.mjs [--board <reference scoreboard.json>] [--heldout <held-out scoreboard.json>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { thirteen } from './score-cap.mjs';

const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const boards = [
  ['the reference run', opt('board', path.join(BENCH, 'results/aidp-v1-main/scoreboard.json'))],
  ['the held-out check', opt('heldout', path.join(BENCH, 'results/aidp-v1-heldout-main/scoreboard.json'))],
];
for (const [name, file] of boards) {
  const t = thirteen(JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')));
  const layers = Object.entries(t.layers).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ');
  console.log(`${name}: ${t.score.toFixed(2)} (95% range ${t.low.toFixed(2)} to ${t.high.toFixed(2)}) on the thirteen AIDP-2K measures; layers ${layers}`);
}
