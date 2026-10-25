// L1 capability allowlist, file fence (DESIGN 13.1-13.2), tool.check allow, session.send isolation (4.6), config.set guard. Slots #4, #5, #7, config.set.
import { modelText } from '../core/say'
import { OFFLINE } from '../core/helpers'
import type { Binding, Host, Hook } from '../types'
import { MAIN_TOOLS, allowlist } from '../agents/index'
import { repoKeyOf, scoped } from '../commands/init'
import { logCall } from '../core/specview'
import { PROTECTED } from '../core/git'
import { EXIT, ROLES_DEFAULT, writes } from '../core/roles'
import { idsIn } from '../core/briefs'
import { cfgOf, strictOf } from '../config/index'
import { askOf } from '../core/asks'
import { runOf, step } from '../core/lifecycle'
import { canon } from '../core/board'

// Paths the guards need, written to $.store `cadre:<repoKey>:policy` by init/session.start/tdd (absolute, realpath'd). Absent keys disable the rule they feed.
export interface Policy { repo?: string; wtRoot?: string; home?: string; mcpAllow?: string[]; locks?: Record<string, string[]>; core?: Record<string, string[]>; protect?: string[]; effectCheck?: string; epicPrefix?: string; changelog?: string }
export const policyKey = async (h: Host) => `cadre:${repoKeyOf(await h.cwd())}:policy`   // per repo (13.5): two repos never share one
export const policyOf = async (h: Host): Promise<Policy> => ((await h.store.get(await policyKey(h))) as Policy | undefined) ?? {}
export const setPolicy = async (h: Host, patch: Policy) => h.store.set(await policyKey(h), { ...(await policyOf(h)), ...patch })

const SHELL = ['Bash', 'PowerShell', 'Monitor'], FILE = ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'NotebookEdit'], FENCED = ['Edit', 'Write', 'NotebookEdit']
const MOD_DIRS = PROTECTED.filter(p => p.endsWith('/')).map(p => p.slice(0, -1)), MOD_FILES = PROTECTED.filter(p => !p.endsWith('/'))
const under = (p: string, root?: string) => !!root && (p === root || p.startsWith(root.replace(/\/$/, '') + '/'))
const rel = (real: string, root: string) => real.slice(root.replace(/\/$/, '').length + 1)
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
  const a = !b && agentId ? await askOf(h, agentId) : undefined, spec = a?.role ? (await cfgOf(h)).roles.custom[a.role] as { tools: string[]; write?: string[]; network?: string } | undefined : undefined   // a custom role's agent runs under its own spec (roles.custom)
  return { b, task, main: !agentId, role: b?.role ?? 'explorer' as const, owner: !!b && task?.state === 'active', spec }
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
export async function fence(h: Host, w: Awaited<ReturnType<typeof who>>, tool: string, input: unknown, pol: Policy, guide?: string, kind?: string): Promise<string | 'allow' | 'tmp' | undefined> {
  const tester = w.role === 'tester' && !w.main, can = (real: string) => writes(ROLES_DEFAULT[w.role], rel(real, w.b!.worktree))   // the role's write scope, relative to its own tree
  const fenced = FENCED.includes(tool) || (tool === 'Read' && !!pol.home && typeof (input as any)?.file_path === 'string' && (input as any).file_path.includes('/.claude/plugins/store/'))
  if (!tester && !fenced) return
  if (!FILE.includes(tool)) return tester && !tool.startsWith('mcp__cadre__') ? `${tool} is not available to you; use Read, Write or Edit inside your working directory` : undefined   // the role's own report tool passed the allowlist
  const cwd = w.b?.worktree ?? pol.repo ?? '/'
  const p = inputPath(tool, input, cwd)
  const real = p === undefined ? undefined : await placed(h, join(cwd, p))
  if (FENCED.includes(tool) && (SETTINGS.test(p ?? '') || SETTINGS.test(real ?? ''))) return SETTINGS_DENY
  if (real === undefined) return 'that path cannot be used; give a plain path inside your working directory'
  if (w.spec) return under(real, pol.repo) && writes({ write: w.spec.write ?? [] } as any, rel(real, pol.repo!)) && !modOwned(real, pol.home, pol.changelog) ? 'allow' : 'write only the files your role allows, inside the project folder'   // the same writes() the built-in roles use
  if (tester) return under(real, w.b!.worktree) && can(real) ? 'allow' : 'write only inside your working directory'
  if (w.main && guide !== undefined && (tool === 'Read' ? under(real, guide.slice(0, guide.lastIndexOf('/'))) : leased(real, pol, kind))) return 'allow'
  if (w.main && FENCED.includes(tool) && pol.repo && real === `${pol.repo}/.cadre/config.json`) return 'the project settings are changed by the user in the cadre pane (Settings, key 9); do not edit that file'
  const own = w.owner && under(real, w.b!.worktree) && (tool === 'Read' || can(real))   // Read is fenced only for the plugin store: reading needs no write scope
  if (!w.main && w.b && w.task?.state === 'blocked' && FENCED.includes(tool) && under(real, w.b.worktree)) return 'your task waits for a decision; stop now: you are resumed with the answer'   // live 0.9.0: "write only inside your working directory" sent a worker that had just reported spec_change looking for another place to write
  if (!w.main && !own) return under(real, (await h.env()).TMPDIR || '/tmp') ? 'tmp' : 'write only inside your working directory (or $TMPDIR)'   // positive jail: file tools are not OS-sandboxed (ADR 0006)
  if (!own && (under(real, pol.repo) || under(real, pol.wtRoot))) return 'project files are edited by a task agent only; plan the change with plan and task, or spawn the agent of a planned task'
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
  if (EXIT.includes(e.tool)) return undefined
  if (escape(e)) return escape(e)
  if (!e.agentId) return MAIN_TOOLS.includes(e.tool) ? undefined : `${e.tool} is not available to main; spawn an agent for it`
  if (SHELL.includes(e.tool) || (e.tool.startsWith('mcp__') && !e.tool.startsWith('mcp__cadre__'))) return 'this tool is not available here; use a different one'   // bindings are unreadable here: over-deny
  const p = e.file_path ?? e.notebook_path
  if (FENCED.includes(e.tool) && typeof p === 'string' && modOwned(p)) return 'that path is managed for you and cannot be edited; leave it alone'
}

