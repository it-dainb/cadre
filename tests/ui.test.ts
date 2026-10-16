import { describe, expect, test } from 'claude-code/testing'
import type { CadreEvent, EventType, Host, UiOps } from '../types'
import { TABLE, ring as rebuildRing } from '../core/events'
import { humanView } from '../core/board'
import { band } from '../ui/band'
import { pane } from '../ui/pane'
import { type Line, at, attention, read, txt } from '../ui/model'
import { levelOf, onEvent, textOf } from '../ui/notify'
import { acts, openPane, renderBand, renderCard, renderPane, resumeBanner, tickUi } from '../ui/index'
import { fakeHost } from './support'
import { BASE, MIN, NOOP, approval, planDec, ring, view } from './fixtures/ui/epic'
import { SCENARIOS } from '../scenarios/index'

const segs = (ls: Line[]) => ls.flat()
const E: any = Object.fromEntries(['Box', 'Text', 'Button', 'Raster'].map(n => [n, (p: any) => ({ type: n, props: p })]))
const flat = (n: any): any[] => (n && typeof n === 'object' ? [n, ...(Array.isArray(n) ? n : (n.props?.children ?? []).flatMap?.(flat) ?? flat(n.props?.children))] : [])
const text = (n: any): string => (typeof n === 'string' ? n : n?.props?.children ? [].concat(n.props.children).map(text).join('') : '')

function mk(o: Partial<UiOps> & { t0?: number } = {}) {
  const calls: [string, ...any[]][] = [], timers: { ms: number; fn: () => unknown }[] = []
  const ops: UiOps = {
    els: () => E, open: async a => { calls.push(['open', a]); return { isPlaced: true } }, focused: async () => false, toast: t => { calls.push(['toast', t]) },
    notify: async t => { calls.push(['notify', t]); return { isSent: true } }, status: t => { calls.push(['status', t]) }, peek: async () => '', fill: async t => { calls.push(['fill', t]); return { isFilled: true } },
    after: (ms, fn) => { timers.push({ ms, fn }) }, invalidate: () => { calls.push(['inv']) }, blit: async a => { calls.push(['blit', a]) }, ...o,
  }
  const h: Host = Object.assign(fakeHost({ t0: o.t0 ?? BASE + 62 * MIN, options: { strictness: 'strict' } }), { ops })
  const run = async () => { while (timers.length) await timers.shift()!.fn() }
  const of = (k: string) => calls.filter(c => c[0] === k).map(c => c[1])
  return { h, calls, timers, run, of }
}
async function seed(h: Host, v = view(62)) {
  await h.board.update(() => v.b); await h.events.update(() => ({ seq: v.ring.length, epics: { p3: v.ring } })); await h.secret.update(() => v.sec); await h.ui.update(() => v.ui)
}
const ev = (type: EventType, data: Record<string, unknown>, o: Partial<CadreEvent> = {}): CadreEvent => {
  const [actor, severity, needsHuman] = TABLE[type]
  return { schemaVersion: 1, seq: 1, at: 0, type, actor, severity, needsHuman, data, ...o }
}


