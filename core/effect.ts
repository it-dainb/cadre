// L3 effect check (DESIGN 13.1): fingerprint, in-flight window attribution, stash quarantine, flags, protected-ref restore by CAS. Slot #6 `wrap` (+ later duties).
// Git runs through the injected h.run (ADR 0003): kit-testable with a scripted run.
import type { Hook, Host } from '../types'
import { emit } from './events'
import { inputPath, policyOf } from '../policy/guards'
import { drainDelta, idsIn } from './briefs'
import { logCall } from './specview'
import { UI } from './reuse'

const WRITERS = ['Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell', 'Monitor']
export const writes = (tool: string) => WRITERS.includes(tool) || (tool.startsWith('mcp__') && !tool.startsWith('mcp__cadre__'))   // no write capability in any allowlist -> skipped
const STATUS = ['status', '--porcelain=v2', '-z', '--', '.', ':(exclude).cadre', ':(exclude).beads', ':(exclude).claude/settings.local.json']
const git = (h: Host, tree: string, ...a: string[]) => h.run(['git', '-C', tree, ...a])

// Records of `status --porcelain=v2 -z`, keyed by the record text -> its path (a rename record owns the following origin path).
export function parse(s: string): Map<string, string> {
  const r = s.split('\0').filter(Boolean), m = new Map<string, string>()
  for (let i = 0; i < r.length; i++) {
    const t = r[i][0], f = r[i].split(' ')
    if (t === '2') { m.set(`${r[i]}\0${r[i + 1]}`, f.slice(9).join(' ')); i++ } else m.set(r[i], t === '?' || t === '!' ? r[i].slice(2) : f.slice(t === 'u' ? 10 : 8).join(' '))
  }
  return m
}
const changed = (before: string | undefined, now: string): string[] => { const b = parse(before ?? ''); return [...parse(now)].filter(([k]) => !b.has(k)).map(([, p]) => p) }
const refMap = (s: string) => new Map(s.split('\n').filter(Boolean).map(l => [l.slice(41), l.slice(0, 40)] as const))

// Fingerprint of the given trees (+ the protected-ref list when the main checkout is in scope).
async function fingerprint(h: Host, trees: string[], repo: string): Promise<Record<string, string>> {
  const fp: Record<string, string> = {}
  for (const t of trees) {
    fp[`s:${t}`] = (await git(h, t, ...STATUS)).stdout
    fp[`h:${t}`] = (await git(h, t, 'rev-parse', 'HEAD')).stdout.trim()
  }
  if (trees.includes(repo)) fp.refs = (await git(h, repo, 'for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads')).stdout
  return fp
}

async function raise(h: Host, flag: string, taskId: string, info: { ref?: string; old?: string; tip?: string } = {}, text = flag) {
  if ((await h.git.read()).flags?.[flag]) return
  await h.git.update(g => ({ ...g, flags: { ...g.flags, [flag]: info } }))
  await emit(h, 'flag.raised', { taskId, flag }, { taskId: taskId || undefined })
  h.toast(`cadre: ${text}`)
}

const isProtected = (branch: string, protect: string[] = ['main', 'dev']) => protect.includes(branch) || branch.startsWith('epic/')

