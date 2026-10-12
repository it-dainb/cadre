// Settings tab (hotkey 9): every config key with its effective value, the layer it came from and its class. The rows ride in the ui atom (`settings.rows`,
// filled by config/route.refreshSettings: the pane cannot read files). Human presses only: a button runs `config <set|edit|sel> ...` through acts.run (ADR 0007).
import { type Acts, type Line, type View, L, S, T, cut, fit } from './model'
import type { Row } from '../config/index'

const GROUPS = ['Workflow', 'Agents & models', 'Drive', 'Cost', 'Sync', 'UI', 'Security']
export const groupOf = (r: Row): string => r.cls === 'S' ? 'Security' : /^(roles|models|reuse)\b/.test(r.key) ? 'Agents & models' : r.key.startsWith('drive.') ? 'Drive' : r.key.startsWith('cost.') ? 'Cost' : /^(store|sync)\b/.test(r.key) ? 'Sync' : r.key.startsWith('ui.') ? 'UI' : 'Workflow'
export const rowsOf = (v: View): Row[] => ((v.ui['settings.rows'] as Row[] | undefined) ?? []).slice().sort((a, b) => GROUPS.indexOf(groupOf(a)) - GROUPS.indexOf(groupOf(b)))   // stable: keeps the key order inside a group
export const val = (r: Row): string => r.kind === 'list' ? `[${(r.value as unknown[]).join(', ')}]` : r.value === '' ? '(empty)' : String(r.value)
const note = (r: Row) => r.cls === 'S' ? 'tighten-only from repo' : r.cls === 'U' ? 'user-level only' : ''
const SRC: Record<Row['src'], string> = { default: 'inactive', user: 'suggestion', repo: 'warning', env: 'success' }
// what a press on the row does: the line after `config`
export const actOf = (r: Row): string => r.kind === 'bool' ? `set ${r.key} ${!r.value}` : r.kind === 'enum' ? `set ${r.key} ${r.opts![(r.opts!.indexOf(String(r.value)) + 1) % r.opts!.length]}` : `edit ${r.key}`
const WORD: Record<Row['kind'], string> = { bool: 'toggle', enum: 'cycle', number: 'edit', text: 'edit', list: 'edit' }

export function settings(v: View, w: number, size: number, a: Acts): Line[] {
  const rs = rowsOf(v), c = v.c, wide = w >= 100, live = v.t === null
  if (!rs.length) return [L('no settings loaded yet'), live ? [S('refresh', undefined, { k: 'r', hk: 'r', p: () => a.run?.('refresh') })] : L('(read-only in replay)')]
  const sel = Math.min(Math.max(0, Number(v.ui.ssel ?? 0)), rs.length - 1)
  const disp: { g?: string; r?: Row; i?: number }[] = []
  rs.forEach((r, i) => { if (!i || groupOf(r) !== groupOf(rs[i - 1])) disp.push({ g: groupOf(r) }); disp.push({ r, i }) })
  const room = Math.max(6, size - 6), at = disp.findIndex(d => d.i === sel), top = Math.min(Math.max(0, at - Math.floor(room / 2)), Math.max(0, disp.length - room))
  const kw = wide ? 30 : 22, vw = wide ? 24 : Math.max(8, w - kw - 21)
  const out: Line[] = [[S(`SETTINGS  ${rs.length} keys · ${live ? '' : 'read-only in replay · '}saved by cadre after your press to ~/.claude/cadre.json`.slice(0, w - 12))], L(T(c, '─'.repeat(w)))]
  if (top > 0) out.push(L(`  ↑ ${top} more`, 'inactive'))
  for (const d of disp.slice(top, top + room)) {
    if (d.g) { out.push([S(d.g.toUpperCase(), undefined, { b: true })]); continue }
    const r = d.r!, me = d.i === sel
    out.push([S(me ? (c.glyphs === 'ascii' ? '> ' : '▸ ') : '  ', undefined, { b: me }), S(fit(r.key, kw), undefined, { b: me }), S(fit(cut(val(r), vw - 1), vw)), S(fit(`[${r.src}]`, 10), SRC[r.src]),
      ...(wide && note(r) ? [S(fit(note(r), 24), 'inactive')] : []),
      ...(live ? [S(WORD[r.kind], 'suggestion', { k: `cfg:${r.key}`, ...(me ? { hk: 'e' } : {}), b: true, p: () => a.run?.(actOf(r)) })] : [])])
    if (!wide && me && note(r)) out.push(L(`    ${note(r)}`, 'inactive'))
  }
  if (top + room < disp.length) out.push(L(`  ↓ ${disp.length - top - room} more`, 'inactive'))
  const r = rs[sel]
  out.push(L(T(c, '─'.repeat(w))), [S(`${r.key}: default ${val({ ...r, value: r.def })}`, 'inactive'), ...(live ? [S('   '), S('next', undefined, { k: 'n', hk: 'n', p: () => a.run?.('sel 1') }), S('  '), S('prev', undefined, { k: 'p', hk: 'p', p: () => a.run?.('sel -1') })] : [])])
  return out
}
