// Decision card (ADR 0008): ONE record (Decision), ONE renderer, ONE press path. Rendering per kind, a test-only kind with no UI code, the queue, core ask/settle, presses.
import { describe, expect, test } from 'claude-code/testing'
import type { Decision, Host, UiOps } from '../types'
import { band } from '../ui/band'
import { card, decisions } from '../ui/card'
import { pane } from '../ui/pane'
import { sheet } from '../ui/sheet'
import { type View, read, txt, wid } from '../ui/model'
import { acts, onEvent } from '../ui/index'
import { press, run } from '../commands/cadre'
import { ROUTES, dispatch, initPropose } from '../core/dispatch'
import { ask, flagDecision, settle } from '../core/decide'
import { modelView } from '../core/board'
import { emit, TABLE } from '../core/events'
import { plan, world } from './fixtures/native/world'
import { NOOP, approval, planDec, view } from './fixtures/ui/epic'
import { banned } from './fixtures/wording'

const dec = (id: string, kind: string, title: string, lines: string[], options: Decision['options'], o: Partial<Decision> = {}): Decision => ({ id, kind, title, lines, hash: 'h', options, ...o })
const withDec = (ds: Decision[], code = '1a2b3c4d', ui: Record<string, unknown> = {}): View => { const v = view(62, { board: { decisions: ds }, ui }); v.sec = { dcode: Object.fromEntries(ds.map(d => [d.id, code])) }; return v }
const flag = (f: string) => flagDecision('a2', f, 'Session refresh')!
const labels = (d: Decision) => d.options.map(o => `${o.key}:${o.label}`)
const OK = { key: 'a', label: 'Confirm', verb: 'approve', run: 'x confirm {code}' }
// a kind nobody wrote UI for: the card, band row, queue and press path work from the record alone
const DEPLOY = dec('deploy:7', 'deploy', 'deploy build 7 to staging?', ['3 services restart', 'rollback is automatic'], [{ key: 'd', label: 'Deploy', verb: 'approve', run: 'deploy now' }, { key: 'w', label: 'Wait an hour', verb: 'change', fill: 'deploy later: ' }], { fallback: '/cadre deploy now' })

const KINDS: [string, Decision, string[], string[]][] = [
  ['plan', planDec(), ['a:Approve', 'x:Reject', 'c:Change'], ['7 tasks']],
  ['init diff', dec('init:4', 'init', 'init stage 4 diff ready · confirm it', ['stage 4 discovery: proposed changes', '  + types.docs', '  + suites.unit'], [OK, { key: 'x', label: 'Cancel', verb: 'reject', run: 'init cancel' }, { key: 'c', label: 'Change', verb: 'change', run: 'init 4' }]), ['a:Confirm', 'x:Cancel', 'c:Change'], ['stage 4 discovery', '+ suites.unit']],
  ['setup plan', dec('init:90', 'init', 'setup plan ready · confirm it', ['  1. installing bd', 'you run once:', '  ! sudo rm /usr/local/bin/bd'], [OK]), ['a:Confirm'], ['1. installing bd', 'sudo rm']],
  ['spec_change', flag('spec_change'), ['a:Accept', 'x:Reject'], ['locked spec']],
  ['git flag', flagDecision('', 'git:dev:agent')!, ['r:Restore', 'k:Keep'], ['refs/cadre/quarantine']],
  ['other flag', flag('rework:2/2'), ['k:Keep', 'x:Cancel task'], ['rework:2/2']],
  ['conflict flag', flag('conflict'), ['a:Accept', 'k:Keep', 'x:Cancel task'], ['conflict']],
  ['lost epic', flagDecision('p3', 'lost-epic')!, ['r:Re-cut', 'x:End epic'], ['epic branch is gone']],
  ['gate', dec('gate:g1', 'gate', 'approve gate g1 · Sign off the API', ['Sign off the API', 'a human gate: the work after it waits for you'], [{ key: 'a', label: 'Approve', verb: 'approve', run: 'approve g1@{code}' }, { key: 'c', label: 'Change', verb: 'change', fill: 'Change g1: ' }], { fallback: '/cadre approve g1@{code}' }), ['a:Approve', 'c:Change'], ['Sign off the API']],
  ['release', dec('release:1.4.0', 'release', 'release v1.4.0?', ['dev merges into main with an annotated tag v1.4.0'], [{ key: 'r', label: 'Release', verb: 'release', run: 'release 1.4.0' }]), ['r:Release'], ['dev merges into main']],
  ['test-only kind', DEPLOY, ['d:Deploy', 'w:Wait an hour'], ['3 services restart']],
]

