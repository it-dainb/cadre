// Decisions (ADR 0008, 0012): ONE record, answered ONLY in the native dialog, listed read-only in the pane. Dialog options per kind, the hash re-check, free text = a change
// request, fields asked one by one with validation, no nagging (one auto pop, `1` re-opens), approve -> one continuation brief, the plan's wording, core ask/settle.
import { describe, expect, test } from 'claude-code/testing'
import type { Decision, Host, UiOps } from '../types'
import { band } from '../ui/band'
import { decisions, needs } from '../ui/needs'
import { pane } from '../ui/pane'
import { read, txt, wid } from '../ui/model'
import { NOT_NOW, acts, answerDialog, autoAsk, onEvent } from '../ui/index'
import { decide, run } from '../commands/cadre'
import { ROUTES, dispatch, initPropose } from '../core/dispatch'
import { ask, flagDecision, settle } from '../core/decide'
import { modelView } from '../core/board'
import { emit, TABLE } from '../core/events'
import { configPress, refreshSettings } from '../config/route'
import { lastNext } from '../core/close'
import { plan, world } from './fixtures/native/world'
import { fakeHost } from './support'
import { NOOP, approval, view } from './fixtures/ui/epic'

const dec = (id: string, kind: string, title: string, lines: string[], options: Decision['options'], o: Partial<Decision> = {}): Decision => ({ id, kind, title, lines, hash: 'h', options, ...o })
const flag = (f: string) => flagDecision('a2', f, 'Session refresh')!
const LITE = { kind: 'plan', lane: 'lite', reason: 'one small fix in src/a.ts', type: 'bug', changelog: { category: 'Fixed', entry: 'off-by-one in paging' } }
// a kind nobody wrote UI for: the band row, the Needs you list and the dialog work from the record alone
const DEPLOY = dec('deploy:7', 'deploy', 'deploy build 7 to staging?', ['3 services restart', 'rollback is automatic'], [{ key: 'd', label: 'Deploy', verb: 'approve', run: 'deploy now' }, { key: 'w', label: 'Wait an hour', verb: 'change' }])
const OK = { key: 'a', label: 'Confirm', verb: 'approve', run: 'x confirm' }

type W = Awaited<ReturnType<typeof world>>
// the engine around the host: ops (timers run on drain), the dialog (answers scripted per question), Host.answer wired like register.ts
async function ui(w: W, say: (q: string, labels: string[]) => string | Promise<string> = () => NOT_NOW, o: { peek?: string } = {}) {
  const calls: [string, ...any[]][] = [], timers: (() => unknown)[] = [], asked: { q: string; labels: string[] }[] = []
  const ops = { els: () => ({}), open: async (a: any) => { calls.push(['open', a]); return { isPlaced: true } }, focused: async () => false, toast: (t: string) => { calls.push(['toast', t]) }, notify: async () => ({ isSent: true }), status: () => {},
    peek: async () => o.peek ?? '', fill: async (t: string) => { calls.push(['fill', t]); return { isFilled: true } }, after: (_ms: number, fn: () => unknown) => { timers.push(fn) }, invalidate: () => {}, blit: async () => {} } as unknown as UiOps
  Object.assign(w.h, { ops, answer: (id: string, k: string, hash: string, vals?: Record<string, string>) => decide(w.h, id, k, hash, vals), ask: async (q: string, labels: string[]) => { asked.push({ q, labels }); return say(q, labels) } })
  const drain = async () => { while (timers.length) await timers.shift()!() }
  return { calls, asked, drain, of: (k: string) => calls.filter(c => c[0] === k).map(c => c[1]) }
}
const top = async (h: Host) => decisions(await read(h))[0]
const goal = async (h: Host) => (await h.ui.read()).goal as string | undefined

