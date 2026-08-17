#!/bin/bash
# A CODE task big enough to cross a compaction boundary.
#
# Why this exists: every other code task in the suite peaks at 22-28k context
# against ~20k irreducible (system prompt + tools), so no compaction trigger
# both fires and leaves working room. None of them can answer "what does an
# agent re-acquire after a boundary on a CODE workload?". The only fixture that
# ever reached a trigger (long-context, peak ~61k) is data analysis, and its
# post-boundary behaviour was re-derivation via Bash — 0 Grep, 0 Glob, 0
# re-read files. That cannot be generalised to editing code.
#
# THREE ATTACKS HAVE ALREADY DEFEATED DRAFTS OF THIS FIXTURE. Each one solved
# the task without reading, which puts peak_ctx back at ~25k and voids the run:
#
#   1. Plaintext answer key in test.mjs -> one sed. Fixed by hashing.
#   2. Per-module digest in test.mjs -> invertible against the handful of
#      candidates per file in milliseconds. Fixed by ONE aggregate digest over
#      all modules; the same attack now costs 8^51 combinations.
#   3. Structural tell in the code: the real constant was passed to
#      `evictExpired(...)` at a fixed position, so `/evictExpired\((\w+)\)/`
#      named the answer in every file. A measured pilot solved all 51 modules
#      in 7 Bash calls, $0.57, peak_ctx 47,890, boundaries 0 — void.
#      Fixed by referencing every timestamp uniformly (see CLOCKS below) so
#      usage carries no signal at all.
#
# That pilot also exposed the deeper error: the bytes were in function bodies
# that the task never required anyone to read, so the agent dumped only the
# comment regions and the volume never entered context. Volume only creates
# context pressure where reading is FORCED. So the mass of each module is now
# the constant documentation itself — eight to ten timestamps per module, each
# with its own paragraph, exactly one of which is this cycle's emission stamp.
#
# The decoys are deliberately NEAR MISSES: the previous cycle's stamp, the
# upstream batch's stamp, the sink's acknowledgement, the scheduled time, the
# stamp on a report that failed to publish. Every one is "a timestamp about
# reporting", so keyword matching on emit/publish/report cannot separate them
# and the choice requires actually understanding the sentence. This is the same
# construction that made long-context resistant: decoys of the same TYPE as the
# answer, not obviously-different filler.
set -euo pipefail
d=$1
mkdir -p "$d/src/modules"

cat > /tmp/gen-code-context.mjs <<'GENEOF'
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = process.argv[2];
const modDir = join(root, 'src', 'modules');
mkdirSync(modDir, { recursive: true });

// Deterministic PRNG. No Math.random: the fixture must be byte-identical across
// trials, or cost differences between runs are fixture noise, not treatment.
let seed = 0x2f6e2b1;
const rnd = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5;  seed >>>= 0;
  return seed / 0x100000000;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo));
