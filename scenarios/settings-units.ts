import { bare } from './base'
import { rows } from '../config/index'
import { unitRows } from '../ui/settings'
// the Workspace units rows of two existing units; e changes the selected one (runner cycles, concurrency and setup ask)
const us = [{ root: '.', checks: { setup: ['npm', 'ci'], test: ['npm', 'test'] } }, { root: 'svc/api', kind: 'service' as const, runner: 'text' as const, concurrency: 2, checks: { test: ['go', 'test'] } }]
const rs = [...rows([{ name: '.cadre/config.json', trust: 'repo', value: { units: us } }]), ...unitRows(us)]
export default bare('Settings tab, Workspace units: each unit\'s runner, concurrency and setup argv as rows; e changes the selected row', {}, { ui: { 'settings.rows': rs, ssel: rs.length - 5 }, tab: 'settings' })
