// L1 capability allowlist, file fence (DESIGN 13.1-13.2), tool.check allow, session.send isolation (4.6), config.set guard. Slots #4, #5, #7, config.set.
import { modelText } from '../core/say'
import type { Binding, Host, Hook } from '../types'
import { MAIN_TOOLS, allowlist } from '../agents/index'
import { repoKeyOf } from '../commands/init'
import { logCall } from '../core/specview'
import { PROTECTED } from '../core/git'
import { idsIn } from '../core/briefs'
import { strictOf } from '../config/index'
import { RETRIES } from '../core/validate'
import { runOf } from '../core/lifecycle'

// Paths the guards need, written to $.store `cadre:<repoKey>:policy` by init/session.start/tdd (absolute, realpath'd). Absent keys disable the rule they feed.
export interface Policy { repo?: string; wtRoot?: string; home?: string; mcpAllow?: string[]; locks?: Record<string, string[]>; core?: Record<string, string[]>; protect?: string[]; effectCheck?: string; epicPrefix?: string; changelog?: string }
export const policyKey = async (h: Host) => `cadre:${repoKeyOf(await h.cwd())}:policy`   // per repo (13.5): two repos never share one
export const policyOf = async (h: Host): Promise<Policy> => ((await h.store.get(await policyKey(h))) as Policy | undefined) ?? {}
export const setPolicy = async (h: Host, patch: Policy) => h.store.set(await policyKey(h), { ...(await policyOf(h)), ...patch })

const SHELL = ['Bash', 'PowerShell', 'Monitor'], FILE = ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'NotebookEdit'], FENCED = ['Edit', 'Write', 'NotebookEdit']
const MOD_DIRS = PROTECTED.filter(p => p.endsWith('/')).map(p => p.slice(0, -1)), MOD_FILES = PROTECTED.filter(p => !p.endsWith('/'))
const under = (p: string, root?: string) => !!root && (p === root || p.startsWith(root.replace(/\/$/, '') + '/'))
const join = (cwd: string, p: string) => (p.startsWith('/') ? p : `${cwd.replace(/\/$/, '')}/${p}`)
const modOwned = (real: string, home?: string, changelog?: string) => {
  const seg = real.split('/')
  return (!!changelog && (real === changelog || real.endsWith(`/${changelog}`))) || seg.some(s => MOD_DIRS.includes(s)) || MOD_FILES.includes(seg[seg.length - 1]) || (!!home && /^cadre\.json$|^settings.*\.json$/.test(seg[seg.length - 1]) && under(real, home + '/.claude')) || (!!home && real === `${home}/.claude.json`)   // the engine's own file: its project mcpServers/allowedTools widen what runs
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
  const name = p.slice(p.lastIndexOf('/') + 1)
  if (!name || name === '.' || name === '..') return (await h.stat(p, { resolve: true }))?.realPath
  const own = await h.stat(p, { resolve: true })
  if (own) return own.realPath
  // a new file (Write creates its folders): the deepest existing ancestor's real path + the rest; a '..' in the rest cannot be placed
  const rest: string[] = []
  for (let q = p; q.includes('/'); ) {
    rest.unshift(q.slice(q.lastIndexOf('/') + 1)); q = q.slice(0, q.lastIndexOf('/')) || '/'
    const dir = await h.stat(q, { resolve: true })
    if (dir?.realPath !== undefined) return rest.some(x => x === '..' || x === '.') ? undefined : `${dir.realPath.replace(/\/$/, '')}/${rest.join('/')}`
    if (q === '/') break
  }
  return undefined
}

// Who is calling: role + binding. Unknown ids and marker-less forks are explorers; no agentId = main.
async function who(h: Host, agentId?: string) {
  const b: Binding | undefined = agentId ? (await h.bind.read())[agentId] : undefined
  const task = b && (await h.board.read()).tasks.find(t => t.id === b.taskId)
  return { b, task, main: !agentId, role: b?.role ?? 'explorer' as const, owner: !!b && task?.state === 'active' }
}

const strict = async (h: Host) => (await strictOf(h)) !== 'advisory'