describe('the dialog offers exactly the decision\'s runnable options (+ "Not now" when fewer than 2); the engine adds "Type something"', () => {
  const KINDS: [string, Decision, string[]][] = [
    ['init diff', dec('init:4', 'init', 'init stage 4 · confirm it', ['  + types.docs'], [OK, { key: 'x', label: 'Cancel', verb: 'reject', run: 'init cancel' }, { key: 'c', label: 'Change', verb: 'change', run: 'init 4' }]), ['Confirm', 'Cancel', 'Change']],
    ['setup confirm (one option)', dec('init:90', 'init', 'setup plan ready · confirm it', ['  1. installing bd'], [OK]), ['Confirm', NOT_NOW]],
    ['spec_change', flag('spec_change'), ['Accept', 'Reject']],
    ['git flag', flagDecision('', 'git:dev:agent')!, ['Restore', 'Keep']],
    ['conflict flag', flag('conflict'), ['Accept', 'Keep', 'Cancel task']],
    ['lost epic', flagDecision('p3', 'lost-epic')!, ['Re-cut', 'End epic']],
    ['release (live bug: a bogus "Yes")', dec('release:1.4.0', 'release', 'release v1.4.0?', ['dev merges into main with an annotated tag v1.4.0'], [{ key: 'r', label: 'Release', verb: 'release', run: 'release 1.4.0' }]), ['Release', NOT_NOW]],
    ['an option without run is not offered', DEPLOY, ['Deploy', NOT_NOW]],
  ]
  for (const [name, d, labels] of KINDS) test(name, async () => {
    const w = await world(), u = await ui(w); await ask(w.h, d); await answerDialog(w.h)
    expect(u.asked.map(a => a.labels)).toEqual([labels]); expect(u.asked[0].q.split('\n')[0]).toBe(d.title); expect(u.asked[0].q.split('\n').length).toBeLessThanOrEqual(7)
  })
  test('the real gate and release decisions (core) ask with two options', async () => {
    const w = await world(), u = await ui(w), { plan: p } = await plan(w); await w.text({ cmd: 'approve', args: [p] })
    const g = await w.store.createDraft({ title: 'Sign off the API', description: 'legal', type: 'gate', parent: p }); await w.store.approve([g.id]); await w.text({ cmd: 'approve', args: [g.id] })
    await answerDialog(w.h, `gate:${g.id}`); expect(u.asked.at(-1)!.labels).toEqual(['Approve', NOT_NOW]); expect(u.asked.at(-1)!.q).toBe(`approve gate ${g.id} · Sign off the API\nlegal\na human gate: the work after it waits for you`)
  })
})

