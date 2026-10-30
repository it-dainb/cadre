import { bare } from './base'
import { envLayer, rows } from '../config/index'
// values from every layer: defaults, the user file, the repo file (a tightening of strictness and an ordinary key), env
const layers = [
  { name: '~/.claude/cadre.json', trust: 'user' as const, value: { strictness: 'advisory', concurrency: { default: 5 }, drive: { maxTurns: 150 }, roles: { worker: { byRisk: { light: { model: 'opus' } } } } } },
  { name: '.cadre/config.json', trust: 'repo' as const, value: { strictness: 'strict', limits: { rebaseRounds: 8 }, jail: 'on', changelog: { path: 'docs/CHANGES.md' } } },
  { name: 'env', trust: 'user' as const, value: envLayer({ CADRE_STORE: 'memory' }) },
]
export default bare('Settings tab: every key with its value, source layer ([default] [user] [repo] [env]) and class note; e changes the selected row, n/p move', {}, { ui: { 'settings.rows': rows(layers), ssel: 3 }, tab: 'settings' })
