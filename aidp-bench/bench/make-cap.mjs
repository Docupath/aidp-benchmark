/**
 * AIDP-CAP, drawn exactly as registered in samples/cap-v1.json before its seed existed.
 *
 *   node bench/make-cap.mjs --round <drand round json> --out <AIDP-CAP folder> [--concurrency 6]
 *
 * --round   the drand round the registration names (https://api.drand.sh/public/<round>), saved as JSON
 * --out     where AIDP-CAP is drawn: its PDFs, answer keys, page texts, maps, customer files and manifest
 *
 * The seed is 'aidp-cap-v1:' followed by the round's randomness. On the mainnet chain the randomness is the SHA-256 of
 * the round's signature, which is checked here; the signature itself is checked against the chain's public key by
 * any drand client. The documents are drawn by corpus-gen/cap/generate.mjs with that seed and nothing else.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const REG = JSON.parse(fs.readFileSync(path.join(HERE, 'samples', 'cap-v1.json'), 'utf8'));
const ROUND = JSON.parse(fs.readFileSync(path.resolve(opt('round')), 'utf8'));
const OUT = path.resolve(opt('out'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

if (ROUND.round !== REG.drand.round) throw new Error(`the registration names round ${REG.drand.round}, got ${ROUND.round}`);
if (sha(Buffer.from(ROUND.signature, 'hex')) !== ROUND.randomness) throw new Error('randomness is not the SHA-256 of the signature');
const SEED = `${REG.seed_prefix}${ROUND.randomness}`;
console.log(`AIDP-CAP seed: ${SEED}`);
const r = spawnSync(process.execPath, [path.join(HERE, '..', 'corpus-gen', 'cap', 'generate.mjs'), '--seed', SEED, '--out', OUT, '--concurrency', opt('concurrency', '6')], { stdio: 'inherit' });
process.exit(r.status ?? 1);
