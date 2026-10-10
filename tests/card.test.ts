// Decision card (ADR 0008): rendering per kind, press -> dispatcher (origin press), hash binding, burn, fallback, focus rules, band fit, wording.
import { describe, expect, test } from 'claude-code/testing'
import type { Host, UiOps } from '../types'
import { band } from '../ui/band'
import { card, decisions } from '../ui/card'
import { pane } from '../ui/pane'
import { sheet } from '../ui/sheet'
import { type View, read, txt, wid } from '../ui/model'
import { acts, onEvent } from '../ui/index'
import { press, run } from '../commands/cadre'
import { dispatch } from '../core/dispatch'
import { TABLE } from '../core/events'
import { plan, world } from './fixtures/native/world'
import { NOOP, approval, view } from './fixtures/ui/epic'
import { banned } from './fixtures/wording'

const flagged = (f: string) => view(62, { tweak: ts => ts.map(t => (t.id === 'a2' ? { ...t, flags: [f] } : t)) })
const withSec = (v: View, sec: View['sec'], ui: Record<string, unknown> = {}): View => ({ ...v, sec, ui: { ...v.ui, ...ui } })
const labels = (v: View) => decisions(v)[0].btn!.map(b => `${b.hk}:${b.label}`)

const KINDS: [string, () => View, string[], string[]][] = [
  ['plan', () => approval(), ['a:Approve', 'x:Reject', 'c:Change'], ['12 scenarios', 'a1 ']],
  ['init diff', () => withSec(view(62), { initConfirm: { stage: 4, code: '1a2b3c4d' } }, { 'init.pending': { stage: 4, name: 'discovery', lines: ['+ types.docs', '+ suites.unit'] } }), ['a:Confirm', 'x:Cancel', 'c:Change'], ['stage 4 discovery', '+ suites.unit']],
  ['setup plan', () => withSec(view(62), { initConfirm: { stage: 90, code: '1a2b3c4d' } }, { 'setup.plan': { acts: [['installing bd', '']], human: ['sudo rm /usr/local/bin/bd'] } }), ['a:Confirm', 'x:Cancel', 'c:Change'], ['1. installing bd', 'sudo rm']],
  ['spec_change', () => flagged('spec_change'), ['a:Accept', 'x:Reject'], ['locked spec']],
  ['git flag', () => view(82), ['r:Restore', 'k:Keep'], ['refs/cadre/quarantine']],
  ['other flag', () => flagged('rework:2'), ['k:Keep', 'x:Cancel task'], ['rework:2']],
  ['conflict flag', () => flagged('conflict'), ['a:Accept', 'k:Keep', 'x:Cancel task'], ['conflict']],
  ['gate', () => withSec(view(62, { tweak: ts => [...ts, { ...ts[0], id: 'g1', title: 'Sign off the API', type: 'gate', state: 'todo' }] }), { approval: { planId: 'g1', code8: 'ab12cd34' } }), ['a:Approve', 'c:Change'], ['Sign off the API']],
  ['release', () => view(95, { ui: { rel: 'v1.4.0' } }), ['r:Release'], ['dev merges into main']],
]

describe('card renders per decision kind (wide and narrow)', () => {
  for (const [name, mk, btns, has] of KINDS) test(name, () => {
    expect(labels(mk())).toEqual(btns)
    for (const w of [116, 56]) {
      const t = txt(card(mk(), w, NOOP))
      expect(t[0]).toMatch(/^╔═+╗$/); expect(t.find(l => l.startsWith('╚'))).toMatch(/^╚═+╝$/)
      for (const x of has) expect(t.join('\n')).toContain(x)
      expect(t.some(l => btns.every(b => l.includes(b.replace(':', ': '))))).toBe(true)
      expect(Math.max(...card(mk(), w, NOOP).map(wid))).toBeLessThanOrEqual(w)   // fits; nothing truncates mid-line
    }
  })
  test('the pane shows the card as its active view, the rest dim and key-less; a stale card tab falls back to the epic', () => {
    const v = { ...approval(), ui: { tab: 'card' } }
    const p = pane(v, 116, 40, NOOP), t = txt(p.before)
    expect(t[2]).toMatch(/^╔/); expect(p.before.slice(2).flat().filter(s => s.d).length).toBeGreaterThan(5)
    const keys = p.before.flat().filter(s => s.hk).map(s => s.hk); expect(keys).toEqual(['1', '7', 'a', 'x', 'c'])   // tabs + the card's buttons only
    expect(txt(pane({ ...view(62), ui: { tab: 'card' } }, 116, 40, NOOP).before)[2]).not.toMatch(/^╔/)
  })
})