// The maintenance lease (ADR 0010): only after a human-started run (commands/agentrun), until it is verified done, cancelled, or 20 main turns / 30 minutes have passed.
export const LIMIT = { turns: 20, ms: 30 * 60_000, follow: 3 }
export const leaseOf = async (h: Host) => { const r = (await h.secret.read()).run; return r && r.turns < LIMIT.turns && (await h.now()) - r.at < LIMIT.ms ? r : undefined }
// The maintenance lease: while a human-started setup/init runs, main may Write/Edit only these, plus Read the guide's folder. Never source files, never a settings file
// (permissions, hooks, sandbox) and never ~/.claude/cadre.json (it holds security keys): cadre writes those after the human confirms a card.
// .cadre/config.json only in an init run (ADR 0019): init re-validates it against the settings after every write; a setup run never needs it
const leased = (real: string, pol: Policy, kind?: string) => !!pol.repo && ((under(real, `${pol.repo}/.cadre`) && (kind === 'init' || real !== `${pol.repo}/.cadre/config.json`)) || ['.git/info/exclude', pol.changelog || 'CHANGELOG.md'].some(f => real === `${pol.repo}/${f}`))
// Claude Code settings files: no agent edits them, lease or not, cadre on or off during a run
const SETTINGS = /(^|\/)\.claude\/settings[^/]*\.json$/, SETTINGS_DENY = 'these settings are applied for you after the human confirms them in the dialog'

// Fence verdict for one file-tool call: undefined = allow-by-fence (continue), 'allow' = tester rule 2, else a deny reason.
async function fence(h: Host, w: Awaited<ReturnType<typeof who>>, tool: string, input: unknown, pol: Policy, guide?: string, kind?: string): Promise<string | 'allow' | 'tmp' | undefined> {
  const tester = w.role === 'tester' && !w.main
  const fenced = FENCED.includes(tool) || (tool === 'Read' && !!pol.home && typeof (input as any)?.file_path === 'string' && (input as any).file_path.includes('/.claude/plugins/store/'))
  if (!tester && !fenced) return
  if (!FILE.includes(tool)) return tester && !tool.startsWith('mcp__cadre__') ? `${tool} is not available to you; use Read, Write or Edit inside your working directory` : undefined   // the role's own report tool passed the allowlist
  const cwd = w.b?.worktree ?? pol.repo ?? '/'
  const p = inputPath(tool, input, cwd)
  const real = p === undefined ? undefined : await placed(h, join(cwd, p))
  if (FENCED.includes(tool) && (SETTINGS.test(p ?? '') || SETTINGS.test(real ?? ''))) return SETTINGS_DENY
  if (real === undefined) return 'that path cannot be used; give a plain path inside your working directory'
  if (tester) return under(real, w.b!.worktree) ? 'allow' : 'write only inside your working directory'
  if (w.main && guide !== undefined && (tool === 'Read' ? under(real, guide.slice(0, guide.lastIndexOf('/'))) : leased(real, pol, kind))) return 'allow'
  if (w.main && FENCED.includes(tool) && pol.repo && real === `${pol.repo}/.cadre/config.json`) return 'the project settings are changed by the user in the cadre pane (Settings, key 9); do not edit that file'
  const own = w.owner && under(real, w.b!.worktree)
  if (!w.main && w.b && w.task?.state === 'blocked' && FENCED.includes(tool) && under(real, w.b.worktree)) return 'your task waits for a decision; stop now: you are resumed with the answer'   // live 0.9.0: "write only inside your working directory" sent a worker that had just reported spec_change looking for another place to write
  if (!w.main && !own) return under(real, (await h.env()).TMPDIR || '/tmp') ? 'tmp' : 'write only inside your working directory (or $TMPDIR)'   // positive jail: file tools are not OS-sandboxed (ADR 0006)
  if (!own && (under(real, pol.repo) || under(real, pol.wtRoot))) return 'project files are edited by a task agent only; plan the change with TaskCreate, or spawn the agent of a planned task'
  if (modOwned(real, pol.home, pol.changelog)) return 'that path is managed for you and cannot be edited; leave it alone'
  if (w.owner && (pol.core?.[w.b!.taskId] ?? []).some(l => real === l)) return 'this file belongs to the shared core that already landed: do not edit it; report outcome "blocked" with the change you need in it'   // ADR 0014 G
  if (w.owner && w.task?.step === 'worker' && (pol.locks?.[w.b!.taskId] ?? []).some(l => real === l || under(real, l))) return 'locked spec test: do not edit it; if it is wrong, report outcome "spec_change"'
}

