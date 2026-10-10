// L1 capability allowlist, file fence (DESIGN 13.1-13.2), tool.check allow, session.send isolation (4.6), config.set guard. Slots #4, #5, #7, config.set.
import type { Binding, Host, Hook } from '../types'
import { MAIN_TOOLS, allowlist } from '../agents/index'
import { repoKeyOf } from '../commands/init'
import { logCall } from '../core/specview'

// Paths the guards need, written to $.store `cadre:<repoKey>:policy` by init/session.start/tdd (absolute, realpath'd). Absent keys disable the rule they feed.
export interface Policy { repo?: string; wtRoot?: string; home?: string; mcpAllow?: string[]; locks?: Record<string, string[]>; protect?: string[]; effectCheck?: string }
export const policyKey = async (h: Host) => `cadre:${repoKeyOf(await h.cwd())}:policy`   // per repo (13.5): two repos never share one
export const policyOf = async (h: Host): Promise<Policy> => ((await h.store.get(await policyKey(h))) as Policy | undefined) ?? {}
export const setPolicy = async (h: Host, patch: Policy) => h.store.set(await policyKey(h), { ...(await policyOf(h)), ...patch })

const SHELL = ['Bash', 'PowerShell', 'Monitor'], FILE = ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'NotebookEdit'], FENCED = ['Edit', 'Write', 'NotebookEdit']
const MOD_DIRS = ['.git', '.cadre', '.beads', '.claude'], MOD_FILES = ['.mcp.json', 'CHANGELOG.md']
const under = (p: string, root?: string) => !!root && (p === root || p.startsWith(root.replace(/\/$/, '') + '/'))
const join = (cwd: string, p: string) => (p.startsWith('/') ? p : `${cwd.replace(/\/$/, '')}/${p}`)
const modOwned = (real: string, home?: string) => {
  const seg = real.split('/')
  return seg.some(s => MOD_DIRS.includes(s)) || MOD_FILES.includes(seg[seg.length - 1]) || (!!home && /^cadre\.json$|^settings.*\.json$/.test(seg[seg.length - 1]) && under(real, home + '/.claude'))
}

