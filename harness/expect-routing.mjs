// The routing a cell's settings allow, per agent role, computed by cadre's own code (config resolve + core/risk.route): every model alias and effort
// a run may take over the role's risk cells and their escalations. The oracle checks the proxy's requests against it (invariant `routing`).
// Usage: node --experimental-transform-types --no-warnings --import <repo>/tests/dev/register.mjs harness/expect-routing.mjs <repo> [repo-config.json] [env.json]
import { readFileSync, existsSync } from 'node:fs'
const [repo, cfgFile, envFile] = process.argv.slice(2)
const { resolve, forcedOf } = await import(`${repo}/config/index.ts`)
const { route, RISKS } = await import(`${repo}/core/risk.ts`)
const j = f => (f && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : undefined)
const cfg = resolve([{ name: '.cadre/config.json', trust: 'repo', value: j(cfgFile) }]).config, fo = forcedOf(j(envFile) ?? {})
const out = {}
for (const role of ['worker', 'tester', 'reviewer', 'explorer', 'planner']) {
  const picks = role === 'explorer' || role === 'planner' ? [route(role, cfg.roles[role], '', 0)] : RISKS.flatMap(k => [0, 99].map(n => route(role, cfg.roles[role].byRisk[k], k, n)))
  out[role] = { models: fo.model ? [fo.model] : [...new Set(picks.map(p => p.model))], efforts: fo.effort ? [fo.effort] : [...new Set(picks.map(p => p.effort).filter(Boolean))] }
}
console.log(JSON.stringify(out))