describe('band: fits, no duplicated hotkey labels', () => {
  const vs = () => [approval(), view(82), ...KINDS.slice(1, 3).map(k => k[1]())]
  test('every ⚑ row fits at 120 and 60 columns and no Button label repeats its hotkey', () => {
    for (const v of vs()) for (const w of [120, 60]) for (const l of band(v, w, NOOP)) expect(wid(l)).toBeLessThanOrEqual(w)
    for (const v of [...vs(), { ...approval(), ui: { tab: 'card' } }]) for (const l of [...band(v, 120, NOOP), ...pane(v, 116, 40, NOOP).before, ...pane(v, 56, 40, NOOP).after, ...sheet(approval(), 116, NOOP)])
      for (const s of l) if (s.hk) expect(s.t.startsWith(`${s.hk}:`)).toBe(false)
  })
})

async function ui(w: Awaited<ReturnType<typeof world>>, o: { peek?: string } = {}) {
  const calls: [string, ...any[]][] = [], timers: (() => unknown)[] = []
  const ops = { els: () => ({}), open: async (a: any) => { calls.push(['open', a]); return { isPlaced: true } }, focused: async () => false, toast: (t: string) => { calls.push(['toast', t]) }, notify: async () => ({ isSent: true }), status: () => {},
    peek: async () => o.peek ?? '', fill: async (t: string) => { calls.push(['fill', t]); return { isFilled: true } }, after: (_ms: number, fn: () => unknown) => { timers.push(fn) }, invalidate: () => { calls.push(['inv']) }, blit: async () => {} } as unknown as UiOps
  Object.assign(w.h, { ops, press: (l: string) => press(w.h, l) })
  const drain = async () => { while (timers.length) await timers.shift()!() }
  return { calls, drain, of: (k: string) => calls.filter(c => c[0] === k).map(c => c[1]) }
}
const btn = async (h: Host, hk: string) => decisions(await read(h))[0].btn!.find(b => b.hk === hk)!