describe('replay: pure fold of the ring at the cursor', () => {
  test('the board at 50 min: a3 in review, a2 implementing, a5 still pending, a6 waiting', async () => {
    const b = at(view(62, { t: 50 })), s = (id: string) => b.tasks.find(t => t.id === id)!
    expect([s('a3').state, s('a3').step, s('a2').state, s('a2').step, s('a5').state, s('a6').state, s('a1').state]).toEqual(['review', 'reviewer', 'active', 'worker', 'todo', 'todo', 'done'])
  })
  test('fold at t = now equals the live board: the independent final state of every task (not the fold again)', async () => {
    const live = view(62).b, folded = at(view(62, { t: 62 })), pick = (b: typeof live) => b.tasks.map(t => [t.id, t.state, t.step, t.flags.length])
    expect(pick(folded)).toEqual(pick(live))
    expect(pick(folded).filter(r => r[1] !== 'todo').length).toBeGreaterThan(3)   // a vacuous all-todo fold would also be "equal"
  })
  test('ring rebuilt from records + journal (after /clear) replays the DAG: states at past times', async () => {
    const m = 60_000, h = fakeHost({ t0: 100 * m }), rec = (k: string, min: number, x = '') => [`cadre.rec.${k}`, `${k} @${min * m} ${x}`]
    const tk = (id: string, meta: string[][]) => ({ id, meta: Object.fromEntries(meta) })
    const store: any = { list: async () => [tk('a1', [rec('red', 15), rec('report', 29), rec('review', 35, 'verdict: pass')]), tk('a2', [rec('red', 25)])],
      events: async () => ({ events: [['a1', 'todo', 1], ['a1', 'active', 10], ['a1', 'review', 30], ['a1', 'done', 40], ['a2', 'todo', 1], ['a2', 'active', 20]].map(([id, category, min]) => ({ id, category, at: (min as number) * m })) }) }
    await h.board.update(b => ({ ...b, epic: 'p3', tasks: ['a1', 'a2'].map(id => ({ id, title: id, type: 'feat', kind: 'code', merges: true, state: 'todo', step: '', phaseSince: 0, deps: [], flags: [] })) as any }))
    expect(await rebuildRing(h, store, 'p3')).toBe(8)
    const v = await read(h), f = (min: number) => at({ ...v, t: min * m }).tasks.map(t => `${t.id}:${t.state}/${t.step}`).join(' ')
    expect(f(12)).toBe('a1:active/ a2:todo/')
    expect(f(22)).toBe('a1:active/worker a2:active/')
    expect(f(32)).toBe('a1:review/reviewer a2:active/worker')
    expect(f(50)).toBe('a1:done/merge a2:active/worker')
  })
})

describe('keys', () => {
  test('band: key 1 only while a decision waits (the drive cell has its own key)', async () => {
    expect(segs(band(view(62), 115, NOOP)).filter(s => s.hk === '1')).toHaveLength(0)
    expect(segs(band(approval(), 115, NOOP)).filter(s => s.hk === '1')).toHaveLength(1)
    expect(segs(band(view(82), 115, NOOP)).filter(s => s.hk === '1')).toHaveLength(1)
  })
  test('presses route to handlers: 1 opens the decision\'s dialog (approval, git flag)', async () => {
    const got: string[] = [], a = { go: (t: string) => { got.push(`go:${t}`) }, pick: (i: string) => { got.push(`pick:${i}`) }, answer: (id: string) => { got.push(`answer:${id}`) }, step: () => {} }
    segs(band(approval(), 115, a)).find(s => s.hk === '1')!.p!(); segs(band(view(82), 115, a)).find(s => s.hk === '1')!.p!()
    expect(got).toEqual(['answer:plan:p3', expect.stringMatching(/^answer:flag:/)])
  })
  // live 0.9.1: the [-] at the band's corner is Claude Code's own (it folds the band away); a click on the plan in the band opens the pane
  test('a click on the plan in the band opens the pane', async () => {
    const got: string[] = [], a = { go: (t: string) => { got.push(`go:${t}`) }, pick: () => {}, answer: () => {}, step: () => {} }
    segs(band(view(62), 115, a)).find(s => s.k === 'pane')!.p!(); expect(got).toEqual(['go:epic'])
  })
})

