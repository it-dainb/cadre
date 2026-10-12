import { describe, expect, test } from 'claude-code/testing'
import type { CadreEvent, EventType, Host, UiOps } from '../types'
import { TABLE, ring as rebuildRing } from '../core/events'
import { humanView } from '../core/board'
import { band } from '../ui/band'
import { dag } from '../ui/epic'
import { pane } from '../ui/pane'
import { sheet } from '../ui/sheet'
import { type Line, T, at, gl, read, txt } from '../ui/model'
import { levelOf, onEvent, textOf } from '../ui/notify'
import { acts, openPane, prefill, renderBand, renderCard, renderPane, resumeBanner, tickUi } from '../ui/index'
import { fakeHost } from './support'
import { BASE, CASES, withStub, MIN, NOOP, SHEET, approval, planDec, ring, rtrim, view } from './fixtures/ui/epic'
import { GOLDEN } from './fixtures/ui/golden'
import { WIRE } from './fixtures/ui/wireframes'

const sq = (ls: string[]) => ls.map(l => l.replace(/─{10,}/g, '─').replace(/\s+/g, ' ').trim())
// v1 draws tabs Epic + Plan + Doctor (8, post-v1: the setup/doctor report, ADR 0007) only (UI-DESIGN 5: 2/3/4 are later); the wireframe's Epic⚑ at 62 m has no attention item behind it (its own band is calm); sheet ids are bd-<id> in the wireframe; the human timeline lane (`*o`: a plan-ready toast and an approve that has no event type) is not compared, nor the last future column of the sync outage (drawn one column long)
const v1 = (ls: string[]) => sq(ls).filter(l => !/^(human|hum) /.test(l)).map(l => l.replace(/^(syn .*?)╌+$/, '$1').replace(' 2: Task 3: Sync 4: Cost', '').replace(/ 8: ?Doctor/, '').replace(' 2:Task', '').replace('Epic⚑', 'Epic').replace(/bd-/g, '')).map(l => l.replace(/^(Enter\/)?n\/p( node)?: select node.*$|^n\/p node ·.*$|^(n: next|n: node) .*$/, 'KEYS').replace('1:Epic 7:Plan', '1: Epic 7: Plan').replace('n: next task p: prev task', 'n/p: task').replace(/n: next p: prev(?= ·|$)|n: next p: prev$/, 'n/p'))   // ADR 0008: the engine draws `key: label`, so the footer keys are labelled Buttons (same keys, same groups)
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

