import { describe, expect, test } from 'claude-code/testing'
import { NO_PLAN, READY, WELCOME, decide, route, run, status } from '../commands/cadre'
import { confirmPrefs, nextOf, prefsCall, prefsItem, prefsRow, wantOf } from '../commands/prefs'
import { ROUTES } from '../core/dispatch'
import { ask } from '../core/decide'
import { fakeHost, task } from './support'
import { plan, world } from './fixtures/native/world'
import { BUDGET } from './fixtures/budget.generated'
import type { Host } from '../types'

// ADR 0014: one message state machine for bare `/cadre` and every command that does not apply here
describe('the one-line status', () => {
  const bare = (o: { setUp?: boolean } = {}) => { const h = fakeHost(); void h.secret.update(() => ({})); if (o.setUp) void h.store.set('cadre:setup', { at: 0 }); return h }
  test('no setup on this machine: welcome; set up, repo untouched: ready; bare /cadre answers it and a command that does not apply gets the same line', async () => {
    expect(await status(bare())).toBe(WELCOME); expect(await status(bare({ setUp: true }))).toBe(READY)
    expect(await run(bare({ setUp: true }), { args: '', origin: { kind: 'composer' } }, () => ({}))).toEqual({ text: READY })
    expect((await route(bare({ setUp: true }), { schemaVersion: 1, cmd: 'continue', args: [], origin: { kind: 'composer' } })).text).toBe(READY)
  })
  test('set up, no plan · a plan running · an unfinished plan · needs you', async () => {
    const w = await world(); expect(await status(w.h)).toBe(NO_PLAN)
    const { plan: id } = await plan(w); const slug = (await w.h.board.read()).plan!.slug
    await w.h.board.update(b => ({ ...b, decisions: [], plan: { ...b.plan!, state: 'approved', approvedAt: 1 }, tasks: [task('a1', { state: 'done' }), task('a2', { state: 'active', step: 'worker' }), task('a3')], drive: { ...b.drive, on: true } }))
    expect(await status(w.h)).toBe(`${id} ${slug} · 1/3 done · running a2 implement · /cadre to open`)
    await w.h.board.update(b => ({ ...b, drive: { ...b.drive, on: false } }))   // nothing drives it and no agent works on it: an earlier session left it
    expect(await status(w.h)).toBe(`Unfinished plan ${id} ${slug} (1/3) · /cadre continue to pick it up`)
    await ask(w.h, { id: 'flag:a2:conflict', kind: 'flag', title: 'a2 flagged conflict', lines: [], hash: 'x', options: [] })
    expect(await status(w.h)).toBe(`${id} · 1 needs you · press 1 to answer`)
  })
  test('/cadre continue: the parser names it; with no owner registered there is nothing to continue', async () => {
    const w = await world(), saved = ROUTES.continue; delete ROUTES.continue
    try { expect(await run(w.h, { args: 'continue', origin: { kind: 'composer' } }, () => ({}))).toEqual({ text: 'nothing to continue · /cadre <goal> to start' }) } finally { if (saved) ROUTES.continue = saved }
  })
  test('the retired "cadre is off in this repo" line is gone from the product, the guides and the docs', () => {
    expect((BUDGET as unknown as { offText: string[] }).offText).toEqual([])
  })
})