describe('notification policy (UI-DESIGN 4)', () => {
  const rows: [EventType, Record<string, unknown>, number, string | undefined][] = [
    ['approval.pending', { planId: 'p3', missing: [], rev: 'r1' }, 3, 'approve:p3:r1'], ['flag.raised', { taskId: 'a7', flag: 'drift:pm:status' }, 3, 'flag:a7:drift:pm:status'],
    ['task.transitioned', { taskId: 'a6', from: 'active', to: 'blocked', hash: 'h' }, 3, 'q:a6:h'], ['task.transitioned', { taskId: 'a1', from: 'review', to: 'done' }, 1, undefined],
    ['task.phase_changed', { taskId: 'a1', from: 'tester', to: 'red' }, 0, undefined], ['task.transitioned', { taskId: 'a2', from: 'review', to: 'active' }, 1, undefined], ['task.transitioned', { taskId: 'a2', from: 'active', to: 'review' }, 0, undefined], ['sync.state_changed', { target: 'pm', state: 'ok', conflicts: 1, at: 1 }, 2, 'off:pm'], ['check.ran', { taskId: 'a1', name: 'test', ok: false }, 1, undefined], ['check.ran', { taskId: 'a1', name: 'test', ok: true }, 1, undefined],
    ['sync.state_changed', { target: 'pm', state: 'offline', at: 1 }, 2, 'off:pm'], ['sync.state_changed', { target: 'pm', state: 'ok', at: 1 }, 1, 'off:pm'],
    ['drive.status', { state: 'paused', reason: 'approve p4' }, 3, 'drive:paused'], ['drive.status', { state: 'finished' }, 3, 'drive:finished'], ['drive.status', { state: 'armed' }, 0, undefined], ['drive.status', { state: 'stopped', reason: 'turn limit' }, 3, 'drive:stopped:0'],
    ['cost.updated', { tokens: 1 }, 0, undefined], ['cost.updated', { tokens: 1, threshold: 80 }, 2, 'cost:80'], ['init.stage', { stage: 4, state: 'proposed' }, 2, 'init:4'],
    ['agent.unbound', { agentId: 'g', reason: 'stale' }, 1, undefined], ['agent.unbound', { agentId: 'g', reason: 'answer' }, 0, undefined], ['agent.bound', { agentId: 'g', taskId: 'a1', role: 'worker' }, 0, undefined],
  ]
  test('matrix: level and dedupe key per event', async () => {
    for (const [type, data, lvl, key] of rows) { const e = ev(type, data, { taskId: data.taskId as string | undefined }); expect([type, levelOf(e)]).toEqual([type, lvl]); expect(textOf(e)?.key).toBe(key) }
    expect(textOf(ev('approval.pending', { planId: 'p3', missing: [] }))!.text).toBe('Plan p3 ready for approval · press 1')
    expect(textOf(ev('drive.status', { state: 'finished' }))!.text).toBe('Landed on dev ✓')
    expect([levelOf(ev('plan.landed', { planId: 'e2', sha: 'x', on: 'milestone/m1-accounts' })), textOf(ev('plan.landed', { planId: 'e2', sha: 'x', on: 'milestone/m1-accounts' }))!.text]).toEqual([2, 'Epic e2 landed on milestone/m1-accounts ✓'])
    expect(levelOf(ev('plan.landed', { planId: 'm1', sha: 'x' }))).toBe(0)
    expect(textOf(ev('drive.status', { state: 'stopped', reason: 'turn limit' }))!.text).toBe('drive stopped · turn limit · 0: resume')
    expect(textOf(ev('drive.status', { state: 'stopped', reason: 'a very long reason that does not fit in a toast at all, really' }))!.text.length).toBeLessThanOrEqual(60)
  })
  test('dedupe: one toast per open item; a resolve re-arms it', async () => {
    const { h, of } = mk(), f = (at: number) => ev('flag.raised', { taskId: 'a7', flag: 'drift:pm:status' }, { taskId: 'a7', at })
    await onEvent(h, f(0)); await onEvent(h, f(20_000)); expect(of('toast')).toEqual(['a7 flagged drift:pm:status · press 1'])
    await onEvent(h, ev('flag.resolved', { taskId: 'a7', flag: 'drift:pm:status' }, { taskId: 'a7', at: 21_000 })); await onEvent(h, f(40_000)); expect(of('toast')).toHaveLength(2)
  })
  test('rate: at most one toast per 8 s; the rest merge into "N updates"', async () => {
    const { h, of, timers, run } = mk()
    await onEvent(h, ev('sync.state_changed', { target: 'pm', state: 'offline', at: 0 }, { at: 0 }))
    await onEvent(h, ev('flag.raised', { taskId: 'a1', flag: 'f1' }, { taskId: 'a1', at: 1000 })); await onEvent(h, ev('flag.raised', { taskId: 'a2', flag: 'f2' }, { taskId: 'a2', at: 2000 }))
    expect(of('toast')).toEqual(['pm offline · retrying']); expect(timers.filter(t => t.ms === 7000)).toHaveLength(1)
    await run(); expect(of('toast')[1]).toBe('2 updates: a1 flagged f1 · press 1 · a2 flagged f2 · press 1')
    await onEvent(h, ev('flag.raised', { taskId: 'a3', flag: 'f3' }, { taskId: 'a3', at: 30_000 })); expect(of('toast')).toHaveLength(3)
  })
  test('a merged toast never offers a settled item: flagged, answered (Keep clears "loop,drift") inside the 8 s window', async () => {
    const { h, of, run } = mk()
    await onEvent(h, ev('sync.state_changed', { target: 'pm', state: 'offline', at: 0 }, { at: 0 }))
    await onEvent(h, ev('flag.raised', { taskId: 'c6', flag: 'loop' }, { taskId: 'c6', at: 1000 })); await onEvent(h, ev('drive.status', { state: 'paused', reason: 'blocked c6' }, { at: 1500 }))
    await onEvent(h, ev('flag.resolved', { taskId: 'c6', flag: 'loop,drift' }, { taskId: 'c6', at: 3000 }))
    await run(); expect(of('toast')[1]).toBe('Drive paused: blocked c6'); expect(of('toast').join()).not.toContain('press 1')
  })
  test('escalation: unacked after 120 s goes to OS notify once; an ack cancels it; drive paused notifies immediately', async () => {
    const a = mk(), f = (id: string, at: number) => ev('flag.raised', { taskId: id, flag: 'g' }, { taskId: id, at })
    await onEvent(a.h, f('a1', 1000)); expect(a.of('notify')).toHaveLength(0); expect(a.timers.map(t => t.ms)).toEqual([120_000]); await a.run(); expect(a.of('notify')).toEqual(['a1 flagged g · press 1'])
    const b = mk(); await onEvent(b.h, f('a1', 1000)); await b.h.ui.update(u => ({ ...u, ack: 5000 })); await b.run(); expect(b.of('notify')).toHaveLength(0)
    const c = mk(); await onEvent(c.h, ev('drive.status', { state: 'paused', reason: 'approve p4' }, { at: 0 })); expect(c.of('notify')).toEqual(['Drive paused: approve p4'])
    const d = mk(); await onEvent(d.h, ev('drive.status', { state: 'stopped', reason: 'turn limit' }, { at: 5 })); await onEvent(d.h, ev('drive.status', { state: 'stopped', reason: 'turn limit' }, { at: 5 })); expect(d.of('notify')).toEqual(['drive stopped · turn limit · 0: resume'])   // deduped per stop
  })
  test('OS notify: ≤3 per 15 min, never while the pane is focused, off with ui.notify off, toast when unsent', async () => {
    const a = mk(); for (let i = 0; i < 5; i++) await onEvent(a.h, ev('flag.raised', { taskId: `t${i}`, flag: 'g' }, { taskId: `t${i}`, at: 1000 + i * 10 })); await a.run(); expect(a.of('notify')).toHaveLength(3)
    const f = mk({ focused: async () => true }); await onEvent(f.h, ev('flag.raised', { taskId: 't', flag: 'g' }, { taskId: 't', at: 1000 })); await f.run(); expect(f.of('notify')).toHaveLength(0)
    const o = mk(); await o.h.ui.update(u => ({ ...u, cfg: { notify: 'off' } })); await onEvent(o.h, ev('flag.raised', { taskId: 't', flag: 'g' }, { taskId: 't', at: 1000 })); await o.run(); expect(o.of('notify')).toHaveLength(0)
    const u = mk({ notify: async () => ({ isSent: false }) }); await onEvent(u.h, ev('flag.raised', { taskId: 't', flag: 'g' }, { taskId: 't', at: 1000 })); await u.run(); expect(u.of('toast')).toHaveLength(2)
  })
  test('status line is attention-only: set with a top item, cleared (undefined) when none', async () => {
    const a = mk(); await seed(a.h, view(82)); await onEvent(a.h, ev('flag.raised', { taskId: 'a6', flag: 'git:dev:agent' }, { taskId: 'a6', at: 0 }))
    expect(a.of('status').pop()).toMatch(/^dev moved outside a cadre merge · .* · press 1$/)
    const b = mk(); await seed(b.h, view(62)); await onEvent(b.h, ev('task.phase_changed', { taskId: 'a2', from: 'a', to: 'b' }, { at: 0 })); expect(b.of('status').pop()).toBeUndefined()
    const c = mk(); await seed(c.h, view(62)); await c.h.board.update(x => ({ ...x, containment: { state: 'degraded', unsandboxed: 1 } })); await onEvent(c.h, ev('task.phase_changed', { taskId: 'a2', from: 'a', to: 'b' }, { at: 0 }))
    expect(c.of('status').pop()).toBe('Containment degraded · run /cadre init')   // a state, not a decision: no dialog would open, so no "press 1"
    const d = mk(); await seed(d.h, view(82)); await onEvent(d.h, ev('flag.raised', { taskId: 'a6', flag: 'git:dev:agent' }, { taskId: 'a6', at: 0 })); const top = attention(await read(d.h))[0]
    await d.h.ui.update(u => ({ ...u, answering: top.d!.id })); expect(attention(await read(d.h)).map(i => i.key)).not.toContain(top.key)   // answered: its command runs, nothing offers it again (live: an approval's seconds of store calls)
  })
})