// Pure L1 facts that need no state: the sandbox flag.
const escape = (e: any) => (e?.dangerouslyDisableSandbox === true || e?.input?.dangerouslyDisableSandbox === true ? 'running unrestricted is not allowed; run the command normally' : undefined)

// A repo where cadre is off, while a setup run is active: only the settings rule applies (the rest of the guards are for active repos)
export const settingsOnly: Hook = async (h, e, next) => (FENCED.includes(e.tool) && SETTINGS.test(inputPath(e.tool, e.input ?? e, '/') ?? '') ? { deny: modelText('deny', SETTINGS_DENY) } : next(e))

// Event-only judgement for the re-entry .catch (G2): a deny reason, or undefined to let the call through. Must not use $.
export const judge = (e: any): string | undefined => {
  if (escape(e)) return escape(e)
  if (!e.agentId) return MAIN_TOOLS.includes(e.tool) ? undefined : `${e.tool} is not available to main; spawn an agent for it`
  if (SHELL.includes(e.tool) || (e.tool.startsWith('mcp__') && !e.tool.startsWith('mcp__cadre__'))) return 'this tool is not available here; use a different one'   // bindings are unreadable here: over-deny
  const p = e.file_path ?? e.notebook_path
  if (FENCED.includes(e.tool) && typeof p === 'string' && modOwned(p)) return 'that path is managed for you and cannot be edited; leave it alone'
}

// Auto permission mode gives every background agent a hand-back contract (Claude Code adds SubagentHandback to its tools and re-asks for it up to 3 times at its
// turn end; flag tengu_lively_waffle, 2.1.287 and 2.1.295 alike). Refused, the agent could never end (live 0.12.0; live 0.12.1: a tester whose report the red gate
// refused bounced until Claude Code gave up). An agent can ALWAYS end: it passes once its run has called report at all (accepted or refused: a refused step goes
// back through cadre's own bounded loop, nudges + limits.testerRounds/attempts), or after RETRIES refusals of the hand-back itself.
// Its message is replaced: main never reads an agent's prose (core/asks), the report already went where it belongs.
const HB = (e: any) => e.tool === 'SubagentHandback' && !!e.agentId
const HANDED = 'This agent has stopped; its task goes on without you. Nothing to do for it.'
const OWES = ['running', 'silent']   // its run has not called report yet; a /clear keeps the run (its record survives in $.store). An agent with no run (a marker-less explorer) goes by ui.handed
async function handback(h: Host, id: string): Promise<string | undefined> {
  const u = await h.ui.read(), k = `handback:${id}`, n = ((u.retries as Record<string, number>) ?? {})[k] ?? 0, s = (await runOf(h, id))?.state
  if ((s ? !OWES.includes(s.state) : ((u.handed as string[] | undefined) ?? []).includes(id)) || n >= RETRIES) return undefined
  await h.ui.update(x => ({ ...x, retries: { ...((x.retries as Record<string, number>) ?? {}), [k]: n + 1 } }))
  return `call report first; once you have called it, SubagentHandback ends your run (attempt ${n + 1}/${RETRIES})`
}
// #5 tool.call guards: L1 allowlist, fence. Judge before next. Advisory: denies become warnings.
export const guard: Hook = async (h, e, next) => {
  const deny = async (): Promise<string | undefined> => {
    const bad = escape(e); if (bad) return bad
    if (HB(e)) return handback(h, e.agentId)
    const w = await who(h, e.agentId), pol = await policyOf(h), run = w.main ? await leaseOf(h) : undefined   // main during a setup/init run: Bash plus the lease's files
    const list = w.main ? (run ? [...MAIN_TOOLS, 'Bash'] : MAIN_TOOLS) : allowlist(w.role, w.role === 'worker' ? pol.mcpAllow : [])
    if (!list.includes(e.tool)) return `${e.tool} is not available to ${w.main ? 'main' : `the ${w.role}`}; use another tool`
    if (SHELL.includes(e.tool) && !run && !(w.role === 'worker' && w.owner && w.task?.step === 'worker')) return 'shell is available only while you implement your task; use run_check or inspect'
    const f = await fence(h, w, e.tool, e, pol, run?.guide, run?.kind)
    return f === 'allow' || f === 'tmp' ? undefined : f
  }
  const why = await deny()
  if (!why) return next(HB(e) ? { ...e, input: { ...e.input, message: modelText('context', HANDED) } } : e)
  const tb = e.agentId && (await h.bind.read())[e.agentId]
  if (tb && tb.role === 'tester') await logCall(h, e.agentId, { tool: e.tool, path: inputPath(e.tool, e.input ?? e, tb.worktree), outcome: why })   // the view audit counts refusals too (3.5.2)
  if (await strict(h)) return { deny: modelText('deny', why) }
  h.log(`advisory: ${why}`); return next(e)
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
    return real && under(real, w.b.worktree) ? { decision: 'allow', reason: modelText('deny', 'inside its own tree') } : next(e)
  }
  if (w.role !== 'tester' && !(w.owner && FENCED.includes(tool))) return next(e)
  const f = await fence(h, w, tool, e.input, pol)
  return f === 'allow' || f === undefined ? { decision: 'allow', reason: modelText('deny', 'inside its own tree') } : next(e)
}

