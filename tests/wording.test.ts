import { describe, expect, test } from 'claude-code/testing'
import { PROMPTS } from '../agents/prompts'
import { ROLES, file } from '../agents/index'
import { SPECS } from '../tools/index'
import { DESC, planRules } from '../native/tasks'
import { DISCOVERY } from '../core/briefs'
import { card, noReportCard } from '../core/render'
import { defaults } from '../task-management/registry'
import { GOLDEN } from './fixtures/briefs/golden'
import { GOLD } from './fixtures/render/golden'
import { check, guard, judge, send, setPolicy } from '../policy/guards'
import { fakeHost, task } from './support'
import { banned } from './fixtures/wording'
import { plan, world } from './fixtures/native/world'
import type { Binding } from '../types'

describe('need-to-know wording: what a model reads names tasks, not machinery', () => {
  test('agent prompts and files, tool descriptions, plan rules, briefs, cards', () => {
    expect(banned(PROMPTS, ROLES.map(file), SPECS.map(s => s.description), DESC, planRules(defaults()), DISCOVERY, GOLDEN, GOLD.context, GOLD.card, GOLD.get)).toEqual([])
    for (const r of ['worker', 'tester']) expect(banned(noReportCard({ id: 'bd-a1', title: 'T' }, r, 'worker'), card({ id: 'a', title: 'b', role: 'r', to: 't', flags: ['quarantine:main'], next: 'n' }))).toEqual([])
  })
  test('every deny of the file guard, the call guard and send names the next action in plain words', async () => {
    const EXISTS = ['/', '/x', '/x/repo', '/x/a1', '/x/a1.view', '/x/a1/f.ts', '/x/repo/a.ts', '/x/a1.view/t.ts']
    const h = fakeHost()
    h.stat = async (p: string, o?: { resolve?: boolean }) => (EXISTS.includes(p) ? { kind: 'file', realPath: o?.resolve ? p : undefined } : undefined)
    await setPolicy(h, { repo: '/x/repo', wtRoot: '/x', home: '/hm/u', locks: { 'bd-a1': ['/x/a1/lock.ts'] } })
    await h.board.update(s => ({ ...s, tasks: [task('bd-a1', { state: 'active', step: 'worker' })] }))
    const B = (role: Binding['role'], worktree: string): Binding => ({ taskId: 'bd-a1', role, step: 'worker', worktree, sessionId: 's', ctxTokens: 0, startedAt: 0 })
    await h.bind.update(() => ({ w1: B('worker', '/x/a1'), t1: B('tester', '/x/a1.view'), r1: B('reviewer', '/x/a1') }))
    const calls: any[] = [
      { tool: 'Bash', dangerouslyDisableSandbox: true }, { tool: 'Bash' }, { tool: 'CronCreate' }, { tool: 'Edit', file_path: '/x/repo/a.ts' },
      { tool: 'Bash', agentId: 'r1' }, { tool: 'Glob', agentId: 't1' }, { tool: 'Write', agentId: 't1', file_path: '/etc/passwd' }, { tool: 'Write', agentId: 't1', file_path: '/x/a1.view/../x' },
      { tool: 'Edit', agentId: 'w1', file_path: '/etc/passwd' }, { tool: 'Edit', agentId: 'w1', file_path: '/x/a1/.git/config' }, { tool: 'Edit', agentId: 'w1', file_path: '/x/a1/lock.ts' },
      { tool: 'Edit', agentId: 'zzz', file_path: '/x/a1/f.ts' }, { tool: 'Edit', agentId: 'w1', file_path: '/x/repo/a.ts' },
    ]
    const out: string[] = []
    for (const c of calls) { const r = await guard(h, c, () => 'ok') as any; expect(r?.deny).toBeString?.(); out.push(r?.deny) }
    out.push(judge({ tool: 'Bash', agentId: 'w1' })!, judge({ tool: 'Read' })!, judge({ tool: 'Edit', agentId: 'w1', file_path: '/x/a1/.git/x' })!)
    const s = await send(h, { agentId: 'w1', to: 'r1', text: 'see bd-a2' }, () => 'sent') as any
    await h.board.update(x => ({ ...x, tasks: [...x.tasks, task('bd-a2', { state: 'todo' })] }))
    out.push((await send(h, { agentId: 'w1', to: 'r1', text: 'see bd-a2' }, () => 'sent') as any).reason, s?.reason)
    expect(out.filter(Boolean).length).toBeGreaterThan(10)
    expect(banned(out.filter(Boolean))).toEqual([])
  })
  test('native Task* denies and refusals', async () => {
    const w = await world(), out: unknown[] = []
    out.push(await w.call('TaskCreate', { subject: 'X', description: '', metadata: { kind: 'plan' } }), await w.call('TaskCreate', { subject: 'Y', description: '', metadata: { kind: 'plan' } }))
    const { task: id } = await plan(await world())
    const u = await world(); const p = await plan(u)
    for (const input of [{ owner: 'x' }, { status: 'in_progress' }, { metadata: { 'cadre.step': 'x' } }, { status: 'pending' }]) out.push(await u.call('TaskUpdate', { taskId: p.task, ...input }))
    out.push(await u.call('TaskGet', { taskId: p.task }), id)
    expect(banned(out)).toEqual([])
  })
})