describe('goldens (wireframes of UI-DESIGN 6)', () => {
  for (const k of Object.keys(GOLDEN)) test(k, async () => { expect(rtrim(CASES[k]())).toEqual(GOLDEN[k]) })
  test('band matches the approved wireframes modulo spacing (working, attention, critical, landed, narrow)', async () => {
    expect(sq(txt(band(view(62, { board: { resumesQueued: 1 } }), 115, NOOP)))).toEqual(sq(WIRE['Band, working|120']))
    expect(sq(txt(band(approval(), 115, NOOP)))).toEqual(sq(WIRE['Band, attention (approval)|120']))
    expect(sq(txt(band(view(82), 115, NOOP)))).toEqual(sq(WIRE['Band, attention (critical flag)|120']))
    expect(sq(txt(band(view(95, { ui: { ctx: 41, rel: 'v1.4.0' }, board: { cost: { tokens: 1, cachePct: 88 } } }), 115, NOOP)))).toEqual(sq(WIRE['Band, epic landed|120']))
    expect(sq(txt(band(approval(), 55, NOOP))).slice(0, 2)).toEqual(sq(WIRE['Band, attention (narrow)|60']).slice(0, 2))
    expect(txt(band(view(62), 55, NOOP))).toEqual(['[RUN] p3 ✓✓✓│▶✓│⏸◌ 4/7 ▶1 ⏸1 ctx34%'])
  })
  test('epic + approval sheet match the approved wireframes modulo spacing (live wide, replay stacked, sheet wide, narrow, amended)', async () => {
    const full = (p: ReturnType<typeof pane>) => [...txt(p.before), ...p.tl!.rows, ...txt(p.after)], rel = { rel: 'v1.4.0' }
    expect(v1(full(pane(view(62, { ui: rel }), 118, 40, NOOP)))).toEqual(v1(WIRE['Epic view, live, wide|120']))
    expect(v1(full(pane({ ...view(62, { t: 50 }), ring: view(95).ring }, 58, 40, NOOP)))).toEqual(v1(WIRE['Epic view, replay t-12m, stacked|60']))
    expect(v1(txt(sheet(approval(), 116, NOOP)))).toEqual(v1(WIRE['Approval sheet, wide|120']))
    expect(v1(txt(sheet(approval(), 56, NOOP)))).toEqual(v1(WIRE['Approval sheet, narrow|60']))
    const am = v1(CASES['sheet amended|56']()), w = v1(WIRE['Approval sheet, amended while open|60'])
    expect([am[0], am[1], am.at(-1)]).toEqual([w[0], w[1], w.at(-1)])
  })
  test('band: idle with no plan draws nothing; under 50 columns only line 1; long strips fold the done end', async () => {
    const v = view(0); expect(band({ ...v, b: { ...v.b, plan: null } }, 115, NOOP)).toEqual([])
    expect(band(view(62), 45, NOOP)).toHaveLength(1)
    const many = view(62, { tweak: ts => [...ts, ...Array.from({ length: 12 }, (_, i) => ({ ...ts[0], id: `x${i}`, state: 'done' as const }))] })
    expect(txt(band(many, 100, NOOP))[1]).toMatch(/\+\d+✓/)
  })
  test('every drawn mark has an ASCII form: no unicode glyphs left with ui.glyphs: ascii', async () => {
    const v = view(62, { cfg: { glyphs: 'ascii' } }), p = pane(v, 118, 40, NOOP)
    const all = [...txt(band(v, 115, NOOP)), ...txt(p.before), ...p.tl!.rows.map(r => T(v.c, r)), ...txt(p.after)].join('\n')
    expect(/[⚑✓✗⚠▶⏸◌↻●◉○━┃┏┓┗┛─│┄▷▼█▒░╌╭╮╰╯]/.test(all)).toBe(false)
    expect(gl(v.c, 'ready')).toBe('o'); expect(gl(v.c, 'attn')).toBe('!')
  })
})