// Engine exit tools (exit rule 1): a fixed allowlist, never refused, by no guard, role, tools list or setting. Auto permission mode gives every background agent a
// hand-back contract (Claude Code re-asks for SubagentHandback up to 3 times at its turn end); refused, an agent could never end (live 0.12.0, 0.12.1). An agent that
// hands back without a report is cadre's to bound: its turn end nudges it, then auto-reports or releases it. The message is replaced: main never reads an agent's prose.
export { EXIT }   // core/roles: rule 6 refuses a spec that drops them
const HANDED = 'This agent has stopped; its task goes on without you. Nothing to do for it.'
// pure (the failure path has no $): the exit call as it goes on, the hand-back's prose replaced
// only a cadre agent's (bound) hand-back: a user's own Explore or general agent keeps its result. The tool's arguments sit beside `tool` in the event (live: the old `input.message` never replaced anything, main read each agent's prose)
export const exitCall = (e: any, bound: boolean) => (bound && e.tool === 'SubagentHandback' ? { ...e, message: modelText('context', HANDED) } : e)
// exit rules 3 and 4 on an agent's call: a tool first seen on its run is journaled, and one that is no cadre tool, not its role's, not an MCP server's is noted for
// Doctor (observation only: the verdict below is the same); the same call REPEAT times in a row spends the run, which then ends at its next step
async function watchCall(h: Host, e: any, role: string): Promise<string | undefined> {
  const seen = (await runOf(h, e.agentId))?.tools ?? [], r = await step(h, e.agentId, { type: 'call', tool: e.tool, sig: `${e.tool} ${canon(e.input ?? {})}` })
  if (r && !seen.includes(e.tool) && !e.tool.startsWith('mcp__') && !allowlist(role as any).includes(e.tool)) { const k = await scoped(h, 'injected'), x = ((await h.store.get(k)) as string[] | undefined) ?? []; if (!x.includes(e.tool)) await h.store.set(k, [...x, e.tool]) }
  return r?.exit ? 'you have made the same call over and over; stop now' : undefined
}
// A cadre agent's Bash call goes on with the package managers offline for that one shell (core/helpers.OFFLINE); main's, other tools' and non-cadre agents' calls are unchanged
export async function shelled(h: Host, e: any): Promise<any> {
  if (e.tool !== 'Bash' || !e.agentId || typeof e.command !== 'string' || !(await h.bind.read())[e.agentId]) return e   // the tool's arguments sit beside `tool` in the event (e.command)
  return { ...e, command: `export ${Object.entries(OFFLINE).map(([k, v]) => `${k}=${v}`).join(' ')}; ${e.command}` }
}
// #5 tool.call guards: L1 allowlist, fence. Judge before next. Advisory: denies become warnings.
export const guard: Hook = async (h, e, next) => {
  if (EXIT.includes(e.tool)) return next(exitCall(e, !!(e.agentId && ((await h.bind.read())[e.agentId] || (await askOf(h, e.agentId))))))   // a bound run, or main's own question (an ask)
  const deny = async (): Promise<string | undefined> => {
    const bad = escape(e); if (bad) return bad
    const w = await who(h, e.agentId), pol = await policyOf(h), run = w.main ? await leaseOf(h) : undefined   // main during a setup/init run: Bash plus the lease's files
    const list = w.main ? (run ? [...MAIN_TOOLS, 'Bash'] : MAIN_TOOLS) : w.spec ? w.spec.tools.filter(t => w.spec!.network === 'on' || !/^Web(Fetch|Search)$/.test(t)) : allowlist(w.role, pol.mcpAllow)
    const loop = w.main ? undefined : await watchCall(h, e, w.role); if (loop) return loop
    if (!list.includes(e.tool)) return `${e.tool} is not available to ${w.main ? 'main' : `the ${w.role}`}; use another tool`
    if (SHELL.includes(e.tool) && !run && !w.spec && !(w.role === 'worker' && w.owner && w.task?.step === 'worker')) return 'shell is available only while you implement your task; use run_check or inspect'
    const f = await fence(h, w, e.tool, e, pol, run?.guide, run?.kind)
    return f === 'allow' || f === 'tmp' ? undefined : f
  }
  const why = await deny()
  if (!why) return next(await shelled(h, e))
  const tb = e.agentId && (await h.bind.read())[e.agentId]
  if (tb && tb.role === 'tester') await logCall(h, e.agentId, { tool: e.tool, path: inputPath(e.tool, e.input ?? e, tb.worktree), outcome: why })   // the view audit counts refusals too (3.5.2)
  if (await strict(h)) return { deny: modelText('deny', why) }
  h.log(`advisory: ${why}`); return next(await shelled(h, e))
}