// Step 0 of the fence: the path a file tool will touch, per tool (input fields). Glob with an absolute pattern: its non-glob base dir.
export function inputPath(tool: string, i: any, cwd: string): string | undefined {
  const v = (x: unknown) => (typeof x === 'string' && x ? x : undefined)
  if (tool === 'Read' || tool === 'Write' || tool === 'Edit') return v(i?.file_path)
  if (tool === 'NotebookEdit') return v(i?.notebook_path)
  if (tool === 'Grep') return v(i?.path) ?? cwd
  if (tool === 'Glob') {
    const pat = v(i?.pattern)
    if (pat?.startsWith('/')) { const seg = pat.split('/'), k = seg.findIndex(s => /[*?[{]/.test(s)); const base = (k < 0 ? seg.slice(0, -1) : seg.slice(0, k)).join('/'); return base || '/' }
    return v(i?.path) ?? cwd
  }
}

// Step 1: where the path lands; a new file resolves its folder (SA-04). undefined = cannot place it.
async function placed(h: Host, p: string): Promise<string | undefined> {
  const cut = p.lastIndexOf('/'), name = p.slice(cut + 1)
  if (!name || name === '.' || name === '..') return (await h.stat(p, { resolve: true }))?.realPath
  const own = await h.stat(p, { resolve: true })
  if (own) return own.realPath
  const dir = await h.stat(cut < 0 ? '.' : p.slice(0, cut + 1), { resolve: true })
  return dir?.realPath === undefined ? undefined : `${dir.realPath.replace(/\/$/, '')}/${name}`
}

// Who is calling: role + binding. Unknown ids and marker-less forks are explorers; no agentId = main.
async function who(h: Host, agentId?: string) {
  const b: Binding | undefined = agentId ? (await h.bind.read())[agentId] : undefined
  const task = b && (await h.board.read()).tasks.find(t => t.id === b.taskId)
  return { b, task, main: !agentId, role: b?.role ?? 'explorer' as const, owner: !!b && task?.state === 'active' }
}

const strict = async (h: Host) => ((await h.env()).CADRE_STRICTNESS ?? h.options.strictness ?? 'strict') !== 'advisory'

// Fence verdict for one file-tool call: undefined = allow-by-fence (continue), 'allow' = tester rule 2, else a deny reason.
async function fence(h: Host, w: Awaited<ReturnType<typeof who>>, tool: string, input: unknown, pol: Policy): Promise<string | 'allow' | undefined> {
  const tester = w.role === 'tester' && !w.main
  const fenced = FENCED.includes(tool) || (tool === 'Read' && !!pol.home && typeof (input as any)?.file_path === 'string' && (input as any).file_path.includes('/.claude/plugins/store/'))
  if (!tester && !fenced) return
  if (!FILE.includes(tool)) return tester ? `cadre: ${tool} is not a tester tool` : undefined
  const cwd = w.b?.worktree ?? pol.repo ?? '/'
  const p = inputPath(tool, input, cwd)
  const real = p === undefined ? undefined : await placed(h, join(cwd, p))
  if (real === undefined) return 'cadre: cannot place the path'
  if (tester) return under(real, w.b!.worktree) ? 'allow' : `cadre: tester is confined to ${w.b!.worktree}`
  if ((under(real, pol.repo) || under(real, pol.wtRoot)) && !(w.owner && under(real, w.b!.worktree))) return 'cadre: only an active task owner writes, and only in its worktree'
  if (modOwned(real, pol.home)) return 'cadre: mod-owned path'
  if (w.owner && w.task?.step === 'worker' && (pol.locks?.[w.b!.taskId] ?? []).some(l => real === l || under(real, l))) return 'cadre: locked spec test'
}

// Pure L1 facts that need no state: the sandbox flag.
const escape = (e: any) => (e?.dangerouslyDisableSandbox === true || e?.input?.dangerouslyDisableSandbox === true ? 'cadre: dangerouslyDisableSandbox is denied' : undefined)

// Event-only judgement for the re-entry .catch (G2): a deny reason, or undefined to let the call through. Must not use $.
export const judge = (e: any): string | undefined => {
  if (escape(e)) return escape(e)
  if (!e.agentId) return MAIN_TOOLS.includes(e.tool) ? undefined : `cadre: ${e.tool} is not allowed for main`
  const p = e.file_path ?? e.notebook_path
  if (FENCED.includes(e.tool) && typeof p === 'string' && modOwned(p)) return 'cadre: mod-owned path'
}

// #5 tool.call guards: L1 allowlist, fence. Judge before next. Advisory: denies become warnings.
export const guard: Hook = async (h, e, next) => {
  const deny = async (): Promise<string | undefined> => {
    const bad = escape(e); if (bad) return bad
    const w = await who(h, e.agentId), pol = await policyOf(h)
    const list = w.main ? MAIN_TOOLS : allowlist(w.role, w.role === 'worker' ? pol.mcpAllow : [])
    if (!list.includes(e.tool)) return `cadre: ${e.tool} is not in the ${w.main ? 'main' : w.role} allowlist`
    if (SHELL.includes(e.tool) && !(w.role === 'worker' && w.owner && w.task?.step === 'worker')) return 'cadre: shell only for a bound worker in the worker step'
    const f = await fence(h, w, e.tool, e, pol)
    return f === 'allow' ? undefined : f
  }
  const why = await deny()
  if (!why) return next(e)
  const tb = e.agentId && (await h.bind.read())[e.agentId]
  if (tb && tb.role === 'tester') await logCall(h, e.agentId, { tool: e.tool, path: inputPath(e.tool, e.input ?? e, tb.worktree), outcome: why })   // the view audit counts refusals too (3.5.2)
  if (await strict(h)) return { deny: why }
  h.log(`cadre advisory: ${why}`); return next(e)
}

// #4 tool.check allow mirrors fence rule 2 (tester) and rule 3 (owner); anything else is the engine's call. Fail-closed answer is {decision:'deny'}.
export const check: Hook = async (h, e, next) => {
  const tool = e.tool as string
  if (!e.agentId || !FILE.includes(tool)) return next(e)
  const w = await who(h, e.agentId)
  if (!w.b) return next(e)
  const pol = await policyOf(h)
  if (tool === 'Read' && w.role !== 'tester' && w.b.worktree) {   // S26: Read needs the allow too (outside the session cwd it prompts), only inside its own tree
    const p = inputPath(tool, e.input, w.b.worktree), real = p === undefined ? undefined : await placed(h, join(w.b.worktree, p))
    return real && under(real, w.b.worktree) ? { decision: 'allow', reason: 'cadre: inside its own tree' } : next(e)
  }
  if (w.role !== 'tester' && !(w.owner && FENCED.includes(tool))) return next(e)
  const f = await fence(h, w, tool, e.input, pol)
  return f === 'allow' || f === undefined ? { decision: 'allow', reason: 'cadre: inside its own tree' } : next(e)
}

// Known-id matcher (4.6): maximal [A-Za-z0-9.-] runs, trailing . - stripped, optional TASK- removed, exact lookup.
export const idsIn = (text: string, known: Set<string>): string[] =>
  (text.match(/[A-Za-z0-9.-]+/g) ?? []).map(r => r.replace(/[.-]+$/, '').replace(/^TASK-/, '')).filter(r => known.has(r))

// #7 session.send: SendMessage naming another task id -> {isDelivered:false} (4.6).
export const send: Hook = async (h, e, next) => {
  const b = (await h.bind.read())
  const own = (e.agentId && b[e.agentId]) || b[e.to]
  if (!own) return next(e)
  const known = new Set((await h.board.read()).tasks.map(t => t.id))
  const other = idsIn(`${e.to} ${e.text}`, known).find(id => id !== own.taskId)
  return other ? { isDelivered: false, reason: `cadre: this agent works on ${own.taskId} only; it may not name ${other}` } : next(e)
}

// config.set: refuse strictness changes while tasks run.
export const configSet: Hook = async (h, e, next) => {
  if (!/(^|\.)strictness$/.test(e.key) || e.value === e.previous) return next(e)
  const running = (await h.board.read()).tasks.some(t => t.state === 'active' || t.state === 'review')
  return running ? { deny: 'cadre: strictness cannot change while tasks are running' } : next(e)
}