// #7 session.send: SendMessage naming another task id -> {isDelivered:false} (4.6).
export const send: Hook = async (h, e, next) => {
  const b = (await h.bind.read())
  const own = (e.agentId && b[e.agentId]) || b[e.to]
  if (!own || (await h.ui.read()).drainTo === e.to) return next(e)   // cadre's own queued resume (core/reuse.sendMine) is exempt
  const ts = (await h.board.read()).tasks, t = ts.find(x => x.id === own.taskId)
  // main messaging an agent whose step is over (live: it re-prompted the finished tester as if it were the worker, then stopped): the next step is a NEW agent
  if (!e.agentId && b[e.to] && t && t.step !== own.step) return { isDelivered: false, reason: modelText('deny', `${t.id}'s ${own.role} has finished; do not message it. ${t.step === 'merge' ? `Complete TASK-${t.id} (TaskUpdate ${t.id} completed)` : `Start the next agent with Agent prompt "TASK-${t.id}"`}`) }
  const known = new Set(ts.map(x => x.id))
  const other = idsIn(`${e.to} ${e.text}`, known).find(id => id !== own.taskId)
  return other ? { isDelivered: false, reason: modelText('deny', `you work on ${own.taskId} only; do not name ${other}`) } : next(e)
}

// Re-entry (fail-closed .catch, 13.3): the board is unreadable, so judge a spawn from the event: a task marker in the prompt is refused, marker-less passes.
export const judgeSpawn = (e: any): string | undefined => /\b(TASK|bd)-[A-Za-z0-9]/.test(String(e.prompt ?? '')) ? 'refused: temporary failure; retry once, then ask the human' : undefined

// config.set: refuse strictness changes while tasks run.
export const configSet: Hook = async (h, e, next) => {
  if (!/(^|\.)strictness$/.test(e.key) || e.value === e.previous) return next(e)
  const running = (await h.board.read()).tasks.some(t => t.state === 'active' || t.state === 'review')
  return running ? { deny: modelText('deny', 'strictness cannot be changed while tasks are running; retry when they finish') } : next(e)
}

// Realpath of the worktree root once (its deepest existing ancestor is resolved): fence rule 3, locks and bindings all compare real paths (M13).
export async function realRoot(h: Host, p: string): Promise<string> {
  for (let q = p, tail = ''; q && q !== '/'; tail = q.slice(q.lastIndexOf('/')) + tail, q = q.slice(0, q.lastIndexOf('/'))) {
    const r = (await h.stat(q, { resolve: true }))?.realPath
    if (r) return r.replace(/\/$/, '') + tail
  }
  return p
}