describe('secrets: nothing secret is drawn or stored (ADR 0012)', () => {
  test('the band, the board, status line, toasts, notify, log, ring and human view carry no code', async () => {
    const a = mk(), v = approval(62); await seed(a.h, v)
    for (const e of [ev('approval.pending', { planId: 'p3', missing: [] }, { at: 0 }), ev('flag.raised', { taskId: 'a1', flag: 'g' }, { taskId: 'a1', at: 20_000 }), ev('drive.status', { state: 'paused', reason: 'approval' }, { at: 40_000 })]) await onEvent(a.h, e)
    await a.run()
    const outside = JSON.stringify([a.calls, (a.h as any).logs, txt(pane({ ...v, ui: { tab: 'board' } }, 118, 40, NOOP).before), ring(), humanView(v.b), v.ring, txt(band(v, 115, NOOP))])
    expect(outside).not.toMatch(/code8|[0-9a-f]{8}@|\/cadre approve/); expect(await a.h.secret.read()).toEqual({})
  })
  test('`1` on the Board opens the plan\'s dialog, bound to its hash; the work starts in after(1)', async () => {
    const a = mk(), v = approval(62); await seed(a.h, v); const answered: unknown[][] = []; a.h.answer = async (...x) => { answered.push(x); return { text: 'ok' } }; a.h.ask = async (_q, ls) => ls[0]
    const h = (v.b.decisions ?? [])[0].hash, one = segs(pane({ ...v, ui: { tab: 'board' } }, 116, 40, acts(a.h)).before).find(s => s.hk === '1')!
    one.p!(); expect(answered).toEqual([]); expect(a.timers.map(t => t.ms)).toEqual([1]); await a.run()
    expect(answered).toEqual([['plan:p3', 'a', h, {}]]); expect(a.of('fill')).toEqual([])
  })
})

