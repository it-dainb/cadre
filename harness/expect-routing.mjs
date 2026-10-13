// The routing a cell's settings allow, per agent role, computed by cadre's own code (config resolve + core/risk.route): every model alias and effort
// a run may take over the review tiers and the escalation rounds. The oracle checks the proxy's requests against it (invariant `routing`).
// Usage: node --experimental-transform-types --no-warnings --import <repo>/tests/dev/register.mjs harness/expect-routing.mjs <repo> [repo-config.json] [env.json]
import { readFileSync, existsSync } from 'node:fs'
const [repo, cfgFile, envFile] = process.argv.slice(2)
const { resolve, forcedOf } = await import(`${repo}/config/index.ts`)
const { route } = await import(`${repo}/core/risk.ts`)
const j = f => (f && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : undefined)
const cfg = resolve([{ name: '.cadre/config.json', trust: 'repo', value: j(cfgFile) }]).config, fo = forcedOf(j(envFile) ?? {})
const out = {}
for (const role of ['worker', 'tester', 'reviewer', 'explorer']) {
  const r = cfg.roles[role], picks = []
  for (const risk of ['light', 'standard', 'thorough']) for (let n = 0; n <= (r.escalate?.after ?? 0); n++) picks.push(route(r, cfg.models, risk, n, role === 'reviewer'))
  out[role] = { models: fo.model ? [fo.model] : [...new Set(picks.map(p => p.model).filter(Boolean))], efforts: fo.effort ? [fo.effort] : [...new Set(picks.map(p => p.effort).filter(e => e && e !== 'default'))] }
}
console.log(JSON.stringify(out))