describe('setup preferences: main hands them over, cadre writes ~/.claude/cadre.json after a confirm', () => {
  const HOME = '/hm/u', USER = `${HOME}/.claude/cadre.json`
  const mk = (files: Record<string, string> = {}) => {
    const h = Object.assign(fakeHost({ files }), { home: async () => HOME }) as Host & { logs: string[]; toasts: string[] }
    void h.secret.update(s => ({ ...s, run: { kind: 'setup' as const, at: 0, turns: 0, follow: 0, guide: 'g' } }))
    return { h, files }
  }
  const call = (h: Host, metadata: Record<string, unknown>, agentId?: string) => prefsCall(h, { tool: 'TaskCreate', subject: 'preferences', description: 'the user\'s choices', metadata: { kind: 'preferences', ...metadata }, ...(agentId ? { agentId } : {}) }) as Promise<any>
  const card = async (h: Host) => ((await h.board.read()).decisions ?? []).find(d => d.id === 'init:93')
  test('values: only mode and the three limits, in range; defaults drop their keys', () => {
    expect(wantOf({ kind: 'preferences', mode: 'yolo', maxTurns: 50 })).toEqual({ mode: 'yolo', maxTurns: 50, maxCostUsd: 20, maxWallMinutes: 240 })
    expect(wantOf({ mode: 'fast' })).toContain('metadata.mode'); expect(wantOf({ maxTurns: 1.5 })).toContain('whole number'); expect(wantOf({ maxCostUsd: 0 })).toContain('metadata.maxCostUsd'); expect(wantOf({ theme: 'x' })).toContain('unknown')
    expect(nextOf({ theme: 'dark', drive: { maxTurns: 10 } }, wantOf({}) as any)).toEqual({ theme: 'dark' })
    expect(nextOf({}, wantOf({ mode: 'yolo', maxCostUsd: 5 }) as any)).toEqual({ drive: { mode: 'yolo', maxCostUsd: 5 } })
  })
  test('the card shows the diff; Confirm writes with a .bak and re-reads; the checklist row follows it', async () => {
    const { h, files } = mk({ [USER]: '{"theme":"dark"}\n' })
    expect((await prefsItem(h)).st).toBe('fail')
    const r = await call(h, { mode: 'yolo', maxTurns: 50 }); expect(r.result.task.id).toBe('preferences'); expect(r.context[0]).toContain('press 1')
    const d = (await card(h))!; expect(d.title).toBe('setup · your preferences · confirm'); expect(d.lines.join('\n')).toContain('drive'); expect(d.options[0].run).toBe('setup prefs confirm')
    expect(files[USER]).toBe('{"theme":"dark"}\n'); expect((await prefsItem(h)).st).toBe('wait')
    expect((await decide(h, d.id, 'a', d.hash)).text).toMatch(/^setup: your preferences are written · setup: /)   // then the run re-checks
    expect(JSON.parse(files[USER])).toEqual({ theme: 'dark', drive: { mode: 'yolo', maxTurns: 50 } }); expect(files[`${USER}.bak`]).toBe('{"theme":"dark"}\n')
    expect((await prefsItem(h)).st).toBe('ok')
  })
  test('a missing file is created with only the non-default keys; nothing to change asks nothing', async () => {
    const { h, files } = mk(); await call(h, { maxWallMinutes: 60 }); expect(await confirmPrefs(h)).toBe('setup: your preferences are written')
    expect(JSON.parse(files[USER])).toEqual({ drive: { maxWallMinutes: 60 } }); expect(files[`${USER}.bak`]).toBeUndefined()
    const n = mk(); const r = await call(n.h, { mode: 'auto' }); expect(r.context[0]).toContain('Nothing to change'); expect(await card(n.h)).toBeUndefined(); expect(n.files[USER]).toBeUndefined(); expect((await prefsItem(n.h)).st).toBe('ok')
  })
  test('stale or not pending is refused; outside a setup run, from an agent, or a bad value: denied or passed on', async () => {
    const { h, files } = mk({ [USER]: '{}\n' }); await call(h, { mode: 'yolo' }); files[USER] = '{"theme":"light"}\n'
    expect(await confirmPrefs(h)).toContain('changed since you saw it'); expect(files[USER]).toBe('{"theme":"light"}\n')
    expect(await confirmPrefs(h)).toBe('setup: nothing pending')
    expect(await call(h, { mode: 'yolo' }, 'agent-1')).toBeUndefined(); expect(await prefsCall(h, { tool: 'TaskCreate', metadata: { kind: 'plan' } })).toBeUndefined()
    expect((await call(h, { mode: 'fast' })).deny).toContain('metadata.mode')
    const off = mk(); await off.h.secret.update(({ run: _r, ...s }) => s); expect((await call(off.h, { mode: 'yolo' })).deny).toContain('/cadre setup')
    files[USER] = 'not json'; expect((await call(h, { mode: 'yolo' })).deny).toContain('not valid JSON')
  })
  test('doctor row: where the preferences come from and what they are', async () => {
    expect(await prefsRow(mk().h)).toEqual(['ok', 'your preferences: the defaults (mode auto, limits 100/$20/240m)'])
    expect((await prefsRow(mk({ [USER]: '{"drive":{"maxTurns":5}}' }).h))[1]).toContain('~/.claude/cadre.json')
  })
})

test('a goal run refuses a separate mission draft: the plan carries it', async () => {
  const w = await world(); await w.h.secret.update(s => ({ ...s, run: { kind: 'init' as const, at: 0, turns: 0, follow: 0, guide: 'g', goal: { text: 'fix it', mode: 'auto' as const } } }))
  const r = await w.call('TaskCreate', { subject: 'Fix it', description: 'Goal: fix it', metadata: { kind: 'mission' } })
  expect(r.deny).toContain('metadata.mission'); expect((await w.h.board.read()).plan).toBeNull()
})
