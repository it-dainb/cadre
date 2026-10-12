// Settings rows (the view is ui/views/settings): every config key with its effective value, the layer it came from and its class. The rows ride in the ui atom (`settings.rows`,
// filled by config/route.refreshSettings: the pane cannot read files). Human presses only: a button runs `config <set|edit|sel> ...` through acts.run (ADR 0007).
import type { View } from './model'
import type { Row } from '../config/index'

const GROUPS = ['Workflow', 'Agents & models', 'Drive', 'Cost', 'Sync', 'UI', 'Security']
export const groupOf = (r: Row): string => r.cls === 'S' ? 'Security' : /^(roles|models|reuse)\b/.test(r.key) ? 'Agents & models' : r.key.startsWith('drive.') ? 'Drive' : r.key.startsWith('cost.') ? 'Cost' : /^(store|sync)\b/.test(r.key) ? 'Sync' : r.key.startsWith('ui.') ? 'UI' : 'Workflow'
export const rowsOf = (v: View): Row[] => ((v.ui['settings.rows'] as Row[] | undefined) ?? []).slice().sort((a, b) => GROUPS.indexOf(groupOf(a)) - GROUPS.indexOf(groupOf(b)))   // stable: keeps the key order inside a group
export const val = (r: Row): string => r.kind === 'list' ? `[${(r.value as unknown[]).join(', ')}]` : r.value === '' ? '(empty)' : String(r.value)
// what a press on the row does: the line after `config`
export const actOf = (r: Row): string => r.kind === 'bool' ? `set ${r.key} ${!r.value}` : r.kind === 'enum' ? `set ${r.key} ${r.opts![(r.opts!.indexOf(String(r.value)) + 1) % r.opts!.length]}` : `edit ${r.key}`