// #4 tool.check allow mirrors fence rule 2 (tester) and rule 3 (owner); anything else is the engine's call. Fail-closed answer is {decision:'deny'}.
export const check: Hook = async (h, e, next) => {
  const tool = e.tool as string
  if (!e.agentId || !FILE.includes(tool)) return next(e)
  const w = await who(h, e.agentId)
  if (w.spec && FENCED.includes(tool)) return (await fence(h, w, tool, e.input, await policyOf(h))) === 'allow' ? { decision: 'allow', reason: modelText('deny', 'inside its own tree') } : next(e)   // a custom role's writes in its scope
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
  const s = await h.board.read(), ts = s.tasks, t = ts.find(x => x.id === own.taskId)
  if (!e.agentId && b[e.to] && s.drive.on && !s.drive.stopped && s.drive.spawn === 'mod') return { isDelivered: false, reason: modelText('deny', 'cadre resumes this agent when its task needs it; do not message it') }   // mod mode: main never messages an agent (ADR 0024 §2.6)
  // main messaging an agent whose step is over (live: it re-prompted the finished tester as if it were the worker, then stopped): the next step is a NEW agent
  if (!e.agentId && b[e.to] && t && t.step !== own.step) return { isDelivered: false, reason: modelText('deny', `${t.id}'s ${own.role} has finished; do not message it. ${t.step === 'merge' ? `Complete TASK-${t.id} (status {id:"${t.id}", set:"completed"})` : `Start the next agent with Agent prompt "TASK-${t.id}"`}`) }
  // any mode but mod (above): an agent that is done, parked or retired would be ended at its next step (exit rule 5), so main's words would go nowhere: say what moves it instead
  const rs = !e.agentId && b[e.to] && t ? (await runOf(h, e.to))?.state?.state : undefined
  if (rs && !['running', 'refused', 'silent'].includes(rs)) return { isDelivered: false, reason: modelText('deny', rs === 'waiting' ? `${t!.id} waits for the human's decision: ask them, then status {id:"${t!.id}", decision:"accept: …"} or "reject: …"; its agent is resumed with it` : rs === 'retired' ? `${t!.id}'s ${own.role} was retired; do not message it. Start a fresh one with Agent prompt "TASK-${t!.id}"` : `${t!.id}'s ${own.role} has handed in its work; do not message it. cadre resumes it when ${t!.id} needs it`) }
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