describe('answers: the chosen label runs its option as origin dialog; the hash is re-checked when the answer arrives', () => {
  test('Approve approves the plan and queues ONE continuation brief to main', async () => {
    const w = await world(), { plan: p, task } = await plan(w); await ui(w, () => 'Approve'); await answerDialog(w.h)
    expect((await w.store.get(task)).category).toBe('todo'); expect((await w.h.board.read()).plan?.state).toBe('approved'); expect(decisions(await read(w.h))).toEqual([])
    expect(await goal(w.h)).toBe(`Plan ${p} is approved: spawn its ready tasks one by one (each by its id), follow the cards until every task is done, then complete the plan (TaskUpdate ${p} completed).`)
    expect((w.h as any).logs.at(-1)).toBe(`cadre: Plan ${p} approved: 1 task ready; epic branch epic/${p}-auth-login cut.`)
  })
  test('the close of the plan\'s last open task nudges main once (its card\'s next line) to complete the plan', async () => {
    const w = await world(), { plan: p, task } = await plan(w); await w.text({ cmd: 'approve', args: [p] })
    expect(await lastNext(w.h, p, 'wait')).toBe('wait')   // a task is still open
    await w.h.board.update(b => ({ ...b, tasks: b.tasks.map(t => (t.id === task ? { ...t, state: 'done' as const } : t)) }))
    expect(await lastNext(w.h, p, 'wait')).toBe(`every task is done: complete the plan (TaskUpdate ${p} completed)`); expect(await lastNext(w.h, 'other', 'wait')).toBe('wait')
  })
  test('Reject drops the plan; no brief', async () => {
    const w = await world(); await plan(w); await ui(w, () => 'Reject'); await answerDialog(w.h)
    expect((await w.h.board.read()).plan).toBeNull(); expect(await goal(w.h)).toBeUndefined()
  })
  test('stale: the plan changes while the dialog is open -> refused, nothing approved, the fresh one is asked again', async () => {
    const w = await world(), { task } = await plan(w); let n = 0
    const u = await ui(w, async (_q, ls) => { if (!n++) await w.call('TaskUpdate', { taskId: task, subject: 'changed under the dialog' }); return ls[0] })
    await answerDialog(w.h)
    expect(u.asked).toHaveLength(2); expect((w.h as any).logs[0]).toBe('cadre: refused: it changed; review again'); expect((w.h as any).logs[1]).toContain('approved')
    expect((await w.store.get(task)).title).toBe('changed under the dialog')
  })
  test('a replayed answer after success is refused (the decision is gone); a stale hash or an unknown key runs nothing', async () => {
    const w = await world(); await plan(w); const d = await top(w.h)
    expect((await decide(w.h, d.id, 'a', d.hash)).text).toContain('approved'); expect((await decide(w.h, d.id, 'a', d.hash)).text).toContain('refused')
    const seen: string[][] = []; ROUTES.deploy = async (_h, c) => { seen.push(c.args); return { text: 'deployed' } }; await ask(w.h, DEPLOY)
    expect((await decide(w.h, 'deploy:7', 'd', 'stale')).text).toBe('refused: it changed; review again'); expect((await decide(w.h, 'deploy:7', 'w', 'h')).text).toContain('refused')
    expect((await decide(w.h, 'deploy:7', 'd', 'h')).text).toBe('deployed'); expect(seen).toEqual([['now']])
  })
  test('free text ("Type something") on a plan = a change request to main; the plan stays a draft and is not asked again', async () => {
    const w = await world(), { plan: p, task } = await plan(w), u = await ui(w, () => 'split the login into two tasks'); await answerDialog(w.h)
    expect(await goal(w.h)).toBe(`Change ${p}: split the login into two tasks`); expect((await w.store.get(task)).category).toBe('draft'); expect(u.asked).toHaveLength(1)
    expect((w.h as any).logs.at(-1)).toBe('cadre: sent to Claude · split the login into two tasks')
  })
  test('free text on another kind goes to main with its title; dismissed or "Not now" decides nothing', async () => {
    const w = await world(); await ask(w.h, flag('conflict')); await ui(w, () => 'keep mine but tell me why'); await answerDialog(w.h)
    expect(await goal(w.h)).toBe('About "a2 flagged conflict": keep mine but tell me why')
    const w2 = await world(), { task } = await plan(w2); await ui(w2, () => { throw new Error('dismissed') }); await answerDialog(w2.h); await ui(w2, () => NOT_NOW); await answerDialog(w2.h)
    expect((await w2.store.get(task)).category).toBe('draft'); expect(await goal(w2.h)).toBeUndefined()
  })
  test('only the dialog decides: typed and other origins are refused, and an engine origin cannot claim "dialog"', async () => {
    const w = await world(), { task } = await plan(w), p = (await w.h.board.read()).plan!.id
    for (const kind of ['composer', 'sdk', 'plugin', 'bridge', 'unclassified']) expect((await dispatch(w.h, { schemaVersion: 1, cmd: 'approve', args: [p], origin: { kind } }, async () => ({ text: '' }))).text).toContain('refused')
    for (const kind of ['press', 'dialog']) expect(((await run(w.h, { args: `approve ${p}`, origin: { kind } } as any, (async () => undefined) as any)) as { text: string }).text).not.toContain('approved')
    expect((await w.store.get(task)).category).toBe('draft')
  })
  test('Cancel on a setup decision: one plain line; typed origins cannot cancel', async () => {
    const w = await world(); await initPropose(w.h, 90, 'p', { title: 't', lines: ['  1. x'], sub: 'setup', change: 'setup' }); const d = await top(w.h)
    expect((await dispatch(w.h, { schemaVersion: 1, cmd: 'setup', args: ['cancel'], origin: { kind: 'sdk' } }, async () => ({ text: '' }))).text).toContain('refused')
    expect((await decide(w.h, d.id, 'x', d.hash)).text).toBe('setup: cancelled'); expect(decisions(await read(w.h))).toEqual([])
  })
})

describe('fields: asked one by one in the dialog, validated, re-asked with the error', () => {
  test('a Settings edit: a bad value is refused and re-asked with the error; the good one is saved', async () => {
    const w = { h: fakeHost({ files: {} }) } as unknown as W; await refreshSettings(w.h)
    const typed = ['lots', '7'], u = await ui(w, (q, ls) => (q === 'maxParallel?' ? typed.shift()! : ls[0]))
    await configPress(w.h, 'edit maxParallel'); expect((await top(w.h)).fields).toEqual([{ key: 'value', label: 'maxParallel', value: '3' }])
    await answerDialog(w.h)
    expect(u.asked.map(a => a.labels)).toEqual([['Keep 3', 'Cancel'], ['Save for me', 'Save to repo', 'Cancel'], ['Keep 3', 'Cancel'], ['Save for me', 'Save to repo', 'Cancel']])
    expect(u.asked[3].q).toContain('! expected a number'); expect((w.h as any).logs.filter((l: string) => !l.includes('prune'))).toEqual(['cadre: refused: expected a number, 0 or more', 'cadre: maxParallel = 7 · saved for you'])
    expect(JSON.parse((await w.h.readText('/hm/u/.claude/cadre.json'))!).maxParallel).toBe(7); expect(decisions(await read(w.h))).toEqual([])
  })
  test('Cancel at a field decides nothing', async () => {
    const w = await world(); await ask(w.h, dec('f:1', 'x', 'name it', [], [OK], { fields: [{ key: 'name', label: 'name', value: 'Ada' }] })); const u = await ui(w, () => 'Cancel'); await answerDialog(w.h)
    expect(u.asked).toHaveLength(1); expect(decisions(await read(w.h))).toHaveLength(1)
  })
})