describe('presses: the dispatcher as the human (origin press), bound to the code drawn with the card', () => {
  test('Approve press approves the plan without typing; the card is gone afterwards', async () => {
    const w = await world(), { task } = await plan(w), u = await ui(w)
    expect((await btn(w.h, 'a')).cmd).toMatch(/^approve [\w-]+@[0-9a-f]{8}$/)
    acts(w.h).press((await btn(w.h, 'a')).cmd!); await u.drain()
    expect((await w.store.get(task)).category).toBe('todo'); expect((await w.h.board.read()).plan?.state).toBe('approved'); expect(decisions(await read(w.h))).toEqual([])
    expect((w.h as any).toasts[0]).toContain('approved')
  })
  test('Reject press drops the plan', async () => {
    const w = await world(); await plan(w); const u = await ui(w)
    acts(w.h).press((await btn(w.h, 'x')).cmd!); await u.drain()
    expect((await w.h.board.read()).plan).toBeNull(); expect((w.h as any).toasts[0]).toContain('dropped')
  })
  test('stale press: the plan changed after the card was drawn -> refused, nothing approved, the old code is dead, the card redraws with the new one', async () => {
    const w = await world(), { task } = await plan(w), u = await ui(w), old = (await btn(w.h, 'a')).cmd!
    await w.call('TaskUpdate', { taskId: task, subject: 'changed under the card' })
    const fresh = (await btn(w.h, 'a')).cmd!; expect(fresh).not.toBe(old)   // the card re-renders with the new code
    acts(w.h).press(old); await u.drain()
    expect((await w.store.get(task)).category).toBe('draft'); expect((w.h as any).toasts[0]).toContain('review again'); expect(u.of('inv').length).toBe(1)
    expect((await press(w.h, fresh)).text).toContain('refused')   // the refused attempt burned the live code too (one secret per decision)
    expect((await press(w.h, (await btn(w.h, 'a')).cmd!)).text).toContain('approved')
  })
  test('a press burns the code: replaying the same press after success is refused', async () => {
    const w = await world(); await plan(w); const cmd = (await btn(w.h, 'a')).cmd!
    expect((await press(w.h, cmd)).text).toContain('approved'); expect((await press(w.h, cmd)).text).toContain('refused')
  })
  test('Change prefills the composer (empty) with `Change <id>: ` and runs nothing; a non-empty composer is not touched', async () => {
    const w = await world(), { task } = await plan(w); let u = await ui(w)
    const c = await btn(w.h, 'c'); expect(c.fill).toMatch(/^Change [\w-]+: $/); expect(c.cmd).toBeUndefined()
    acts(w.h).fill(c.fill!); await u.drain(); expect(u.of('fill')).toEqual([c.fill]); expect((await w.store.get(task)).category).toBe('draft')
    u = await ui(w, { peek: 'half-typed' }); acts(w.h).fill(c.fill!); await u.drain(); expect(u.of('fill')).toEqual([]); expect(u.of('toast')[0]).toContain('composer not empty')
  })
  test('only a press (or the composer) is the human: other origins are refused, and an engine origin cannot claim "press"', async () => {
    const w = await world(), { task } = await plan(w), p = (await w.h.board.read()).plan!.id, at = async () => `${p}@${(await w.h.secret.read()).approval!.code8}`
    for (const kind of ['sdk', 'plugin', 'bridge', 'unclassified']) expect((await dispatch(w.h, { schemaVersion: 1, cmd: 'approve', args: [await at()], origin: { kind } }, async () => ({ text: '' }))).text).toContain('refused')
    const out = await run(w.h, { args: `approve ${await at()}`, origin: { kind: 'press' } } as any, (async () => undefined) as any) as { text: string }
    expect(out.text).toContain('refused'); expect((await w.store.get(task)).category).toBe('draft')
  })
  test('the typed fallback is unchanged: composer origin `approve <id>@<code>` still approves', async () => {
    const w = await world(), { task } = await plan(w), p = (await w.h.board.read()).plan!.id
    expect((await w.text({ cmd: 'approve', args: [`${p}@${(await w.h.secret.read()).approval!.code8}`] })).text).toContain('approved'); expect((await w.store.get(task)).category).toBe('todo')
  })
  test('Cancel burns a pending init/setup code and says so in one plain line', async () => {
    const w = await world(); await w.h.secret.update(s => ({ ...s, initConfirm: { stage: 90, code: 'ab12cd34' } }))
    const r = await press(w.h, 'setup cancel'); expect(r.text).toBe('setup: cancelled; nothing ran'); expect(banned(r.text)).toEqual([]); expect((await w.h.secret.read()).initConfirm).toBeUndefined()
    expect((await dispatch(w.h, { schemaVersion: 1, cmd: 'setup', args: ['cancel'], origin: { kind: 'sdk' } }, async () => ({ text: '' }))).text).toContain('refused')
  })
})

describe('opening: focus only while the composer is empty', () => {
  const pending = async (w: Awaited<ReturnType<typeof world>>) => { await plan(w); const [actor, severity, needsHuman] = TABLE['approval.pending']; return { schemaVersion: 1, seq: 1, at: 5, type: 'approval.pending', actor, severity, needsHuman, data: { planId: 'p', missing: [] } } as any }
  test('empty composer: the card opens focused, once per decision', async () => {
    const w = await world(), u = await ui(w), e = await pending(w); await onEvent(w.h, e); await u.drain()
    expect(u.of('open')).toEqual([{ id: 'cadre', title: 'cadre', focus: true, columns: 120 }]); expect((await w.h.ui.read()).tab).toBe('card')
    await onEvent(w.h, e); await u.drain(); expect(u.of('open').length).toBe(1)
  })
  test('text in the composer: the pane may open but never asks for focus (no steal)', async () => {
    const w = await world(), u = await ui(w, { peek: 'I am typing' }); await onEvent(w.h, await pending(w)); await u.drain()
    expect(u.of('open')).toEqual([{ id: 'cadre', title: 'cadre', columns: 120 }])
  })
})

describe('band in a docked-pane column', () => {
  test('at 24 and 36 columns the ⚑ row wraps (no truncation) and keeps its button', () => {
    for (const w of [24, 36]) for (const v of [approval(), view(82), KINDS[2][1]()]) {
      const ls = band(v, w, NOOP); expect(ls.every(l => wid(l) <= w)).toBe(true); expect(txt(ls).join(' ')).not.toContain('…'); expect(ls.flat().some(s => s.hk === '1')).toBe(true)
    }
  })
})