describe('render hooks, handlers, fallbacks', () => {
  const next = (e: any) => ({ type: 'engine', e })
  test('band: yields to surveys, agent views and calm; otherwise wraps next(e) in a column', async () => {
    const a = mk(); await seed(a.h, approval(62))
    expect(await renderBand(a.h, { props: { hasSurvey: true, bodyColumns: 115 } }, next)).toEqual({ type: 'engine', e: { props: { hasSurvey: true, bodyColumns: 115 } } })
    expect((await renderBand(a.h, { props: { view: { agentId: 'x' }, bodyColumns: 115 } }, next)).type).toBe('engine')
    const t = await renderBand(a.h, { props: { bodyColumns: 115 } }, next); expect(t.type).toBe('Box'); expect(t.props.children.at(-1).type).toBe('engine'); expect(flat(t).filter((n: any) => n.type === 'Button').map((n: any) => n.props.hotkey).sort()).toEqual(['1'])
    const calm = mk(); expect((await renderBand(calm.h, { props: { bodyColumns: 115 } }, next)).type).toBe('engine')
  })
  test('pane: the timeline tab draws one Raster sized to the body, base64 cells; the 30 s tick asks for a redraw', async () => {
    const a = mk(); await seed(a.h, view(62, { ui: { tab: 'timeline' } })); const t = await renderPane(a.h, { surface: 'terminal', props: { bodyColumns: 118, scroll: { bodyRows: 40 } } })
    const r = flat(t).find((n: any) => n.type === 'Raster'); expect([r.props.key, r.props.columns, r.props.cells.length]).toEqual(['tl', 118, 4 * Math.ceil(118 * r.props.rows * 12 / 3)])
    await tickUi(a.h); expect(a.of('inv').length).toBeGreaterThan(0)
  })
  test('M10: the tick copies the resolved strictness into the ui atom; the render reads it (the hook cannot read env/config)', async () => {
    const a = mk(); await seed(a.h); a.h.config = async () => ({ strictness: 'advisory' }) as any
    expect((await read(a.h)).sx).toBe('strict'); await tickUi(a.h); expect((await read(a.h)).sx).toBe('advisory')
  })
  test('the tick re-reads the theme (/theme after session start): the Raster palette follows it', async () => {
    const a = mk(); await seed(a.h); a.h.theme = async () => 'light'
    await tickUi(a.h); expect(((await read(a.h)).ui.cfg as { theme?: string }).theme).toBe('light')
    a.h.theme = async () => 'dark'; await openPane(a.h, 'board'); expect(((await read(a.h)).ui.cfg as { theme?: string }).theme).toBe('dark')   // a pane open re-reads it too (the tick only runs while a plan is active)
  })
  test('openPane: tab + focus request; where nothing draws the dialog opens instead', async () => {
    const a = mk(); await seed(a.h, approval(62)); await openPane(a.h, 'board')
    expect(a.of('open')).toEqual([{ id: 'cadre', title: 'cadre', focus: true, columns: 120 }]); expect(await read(a.h).then(v => v.ui.tab)).toBe('board'); expect((a.h as any).logs).toHaveLength(0)
    const b = mk({ open: async () => ({ isPlaced: false, reason: 'no room' }) }); await seed(b.h, approval(62)); await openPane(b.h, 'board')
    expect((b.h as any).toasts[0]).toContain('no room')
    const c = mk({ open: async () => { throw new Error('ui.open refused: no pane surface') } }); await seed(c.h, approval(62)); await openPane(c.h, 'board')   // a rejected open used to vanish
    expect((c.h as any).toasts[0]).toBe('pane not shown · ui.open refused: no pane surface'); expect((await read(c.h)).ui.paneErr).toMatchObject({ reason: 'ui.open refused: no pane surface' })
    await openPane(a.h, 'board'); expect((await read(a.h)).ui.paneErr).toBeUndefined()
  })
  test('handlers: n/p select, h/l move the cursor (live at the edge), e = live, done toggle, key sheet toggle', async () => {
    const a = mk(); await seed(a.h); const x = acts(a.h), st = async (w: string, d = 0) => { x.step(w, d); await a.run(); return read(a.h) }
    expect((await st('node', 1)).ui.sel).toBe('a3'); expect((await st('node', 1)).ui.sel).toBe('a6'); expect((await st('node', -1)).ui.sel).toBe('a3')
    const t1 = (await st('time', -1)).t as number; expect(t1).toBeLessThan(BASE + 62 * MIN); expect(t1).toBeGreaterThan(BASE); expect((await st('time', 1)).t).toBe(null)
    await st('time', -1); expect((await st('live')).t).toBe(null)
    expect((await st('keys')).ui.ks).toBe(true); expect((await st('keys')).ui.ks).toBe(false); expect((await st('done')).ui.dn).toBe(true)
  })
  test('result-card row: engine row while running or unmapped; else a glyphed row + next line', async () => {
    const a = mk(), v = view(62, { tweak: ts => ts.map(t => (t.id === 'a1' ? { ...t, card: 'worker → review  a1 "Add login"  green ✓ test 41s\nnext: spawn reviewer for a1' } : t)), ui: { cards: { tu1: 'a1' } } }); await seed(a.h, v)
    expect((await renderCard(a.h, { props: { tool_use_id: 'tu1', isRunning: true } }, next)).type).toBe('engine'); expect((await renderCard(a.h, { props: { tool_use_id: 'zz', isRunning: false } }, next)).type).toBe('engine')
    const t = await renderCard(a.h, { props: { tool_use_id: 'tu1', isRunning: false } }, next); expect(text(t)).toBe('⏺ ✓ worker → review  a1 "Add login"  green ✓ test 41s  next: spawn reviewer for a1')
  })
  test('resume banner: one transcript line, plain words (the band carries the drive state)', async () => {
    const a = mk(); await seed(a.h, view(62, { board: { resumesQueued: 1, drive: { on: false, level: 'epic', epicId: null, turns: 0, costUsd: 0, startedAt: null } } })); await resumeBanner(a.h, { decisions: 5, next: 'complete a5', stale: 1 })
    expect((a.h as any).logs[0]).toBe('✓ resumed · mission "Auth v2" · epic p3 · 1 running (re-adopted) · 1 stale → rebind · 1 queued · next: complete a5')
  })
  test('resume banner with no recorded mission: no "null" in the line', async () => {
    const a = mk(); await seed(a.h, view(62, { board: { mission: null, resumesQueued: 0 } })); await resumeBanner(a.h, {})
    expect((a.h as any).logs[0]).not.toContain('null'); expect((a.h as any).logs[0]).toMatch(/^✓ resumed · epic p3 · /)
  })
})


