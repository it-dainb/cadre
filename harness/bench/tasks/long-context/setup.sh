#!/bin/bash
# Volume, not breadth or depth. 200 incident reports the agent must actually
# read to answer one question — the one task in the suite built to reach real
# auto-compaction range (~80% of a ~300k window) rather than the ~25k tokens
# everything else peaks at.
#
# v2. The first version generated durations from `((i*197+13)%4000)+5` and
# rendered them through 30 sentence templates. An agent beat it in 12 turns:
# it read 6 files by hand, wrote a word-to-number parser, and then recovered
# the generator outright by noticing consecutive values differ by 197. peak_ctx
# came back at 48k against a 150k gate. Both defeats were generator
# regularities — a formula, and a finite template set — so neither more
# templates nor harder prose would have fixed it.
#
# So the signal is no longer generated. fixture/records.json holds 200
# authored snippets, each stating one real outage duration in prose plus 1-3
# decoy durations (planned maintenance windows, SLA targets, prior unrelated
# outages, wrong ETAs, vendor quotes, deploy times, hold times). There is no
# formula behind the values and no template behind the wording, so there is no
# rule to recover.
#
# Measured resistance, and it is thinner than it first looked: an adversary
# given the record texts, 12 of them labelled, and told to script rather than
# read reached 87.5% per-record accuracy, landing the sum 14.1% off. The bar is
# one exact integer so that still fails — but only just. Regenerate with
# adversary/grade.py rather than trusting these numbers; an earlier, weaker
# attack by the same adversary scored 60.4%/50.8% and was reported as final
# here until a regrade caught it.
#
# The bulk filler around each snippet is still mechanical. It is noise by
# design — it buys token volume, carries no signal, and nothing about the
# answer depends on it.
set -euo pipefail
d=$1
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
mkdir -p "$d/logs"

node - "$d" "$here/fixture/records.json" <<'EOF'
const fs = require('fs');
const path = require('path');
const [root, fixturePath] = process.argv.slice(2);

const records = JSON.parse(fs.readFileSync(fixturePath, 'utf8')).records;
if (records.length !== 200) throw new Error(`expected 200 records, got ${records.length}`);

// Binds this fixture to the constant verify.sh checks. Editing the fixture
// without editing verify.sh fails here, loudly, at setup time — rather than
// silently marking every future run as failed.
const EXPECTED = 135096;
const actual = records.reduce((a, r) => a + r.minutes, 0);
if (actual !== EXPECTED) {
  throw new Error(`fixture sums to ${actual}, verify.sh expects ${EXPECTED} — update both together`);
}

const TARGET_BYTES = 4300; // filler bytes per file, tuned for ~900KB total

// Cycling filler sentences — bulk, not signal. Deliberately free of durations,
// so filler can never be mistaken for a decoy, and free of the marker words a
// scoring heuristic would key on.
const SENT = [
  'The on-call engineer paged the secondary team after the initial alert threshold was crossed.',
  'Traffic was rerouted to the standby region while the primary cluster was drained for inspection.',
  'A configuration rollback was staged but held pending confirmation from the database team.',
  'Metrics dashboards showed elevated error rates across three availability zones before recovery.',
  'The root cause was traced to a connection pool exhaustion under sustained retry pressure.',
  'A follow-up action item was filed to add a circuit breaker around the upstream dependency.',
  'Customer-facing latency briefly exceeded the p99 budget before the mitigation took effect.',
  'The incident channel was archived once the status page was updated to resolved.',
  'Log retention was extended for the affected shard so the trace could be replayed later.',
  'Two engineers disagreed about whether the failover had completed cleanly on the first attempt.',
  'The runbook step for draining the queue was found to be out of date and was corrected.',
  'A synthetic probe from the eastern region continued to report green throughout the event.',
  'Ownership of the affected service had changed hands in the previous quarter.',
  'The alert routing rule sent the first page to a rotation that no longer existed.',
  'A cached credential was refreshed manually to unblock the deployment pipeline.',
];

for (let i = 0; i < records.length; i++) {
  const rec = records[i];
  const header = [
    `INCIDENT REPORT ${String(i + 1).padStart(4, '0')}`,
    `service: svc-${(i * 7) % 61}-${['edge', 'core', 'batch', 'index', 'relay'][i % 5]}`,
    '',
  ];

  const filler = [];
  let bytes = 0;
  while (bytes < TARGET_BYTES) {
    const s = SENT[(i * 3 + filler.length) % SENT.length];
    filler.push(s);
    bytes += s.length + 1;
  }

  // The snippet's position varies with the index — not to hide it, anyone
  // reading finds it immediately, but so that "the answer is in the last
  // line" is never true. That was half of what made v1 greppable.
  const at = (i * 13) % filler.length;
  filler.splice(at, 0, '', rec.text, '');

  fs.writeFileSync(
    path.join(root, 'logs', `incident-${String(i + 1).padStart(4, '0')}.txt`),
    header.concat(filler).join('\n') + '\n'
  );
}
EOF