// One audit: scope = main + caller's worktree (sandbox on) or everything (sweep / degraded / effectCheck always).
export async function audit(h: Host, caller: string | null): Promise<void> {
  const g = await h.git.read(), pol = await policyOf(h)
  if (g.busy || !pol.repo || pol.effectCheck === 'off') return
  const binds = await h.bind.read()
  const owners: Record<string, string> = { [pol.repo]: '' }
  for (const [id, b] of Object.entries(binds)) if (b.role !== 'tester') owners[b.worktree] = id   // views are not git trees (3.5.3)
  const full = caller === null || pol.effectCheck === 'always' || (await h.board.read()).containment.state !== 'contained' || !binds[caller]
  const scope = full ? Object.keys(owners) : [...new Set([pol.repo, binds[caller!].worktree])]
  const now = await fingerprint(h, scope, pol.repo), base = g.fp
  const open = [...new Set(Object.values(g.win?.open ?? {}))]
  const save = (fp: Record<string, string>, loops: string[]) => h.git.update(x => ({ ...x, fp: { ...x.fp, ...fp, epoch: String(x.epoch) }, win: { open: x.win?.open ?? {}, loops } }))   // the window restarts at each audit with the calls still in flight
  if (!base || base.epoch !== String(g.epoch)) return void (await save(now, open))   // first sight or a mod git op: re-baseline, no verdict
  const loops = g.win?.loops ?? [], agentLoop = loops.some(l => l !== ''), after = { ...now }
  for (const t of scope) {
    if (base[`s:${t}`] === undefined) continue
    const paths = changed(base[`s:${t}`], now[`s:${t}`]), o = owners[t]
    if (!paths.length) continue
    const tid = o ? binds[o].taskId : ''
    const locked = pol.locks?.[tid] ?? []
    const bad = o ? (loops.includes(o) ? paths.filter(p => locked.some(l => p === l || l.endsWith('/' + p))) : paths) : agentLoop ? paths : []   // rule 1 / rule 2
    if (!bad.length) { if (!o && !agentLoop) await raise(h, 'git:main-dirty', '', {}, 'main checkout changed outside cadre'); continue }
    const ts = await h.now(), name = `cadre-q-${tid || 'main'}-${ts}`
    const r = await git(h, t, 'stash', 'push', '-u', '-m', name, '--', ...bad)
    await raise(h, r.exitCode ? `quarantine-failed:${tid || 'main'}` : `quarantine:${tid || 'main'}`, tid, {}, `${bad.length} path(s) quarantined (${name})`)
    if (!r.exitCode) { const q = ((await h.store.get('quarantine')) as unknown[]) ?? []; await h.store.set('quarantine', [...q, { name, tree: t, paths: bad, ts }]); Object.assign(after, await fingerprint(h, [t], pol.repo)) }
  }
  if (scope.includes(pol.repo) && base.refs !== undefined) {   // rule 3: protected refs moved outside a cadre merge (epoch unchanged)
    const was = refMap(base.refs), is = refMap(now.refs)
    for (const [ref, old] of was) {
      const br = ref.replace(/^refs\/heads\//, ''), tip = is.get(ref)
      if (tip !== old && isProtected(br, pol.protect)) await raise(h, agentLoop ? `git:${br}:agent` : `git:${br}`, '', { ref, old, tip }, `protected branch ${br} moved outside cadre`)
    }
  }
  await save(after, open)
}

// #6 tool.call wrap: L3 window + audit for writers; then the delta drain (4.3), the foreground result card (S39), the tester call log (3.5.2).
export const wrap: Hook = async (h, e, next) => {
  const r = await (writes(e.tool) ? audited(h, e, next) : next(e))
  try { return await after(h, e, r) } catch (x) { h.log(`cadre: wrap after-call failed: ${x}`); return r }
}
async function after(h: Host, e: any, r: any): Promise<any> {
  if (!e.agentId) {   // main's foreground Agent call: the task's card replaces the hand-back text (r.result.content[0].text, S39)
    if (e.tool !== 'Agent' || !r?.result?.content?.[0]) return r
    const s = await h.board.read(), [id] = idsIn(String(e.prompt ?? e.input?.prompt ?? ''), s.tasks.map(t => t.id)), t = s.tasks.find(x => x.id === id)
    if (!t?.card) return r
    if (e.tool_use_id) await UI.mapCard?.(h, e.tool_use_id, t.id)
    return { ...r, result: { ...r.result, content: [{ ...r.result.content[0], text: t.card.replace('\n', ' · ') }, ...r.result.content.slice(1)] } }
  }
  const b = (await h.bind.read())[e.agentId]
  if (b?.role === 'tester') await logCall(h, e.agentId, { tool: e.tool, path: inputPath(e.tool, e.input ?? e, b.worktree), outcome: r?.deny ? String(r.deny) : r?.error ? 'error' : 'ok' })
  const d = b && (await drainDelta(h, e.agentId))
  return d ? { ...r, context: [...(r?.context ?? []), d] } : r
}
async function audited(h: Host, e: any, next: (e: any) => any) {
  const loop = e.agentId ?? '', id = e.tool_use_id ?? h.rand(4)
  await h.git.update(g => ({ ...g, win: { loops: [...new Set([...(g.win?.loops ?? []), loop])], open: { ...g.win?.open, [id]: loop } } }))
  try { return await next(e) } finally {
    await h.git.update(g => { const { [id]: _d, ...open } = g.win?.open ?? {}; return { ...g, win: { loops: g.win?.loops ?? [], open } } })   // this call is over, but stays in the window it is about to be audited in
    await audit(h, loop).catch(x => h.log(`cadre: effect audit failed: ${x}`))
  }
}

// Full sweep: at every turn.complete (core/close.observe calls it) and before every merge.
export const sweep = (h: Host) => audit(h, null)

// `resolve git keep|restore <flag>`: keep accepts the move; restore saves the tip to refs/cadre/quarantine and CAS-moves the ref back (Q4).
export async function resolveGit(h: Host, flag: string, how: 'keep' | 'restore'): Promise<{ ok: boolean; error?: string }> {
  const f = (await h.git.read()).flags?.[flag], pol = await policyOf(h)
  if (!f || !pol.repo) return { ok: false, error: `no open flag ${flag}` }
  if (how === 'restore') {
    if (!f.ref || !f.old) return { ok: false, error: `${flag} cannot be restored` }
    if (f.tip) {
      const s = await git(h, pol.repo, 'update-ref', `refs/cadre/quarantine/${f.ref.replace(/^refs\/heads\//, '')}-${await h.now()}`, f.tip)
      if (s.exitCode) return { ok: false, error: s.stderr }
    }
    const r = await git(h, pol.repo, 'update-ref', f.ref, f.old, ...(f.tip ? [f.tip] : []))   // CAS: only if still at the tip we saw
    if (r.exitCode) return { ok: false, error: `ref moved again: ${r.stderr}` }
  }
  const refs = (await git(h, pol.repo, 'for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads')).stdout
  await h.git.update(g => { const { [flag]: _d, ...flags } = g.flags ?? {}; return { ...g, flags, fp: { ...g.fp, refs } } })
  await emit(h, 'flag.resolved', { taskId: '', flag })
  return { ok: true }
}