describe('no nagging: a decision pops once, when it first appears; `1` re-opens it', () => {
  const pending = (): any => { const [actor, severity, needsHuman] = TABLE['approval.pending']; return { schemaVersion: 1, seq: 1, at: 5, type: 'approval.pending', actor, severity, needsHuman, data: { planId: 'p', missing: [] } } }
  test('the first event pops it; dismissed, later events and timer ticks (several main turns) never re-pop; `1` opens it again', async () => {
    const w = await world(); await plan(w); const u = await ui(w)
    for (let i = 0; i < 4; i++) { await onEvent(w.h, pending()); await autoAsk(w.h); await u.drain() }
    expect(u.asked).toHaveLength(1)
    acts(w.h).answer((await top(w.h)).id); expect(u.asked).toHaveLength(1); await u.drain(); expect(u.asked).toHaveLength(2)
    await w.call('TaskUpdate', { taskId: (await w.h.board.read()).tasks[0].id, subject: 'reworded' }); await autoAsk(w.h); await u.drain(); expect(u.asked).toHaveLength(2)   // a new hash is not a new decision
  })
  test('a decision appearing while the human types never pops (the band carries it); nor a quiet one', async () => {
    const w = await world(); await plan(w); const u = await ui(w, undefined, { peek: 'I am typing' }); await autoAsk(w.h); await u.drain(); expect(u.asked).toHaveLength(0)
    const w2 = await world(), u2 = await ui(w2); await ask(w2.h, dec('run:setup', 'init', 'setup · 2/8 done · Claude is on it', [], [OK], { quiet: true })); await autoAsk(w2.h); await u2.drain(); expect(u2.asked).toHaveLength(0)
  })
})

describe('the plan decision: each fact once, plural, no "0 scenarios"', () => {
  test('lite: "approve plan <id>", the lane line carries "1 task", the row has no scenario count', async () => {
    const w = await world(), p = await w.call('TaskCreate', { subject: 'Fix paging', description: 'n is 1-based', metadata: LITE }), d = await top(w.h), id = p.result.task.id
    expect(d.title).toBe(`approve plan ${id}`); expect(d.lines[0]).toBe('lite · 1 task · fix · one small fix in src/a.ts'); expect(d.lines.slice(1)).toEqual([expect.stringMatching(/^  \S+ bug Fix paging$/)])
    const all = [d.title, ...d.lines].join('\n'); expect(all).not.toMatch(/\b1 tasks\b|0 scenarios/); expect(all.match(/1 task\b/g)).toHaveLength(1)
  })
  test('full: the lane line has the count once; rows name their own scenarios; at most 6 lines', async () => {
    const w = await world(); await plan(w); const d = await top(w.h)
    expect(d.lines[0]).toBe('full · 1 task · feat'); expect(d.lines[1]).toMatch(/ · 1 scenario$/); expect(d.lines.length).toBeLessThanOrEqual(6)
  })
})

