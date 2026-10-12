import { bare } from './base'
import { envLayer, rows } from '../config/index'
import { rowsOf } from '../ui/settings'
const layers = [{ name: '~/.claude/cadre.json', trust: 'user' as const, value: { drive: { maxTurns: 150 }, ui: { density: 'compact' } } }, { name: 'env', trust: 'user' as const, value: envLayer({}) }]
const rs = rows(layers)
export default bare('settings: the Drive group (bounds) and the ui.flash / ui.density / ui.v2 rows; e changes the selected row', {}, { ui: { 'settings.rows': rs, ssel: rowsOf({ ui: { 'settings.rows': rs } } as any).findIndex(r => r.key === 'drive.maxTurns'), cfg: { v2: true } }, tab: 'settings' })
