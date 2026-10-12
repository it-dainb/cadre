import { describe, expect, test } from 'claude-code/testing'
import { scoped } from '../commands/init'
import { HINT, route, run } from '../commands/cadre'
import { ROUTES, dispatch } from '../core/dispatch'
import { plan, world } from './fixtures/native/world'

const opened: unknown[] = []
const ops = { open: async (o: unknown) => { opened.push(o); return { isPlaced: true } }, peek: async () => '', fill: async () => ({ isFilled: true }), toast: () => {}, invalidate: async () => {} }
// typed: the five forms (ADR 0011) · press: every other dispatcher command, as the card's buttons and the pane's tabs run them
const typed = (w: Awaited<ReturnType<typeof world>>, args: string, origin: any = { kind: 'composer' }) => run(w.h, { command: 'cadre', args, origin }, async () => 'NEXT') as Promise<{ text: string }>
const press = (w: Awaited<ReturnType<typeof world>>, line: string, origin: any = { kind: 'press' }) => { const [cmd, ...args] = line.split(' '); return dispatch(w.h, { schemaVersion: 1, cmd, args, origin }, route) }
const withOps = async () => { const w = await world(); (w.h as any).ops = ops; return w }

describe('/cadre (ADR 0011): typed forms; the rest are presses', () => {
  test('bare /cadre opens the pane on the epic tab (Needs you on top when a decision waits)', async () => {
    const w = await withOps(); opened.length = 0
    expect(await typed(w, '')).toEqual({ text: 'Opened the cadre pane.' }); expect((await w.h.ui.read()).tab).toBe('epic')
    await plan(w); await w.h.board.update(b => ({ ...b, decisions: [{ id: 'd1', kind: 'x', title: 't', lines: [], hash: 'h', options: [] }] }))
    await typed(w, ''); expect((await w.h.ui.read()).tab).toBe('epic'); expect(opened).toHaveLength(2)
  })
  test('old subcommands typed: one line, nothing runs, no plan starts', async () => {
    const w = await world(); const { plan: p } = await plan(w)
    for (const t of [`approve ${p}`, `reject ${p} no`, 'resolve git keep', 'restore', 'status', 'open plan', 'config set strictness strict', 'drive on', 'adapter token', 'release'])
      expect(await typed(w, t)).toEqual({ text: HINT })
    expect((await w.h.board.read()).plan).toMatchObject({ id: p, state: 'draft' })
  })
  test('M6: an open human gate is approved by a press on its card (first press draws it), then resolved in the store; typed never', async () => {
    const w = await world(); const { plan: p } = await plan(w)
    await w.store.createDraft({ title: 'after gate', description: '', type: 'feature', parent: p, gate: { await: 'human' } })
    const g = (await w.store.list({ parent: p })).find(t => t.type === 'gate')!
    expect((await press(w, `approve ${g.id}`)).text).toContain('refused')   // no card yet: it is drawn now
    expect((await w.h.board.read()).decisions?.some(d => d.id === `gate:${g.id}`)).toBe(true)
    expect((await press(w, `approve ${g.id}`, { kind: 'composer' })).text).toContain('refused'); expect((await w.store.get(g.id)).category).not.toBe('done')
    expect((await press(w, `approve ${g.id}`)).text).toBe(`Gate ${g.id} approved.`); expect((await w.store.get(g.id)).category).toBe('done')
  })
  test('M5: a blocked epic is re-cut from dev with resolve <epic> recut (or cancelled)', async () => {
    const w = await world(); const { plan: p } = await plan(w)
    await w.h.board.update(b => ({ ...b, plan: { ...b.plan!, state: 'blocked', flags: ['lost-epic'] } }))
    expect((await press(w, `resolve ${p} recut`)).text).toContain('re-cut from dev')
    expect((await w.h.board.read()).plan).toMatchObject({ state: 'approved', flags: [] })
    await w.h.board.update(b => ({ ...b, plan: { ...b.plan!, state: 'blocked' } }))
    expect((await press(w, `resolve ${p} cancel`)).text).toBe(`Epic ${p} cancelled.`)
    expect((await w.h.board.read()).plan).toBeNull()
  })
  test('M7: restore [name] re-applies the quarantined stash and keeps it; only a press', async () => {
    const w = await world(); const ran: string[][] = []
    ;(w.h as any).run = async (argv: string[]) => { ran.push(argv); return { exitCode: 0, stdout: argv.includes('list') ? 'stash@{0} On main: cadre-q-a1-5\nstash@{1} On main: other\n' : '', stderr: '' } }
    expect((await press(w, 'restore')).text).toContain('no quarantined entry')
    await w.h.store.set(await scoped(w.h, 'quarantine'), [{ name: 'cadre-q-a1-5', tree: '/wt/a1', paths: ['x.ts'], ts: 5 }])
    expect((await press(w, 'restore cadre-q-a1-5')).text).toContain('Restored 1 path')
    expect(ran.some(a => a.join(' ') === 'git -C /wt/a1 stash apply stash@{0}')).toBe(true)
    expect((await press(w, 'restore x', { kind: 'bridge' })).text).toContain('refused')
  })
  test('commands owned elsewhere route through ROUTES; unknown ones never throw', async () => {
    const w = await world()
    ROUTES.drive = async (_h, c) => ({ text: `drive ${c.args.join(' ')}` }); expect(await press(w, 'drive status')).toEqual({ text: 'drive status' })
    expect((await press(w, 'frobnicate')).text).toContain('unknown /cadre subcommand "frobnicate"')
    delete ROUTES.drive
  })
})