describe('Epic view', () => {
  const g = txt(dag(view(62), 'a2', [], NOOP)).join('\n')
  test('typed edges: live blocks ━━▶, pending blocks ──▶, conditional ┄▷', async () => {
    expect(g).toContain('━━┳━▶'); expect(g).toContain('┄▷'); expect(g).toMatch(/──[┳┬]━?─?▶/)
    expect(txt(dag(view(62), 'a2', [], NOOP)).filter(l => l.includes('┄▷')).length).toBe(1)
  })
  test('skipped node: IDLE tag, ○ strip, word "skipped"; wait words name the dependency', async () => {
    expect(g).toMatch(/a5 fix\s+\[IDLE\]◌/); expect(g).toContain('○○○○○○ skipped'); expect(g).toContain('○○○○○○ waits a2')
    expect(txt(pane(view(62, { t: 50 }), 58, 40, NOOP).before).join('\n')).toContain('waits a2 a3')
  })
  test('selected = heavy border; just-changed = double border + » word «; none when more than 3 flash', async () => {
    const f = txt(dag(view(62), 'a1', ['a2'], NOOP)).join('\n')
    expect(f).toContain('┏━━') ; expect(f).toContain('╔════════════════╗'); expect(f).toContain('» implement «')
    const v = view(62, { cfg: { flash: true } }), now = v.now
    const ph = (id: string) => ({ ...v.b.tasks.find(t => t.id === id)!, phaseSince: now - 500 })
    const one = pane({ ...v, b: { ...v.b, tasks: v.b.tasks.map(t => (t.id === 'a2' ? ph('a2') : t)) } }, 118, 40, NOOP)
    expect(txt(one.before).join('\n')).toContain('╔');
    const four = pane({ ...v, b: { ...v.b, tasks: v.b.tasks.map(t => (['a1', 'a2', 'a3', 'a4'].includes(t.id) ? ph(t.id) : t)) } }, 118, 40, NOOP)
    expect(txt(four.before).join('\n')).not.toContain('╔')
    const off = pane({ ...v, c: { ...v.c, flash: false }, b: { ...v.b, tasks: v.b.tasks.map(t => (t.id === 'a2' ? ph('a2') : t)) } }, 118, 40, NOOP)
    expect(txt(off.before).join('\n')).not.toContain('╔')
  })
  test('every node id row is a Button (engine focus ring); nodes press to select', async () => {
    const picked: string[] = [], bs = segs(dag(view(62), 'a2', [], { ...NOOP, pick: id => { picked.push(id) } })).filter(s => s.k)
    expect(bs.map(s => s.k).sort()).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'].map(x => `n:${x}`))
    bs.find(s => s.k === 'n:a3')!.p!(); expect(picked).toEqual(['a3'])
  })
  test('rail follows plan state (epic run -> dev -> main) and layout flips at 116 columns', async () => {
    const wide = txt(pane(view(62), 118, 40, NOOP).before).join('\n'), stk = txt(pane(view(62), 100, 40, NOOP).before).join('\n')
    expect(wide).toContain('epic/p3'); expect(stk).toContain('rail  epic/p3 [RUN]▶ → dev [WAIT]⏸ → main [WAIT]⏸'); expect(stk).toContain('DEPTH 1  after a1'); expect(wide).not.toContain('DEPTH')
    expect(txt(pane(view(95), 100, 40, NOOP).before).join('\n')).toContain('rail  epic/p3 [OK]✓ → dev [OK]✓ → main [WAIT]⏸')
  })
  test('collapse: timeline folds below 34 body rows, log to 2 rows below 22', async () => {
    expect(pane(view(62), 118, 30, NOOP).tl).toBeUndefined(); expect(pane(view(62), 118, 40, NOOP).tl).toBeDefined()
    const logRows = (p: ReturnType<typeof pane>) => txt(p.before).filter(l => /^ ?\d+m [.o*!] /.test(l.slice(86)) || /^ ?\d+m [.o*!] /.test(l)).length
    expect(logRows(pane(view(62), 100, 18, NOOP))).toBe(2); expect(logRows(pane(view(62), 100, 40, NOOP))).toBe(6)
    expect(pane(view(62, { ui: { tl: false } }), 118, 40, NOOP).tl).toBeUndefined()
  })
  test('desktop (no Raster): the timeline header says terminal only', async () => {
    const p = pane(view(62), 118, 40, NOOP, false); expect(p.tl).toBeUndefined(); expect(txt(p.before).join('\n')).toContain('timeline: terminal only')
  })
  test('detail strip: pipeline marks, typed deps, unblocks', async () => {
    const d = txt(pane(view(62), 118, 40, NOOP).before).join('\n')
    expect(d).toContain('spec● red● impl◉ green○'); expect(d).toContain('review○ merged○'); expect(d).toContain('after a1 [OK] ━ live edge'); expect(d).toContain('unblocks a6')
  })
})