describe('ONE renderer draws any Decision (wide and narrow)', () => {
  for (const [name, d, btns, has] of KINDS) test(name, () => {
    expect(labels(d)).toEqual(btns)
    for (const w of [116, 56]) {
      const ls = card(withDec([d]), w, NOOP), t = txt(ls)
      expect(t[0]).toMatch(/^╔═+╗$/); expect(t.find(l => l.startsWith('╚'))).toMatch(/^╚═+╝$/)
      for (const x of has) expect(t.join('\n')).toContain(x)
      expect(t.some(l => btns.every(b => l.includes(b.replace(':', ': '))))).toBe(true)
      expect(Math.max(...ls.map(wid))).toBeLessThanOrEqual(w)   // fits; nothing truncates mid-line
      expect(ls.flat().filter(s => s.hk && s.k !== 'n' && s.k !== 'p').map(s => s.hk)).toEqual(d.options.map(o => o.key))   // options = buttons, key = hotkey
    }
  })
  test('the band row of a never-seen kind: title, review button, typed fallback only when it carries a code', () => {
    const v = withDec([DEPLOY]); expect(txt(band(v, 115, NOOP)).join('\n')).toContain('deploy build 7 to staging?'); expect(txt(band(v, 115, NOOP)).join('\n')).not.toContain('/cadre deploy now')
    const g = withDec([KINDS[8][1]]); g.sec = { dcode: { 'gate:g1': 'cafe0001' } }; expect(txt(band(g, 115, NOOP)).join('\n')).toContain('/cadre approve g1@cafe0001')
  })
  test('the queue: "1 of 3", next/prev move through them oldest first', () => {
    const ds = [KINDS[0][1], KINDS[3][1], DEPLOY], t = (di: number) => txt(card(withDec(ds, 'c', { di }), 116, NOOP)).join('\n')
    expect(t(0)).toContain('1 of 3'); expect(t(0)).toContain('approve plan p3'); expect(t(1)).toContain('2 of 3'); expect(t(1)).toContain('a2 flagged spec_change'); expect(t(2)).toContain('deploy build 7'); expect(t(9)).toContain('3 of 3')
    expect(txt(card(withDec([DEPLOY]), 116, NOOP)).join('\n')).not.toContain(' of ')
    const got: string[] = []; card(withDec(ds), 116, { ...NOOP, step: (w, d) => { got.push(`${w}${d}`) } }).flat().filter(s => s.k === 'n' || s.k === 'p').forEach(s => s.p!()); expect(got).toEqual(['dec-1', 'dec1'])
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
  const vs = () => [approval(), view(82), withDec([KINDS[1][1]]), withDec([DEPLOY])]
  test('every ⚑ row fits at 120 and 60 columns and no Button label repeats its hotkey', () => {
    for (const v of vs()) for (const w of [120, 60]) for (const l of band(v, w, NOOP)) expect(wid(l)).toBeLessThanOrEqual(w)
    for (const v of [...vs(), { ...approval(), ui: { tab: 'card' } }]) for (const l of [...band(v, 120, NOOP), ...pane(v, 116, 40, NOOP).before, ...pane(v, 56, 40, NOOP).after, ...sheet(approval(), 116, NOOP)])
      for (const s of l) if (s.hk) expect(s.t.startsWith(`${s.hk}:`)).toBe(false)
  })
  test('in a docked-pane column (24, 36) the ⚑ row wraps, never truncates, and keeps its button', () => {
    for (const w of [24, 36]) for (const v of vs()) { const ls = band(v, w, NOOP); expect(ls.every(l => wid(l) <= w)).toBe(true); expect(txt(ls).join(' ')).not.toContain('…'); expect(ls.flat().some(s => s.hk === '1')).toBe(true) }
  })
})

describe('core: ask / settle / events', () => {
  test('ask adds (replace keeps its place), settle clears it and its code; the model view never sees decisions; no code on the board', async () => {
    const w = await world(), d2 = { ...DEPLOY, id: 'deploy:8' }
    await ask(w.h, DEPLOY, 'c0de0001'); await ask(w.h, d2, 'c0de0002'); await ask(w.h, { ...DEPLOY, hash: 'h2' }, 'c0de0003')
    const b = await w.h.board.read(); expect(b.decisions!.map(d => `${d.id}:${d.hash}`)).toEqual(['deploy:7:h2', 'deploy:8:h'])
    expect(JSON.stringify(b)).not.toContain('c0de000'); expect(JSON.stringify(modelView(b))).not.toContain('deploy'); expect((await w.h.secret.read()).dcode).toEqual({ 'deploy:7': 'c0de0003', 'deploy:8': 'c0de0002' })
    await settle(w.h, 'deploy:7'); expect((await w.h.board.read()).decisions!.map(d => d.id)).toEqual(['deploy:8']); expect((await w.h.secret.read()).dcode).toEqual({ 'deploy:8': 'c0de0002' }); await settle(w.h, 'nope')
  })
  test('every flag.raised asks; flag.resolved settles; a phase that asked first (spec_change) keeps its richer card', async () => {
    const w = await world(); await emit(w.h, 'flag.raised', { taskId: 'a2', flag: 'conflict' }, { taskId: 'a2' })
    expect((await w.h.board.read()).decisions!.map(d => d.id)).toEqual(['flag:a2:conflict'])
    await ask(w.h, dec('flag:a3:spec_change', 'flag', 't', ['why: the API changed'], [OK])); await emit(w.h, 'flag.raised', { taskId: 'a3', flag: 'spec_change' }, { taskId: 'a3' })
    expect((await w.h.board.read()).decisions!.find(d => d.id === 'flag:a3:spec_change')!.lines).toEqual(['why: the API changed'])
    await emit(w.h, 'flag.resolved', { taskId: 'a2', flag: 'conflict,drift' }, { taskId: 'a2' }); expect((await w.h.board.read()).decisions!.map(d => d.id)).toEqual(['flag:a3:spec_change'])
  })
  test('a plan asks when approvable (code in the secret, none on the board) and settles on approve and on reject', async () => {
    const w = await world(), { plan: p } = await plan(w), b = await w.h.board.read(), sec = await w.h.secret.read()
    expect(b.decisions!.map(d => d.id)).toEqual([`plan:${p}`]); expect(JSON.stringify(b)).not.toContain(sec.approval!.code8); expect(sec.dcode![`plan:${p}`]).toBe(sec.approval!.code8)
    await w.text({ cmd: 'approve', args: [`${p}@${sec.approval!.code8}`] }); expect((await w.h.board.read()).decisions).toEqual([])
    const w2 = await world(), r = await plan(w2); await w2.text({ cmd: 'reject', args: [r.plan] }); expect((await w2.h.board.read()).decisions).toEqual([])
  })
  test('init/setup: initPropose asks, a confirm attempt (right or wrong) settles it', async () => {
    const w = await world(), code = await initPropose(w.h, 90, 'p', { title: 'setup plan ready · confirm it', lines: ['  1. x'], sub: 'setup', change: 'setup' })
    const d = (await w.h.board.read()).decisions![0]; expect([d.id, d.fallback, d.options.map(o => o.run)]).toEqual(['init:90', '/cadre setup confirm {code}', ['setup confirm {code}', 'setup cancel', 'setup']]); expect(JSON.stringify(d)).not.toContain(code); expect((await w.h.secret.read()).dcode!['init:90']).toBe(code)
    await dispatch(w.h, { schemaVersion: 1, cmd: 'setup', args: ['cancel'], origin: { kind: 'composer' } }, async () => ({ text: '' })); expect((await w.h.board.read()).decisions).toEqual([])
  })
})

async function ui(w: Awaited<ReturnType<typeof world>>, o: { peek?: string } = {}) {
  const calls: [string, ...any[]][] = [], timers: (() => unknown)[] = []
  const ops = { els: () => ({}), open: async (a: any) => { calls.push(['open', a]); return { isPlaced: true } }, focused: async () => false, toast: (t: string) => { calls.push(['toast', t]) }, notify: async () => ({ isSent: true }), status: () => {},
    peek: async () => o.peek ?? '', fill: async (t: string) => { calls.push(['fill', t]); return { isFilled: true } }, after: (_ms: number, fn: () => unknown) => { timers.push(fn) }, invalidate: () => { calls.push(['inv']) }, blit: async () => {} } as unknown as UiOps
  Object.assign(w.h, { ops, press: (id: string, k: string, hash: string) => press(w.h, id, k, hash) })
  const drain = async () => { while (timers.length) await timers.shift()!() }
  return { calls, drain, of: (k: string) => calls.filter(c => c[0] === k).map(c => c[1]) }
}
const top = async (h: Host) => decisions(await read(h))[0]
const pressOf = async (h: Host, key: string) => { const d = await top(h); return (): void => acts(h).press(d.id, key, d.hash) }   // what the drawn Button does: bound to the hash it was drawn with

describe('presses: one generic handler -> the dispatcher as the human (origin press), bound to the hash drawn with the card', () => {
  test('Approve press approves the plan without typing; the card is gone afterwards', async () => {
    const w = await world(), { task } = await plan(w), u = await ui(w), go = await pressOf(w.h, 'a')
    go(); await u.drain()
    expect((await w.store.get(task)).category).toBe('todo'); expect((await w.h.board.read()).plan?.state).toBe('approved'); expect(decisions(await read(w.h))).toEqual([])
    expect((w.h as any).toasts[0]).toContain('approved')
  })
  test('Reject press drops the plan', async () => {
    const w = await world(); await plan(w); const u = await ui(w), go = await pressOf(w.h, 'x'); go(); await u.drain()
    expect((await w.h.board.read()).plan).toBeNull(); expect((w.h as any).toasts[0]).toContain('dropped')
  })
  test('stale press: the plan changed after the card was drawn -> refused, nothing approved, the card redraws with the new hash and code', async () => {
    const w = await world(), { task } = await plan(w), u = await ui(w), old = await top(w.h), go = await pressOf(w.h, 'a')
    await w.call('TaskUpdate', { taskId: task, subject: 'changed under the card' })
    const fresh = await top(w.h); expect(fresh.hash).not.toBe(old.hash)   // the card re-renders from the board
    go(); await u.drain()
    expect((await w.store.get(task)).category).toBe('draft'); expect((w.h as any).toasts[0]).toContain('review again'); expect(u.of('inv').length).toBe(1)
    expect((await press(w.h, fresh.id, 'a', fresh.hash)).text).toContain('approved')   // the redrawn card works
  })
  test('a press burns the code: replaying the same press after success is refused', async () => {
    const w = await world(); await plan(w); const d = await top(w.h)
    expect((await press(w.h, d.id, 'a', d.hash)).text).toContain('approved'); expect((await press(w.h, d.id, 'a', d.hash)).text).toContain('refused')
  })
  test('Change prefills the composer (empty) with `Change <id>: ` and runs nothing; a non-empty composer is not touched', async () => {
    const w = await world(), { task } = await plan(w); let u = await ui(w)
    const c = (await top(w.h)).options.find(o => o.key === 'c')!; expect(c.fill).toMatch(/^Change [\w-]+: $/); expect(c.run).toBeUndefined()
    acts(w.h).fill(c.fill!); await u.drain(); expect(u.of('fill')).toEqual([c.fill]); expect((await w.store.get(task)).category).toBe('draft')
    u = await ui(w, { peek: 'half-typed' }); acts(w.h).fill(c.fill!); await u.drain(); expect(u.of('fill')).toEqual([]); expect(u.of('toast')[0]).toContain('composer not empty')
  })
  test('a test-only kind presses through its own command with no UI code; a stale hash or unknown key is refused; the code is filled in from the secret', async () => {
    const w = await world(), seen: string[][] = []; ROUTES.deploy = async (_h, c) => { seen.push(c.args); return { text: 'deployed' } }
    await ask(w.h, { ...DEPLOY, options: [{ key: 'd', label: 'Deploy', verb: 'approve', run: 'deploy now {code}' }] }, 'c0de1234')
    expect((await press(w.h, 'deploy:7', 'd', 'stale')).text).toBe('refused: it changed; review again'); expect((await press(w.h, 'deploy:7', 'z', 'h')).text).toContain('refused')
    expect((await press(w.h, 'deploy:7', 'd', 'h')).text).toBe('deployed'); expect(seen).toEqual([['now', 'c0de1234']])  
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
  test('Cancel on a setup card burns its code and says so in one plain line; other origins cannot cancel', async () => {
    const w = await world(); await initPropose(w.h, 90, 'p', { title: 't', lines: ['  1. x'], sub: 'setup', change: 'setup' }); const d = await top(w.h)
    expect((await dispatch(w.h, { schemaVersion: 1, cmd: 'setup', args: ['cancel'], origin: { kind: 'sdk' } }, async () => ({ text: '' }))).text).toContain('refused')
    const r = await press(w.h, d.id, 'x', d.hash); expect(r.text).toBe('setup: cancelled; nothing ran'); expect(banned(r.text)).toEqual([]); expect((await w.h.secret.read()).initConfirm).toBeUndefined(); expect(decisions(await read(w.h))).toEqual([])
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
