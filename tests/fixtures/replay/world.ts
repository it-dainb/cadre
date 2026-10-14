// Replay world (tests/replay.test.ts): one approved plan in a MemoryStore, a scripted git, a fakeHost whose spawnAgent goes through admission as the spawner's own call.
// Synthetic: generic ids, titles and paths. `git` answers every git call; a row overrides single commands with o.git.
import type { Binding, Host, Role } from '../../../types'
import { MemoryStore } from '../../../task-management/adapters/memory/store'
import { defaults } from '../../../config/index'
import { admitWith, resolveDeps } from '../../../core/admission'
import { handleWith } from '../../../tools/index'
import { guard } from '../../../policy/guards'
import { drain } from '../../../core/reuse'
import { observeWith } from '../../../core/close'
import { spawnStep } from '../../../core/spawner'
import { classify, step as lifeStep } from '../../../core/lifecycle'
import { fakeHost, task } from '../../support'

export const TIP = 'c0ffee1', HEAD = 'feed001'   // the plan tip; every task tree's HEAD (a commit past its base)
type R = { exitCode?: number; stdout?: string; stderr?: string }
export const ACCEPT = 'S1: Given a request When it runs Then it answers'

export async function world(o: { n?: number; type?: string; ids?: string[]; mode?: 'mod' | 'main'; drive?: 'auto' | 'yolo'; pkg?: object; git?: (a: string[]) => R | undefined; kv?: Map<string, unknown>; store?: MemoryStore; session?: string } = {}) {
  const clock = { now: 1_700_000_000_000 }, kv = o.kv ?? new Map<string, unknown>(), calls: string[] = [], sent: [string, string][] = [], submitted: string[] = [], spawned: [string, string, string][] = []
  const store = o.store ?? new MemoryStore(() => clock.now), fresh = !o.store
  const cfg = defaults(); cfg.drive.spawn = o.mode ?? 'mod'; cfg.jail = 'off' as any; cfg.packages = [(o.pkg ?? { root: '.', verify: ['verify'], checks: { verify: ['true'], test: ['true'] } }) as any]
  let epic = '', ids: string[] = []
  if (fresh) {
    await store.init({ types: cfg.types as any, journal: true }); epic = await store.createEpic('Service', 'goal')
    for (let i = 0; i < (o.n ?? 1); i++) ids.push((await store.createDraft({ title: `task ${i}`, description: 'd', acceptance: ACCEPT, type: o.type ?? 'docs', parent: epic, meta: { 'cadre.package': '.', 'cadre.changelog': JSON.stringify({ none: true, reason: 'internal' }) } })).id)
    if (o.ids) ids = ids.map((id, i) => rename(store, id, o.ids![i] ?? id))   // e.g. an id with "_" (bd names ids after the repo folder)
    await store.approve([epic, ...ids])
  }
  const run = async (argv: readonly string[]) => {
    const a = [...argv], j = a.join(' '); calls.push(j)
    const x = o.git?.(a); if (x) return { exitCode: 0, stdout: '', stderr: '', ...x }
    if (a[0] !== 'git') return { exitCode: 0, stdout: '', stderr: '' }
    return { exitCode: j.includes('diff --cached --quiet') ? 1 : 0, stdout: a.includes('rev-parse') ? `${j.includes('HEAD') ? HEAD : TIP}\n` : '', stderr: '' }
  }
  const h = fakeHost({ env: { CADRE_SPAWN: o.mode ?? 'mod' } }) as any
  Object.assign(h, {
    now: async () => (clock.now += 1000), run, taskStore: async () => store, config: async () => cfg, usage: async () => ({ cost: { usd: 0 } }),
    store: { get: async (k: string) => kv.get(k), set: async (k: string, v: unknown) => { kv.set(k, v) }, del: async (k: string) => { kv.delete(k) } },
    sendTo: async (id: string, t: string) => { sent.push([id, t]); return { isDelivered: true } }, submit: async (t: string) => { submitted.push(t) },
  })
  await h.secret.update((s: any) => ({ ...s, session: o.session ?? 's1' }))
  const dep = await resolveDeps(h)
  await h.board.update((s: any) => ({ ...s, containment: { state: 'contained', unsandboxed: 0 } }))   // drawn at wake (policy/containment)
  if (fresh) await h.board.update((s: any) => ({ ...s, seq: 1, epic, plan: { id: epic, slug: 'service', state: 'approved', epicBranch: 'epic/p1-service', mode: o.drive ?? 'auto' },
    tasks: ids.map(id => task(id, { title: `task ${ids.indexOf(id)}`, type: o.type ?? 'docs' })) }))
  let k = 0
  const cadre = Object.assign(async (e: any) => { const id = `ag${++k}`; spawned.push([id, e.prompt, e.subagentType]); return { agentId: id, model: 'm' } }, { origin: { plugin: 'cadre' } })
  h.spawnAgent = (a: any) => admitWith(h, dep, { ...a, background: true }, cadre)
  const w = {
    h: h as Host & { logs: string[]; spawnAgent: any }, store, cfg, dep, kv, clock, calls, sent, submitted, spawned, epic, ids, cadre,
    turn: () => spawnStep(h, 'turn.complete'),   // an agent's turn end reaching the spawner
    rep: (agentId: string, body: object) => handleWith(h, dep, { tool: 'mcp__cadre__report', agentId, input: { schemaVersion: 1, ...body } }).then(r => r.result),
    hb: (agentId: string) => guard(h, { tool: 'SubagentHandback', agentId, input: { message: 'my work is done' } }, async (e: any) => e) as Promise<any>,
    stop: (agentId: string, reason = 'answer', answer = '') => drain(h, { agentId, reason, answer }, (e: any) => observeWith(h, dep, e, () => ({}))),   // #1 drain wraps #2 observe, as registered
    // an agent of `role` already at work on `id` (the claim is not what the row replays)
    at: async (agentId: string, id: string, role: Role, step: string = role) => {
      await store.claim(id, dep.actor); await store.setMeta(id, { 'cadre.step': step, 'cadre.worktree': `/wt/${id}`, 'cadre.branch': `docs/${id}`, 'cadre.base': 'base000' }, dep.actor)
      await h.board.update((s: any) => ({ ...s, tasks: s.tasks.map((t: any) => (t.id === id ? { ...t, state: step === 'reviewer' ? 'review' : 'active', step, owner: dep.actor } : t)) }))
      if (step === 'reviewer') await store.move(id, 'review', dep.actor)
      await h.bind.update((b: Record<string, Binding>) => ({ ...b, [agentId]: { taskId: id, role, step, worktree: `/wt/${id}`, sessionId: dep.session, ctxTokens: 0, startedAt: 0 } }))
      await lifeStep(h, agentId, { type: 'spawn.ok', taskId: id, role, step })   // as admission records it
    },
    state: async (agentId: string, taskId?: string) => {
      const b = await h.bind.read(), id = b[agentId]?.taskId ?? taskId
      return classify({ bind: b, tasks: (await h.board.read()).tasks, ui: await h.ui.read(), meta: id ? (await store.get(id).catch(() => undefined))?.meta : undefined }, agentId, taskId)
    },
  }
  return w
}
export type World = Awaited<ReturnType<typeof world>>
export const PASS = { role: 'reviewer', verdict: 'pass', summary: 'ok', findings: [], coverage: [{ scenario: 'S1', test: 'test/a.test.js', ok: true }], contractStatus: [] }

// MemoryStore names ids m-<n>; a row that needs another id renames it in place
function rename(store: MemoryStore, id: string, to: string): string {
  const db = (store as any).db() as Map<string, any>, t = db.get(id); db.delete(id); t.id = to; db.set(to, t); return to
}