const shuffle = (a) => {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const NAMES = `auth billing cache catalog config crypto db dispatch email events
export feed gateway health import ingest inventory jobs kv ledger mailer metrics
notify orders parser payments pricing queue quota refunds reporting router
scheduler search session settlement shipping stats storage sync tasks tenants
throttle tokens tracing transforms uploads users vault webhooks workers`
  .trim().split(/\s+/);

// ONE pool for the real emission stamp AND every decoy. Two pools was the first
// regularity to die: an agent reads three modules, learns the decoy names, and
// scripts "the one not in that list". Sharing the pool makes the NAME carry
// zero signal — `emittedAt` is the answer in one module and a decoy in the next.
const TS = ['emittedAt', 'stampMs', 'reportTime', 'atMs', 'producedAt', 'tick',
  'writtenAt', 'sampleTime', 'markMs', 'flushedAt', 'observedAt', 'sealedAt',
  'cutMs', 'postedAt', 'lastFailureAt', 'firstSeenAt', 'previousRunAt',
  'scheduledFor', 'lastCompactedAt', 'priorIncidentAt', 'ackedAt', 'batchAt',
  'leaseAt', 'reloadedAt', 'promotedAt', 'quiescedAt', 'checkpointAt',
  'handoffAt', 'retiredAt', 'landedAt'];

// Wrap a sentence into comment lines. Authored text is stored as plain prose so
// the line breaks are not part of the phrasing — a fixed break position would
// itself be a pattern to match on.
const wrap = (text) => {
  const out = [];
  let line = '//';
  for (const word of text.split(/\s+/)) {
    if (line.length + word.length + 1 > 76) { out.push(line); line = '//'; }
    line += ` ${word}`;
  }
  out.push(line);
  return out.join('\n');
};

// THE ANSWER, ONE AUTHORED SENTENCE PER MODULE, INDEX MATCHED.
//
// This is the expensive part of the fixture and it is expensive on purpose.
// A generated phrasing pool does not work, however large: a measured n=5 run
// read three modules, recovered all eight templates then in use, and matched
// the rest with wildcards —
//
//   const GOOD=[/is the observation time this module attaches.../,
//               /Emission stamp for the cycle running now/,
//               /The moment the .* drain below emits its report/, ...]
//
// That `.*` is why per-module nouns do not help: a wildcard generalises across
// any filler. Only STRUCTURE resists, so every sentence below is a different
// shape — declarative, fragment, question-answer, contrast, imperative,
// colon-definition, parenthetical. Reading module 7 tells you nothing about
// how module 34 is worded, so a regex list built from a sample covers only
// that sample. Peak_ctx collapsed from 45k to 31k under the template attack
// and 4 of 5 trials stopped crossing the trigger; this is the fix for that.
const REAL_DOC = [
  (v, n) => `${v} is stamped by this reporter at the instant the current drain cycle publishes; the pipeline stores this cycle's row against it and against nothing earlier.`,
  (v, n) => `When the pass now draining finishes, the value it writes out as its own time is ${v}.`,
  (v, n) => `Of everything dated in this file, ${v} alone belongs to the report being assembled right now.`,
  (v, n) => `Publish time, this pass, this module: ${v}.`,
  (v, n) => `The collector will file the row ${n} is about to produce under ${v}.`,
  (v, n) => `Set on the way out — ${v} is assigned as the finished record leaves ${n}.`,
  (v, n) => `Ask when ${n} reported on this pass and the answer is ${v}.`,
  (v, n) => `${v} holds the emission instant of the report currently under construction.`,
  (v, n) => `This pass stamps ${v}; every pass before it stamped something else.`,
  (v, n) => `Downstream joins against the current ${n} row key on ${v}.`,
  (v, n) => `Whatever else here looks like a publish time, the one this cycle actually emits with is ${v}.`,
  (v, n) => `${v}: written once, at emission, by the drain below.`,
  (v, n) => `The report ${n} is building takes ${v} as its observation time.`,
  (v, n) => `Not the previous run's, not the source's — ${v} is this run's own emission stamp.`,
  (v, n) => `Telemetry for the cycle in progress is dated ${v}.`,
  (v, n) => `${v} is the clock reading taken at the moment this module hands its report off.`,
  (v, n) => `If you need the time attached to the record produced on this invocation, use ${v}.`,
  (v, n) => `${v} marks emission for the drain executing now.`,
  (v, n) => `The current cycle's published row carries ${v} as its timestamp.`,
  (v, n) => `${v} is stamped locally, by ${n}, for the pass it is running.`,
  (v, n) => `Emission time of the in-flight report: ${v}.`,
  (v, n) => `${v} is the value this reporter attaches to the telemetry it is about to send.`,
  (v, n) => `Among the timestamps below, ${v} is the one describing this very cycle's publication.`,
  (v, n) => `${v} — the instant the drain finishes and the record goes out.`,
  (v, n) => `The row produced by this pass is dated with ${v}.`,
  (v, n) => `${v} is written by the drain below at the moment it emits, and by nothing else.`,
  (v, n) => `For the cycle currently draining, emission is recorded as ${v}.`,
  (v, n) => `Use ${v} whenever the question is when this particular report was produced.`,
  (v, n) => `${v} is ${n}'s own publish stamp for the pass in progress.`,
  (v, n) => `The telemetry row leaving this module on this cycle is timestamped ${v}.`,
  (v, n) => `${v} captures when the current drain completes and publishes.`,
  (v, n) => `This is the one that belongs to now: ${v}.`,
  (v, n) => `${v} is recorded at hand-off time for the report this pass generates.`,
  (v, n) => `The pipeline reads ${v} as the time ${n} emitted on this cycle.`,
  (v, n) => `${v} is the emission stamp of the report being produced by the code below.`,
  (v, n) => `Every other dated constant here refers elsewhere; ${v} refers to this publication.`,
  (v, n) => `${v} fixes the observation time of the current ${n} drain.`,
  (v, n) => `Stamped at publish, for this pass only: ${v}.`,
  (v, n) => `${v} is when the record this cycle builds is emitted.`,
  (v, n) => `The current report's own timestamp is ${v}.`,
  (v, n) => `${v} is set as the drain concludes and the row is handed downstream.`,
  (v, n) => `Reading ${v} tells you when this invocation published.`,
  (v, n) => `${v} belongs to the report in flight, not to any that preceded it.`,
  (v, n) => `The emission moment for this pass through ${n} is ${v}.`,
  (v, n) => `${v} is the time value the current cycle writes onto its output row.`,
  (v, n) => `On this drain, publication is dated ${v}.`,
  (v, n) => `${v} is what the collector receives as the production time of this report.`,
  (v, n) => `The stamp this cycle applies to its own emitted record is ${v}.`,
  (v, n) => `${v} records the instant ${n} publishes during the pass now executing.`,
  (v, n) => `Take ${v} as the emission time of the report this module is producing.`,
  (v, n) => `${v} is the current cycle's publish timestamp, assigned inside the drain below.`,
];

// NEAR MISSES. Every one is a timestamp about reporting, publishing, emitting
// or acknowledging — just never THIS cycle's own. Keyword matching on
// emit/publish/stamp/report cannot separate these from the answer, which is the
// point. The pool is deliberately larger than any module uses so that an agent
// cannot become confident it has seen them all and invert the test ("the one
// matching no known decoy"). Inversion is punished hard by the aggregate
// digest: one wrong module fails everything, with no per-module feedback to
// localise it, so guessing is a bad strategy and reading is the cheap one.
const DECOY_DOC = [
  (v, n) => `${v} is the emission stamp from the previous drain cycle, kept so this pass can measure the gap between reports.`,
  (v, n) => `${v} is when the upstream collector stamped the batch this cycle read; it is the source's clock, not this reporter's.`,
  (v, n) => `${v} is when the downstream sink acknowledged the last report ${n} published — one hop after emission.`,
  (v, n) => `${v} is the time the scheduler intended this cycle to run, written ahead of the fact.`,
  (v, n) => `${v} carries the stamp of a report that failed to publish and was dropped.`,
  (v, n) => `${v} is when this module was last restarted.`,
  (v, n) => `${v} is when the shard leader for ${n} last changed.`,
  (v, n) => `${v} is when configuration was last reloaded; a report emitted before it used stale settings.`,
  (v, n) => `${v} is when the oldest entry still in memory was first seen.`,
  (v, n) => `${v} is the stamp the replica applied when it copied this cycle's input.`,
  (v, n) => `${v} is when the last compaction of ${n} state ran.`,
  (v, n) => `${v} is when the lease on this shard was granted.`,
  (v, n) => `${v} marks when this subsystem was promoted out of warmup.`,
  (v, n) => `${v} is the checkpoint the drain would rewind to on failure.`,
  (v, n) => `${v} is when the handoff from the previous owner completed.`,
  (v, n) => `${v} is when this metric was last quiesced for maintenance.`,
  (v, n) => `The row two cycles back was published at ${v}, retained for trend comparison.`,
  (v, n) => `${v} is when the retry queue for ${n} was last flushed.`,
  (v, n) => `Not a publication time at all — ${v} is when the schema for these rows was last migrated.`,
  (v, n) => `${v} is the deadline after which this cycle's report would be considered late.`,
  (v, n) => `${v} is the timestamp the ingest layer assigned before ${n} ever saw the data.`,
  (v, n) => `${v} is when the audit log recorded this subsystem's last configuration write.`,
  (v, n) => `${v} is when the previous owner of this shard emitted its final report.`,
  (v, n) => `${v} is the time the health probe last succeeded against ${n}.`,
  (v, n) => `${v} is when the batch window this cycle drew from opened.`,
  (v, n) => `${v} is when that batch window closed.`,
  (v, n) => `${v} is the publication time of the report the collector rejected as malformed.`,
  (v, n) => `${v} is when backpressure was last applied to ${n}.`,
  (v, n) => `${v} is the moment the cache backing this module was last warmed.`,
  (v, n) => `${v} is when the current shard assignment took effect.`,
  (v, n) => `${v} is the timestamp on the newest record this cycle consumed, set by its producer.`,
  (v, n) => `${v} is when the last successful publish was acknowledged end to end.`,
  (v, n) => `${v} is when this module's metrics were last scraped by the sidecar.`,
  (v, n) => `${v} is the time the rollout that deployed this code completed.`,
  (v, n) => `${v} is when the tenant owning this shard was last billed.`,
  (v, n) => `${v} is when the previous drain started — not when it published.`,
  (v, n) => `${v} is when the write-ahead log for ${n} was last truncated.`,
  (v, n) => `${v} is the effective time of the pricing snapshot this cycle applied.`,
  (v, n) => `${v} is when the alert on this subsystem last cleared.`,
  (v, n) => `${v} is the stamp on the duplicate row the deduper discarded.`,
  (v, n) => `${v} is when the connection to the collector was last re-established.`,
  (v, n) => `${v} is when the operator last acknowledged a page for ${n}.`,
  (v, n) => `${v} is the time the snapshot this cycle diffed against was taken.`,
  (v, n) => `${v} is when the index backing these lookups was last rebuilt.`,
  (v, n) => `${v} is the publication time recorded by the shadow pipeline running alongside this one.`,
  (v, n) => `${v} is when the quota for ${n} last reset.`,
  (v, n) => `${v} is when this subsystem last reported a state change, which is not the same as publishing a report.`,
  (v, n) => `${v} is the timestamp the client attached to the request that triggered this cycle.`,
  (v, n) => `${v} is when the last report was persisted to cold storage, well after emission.`,
  (v, n) => `${v} is when the feature flag governing this drain was last toggled.`,
  (v, n) => `${v} is the moment the leader lease is due to expire.`,
  (v, n) => `${v} is when the schema registry last validated these rows.`,
  (v, n) => `${v} is the emission stamp the canary instance produced for the same cycle.`,
  (v, n) => `${v} is when garbage collection last ran in this module.`,
  (v, n) => `${v} is when the upstream feed last signalled end-of-stream.`,
  (v, n) => `${v} is when this shard was last rebalanced.`,
];

// Hard guard, not a comment. If a module ever falls back to a reused phrasing
// the fixture silently reverts to being template-matchable and every trial goes
// void without any visible error — the most expensive failure mode here.
if (REAL_DOC.length < NAMES.length) {
  throw new Error(`REAL_DOC has ${REAL_DOC.length} phrasings for ${NAMES.length} modules; each module needs its own`);
}

const LEVEL = ['info', 'warn', 'debug'];

const expected = {};
const files = [];

NAMES.forEach((n, i) => {
  // Sized against the trigger, not chosen for realism: at 8 timestamps/module
  // the corpus is ~38k tokens, which lands peak_ctx around 58k and slides under
  // a 60k trigger without compacting. Ten to twelve puts required reading near
  // 45k and peak around 65k, so the boundary actually fires. Re-measure this if
  // the trigger changes — an uncrossed trigger makes every trial void.
  const nDecoy = int(15, 19);
  const names = shuffle(TS).slice(0, nDecoy + 1);
  const realVar = names[0];
  const decoys = names.slice(1);
  const realVal = 1771000000000 + int(1, 9_000_000) * 7 + i;
  expected[n] = realVal;

  // Decoys sit in the same magnitude band as the answer, so "the largest" and
  // "the most recent" are both dead ends.
  // REAL_DOC[i], never pick(): index matching is what guarantees all 51
  // phrasings are distinct. A random pick would reuse some and skip others,
  // handing the agent a small effective template set — the exact failure this
  // authoring exists to remove.
  const docs = shuffle([
    { v: realVar, val: realVal, doc: REAL_DOC[i](realVar, n) },
    ...shuffle(DECOY_DOC).slice(0, decoys.length).map((f, k) => ({
      v: decoys[k],
      val: 1771000000000 + int(1, 9_000_000) * (3 + k) + i,
      doc: f(decoys[k], n),
    })),
  ]);

  const block = docs.map((x) => `${wrap(x.doc)}\nconst ${x.v} = ${x.val};`).join('\n\n');

  // Every timestamp is referenced exactly once, in one uniform structure. This
  // is what closes attack 3: no constant is distinguishable by how it is used,
  // and none is left unused (an unused const would itself be the tell).
  const clocks = shuffle(docs.map((x) => x.v));

  const cap = n[0].toUpperCase() + n.slice(1);
  const level = pick(LEVEL);

  files.push(`import { logMsg } from '../telemetry.mjs';

// ${cap} subsystem. Owns ${n} state for one tenant shard and reports its
// health on every drain cycle.
//
// The constants below are declared in no particular order and several of them
// are timestamps in the reporting path. Exactly one is the stamp this module
// puts on the report it produces in the cycle being drained. Read what each
// one says before using it — the names do not tell you which is which.

${block}

// Debug surface: every clock this module tracks, in no meaningful order.
export const ${n}Clocks = { ${clocks.join(', ')} };

const LIMIT = ${int(16, 512)};
const SHARDS = ${int(2, 9)};

const state = { entries: new Map(), drained: 0, rejected: 0 };

function shardFor(key) {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h) % SHARDS;
}

function backlog() {
  let n = 0;
  for (const entry of state.entries.values()) if (entry.shard % 2 === 0) n += 1;
  return n;
}

export function ${n}Admit(key, value) {
  if (state.entries.size >= LIMIT) { state.rejected += 1; return false; }
  state.entries.set(key, { value, shard: shardFor(key) });
  return true;
}

export function ${n}Report() {
  const pending = backlog();
  state.drained += 1;
  return logMsg('${level}', \`${n} pending=\${pending} rejected=\${state.rejected}\`);
}
`);
});

NAMES.forEach((n, i) => writeFileSync(join(modDir, `${n}.mjs`), files[i]));

writeFileSync(join(root, 'src', 'telemetry.mjs'), `// Deprecated: logMsg(level, text)
// New API:    emit({ level, text, at })  -- \`at\` is REQUIRED and must be the
//             emission timestamp this module stamps for its own drain cycle.
export function logMsg(level, text) {
  return \`[\${level}] \${text}\`;
}

export function emit({ level, text, at }) {
  if (at === undefined) throw new Error('emit: \`at\` is required');
  if (typeof at !== 'number') throw new Error('emit: \`at\` must be a number');
  return \`[\${level}] \${text} @\${at}\`;
}
`);

// Solvability has to be checkable by CI without CI hardcoding 51 authored
// sentences, which would rot the moment one is reworded. So the generator can
// emit the answer key on demand — to a path OUTSIDE the project tree, only when
// this env var is set, and never by run.sh. A key inside $root would be a
// complete no-read solution sitting in the fixture.
if (process.env.CODE_CONTEXT_ANSWER_KEY) {
  writeFileSync(process.env.CODE_CONTEXT_ANSWER_KEY, JSON.stringify(expected, null, 2));
}

// ONE aggregate digest, never one per module. Per-module digests are invertible
// by brute force against the ~8 candidates in each file — a complete no-read
// solution. Aggregated, the same attack costs 8^51 combinations.
//
// The cost is that the agent gets no per-module feedback, and that is
// deliberate: a wrong-count would let it hill-climb one module at a time.
const aggregate = createHash('sha256')
  .update(Object.keys(expected).sort().map((n) => `${n}:${expected[n]}`).join('|'))
  .digest('hex');

writeFileSync(join(root, 'test.mjs'), `import { readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// This file is a checker, not an answer key. The expected \`at\` values appear
// here only inside a single aggregate SHA-256 over all modules at once, which
// cannot be inverted per module. Each module's emission timestamp exists in
// plaintext in exactly one place: that module.
const AGGREGATE = '${aggregate}';

const dir = new URL('./src/modules/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();
assert.equal(files.length, ${NAMES.length}, \`expected ${NAMES.length} modules, found \${files.length}\`);

const stillDeprecated = [];
const parts = [];

for (const f of files) {
  const name = f.replace(/\\.mjs$/, '');
  const mod = await import(new URL(f, dir));
  const fn = mod[\`\${name}Report\`];
  assert.equal(typeof fn, 'function', \`\${f}: missing \${name}Report export\`);
  const out = fn();
  const m = /@(\\d+)$/.exec(out);
  if (!m) { stillDeprecated.push(f); continue; }
  parts.push(\`\${name}:\${m[1]}\`);
}

// Reported by name: this is about the API migration and leaks no timestamp.
assert.deepEqual(stillDeprecated, [], \`still on the deprecated API: \${stillDeprecated.join(', ')}\`);

const got = createHash('sha256').update(parts.sort().join('|')).digest('hex');
assert.equal(got, AGGREGATE,
  'all call sites migrated, but at least one \`at\` is not that module\\'s own emission stamp. ' +
  'No per-module detail is reported on purpose -- re-read the modules and check which constant ' +
  'each file documents as the stamp for the cycle it is draining.');
console.log('PASS');
`);
GENEOF

node /tmp/gen-code-context.mjs "$d"
