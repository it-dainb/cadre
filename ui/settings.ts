// Settings rows (the view is ui/views/settings): every config key with its effective value, the layer it came from and its class. The rows ride in the ui atom (`settings.rows`,
// filled by config/route.refreshSettings: the pane cannot read files). Human presses only: a button runs `config <set|edit|sel> ...` through acts.run (ADR 0007).
import type { View } from './model'
import type { Row } from '../config/index'
import type { Pkg } from '../core/discover'

export const groupOf = (r: Row): string => r.cat   // the registry's category; config/route sends the rows in category order
export const rowsOf = (v: View): Row[] => (v.ui['settings.rows'] as Row[] | undefined) ?? []
export const val = (r: Row): string => Array.isArray(r.value) ? `[${r.value.join(', ')}]` : r.value === '' ? '(empty)' : r.value && typeof r.value === 'object' ? JSON.stringify(r.value) : String(r.value)
// what a press on the row does: the line after `config`
export const actOf = (r: Row): string => r.src === 'fixed' ? 'refresh' : r.kind === 'bool' ? `set ${r.key} ${!r.value}` : r.kind === 'enum' ? `set ${r.key} ${r.opts![(r.opts!.indexOf(String(r.value)) + 1) % r.opts!.length]}` : `edit ${r.key}`

// Workspace units rows (config/route.saveUnit writes them): each existing unit's scalar fields, keyed `units.<i>.<field>`; add and remove stay in init

export const UNIT = /^units\.(\d+)\.(concurrency|setup)$/
export const unitRows = (us: Pkg[]): Row[] => us.flatMap((u, i): Row[] => {
  const r = (f: string, kind: Row['kind'], value: unknown, def: unknown, desc: string, opts?: string[]): Row => ({ key: `units.${i}.${f}`, cat: 'Workspace units', cls: 'O', desc: `${u.root}: ${desc}`, safety: false, value, def, src: 'repo', kind, ...(opts ? { opts } : {}) })
  return [r('concurrency', 'number', u.concurrency ?? 0, 0, 'tasks of this unit at once (0 = no unit cap)'),
    r('setup', 'text', JSON.stringify(u.setup ?? []), JSON.stringify([]), 'the setup command as a JSON argument list')]
})
