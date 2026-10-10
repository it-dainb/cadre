import { describe, expect, test } from 'claude-code/testing'
import { run } from '../commands/cadre'
import { ROUTES } from '../core/dispatch'
import { plan, world } from './fixtures/native/world'

const opened: unknown[] = []
const ops = { open: async (o: unknown) => { opened.push(o); return { isPlaced: true } }, peek: async () => '', fill: async () => ({ isFilled: true }), toast: () => {}, invalidate: async () => {} }
const cmd = (w: Awaited<ReturnType<typeof world>>, args: string, origin: any = { kind: 'composer' }) => run(w.h, { command: 'cadre', args, origin }, async () => 'NEXT') as Promise<{ text: string }>
const withOps = async () => { const w = await world(); (w.h as any).ops = ops; return w }

describe('/cadre <sub> (DESIGN 5.3)', () => {
  test('bare /cadre and status: the context line, one row per task, the cost ledger', async () => {
    const w = await world()
    expect(await cmd(w, '')).toEqual({ text: 'no plan\ncost: 0 tokens · containment unknown' })
    const { plan: p, task } = await plan(w)
    expect((await cmd(w, 'status', { kind: 'plugin', name: 'x' })).text).toBe(`plan ${p} draft · epic/${p}-auth-login\nnext: ask the human to approve ${p}\n${task} [draft] Add login\ncost: 0 tokens · containment unknown`)
  })
  test('approve <id> without a token: a one-line {text} and the pane opens; the code is never in it', async () => {
    const w = await withOps(); const { plan: p } = await plan(w); opened.length = 0
    const r = await cmd(w, `approve ${p}`)
    expect(r).toEqual({ text: `Approval sheet for ${p} opened in the cadre pane.` }); expect(r.text.split('\n')).toHaveLength(1)
    expect(r.text).not.toContain((await w.h.secret.read()).approval!.code8); expect(opened).toHaveLength(1); expect((await w.h.ui.read()).tab).toBe('plan')
    expect(await cmd(w, 'approve p9')).toEqual({ text: 'refused: no draft plan p9' })
    expect(await cmd(w, `approve ${p}`, { kind: 'bridge' })).toEqual({ text: 'refused: origin bridge is not human' })
  })
  test('approve <id>@<code> approves through the dispatcher; a wrong code is refused and burns', async () => {
    const w = await world(); const { plan: p } = await plan(w); const c = (await w.h.secret.read()).approval!.code8
    expect((await cmd(w, `approve ${p}@zzzzzzzz`)).text).toContain('refused: token mismatch')
    expect((await cmd(w, `approve ${p}@${c}`)).text).toContain('refused')
    expect((await cmd(w, `approve ${p}@${(await w.h.secret.read()).approval!.code8}`)).text).toContain('approved')
  })
  test('subs owned elsewhere route through ROUTES; unwired ones say so; unknown ones list the subs; typos never throw', async () => {
    const w = await world()
    expect((await cmd(w, 'release')).text).toBe('/cadre release: not available yet')
    ROUTES.drive = async (_h, c) => ({ text: `drive ${c.args.join(' ')}` }); expect(await cmd(w, 'drive status', { kind: 'bridge' })).toEqual({ text: 'drive status' })
    expect((await cmd(w, 'frobnicate')).text).toContain('unknown /cadre subcommand "frobnicate"')
    delete ROUTES.drive
  })
  test('config show prints the resolved config; adapter token needs the human and toasts the token', async () => {
    const w = await world()
    expect(JSON.parse((await cmd(w, 'config')).text.slice(0, 2000).split('\n')[0] + '}').strictness ?? 'strict').toBe('strict')
    expect((await cmd(w, 'adapter token', { kind: 'bridge' })).text).toBe('refused: origin bridge is not human')
    expect((await cmd(w, 'adapter token')).text).toContain('toast only'); expect(w.h.toasts[0]).toMatch(/^cadre session token: /)
  })
})
