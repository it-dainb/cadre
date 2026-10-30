// Delivery hooks (plan 2.7): the profile's argv per event, run by core/modrun in a detached working folder cut at the branch tip. Core stages and commits what a hook changed with the
// static template, after an audit of the changed paths; the commit lands by CAS (the same `move` as every protected branch), never by the hook. A lost CAS or a failing hook leaves
// the branch untouched and raises `hook-failed`. No regex here.
import type { Host } from '../types'
import type { HookEvent } from '../types/profile'
import { active, fill } from './pipeline'
import { modrun } from './modrun'
import { emit } from './events'
import { baseOf, move, wtPath } from './branches'
import { commitAll, git, isProt, op, tip, worktreeRemove } from './git'
import { scoped } from '../commands/init'

type Dirs = { root: string; wtRoot: string; key: string }
type Pending = { ev: HookEvent; base: string; input: Record<string, unknown>; vars: Record<string, string> }
const MINUTE = 60_000
const semver = (v: unknown) => typeof v === 'string' && v.split('.').length === 3 && v.split('.').every(p => p !== '' && String(Number(p)) === p)
const changed = async (h: Host, wt: string) => [...new Set([...(await git(h.run, wt, ['ls-files', '-z', '-m', '-o', '-d', '--exclude-standard'])).split('\0'), ...(await git(h.run, wt, ['diff', '--cached', '--name-only', '-z'])).split('\0')])].filter(Boolean)

// The event's hooks over a working folder cut at `at`: each runs, its changes are audited and committed. Returns the last commit (`at` itself when nothing changed) and the version a hook named.
// `dry`: the hooks only answer (a `version`), in `root`, and commit nothing.
export async function runHooks(h: Host, d: Dirs, ev: HookEvent, at: string, input: Record<string, unknown>, vars: Record<string, string> = {}, dry = false): Promise<{ sha: string; version?: string } | { why: string }> {
  const hs = (active().hooks[ev] ?? []).filter(x => 'run' in x) as { run: string[]; commit?: string; envPass?: string[] }[]; let sha = at, version = vars.version
  if (!hs.length) return { sha }
  const wt = wtPath(d.wtRoot, d.key, `hook-${h.rand(4)}`)
  if (!dry) await git(h.run, d.root, ['worktree', 'add', '--detach', wt, at])
  try {
    for (const x of hs) {
      const v = { ...vars, ...(version ? { version } : {}) }, r = await modrun(h, { argv: x.run.map(a => fill(a, v)), cwd: dry ? d.root : wt, input: { event: ev, ...input, ...(version ? { version } : {}), ...(dry ? { dry } : {}) }, scratch: `${wt}.mod`, envPass: x.envPass, timeoutMs: MINUTE })
      const res = r.result as { version?: unknown; note?: unknown } | undefined, bad = r.bad ?? (res !== undefined && (typeof res !== 'object' || res === null || Object.keys(res).some(k => k !== 'version' && k !== 'note') || (res.version !== undefined && !semver(res.version))) ? 'its result has the wrong shape' : '')
      if (r.timedOut) return { why: 'a hook timed out' }
      if (r.exit || bad) return { why: bad || (typeof res?.note === 'string' ? res.note : `a hook failed (exit ${r.exit})`) }
      if (typeof res?.version === 'string') version = res.version
      if (dry) continue
      if ((await tip(h.run, wt, 'HEAD')) !== sha) return { why: 'a hook moved the branch itself' }
      const paths = await changed(h, wt); if (!paths.length) continue
      const prot = paths.find(p => isProt(p)); if (prot) return { why: `a hook changed ${prot}, which only the person edits` }
      if (!x.commit) return { why: 'a hook changed files but has no commit message' }
      try { sha = (await commitAll(h.run, wt, fill(x.commit, v))) ?? sha } catch (e) { return { why: `the commit failed: ${(e as Error).message.slice(0, 120)}` } }
    }
    return { sha, version }
  } finally { await h.run(['rm', '-rf', `${wt}.mod`]); if (!dry) await worktreeRemove(h.run, d.root, wt).catch(() => {}) }
}

// Land the event's commit on `base` (a task's epic branch, or dev) by CAS. A failure keeps what the hooks needed, so Retry runs them again (retryHooks) and Skip drops them.
export async function deliver(h: Host, d: Dirs, ev: HookEvent, o: { id: string; base: string; input: Record<string, unknown>; vars: Record<string, string> }): Promise<void> {
  // under the merge lock (git.op): the hooks and the CAS see one branch tip; a busy lock is a failure Retry can run again
  const why = await op(h, async () => {
    const old = await tip(h.run, d.root, await baseOf(h, o.base)), r = await runHooks(h, d, ev, old, o.input, o.vars)
    return 'why' in r ? r.why : r.sha === old || (await move(h, o.base, r.sha, old)) ? '' : 'the branch moved while the hooks ran'
  }).catch((e: Error) => e.message)
  const K = await scoped(h, 'hooks'), all = ((await h.store.get(K)) as Record<string, Pending> | undefined) ?? {}
  if (!why) { if (all[o.id]) { const { [o.id]: _x, ...rest } = all; await h.store.set(K, rest) } return }
  h.log(`${ev} hooks for ${o.id}: ${why}`)
  await h.store.set(K, { ...all, [o.id]: { ev, base: o.base, input: o.input, vars: o.vars } })
  await h.board.update(b => (b.plan?.id === o.id ? { ...b, plan: { ...b.plan, flags: [...new Set([...(b.plan.flags ?? []), 'hook-failed'])] } } : { ...b, tasks: b.tasks.map(t => (t.id === o.id && !t.flags.includes('hook-failed') ? { ...t, flags: [...t.flags, 'hook-failed'] } : t)) }))
  await emit(h, 'flag.raised', { taskId: o.id, flag: 'hook-failed' }, { taskId: o.id })
}

// the tick: a failed delivery whose flag the person cleared (Retry) runs again, once; the next failure raises it again
export async function retryHooks(h: Host, d: Dirs): Promise<void> {
  const K = await scoped(h, 'hooks'), all = ((await h.store.get(K)) as Record<string, Pending> | undefined) ?? {}, b = await h.board.read()
  for (const [id, p] of Object.entries(all)) if (!(b.plan?.id === id ? b.plan.flags ?? [] : b.tasks.find(t => t.id === id)?.flags ?? []).includes('hook-failed')) await deliver(h, d, p.ev, { id, ...p })
}
// Skip: the failed delivery is given up
export async function dropHooks(h: Host, id: string): Promise<void> {
  const K = await scoped(h, 'hooks'), { [id]: _x, ...rest } = ((await h.store.get(K)) as Record<string, Pending> | undefined) ?? {}; await h.store.set(K, rest)
}
