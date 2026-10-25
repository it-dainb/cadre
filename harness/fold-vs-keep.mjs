#!/usr/bin/env node
// The A1 rule for the specifier (plan 0.17, fixed before any run). Usage: node harness/fold-vs-keep.mjs <matrix run dir>  (the dir of `harness/matrix.sh release017`)
// Reads <dir>/fold-vs-keep-{folded,kept}.rK/verdict.json (oracle mode fold-vs-keep) and sums landed tasks, rework rounds and dialogs over the runs of each arm.
// The folded arm (no specifier) is WORSE iff it lands strictly fewer tasks, or lands the same and has at least 2 more rework+dialog events in total.
// Worse -> the specifier defaults on. Equal, better or mixed -> it stays opt-in. A run with no verdict (a crash) counts 0 landed. Flow counts, not quality.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const sum = runs => runs.reduce((a, r) => ({ landed: a.landed + (r?.landed ?? 0), events: a.events + (r?.rework ?? 0) + (r?.dialogs ?? 0) }), { landed: 0, events: 0 })
export function decide(folded, kept) {
  const f = sum(folded), k = sum(kept), worse = f.landed < k.landed || (f.landed === k.landed && f.events - k.events >= 2)
  return { folded: f, kept: k, foldedWorse: worse, specifierDefault: worse ? 'on' : 'off (opt-in)' }
}
const runsOf = (dir, arm) => readdirSync(dir).filter(d => d.startsWith(`fold-vs-keep-${arm}.r`)).sort().map(d => { const f = join(dir, d, 'verdict.json'); try { return JSON.parse(readFileSync(f, 'utf8')).stats?.foldKeep } catch { return undefined } })
if (process.argv[1]?.endsWith('fold-vs-keep.mjs')) {
  const dir = process.argv[2]; if (!dir || !existsSync(dir)) { console.error('usage: node harness/fold-vs-keep.mjs <matrix run dir>'); process.exit(2) }
  const r = decide(runsOf(dir, 'folded'), runsOf(dir, 'kept')); r.runs = { folded: runsOf(dir, 'folded').length, kept: runsOf(dir, 'kept').length }
  writeFileSync(join(dir, 'fold-vs-keep.json'), JSON.stringify(r, null, 1)); console.log(JSON.stringify(r))
}