describe('the pane and the band: read-only Needs you, `1: answer`', () => {
  const v = (ds: Decision[]) => view(62, { board: { decisions: ds } })
  test('the epic tab lists every decision with its detail; `1` answers the oldest, the others answer by click; no option buttons anywhere', () => {
    const got: string[] = [], a = { ...NOOP, answer: (id: string) => { got.push(id) } }, ds = [flag('conflict'), DEPLOY]
    const ls = pane(v(ds), 116, 40, a).before, t = txt(ls).join('\n')
    expect(t).toContain('NEEDS YOU'); expect(t).toContain('  ! a2 flagged conflict'); expect(t).toContain('    3 services restart')
    const keys = ls.flat().filter(s => s.hk).map(s => s.hk); expect(keys).toEqual(['7', '8', '9', '1'])   // the Epic tab gives `1` to the answer while one waits
    ls.flat().filter(s => s.k === 'att' || s.k?.startsWith('ans:')).forEach(s => s.p!()); expect(got).toEqual(['flag:a2:conflict', 'deploy:7'])
    for (const w of [116, 56, 40]) for (const l of pane(v(ds), w, 40, a).before) expect(wid(l)).toBeLessThanOrEqual(Math.max(w, 116))
    expect(needs(view(62), 116, NOOP)).toEqual([])
  })
  test('the other tabs carry the one-line form on top; the band: `! NEEDS YOU · <title> · +N more · 1: answer`', () => {
    for (const tab of ['plan', 'settings', 'doctor']) expect(txt(pane({ ...approval(), ui: { tab } }, 116, 40, NOOP).before)[2]).toMatch(/^! NEEDS YOU · approve plan p3 +1: answer$/)
    expect(txt(band(v([flag('conflict'), DEPLOY]), 115, NOOP))[0]).toMatch(/^! NEEDS YOU · a2 flagged conflict · \+1 more +1: answer$/)
    for (const w of [120, 60, 36, 24]) for (const l of band(v([DEPLOY]), w, NOOP)) expect(wid(l)).toBeLessThanOrEqual(w)
  })
})

describe('core: ask / settle / events', () => {
  test('ask adds (replace keeps its place), settle clears it; the model view never sees decisions', async () => {
    const w = await world(), d2 = { ...DEPLOY, id: 'deploy:8' }
    await ask(w.h, DEPLOY); await ask(w.h, d2); await ask(w.h, { ...DEPLOY, hash: 'h2' })
    const b = await w.h.board.read(); expect(b.decisions!.map(d => `${d.id}:${d.hash}`)).toEqual(['deploy:7:h2', 'deploy:8:h'])
    expect(JSON.stringify(modelView(b))).not.toContain('deploy')
    await settle(w.h, 'deploy:7'); expect((await w.h.board.read()).decisions!.map(d => d.id)).toEqual(['deploy:8']); await settle(w.h, 'nope')
  })
  test('every flag.raised asks; flag.resolved settles; a phase that asked first (spec_change) keeps its richer decision', async () => {
    const w = await world(); await emit(w.h, 'flag.raised', { taskId: 'a2', flag: 'conflict' }, { taskId: 'a2' })
    expect((await w.h.board.read()).decisions!.map(d => d.id)).toEqual(['flag:a2:conflict'])
    await ask(w.h, dec('flag:a3:spec_change', 'flag', 't', ['why: the API changed'], [OK])); await emit(w.h, 'flag.raised', { taskId: 'a3', flag: 'spec_change' }, { taskId: 'a3' })
    expect((await w.h.board.read()).decisions!.find(d => d.id === 'flag:a3:spec_change')!.lines).toEqual(['why: the API changed'])
    await emit(w.h, 'flag.resolved', { taskId: 'a2', flag: 'conflict,drift' }, { taskId: 'a2' }); expect((await w.h.board.read()).decisions!.map(d => d.id)).toEqual(['flag:a3:spec_change'])
  })
  test('a plan asks when approvable (hash-bound; Approve, Reject, Lane; a change is typed) and settles on approve and on reject', async () => {
    const w = await world(), { plan: p } = await plan(w), b = await w.h.board.read()
    expect(b.decisions!.map(d => d.id)).toEqual([`plan:${p}`]); expect(b.decisions![0].options.map(o => o.run)).toEqual([`approve ${p}`, expect.stringContaining('reject'), `lane ${p}`]); expect(b.decisions![0].change).toBe(`Change ${p}: `)
    await w.text({ cmd: 'approve', args: [p] }); expect((await w.h.board.read()).decisions).toEqual([])
    const w2 = await world(), r = await plan(w2); await w2.text({ cmd: 'reject', args: [r.plan] }); expect((await w2.h.board.read()).decisions).toEqual([])
  })
  test('init/setup: initPropose asks (hash-bound), Cancel settles it', async () => {
    const w = await world(); await initPropose(w.h, 90, 'p', { title: 'setup plan ready · confirm it', lines: ['  1. x'], sub: 'setup', change: 'setup' })
    const d = (await w.h.board.read()).decisions![0]; expect([d.id, d.options.map(o => o.run)]).toEqual(['init:90', ['setup confirm', 'setup cancel', 'setup']])
    await dispatch(w.h, { schemaVersion: 1, cmd: 'setup', args: ['cancel'], origin: { kind: 'dialog' } }, async () => ({ text: '' })); expect((await w.h.board.read()).decisions).toEqual([])
  })
})
