// The 3 MCP tools (DESIGN 5.2, 6.2, 6.6): report, inspect, run_check; strict schemas with schemaVersion, isDeferred:false. Registered in session.start from SPECS (register.ts).
// Handlers answer `{result}` (an `error: …` text is a refusal the agent can retry). Descriptions are byte-stable.
import { modelText } from '../core/say'
import type { Hook, Host } from '../types'
import { resolveDeps, type Deps } from '../core/admission'
import { raise, report, runCheck } from '../core/close'
import { warm } from '../core/session'
import { askAnswer, askOf } from '../core/asks'
import { planned } from '../core/planner'
import { checkInput, refuse, tried, validateReport } from '../core/validate'
import * as G from '../core/git'
import { charge, runOf, step } from '../core/lifecycle'
import { PLAN_TOOLS } from '../core/plantools'
import { prefsTool } from '../commands/prefs'

export const TOOLS = ['report', 'inspect', 'run_check'] as const
const S = { type: 'string' }, ARR = { type: 'array' }
const V = { type: 'integer', enum: [1] }
export const SPECS = [
  { name: 'report', isDeferred: false, description: 'Finish your step. Worker: {schemaVersion:1,role:"worker",outcome:"done"|"blocked"|"spec_change"|"needs",summary,reason (blocked, spec_change),needs (what you need: needs),risks?,questions?}. Tester: role "tester", outcome "done", summary, tests[{path,name,scenario}], run{command[],junit?,cwd?} (the argument list that runs only your tests). Reviewer: role "reviewer", verdict "pass"|"changes", summary, findings[{severity,file,line?,issue,fix?}], coverage[{scenario,test?,ok}], contractStatus[{name,ok}]. Explorer: role "explorer", answer, citations[{path,line}]. Planner: role "planner", summary, tasks[{subject,description,metadata,after?}]. Call it once, then stop.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['schemaVersion', 'role'], properties: { schemaVersion: V, role: { type: 'string', enum: ['worker', 'tester', 'reviewer', 'explorer', 'planner'] }, outcome: { type: 'string', enum: ['done', 'blocked', 'spec_change', 'needs'] }, summary: S, reason: S, needs: S, risks: ARR, questions: ARR, tests: ARR, run: { type: 'object' }, followups: ARR, verdict: { type: 'string', enum: ['pass', 'changes'] }, findings: ARR, coverage: ARR, contractStatus: ARR, answer: S, citations: ARR, tasks: ARR } } },
  { name: 'inspect', isDeferred: false, description: 'Read git facts of your task tree. what: status | files | log | diff | show. rev and path are optional; show needs a path. Output: exit, seconds, truncated, capped body.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['what'], properties: { schemaVersion: V, what: { type: 'string', enum: ['status', 'files', 'log', 'diff', 'show'] }, task: S, rev: S, path: S } } },
  { name: 'run_check', isDeferred: false, description: 'Run a named check of your task package on your tree. Output: exit, seconds, truncated, capped body.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['name', 'task'], properties: { schemaVersion: V, name: S, task: S } } },
] as const

// Main's tools (core/plantools, commands/prefs): registered at session start only where the work is due (hooks/register); an agent's call is refused.
// Strict schemas: checked in code (core/validate.checkInput) before anything is stored; caps refuse, never truncate.
const L = (n: number) => ({ type: 'string', maxLength: n }), B = { type: 'boolean' }, O = { type: 'object' }, N = { type: 'integer', minimum: 0 }
const IDS = { type: 'array', maxItems: 20, items: L(64) }, LIST = (n: number, k: number) => ({ type: 'array', maxItems: n, items: L(k) })
const TASK = { type: L(40), package: L(200), scope: L(80), breaking: B, scenarios: LIST(20, 500), changelog: O, interface: O, paths: LIST(20, 200), core: B, repro: B }
export const MAIN_SPECS = [
  { name: 'plan', isDeferred: false, description: 'Start a plan (a draft the user approves): title, description, its size from the enum, reason (one line). A one-step plan carries its task\'s fields here. Answer: {id, plan, revision}.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['title', 'description'], properties: { kind: { type: 'string', enum: ['plan', 'mission'] }, title: L(200), description: L(8000), lane: { type: 'string', enum: ['ask', 'lite', 'full', 'milestone'] }, reason: L(300), mission: L(1000), notes: {}, assumed: LIST(5, 200), ...TASK } } },
  { name: 'task', isDeferred: false, description: 'Add a task to the draft plan: title, description, type, package, scenarios ["S1: Given … When … Then …"], changelog, interface, paths; after: ids it waits for; epic: its epic in a milestone. Answer: {id, plan, revision}.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['title', 'description'], properties: { title: L(200), description: L(8000), ...TASK, epic: L(64), after: IDS } } },
  { name: 'epic', isDeferred: false, description: 'Milestone only. Add an epic to the roadmap: title, goal, size (1-7 tasks), core?, paths?, after?. Or {id, planned:true} once its tasks are drafted. Answer: {id, plan, revision}.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { id: L(64), title: L(200), goal: L(2000), size: { type: 'integer', minimum: 1 }, core: B, paths: LIST(20, 200), after: IDS, planned: B } } },
  { name: 'amend', isDeferred: false, description: 'Change a task (or the draft plan) by id: any field task takes, after (more ids to wait for), or remove:true for a draft. expectedRevision: the revision your last answer gave. An approved task needs reason and evidence; each scenario or field of it changes once.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['id', 'expectedRevision'], properties: { id: L(64), expectedRevision: N, title: L(200), description: L(8000), ...TASK, size: { type: 'integer', minimum: 1 }, critique: L(1500), after: IDS, remove: B, reason: L(500), evidence: L(1000) } } },
  { name: 'explore', isDeferred: false, description: 'Ask a read-only explorer a question about the code; it starts when your turn ends and its answer comes back as a message. {id} reads a full answer again.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { question: L(2000), id: L(64) } } },
  { name: 'ask', isDeferred: false, description: 'Record an open question for the user on the draft plan; the plan cannot be approved while one is open. Ask the user, then {id, answer} records their answer. Before a goal\'s plan, {clarity:{outcome,scope,acceptance,constraints}} (each 0-1) records how clear it is; the answer says what comes next.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { question: L(500), id: L(16), answer: L(2000), clarity: { type: 'object', properties: { outcome: { type: 'number' }, scope: { type: 'number' }, acceptance: { type: 'number' }, constraints: { type: 'number' } } } } } },
  { name: 'status', isDeferred: false, description: 'Read the plan: {} lists its tasks, {id} shows one (scenarios, contract, changelog, records). Move one on: {id, set:"completed"} completes a task, epic or plan; "pending" gives a task back; "deleted" cancels it (reason). {id, decision} answers a blocked task.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { id: L(64), set: { type: 'string', enum: ['completed', 'pending', 'deleted'] }, decision: L(1000), reason: L(300) } } },
] as const
export const PREFS_SPEC = { name: 'preferences', isDeferred: false, description: 'Hand over the user\'s setup preferences: mode "auto"|"yolo", maxTurns, maxCostUsd, maxWallMinutes, maxParallel, maxEpics (0 = no limit on the last two). Only during setup.',
  inputSchema: { type: 'object', additionalProperties: false, properties: { mode: { type: 'string', enum: ['auto', 'yolo'] }, maxTurns: N, maxCostUsd: { type: 'number' }, maxWallMinutes: N, maxParallel: N, maxEpics: N } } } as const
export const MAIN = [...MAIN_SPECS, PREFS_SPEC]
const ENVELOPE = ['tool', 'tool_use_id', 'agentId', 'requestMeta', 'consent']
// main's tool call: role gate, strict schema, then the handler (no task deps: preferences answers in a dormant repo too)
export async function mainTool(h: Host, e: any): Promise<unknown> {
  const name = String(e.tool).replace(/^mcp__cadre__/, ''), spec = MAIN.find(t => t.name === name)!
  const i = e.input ?? Object.fromEntries(Object.entries(e).filter(([k]) => !ENVELOPE.includes(k)))
  if (e.agentId) return { result: modelText('tool-result', bad(`${name} is for the main session; finish your own step with report`)) }
  const err = checkInput(spec.inputSchema, i); if (err) return { result: modelText('tool-result', bad(err)) }
  return name === 'preferences' ? prefsTool(h, i) : PLAN_TOOLS[name](h, i)
}

const bad = (m: string) => `error: ${m}`

async function onReport(h: Host, d: Deps, agentId: string | undefined, r: any): Promise<string> {
  const key = `report:${agentId ?? 'main'}`
  if (!agentId) return bad('only a spawned agent reports')
  const no = async (m: string) => {   // a bound agent's refusals count on its run (and the task budget); anyone else's in ui.retries
    const s = (await step(h, agentId, { type: 'report.refused' }))?.state
    if (s?.state !== 'refused') return bad(await refuse(h, key, m))
    await charge(h, (await runOf(h, agentId))!.taskId, 'refusals'); return bad(tried(m, s.n, key))
  }
  const env = validateReport(r); if (env) return no(env)
  if (!(await h.bind.read())[agentId] && (await askOf(h, agentId))) return r.role === 'explorer' ? askAnswer(h, agentId, r) : bad('role: you are an explorer; report role "explorer" with answer and citations')
  if ((await h.bind.read())[agentId]?.role === 'planner') return r.role === 'planner' ? planned(h, d, agentId, r).then(async t => (await step(h, agentId, { type: t.startsWith('error') ? 'report.refused' : 'report.ok' }), t)) : bad('role: you are the planner; report role "planner" with tasks')   // a ready epic's planner (core/planner)
  const b = (await h.bind.read())[agentId], ok = async () => step(h, agentId, { type: 'report.ok', wait: (await h.board.read()).tasks.find(t => t.id === b?.taskId)?.state === 'blocked' })
  try {
    const text = await report(h, d, agentId, r); await ok(); return text
  } catch (x) {
    const msg = (x as Error).message, s = (await runOf(h, agentId))?.state, n = s?.state === 'refused' ? s.n : 0   // refusals so far, on its run
    // semantic (6.3) failures only; after limits.reportRetries the report is accepted unvalidated + flagged
    if (n >= d.cfg.limits.reportRetries && /^(findings|coverage|contractStatus|verdict)/.test(msg)) {
      await raise(h, b.taskId, 'report-unvalidated'); const text = await report(h, d, agentId, r, { lax: true }); await ok(); return text
    }
    return no(msg)
  }
}

const SAFE = /^[\w./@^~:{}+-]+$/
async function onInspect(h: Host, d: Deps, agentId: string | undefined, i: any): Promise<string> {
  const b = agentId ? (await h.bind.read())[agentId] : undefined, tree = b?.worktree || d.root, what = i.what
  if (!['status', 'files', 'log', 'diff', 'show'].includes(what)) return bad('what: expected status|files|log|diff|show')
  if (!agentId && !['status', 'files', 'log'].includes(what)) return bad('main may inspect status, files and log only')
  if (i.task && b && i.task !== b.taskId) return bad(`task: you are bound to ${b.taskId}`)
  const rev = i.rev as string | undefined, path = i.path as string | undefined
  if (path !== undefined && (typeof path !== 'string' || path.startsWith('/') || path.startsWith('-') || path.split('/').includes('..'))) return bad('path: expected a relative path inside your working directory, e.g. "src/a.ts"')
  if (rev !== undefined && (typeof rev !== 'string' || rev.startsWith('-') || !SAFE.test(rev) || !(await G.exists(h.run, tree, rev)))) return bad(`rev: ${JSON.stringify(rev)} is not a known commit`)
  const task = b ? await d.store.get(b.taskId) : undefined, C = task?.meta['cadre.sourceCommit'], base = task?.meta['cadre.base']
  if (rev && C && b?.role === 'reviewer' && !(await G.ok(h.run, tree, ['merge-base', '--is-ancestor', rev, C]))) return bad(`rev: ${rev} is outside the reviewed range (up to ${C.slice(0, 7)})`)
  const p = path ? ['--', path] : []
  const argv = what === 'status' ? ['status', '--short', ...p] : what === 'files' ? ['ls-tree', '-r', '--name-only', '--end-of-options', rev ?? C ?? 'HEAD', ...p]
    : what === 'log' ? ['log', '--oneline', '-n', '30', '--end-of-options', rev ?? C ?? 'HEAD', ...p] : what === 'diff' ? ['diff', '--end-of-options', rev ?? base ?? 'HEAD', C ?? 'HEAD', ...p]
    : ['show', '--end-of-options', `${rev ?? C ?? 'HEAD'}:${path ?? ''}`]
  if (what === 'show' && !path) return bad('path: show needs a path')
  const t0 = await h.now(), r = await h.run(['git', '-C', tree, ...argv]), out = r.stdout + r.stderr, cut = out.length > 16384
  let log = ''
  if (cut) { log = `${d.root}/.cadre/tmp/logs/inspect-${t0}.log`; await h.write(log, out).catch(() => { log = '' }) }
  return `exit=${r.exitCode} · ${Math.round(((await h.now()) - t0) / 1000)}s · truncated=${cut ? 'yes' : 'no'}\n${cut ? out.slice(-4096) : out}`
}

async function onCheck(h: Host, d: Deps, agentId: string | undefined, i: any): Promise<string> {
  const b = agentId ? (await h.bind.read())[agentId] : undefined
  if (!b || b.role === 'explorer' || b.role === 'tester') return bad('run_check is for a bound worker or reviewer')
  if (i.task !== b.taskId) return bad(`task: you are bound to ${b.taskId}`)
  if (typeof i.name !== 'string' || !i.name) return bad('name: expected a check name, e.g. "test"')
  const r = await runCheck(h, d, await d.store.get(b.taskId), b.worktree, i.name)
  return r.found ? r.text : bad(r.text)
}

export async function handleWith(h: Host, d: Deps, e: any): Promise<{ result: string }> {
  const i = e.input ?? Object.fromEntries(Object.entries(e).filter(([k]) => !ENVELOPE.includes(k))), id = e.agentId as string | undefined   // live calls carry the arguments flat beside the envelope
  try {
    switch (String(e.tool).replace(/^mcp__cadre__/, '')) {
      case 'report': return { result: modelText('tool-result', await onReport(h, d, id, i)) }
      case 'inspect': return { result: modelText('tool-result', await onInspect(h, d, id, i)) }
      default: return { result: modelText('tool-result', await onCheck(h, d, id, i)) }
    }
  } catch (x) { return { result: modelText('tool-result', bad(String((x as Error).message ?? x))) } }
}
// tool.call for mcp__cadre__*: answer {result}.
export const handle: Hook = async (h, e, next) => (MAIN.some(t => e.tool === `mcp__cadre__${t.name}`) ? mainTool(h, e).catch(x => ({ result: modelText('tool-result', bad(String((x as Error).message ?? x))) })) as any
  : TOOLS.some(t => e.tool === `mcp__cadre__${t}`) ? (await warm(h), handleWith(h, await resolveDeps(h), e)) : next(e))