// H2 and M4 (0.9.0 review)
describe('replay entry and blocked tasks (0.9.0 review)', () => {
  test('H2: from live the timeline offers h (back) and s (start); pressing h asks for a step back', async () => {
    const calls: string[] = [], v = { ...SCENARIOS['v2-driving-yolo'], ui: { ...SCENARIOS['v2-driving-yolo'].ui, tab: 'timeline' } }
    const p = pane(v, 120, 40, { ...NOOP, step: (w: string, d: number) => calls.push(`${w} ${d}`) }), keys = [...p.before, ...p.after].flat().filter(s => s.hk)
    expect(keys.map(s => s.hk)).toEqual(expect.arrayContaining(['h', 's'])); keys.find(s => s.hk === 'h')!.p!()
    expect(calls).toEqual(['time -1'])
  })
  test('yolo: a flag drive does not hold on, and a blocked task, are silent (no toast, no "press 1"); held flags still notify', () => {
    const f = (flag: string) => ev('flag.raised', { taskId: 'a2', flag }, { taskId: 'a2', needsHuman: true })
    expect([levelOf(f('auto-reported'), true), levelOf(f('auto-reported')), levelOf(f('spec_change'), true), levelOf(f('rework:a2'), true), levelOf(f('git:dev:agent'), true)]).toEqual([0, 3, 0, 3, 3])
    expect(levelOf(ev('task.transitioned', { to: 'blocked' }, { taskId: 'a2' }), true)).toBe(0)
  })
  test('the downgrade of yolo to auto shows on the drive cell and in Doctor', () => {
    const s = SCENARIOS['v2-driving-yolo'], v = { ...s, b: { ...s.b, plan: { ...s.b.plan!, mode: 'yolo' as const }, drive: { ...s.b.drive, mode: 'auto' as const } } }
    expect(txt(band(v, 120, NOOP)).join('\n')).toContain('auto (yolo needs containment) · turn')
    expect(txt(pane({ ...v, ui: { ...v.ui, tab: 'doctor' } }, 120, 40, NOOP).before).join('\n')).toContain('auto (yolo needs containment)')
  })
  test('M4: a blocked task is "needs you" only when a human is asked: not under yolo, and once with its own decision', () => {
    const b = SCENARIOS['v2-board'].b, mk = (x: object) => attention({ ...SCENARIOS['v2-board'], b: { ...b, ...x } }).filter(i => i.key.startsWith('q:'))
    const blocked = b.tasks.map(t => (t.id === 'a2' ? { ...t, state: 'blocked' as const } : t))
    expect(mk({ tasks: blocked, decisions: [] })).toHaveLength(1)
    expect(mk({ tasks: blocked, decisions: [{ id: 'flag:a2:spec_change', kind: 'flag', title: 't', lines: [], hash: 'h', options: [], sel: 'a2' }] })).toHaveLength(0)
    expect(mk({ tasks: blocked, decisions: [], drive: { ...b.drive, on: true, mode: 'yolo' } })).toHaveLength(0)
  })
})