describe('v1 gaps: stubs and go-to-id', () => {
  test('non-adjacent dependency: ↷ stub on both ends, none for adjacent edges', async () => {
    const g = txt(dag(view(62, { tweak: withStub }), 'a2', [], NOOP)).join('\n')
    expect(g.split('↷').length - 1).toBe(2); expect(g).toMatch(/a8 docs/)
    expect(txt(dag(view(62), 'a2', [], NOOP)).join('\n')).not.toContain('↷')
  })
  test('g opens an Input; a known id selects, an unknown one just closes it', async () => {
    const got: string[] = [], a = { ...NOOP, pick: (i: string) => { got.push(`pick:${i}`) }, step: (w: string) => { got.push(`step:${w}`) } }
    const f = (go: boolean) => segs(pane(view(62, { ui: { go } }), 118, 40, a).after)
    expect(f(false).some(s => s.inp)).toBe(false); expect(f(false).some(s => s.hk === 'g')).toBe(true)
    const i = f(true).find(s => s.inp)!; i.inp!('a3'); i.inp!('zz'); expect(got).toEqual(['pick:a3', 'step:go'])
  })
})

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
  test('header [REPLAY t-12m], actions off, future spans ╌, keys h/l/b/f/e still live', async () => {
    const p = pane(view(62, { t: 50 }), 58, 40, NOOP), t = txt(p.before).join('\n')
    expect(t).toContain('[REPLAY t-12m]'); expect(t).toContain('(actions off)'); expect(p.tl!.rows.join('\n')).toContain('╌')
    expect(segs(p.after).filter(s => s.hk).map(s => s.hk).sort()).toEqual(['b', 'e', 'f', 'g', 'h', 'l', 'n', 'p', 't'])
    expect(txt(pane(view(62), 118, 40, NOOP).before)[0]).toContain('[LIVE]')
  })
  test('prefill buttons are off in replay: the sheet footer is read-only', async () => {
    const live = sheet(approval(), 100, NOOP), past = sheet({ ...approval(), t: BASE + 10 * MIN }, 100, NOOP)
    expect(segs(live).filter(s => s.k === 'a' || s.k === 'x')).toHaveLength(2); expect(segs(past).filter(s => s.k === 'a' || s.k === 'x')).toHaveLength(0)
  })
})

describe('keys', () => {
  test('band: only key 1, and only while attention exists; none when calm (no typed line, no d)', async () => {
    expect(segs(band(view(62), 115, NOOP)).filter(s => s.hk)).toHaveLength(0)
    expect(segs(band(approval(), 115, NOOP)).filter(s => s.hk).map(s => s.hk).sort()).toEqual(['1'])
    expect(segs(band(view(82), 115, NOOP)).filter(s => s.hk).map(s => s.hk)).toEqual(['1'])
  })
  test('attention: degraded containment is a [CRIT] item; a gate approval reads "approve gate <id>"', async () => {
    const v = view(62, { board: { containment: { state: 'degraded', unsandboxed: 0 } } })
    expect(txt(band(v, 115, NOOP))[0]).toContain('[CRIT] ✗ Containment degraded · run /cadre init')
    const g = view(62, { board: { decisions: [{ ...planDec(), id: 'gate:a6', kind: 'gate', title: 'approve gate a6 · Remember me' }] } })
    expect(txt(band(g, 115, NOOP))[0]).toMatch(/approve gate a6 .*1: open/); expect(txt(band(g, 115, NOOP)).join('\n')).not.toContain('/cadre approve')
  })
  test('attention: a pending init diff is a band row with the open button and no typed line, also before any plan exists', async () => {
    const v = view(62, { board: { containment: { state: 'degraded', unsandboxed: 0 }, decisions: [{ ...planDec(), id: 'init:4', kind: 'init', title: 'init stage 4 diff ready · confirm it' }] } })
    expect(txt(band(v, 115, NOOP)).join('\n')).toMatch(/init stage 4 diff ready.*1: open/); expect(txt(band(v, 115, NOOP)).join('\n')).not.toMatch(/\/cadre|type /)
    const np = { ...v, b: { ...v.b, plan: undefined, tasks: [] } }   // init runs before any plan exists: the band must still draw
    expect(txt(band(np, 115, NOOP)).join('\n')).toContain('init stage 4 diff ready')
    v.b.decisions = []; expect(txt(band(v, 115, NOOP))[0]).toContain('Containment degraded')
  })
  test('presses route to handlers: 1 opens the decision card (approval, git flag)', async () => {
    const got: string[] = [], a = { go: (t: string) => { got.push(`go:${t}`) }, pick: (i: string) => { got.push(`pick:${i}`) }, fill: () => {}, press: () => {}, step: () => {} }
    segs(band(approval(), 115, a)).find(s => s.hk === '1')!.p!(); segs(band(view(82), 115, a)).find(s => s.hk === '1')!.p!();
    expect(got).toEqual(['go:card', 'go:card'])   // a decision's band button opens its card (ADR 0008)
  })
})

describe('Plan tab = approval sheet', () => {
  test('summary counts; the footer buttons are Approve / Reject; paging n/p', async () => {
    const wide = txt(sheet(approval(), 116, NOOP))
    expect(wide[0]).toContain('12 scenarios'); expect(wide[1]).toContain('3 NEW · 2 CHANGED · 4 same'); expect(wide.at(-1)).toMatch(/a: Approve plan · x: Reject plan/); expect(wide.join('\n')).not.toMatch(/\/cadre|@/)
    const v = approval(); const page = txt(sheet({ ...v, ui: { si: 2 } }, 116, NOOP)).join('\n')
    expect(page).toContain('a3 · fix'); expect(page).toContain('- validateToken(t: Token) -> Claims|null'); expect(page).toContain('task 3/7')
  })
  test('amended while open: banner names the changed task and the buttons stay', async () => {
    const t = CASES['sheet amended|56'](); expect(t[0]).toContain('plan changed since you opened it'); expect(t[1]).toContain('a3 scenarios')
  })
})

describe('notification policy (UI-DESIGN 4)', () => {
  const rows: [EventType, Record<string, unknown>, number, string | undefined][] = [
    ['approval.pending', { planId: 'p3', missing: [], rev: 'r1' }, 3, 'approve:p3:r1'], ['flag.raised', { taskId: 'a7', flag: 'drift:pm:status' }, 3, 'flag:a7:drift:pm:status'],
    ['task.transitioned', { taskId: 'a6', from: 'active', to: 'blocked', hash: 'h' }, 3, 'q:a6:h'], ['task.transitioned', { taskId: 'a1', from: 'review', to: 'done' }, 1, undefined],
    ['task.phase_changed', { taskId: 'a1', from: 'tester', to: 'red' }, 0, undefined], ['task.transitioned', { taskId: 'a2', from: 'review', to: 'active' }, 1, undefined], ['task.transitioned', { taskId: 'a2', from: 'active', to: 'review' }, 0, undefined], ['sync.state_changed', { target: 'pm', state: 'ok', conflicts: 1, at: 1 }, 2, 'off:pm'], ['check.ran', { taskId: 'a1', name: 'test', ok: false }, 1, undefined], ['check.ran', { taskId: 'a1', name: 'test', ok: true }, 1, undefined],
    ['sync.state_changed', { target: 'pm', state: 'offline', at: 1 }, 2, 'off:pm'], ['sync.state_changed', { target: 'pm', state: 'ok', at: 1 }, 1, 'off:pm'],
    ['drive.status', { state: 'paused', reason: 'approve p4' }, 3, 'drive:paused'], ['drive.status', { state: 'finished' }, 3, 'drive:finished'], ['drive.status', { state: 'armed' }, 0, undefined],
    ['cost.updated', { tokens: 1 }, 0, undefined], ['cost.updated', { tokens: 1, threshold: 80 }, 2, 'cost:80'], ['init.stage', { stage: 4, state: 'proposed' }, 2, 'init:4'],
    ['agent.unbound', { agentId: 'g', reason: 'stale' }, 1, undefined], ['agent.unbound', { agentId: 'g', reason: 'answer' }, 0, undefined], ['agent.bound', { agentId: 'g', taskId: 'a1', role: 'worker' }, 0, undefined],
  ]
  test('matrix: level and dedupe key per event', async () => {
    for (const [type, data, lvl, key] of rows) { const e = ev(type, data, { taskId: data.taskId as string | undefined }); expect([type, levelOf(e)]).toEqual([type, lvl]); expect(textOf(e)?.key).toBe(key) }
    expect(textOf(ev('approval.pending', { planId: 'p3', missing: [] }))!.text).toBe('Plan p3 ready for approval · press 1')
    expect(textOf(ev('drive.status', { state: 'finished' }))!.text).toBe('Epic landed on dev ✓')
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
  test('escalation: unacked after 120 s goes to OS notify once; an ack cancels it; drive paused notifies immediately', async () => {
    const a = mk(), f = (id: string, at: number) => ev('flag.raised', { taskId: id, flag: 'g' }, { taskId: id, at })
    await onEvent(a.h, f('a1', 1000)); expect(a.of('notify')).toHaveLength(0); expect(a.timers.map(t => t.ms)).toEqual([120_000]); await a.run(); expect(a.of('notify')).toEqual(['a1 flagged g · press 1'])
    const b = mk(); await onEvent(b.h, f('a1', 1000)); await b.h.ui.update(u => ({ ...u, ack: 5000 })); await b.run(); expect(b.of('notify')).toHaveLength(0)
    const c = mk(); await onEvent(c.h, ev('drive.status', { state: 'paused', reason: 'approve p4' }, { at: 0 })); expect(c.of('notify')).toEqual(['Drive paused: approve p4'])
  })
  test('OS notify: ≤3 per 15 min, never while the pane is focused, off with ui.notify off, toast when unsent', async () => {
    const a = mk(); for (let i = 0; i < 5; i++) await onEvent(a.h, ev('flag.raised', { taskId: `t${i}`, flag: 'g' }, { taskId: `t${i}`, at: 1000 + i * 10 })); await a.run(); expect(a.of('notify')).toHaveLength(3)
    const f = mk({ focused: async () => true }); await onEvent(f.h, ev('flag.raised', { taskId: 't', flag: 'g' }, { taskId: 't', at: 1000 })); await f.run(); expect(f.of('notify')).toHaveLength(0)
    const o = mk(); await o.h.ui.update(u => ({ ...u, cfg: { notify: 'off' } })); await onEvent(o.h, ev('flag.raised', { taskId: 't', flag: 'g' }, { taskId: 't', at: 1000 })); await o.run(); expect(o.of('notify')).toHaveLength(0)
    const u = mk({ notify: async () => ({ isSent: false }) }); await onEvent(u.h, ev('flag.raised', { taskId: 't', flag: 'g' }, { taskId: 't', at: 1000 })); await u.run(); expect(u.of('toast')).toHaveLength(2)
  })
  test('status line is attention-only: set with a top item, cleared (undefined) when none', async () => {
    const a = mk(); await seed(a.h, view(82)); await onEvent(a.h, ev('flag.raised', { taskId: 'a6', flag: 'git:dev:agent' }, { taskId: 'a6', at: 0 }))
    expect(a.of('status').pop()).toMatch(/^git:dev:agent · .* · press 1$/)
    const b = mk(); await seed(b.h, view(62)); await onEvent(b.h, ev('task.phase_changed', { taskId: 'a2', from: 'a', to: 'b' }, { at: 0 })); expect(b.of('status').pop()).toBeUndefined()
  })
})

describe('secrets: nothing secret is drawn or stored (ADR 0012)', () => {
  test('the band, the sheet, the epic tab, status line, toasts, notify, log, ring and human view carry no code', async () => {
    const a = mk(), v = approval(62); await seed(a.h, v)
    for (const e of [ev('approval.pending', { planId: 'p3', missing: [] }, { at: 0 }), ev('flag.raised', { taskId: 'a1', flag: 'g' }, { taskId: 'a1', at: 20_000 }), ev('drive.status', { state: 'paused', reason: 'approval' }, { at: 40_000 })]) await onEvent(a.h, e)
    await a.run()
    const outside = JSON.stringify([a.calls, (a.h as any).logs, txt(pane({ ...v, ui: { tab: 'epic' } }, 118, 40, NOOP).before), ring(), humanView(v.b), v.ring, txt(band(v, 115, NOOP)), txt(sheet(v, 116, NOOP))])
    expect(outside).not.toMatch(/code8|[0-9a-f]{8}@|\/cadre approve/); expect(await a.h.secret.read()).toEqual({})
  })
  test('prefill: empty composer -> fills; text in it -> toast and no fill; refused -> "type <cmd>"', async () => {
    const a = mk(); await prefill(a.h, '/cadre drive on'); expect(a.of('fill')).toEqual(['/cadre drive on'])
    const b = mk({ peek: async () => 'half typed' }); await prefill(b.h, '/cadre drive on'); expect(b.of('fill')).toEqual([]); expect(b.of('toast')).toEqual(['cadre: composer not empty: clear it, then press again'])
    const c = mk({ fill: async () => ({ isFilled: false }) }); await prefill(c.h, '/cadre drive on'); expect(c.of('toast')).toEqual(['cadre: type /cadre drive on'])
  })
  test('sheet buttons PRESS the plan decision bound to its hash (never prefill a typed command); the work starts in after(1)', async () => {
    const a = mk(), v = approval(62); await seed(a.h, v); const pressed: unknown[][] = []; a.h.press = async (...x) => { pressed.push(x); return { text: 'ok' } }
    const h = (v.b.decisions ?? [])[0].hash
    segs(sheet(v, 116, acts(a.h))).find(s => s.k === 'a')!.p!(); expect(pressed).toEqual([]); expect(a.timers.map(t => t.ms)).toEqual([1]); await a.run()
    expect(pressed).toEqual([['plan:p3', 'a', h]]); expect(a.of('fill')).toEqual([])
    segs(sheet(v, 116, acts(a.h))).find(s => s.k === 'x')!.p!(); await a.run(); expect(pressed.at(-1)).toEqual(['plan:p3', 'x', h])
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
  test('pane: one Raster sized to the body, base64 cells; blit repaints the cursor without a re-render', async () => {
    const a = mk(); await seed(a.h); const t = await renderPane(a.h, { surface: 'terminal', props: { bodyColumns: 118, scroll: { bodyRows: 40 } } })
    const r = flat(t).find((n: any) => n.type === 'Raster'); expect([r.props.key, r.props.columns, r.props.rows, r.props.cells.length]).toEqual(['tl', 118, 9, 4 * Math.ceil(118 * 9 * 12 / 3)])
    await tickUi(a.h); expect(a.of('blit')[0]).toMatchObject({ requestId: 'cadre', key: 'tl' }); expect(a.of('blit')[0].cells.length).toBe(r.props.cells.length)
  })
  test('M10: the tick copies the resolved strictness into the ui atom; the render reads it (the hook cannot read env/config)', async () => {
    const a = mk(); await seed(a.h); a.h.config = async () => ({ strictness: 'advisory' }) as any
    expect((await read(a.h)).sx).toBe('strict'); await tickUi(a.h); expect((await read(a.h)).sx).toBe('advisory')
  })
  test('openPane: tab + focus request; where nothing draws the sheet goes to $.ui.log', async () => {
    const a = mk(); await seed(a.h, approval(62)); await openPane(a.h, 'plan')
    expect(a.of('open')).toEqual([{ id: 'cadre', title: 'cadre', focus: true, columns: 120 }]); expect(await read(a.h).then(v => v.ui.tab)).toBe('plan'); expect((a.h as any).logs).toHaveLength(0)
    const b = mk({ open: async () => ({ isPlaced: false, reason: 'no room' }) }); await seed(b.h, approval(62)); await openPane(b.h, 'plan')
    expect((b.h as any).toasts[0]).toContain('no room'); expect((b.h as any).logs[0]).toContain('Approve plan'); expect((b.h as any).logs[0]).not.toContain('@')
  })
  test('handlers: n/p select, h/l move the cursor (live at the edge), b/f jump to attention events, e = live, t toggles the timeline, sheet paging', async () => {
    const a = mk(); await seed(a.h); const x = acts(a.h), st = async (w: string, d = 0) => { x.step(w, d); await a.run(); return read(a.h) }
    expect((await st('node', 1)).ui.sel).toBe('a3'); expect((await st('node', 1)).ui.sel).toBe('a6'); expect((await st('node', -1)).ui.sel).toBe('a3')
    const t1 = (await st('time', -1)).t as number; expect(t1).toBeLessThan(BASE + 62 * MIN); expect(t1).toBeGreaterThan(BASE); expect((await st('time', 1)).t).toBe(null)
    const b = await st('attn', -1); expect(b.t).not.toBe(null); expect((await st('live')).t).toBe(null); expect((await st('tl')).ui.tl).toBe(false); expect((await st('tl')).ui.tl).toBe(true)
    await seed(a.h, approval()); expect((await st('sheet', 1)).ui.si).toBe(1); expect((await st('sheet', -5)).ui.si).toBe(0); expect((await st('sheet', 99)).ui.si).toBe(SHEET.length - 1)
  })
  test('result-card row: engine row while running or unmapped; else a glyphed row + next line', async () => {
    const a = mk(), v = view(62, { tweak: ts => ts.map(t => (t.id === 'a1' ? { ...t, card: 'worker → review  a1 "Add login"  green ✓ test 41s\nnext: spawn reviewer for a1' } : t)), ui: { cards: { tu1: 'a1' } } }); await seed(a.h, v)
    expect((await renderCard(a.h, { props: { tool_use_id: 'tu1', isRunning: true } }, next)).type).toBe('engine'); expect((await renderCard(a.h, { props: { tool_use_id: 'zz', isRunning: false } }, next)).type).toBe('engine')
    const t = await renderCard(a.h, { props: { tool_use_id: 'tu1', isRunning: false } }, next); expect(text(t)).toBe('⏺ [OK] worker → review  a1 "Add login"  green ✓ test 41s  next: spawn reviewer for a1')
  })
  test('resume banner: transcript log line, band cell until the first ack', async () => {
    const a = mk(); await seed(a.h, view(62, { board: { resumesQueued: 1, drive: { on: false, level: 'epic', epicId: null, turns: 0, costUsd: 0, startedAt: null } } })); await resumeBanner(a.h, { decisions: 5, next: 'complete a5', stale: 1 })
    expect((a.h as any).logs[0]).toBe('● cadre: [OK] resumed · mission "Auth v2" · epic p3 · 1 running (re-adopted) · [IDLE] 1 stale → rebind · ↻ 1')
    expect(txt(band(await read(a.h), 115, NOOP))[0]).toBe('[OK] ↺ cadre resumed from beads · 5 decisions · next: complete a5 · [WAIT] drive off until /cadre drive on')
    await a.h.ui.update(u => ({ ...u, ack: Date.now() + 1e12 })); expect(txt(band(await read(a.h), 115, NOOP))[0]).toMatch(/^\[RUN\] cadre/)
  })
  test('resume banner shows the rehydrated drive state: continuing when drive survived the reset', async () => {
    const a = mk(); await seed(a.h, view(62, { board: { drive: { on: true, level: 'epic', epicId: 'p3', turns: 4, costUsd: 1, startedAt: 0 } } })); await resumeBanner(a.h, { decisions: 5, next: 'complete a5' })
    expect(txt(band(await read(a.h), 115, NOOP))[0]).toBe('[OK] ↺ cadre resumed from beads · 5 decisions · next: complete a5 · [RUN] drive ▶ continuing')
    expect(((await a.h.ui.read()).res as any).n).toContain('[RUN] drive ▶ continuing')
  })
})

describe('Doctor tab (post-v1, ADR 0007)', () => {
  test('8: Doctor is always on the tab row; with no report it says how to get one; a report shows its rows', () => {
    const v = view(62, {}), keys = (p: ReturnType<typeof pane>) => p.before.flat().filter(s => s.hk).map(s => s.hk)
    expect(keys(pane(v, 118, 40, NOOP))).toContain('8')
    expect(txt(pane({ ...v, ui: { tab: 'doctor' } }, 118, 40, NOOP).before).join('\n')).toContain('no report yet · run /cadre doctor')
    expect(txt(pane({ ...v, ui: { tab: 'doctor', 'doctor.rows': [['ok', 'git 2.43.0']] } }, 118, 40, NOOP).before).join('\n')).toContain('[OK] git 2.43.0')
  })
})
