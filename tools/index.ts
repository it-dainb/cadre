// The 3 MCP tools (DESIGN 5.2, 6.2, 6.6): report, inspect, run_check; strict schemas with schemaVersion, isDeferred:false. Registered in session.start from SPECS (register.ts).
// Handlers answer `{result}` (an `error: …` text is a refusal the agent can retry; handle sends it as {deny}). Descriptions are byte-stable.
import { modelText } from '../core/say'
import type { Hook, Host } from '../types'
import { resolveDeps, type Deps } from '../core/admission'
import { raise, report, runCheck, shapeBlock } from '../core/close'
import { warm } from '../core/session'
import { askAnswer, askOf } from '../core/asks'
import { specAnswer } from '../core/specifier'
import { planned } from '../core/planner'
import { Refusal, checkInput, refuse, reportRefusal, tried } from '../core/validate'
import * as G from '../core/git'
import { charge, runOf, step } from '../core/lifecycle'
import { PLAN_TOOLS } from '../core/plantools'
import { prefsTool } from '../commands/prefs'

export const TOOLS = ['report', 'inspect', 'run_check'] as const
const S = { type: 'string' }, ARR = { type: 'array' }
const V = { type: 'integer', enum: [1] }
export const SPECS = [
  { name: 'report', isDeferred: false, description: 'Finish your step. Worker: {schemaVersion:1,role:"worker",outcome:"done"|"blocked"|"spec_change",summary,reason (blocked, spec_change),risks?,questions?}. Tester: role "tester", outcome "done", summary, tests[{path,name,ids[]}] (ids = the scenarios each test checks), run{command[],cwd?} (the argument list that runs only your tests). Reviewer: role "reviewer", verdict "pass"|"changes", summary, findings[{severity,file,line?,issue,fix?}], coverage[{scenario,test?,ok}], contractStatus[{name,ok}]. Explorer: role "explorer", answer, citations[{path,line}]. Planner: role "planner", summary, tasks[{subject,description,metadata,after?}]. Specifier: role "specifier", notes, deviation "none"|"wrong_path"|"scenario_conflict"|"missing_dep". Call it once, then stop.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['schemaVersion', 'role'], properties: { schemaVersion: V, role: { type: 'string', enum: ['worker', 'tester', 'reviewer', 'explorer', 'planner', 'specifier'] }, outcome: { type: 'string', enum: ['done', 'blocked', 'spec_change'] }, summary: S, reason: S, scenario: S, risks: ARR, questions: ARR, tests: ARR, run: { type: 'object' }, followups: ARR, verdict: { type: 'string', enum: ['pass', 'changes'] }, findings: ARR, coverage: ARR, contractStatus: ARR, answer: S, citations: ARR, tasks: ARR, notes: S, deviation: { type: 'string', enum: ['none', 'wrong_path', 'scenario_conflict', 'missing_dep'] } } } },
  { name: 'inspect', isDeferred: false, description: 'Read git facts of your task tree (main: status, files and log only; read a file with Read). what: status | files | log | diff | show. rev and path are optional; show needs a path. Output: exit, seconds, truncated, capped body.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['what'], properties: { schemaVersion: V, what: { type: 'string', enum: ['status', 'files', 'log', 'diff', 'show'] }, task: S, rev: S, path: S } } },
  { name: 'run_check', isDeferred: false, description: 'Run a named check of your task package on your tree. Output: exit, seconds, truncated, capped body.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['name', 'task'], properties: { schemaVersion: V, name: S, task: S } } },
] as const

// Main's tools (core/plantools, commands/prefs): registered at session start only where the work is due (hooks/register); an agent's call is refused.
// Strict schemas: checked in code (core/validate.checkInput) before anything is stored; caps refuse, never truncate.
const L = (n: number) => ({ type: 'string', maxLength: n }), B = { type: 'boolean' }, N = { type: 'integer', minimum: 0 }
const IDS = { type: 'array', maxItems: 20, items: L(64) }, LIST = (n: number, k: number) => ({ type: 'array', maxItems: n, items: L(k) })
const CHANGELOG = { type: 'object', properties: { category: L(20), entry: L(500), none: B, reason: L(300) } }   // the shape itself: validate.validateFields
const SYMBOL = { type: 'object', properties: { name: L(200), kind: L(40), params: LIST(20, 300), returns: L(300), status: L(20) } }
const INTERFACE = { type: 'object', properties: { symbols: { type: 'array', maxItems: 50, items: SYMBOL }, none: B, reason: L(300) } }
const TASK = { type: L(40), package: L(200), scope: L(80), breaking: B, scenarios: LIST(20, 500), changelog: CHANGELOG, interface: INTERFACE, paths: LIST(20, 200), core: B, holds: LIST(10, 8), risk: { type: 'string', enum: ['light', 'standard', 'thorough', 'core'] } }
const { paths: _p, core: _c, ...ONE } = TASK   // a one-step plan's task fields: paths and core belong to plans of 2+ tasks
export const MAIN_SPECS = [
  { name: 'plan', isDeferred: false, description: 'Start a plan (a draft the user approves): title, description, how big the work is (pick the value that fits), reason (one line). A one-step plan carries its task\'s fields here. Answer: {id, plan, revision}.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['title', 'description'], properties: { kind: { type: 'string', enum: ['plan', 'mission'] }, title: L(200), description: L(8000), lane: { type: 'string', enum: ['ask', 'lite', 'full', 'milestone'] }, reason: L(300), mission: L(1000), notes: {}, assumed: LIST(5, 200), ...ONE } } },
  { name: 'task', isDeferred: false, description: 'Add a task to the draft plan: title, description, type, package, scenarios ["S1: Given … When … Then …"], changelog, interface, paths, risk (how closely it is reviewed: light, standard, thorough, core); after: ids it waits for; epic: its epic in a milestone. Answer: {id, plan, revision}.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['title', 'description'], properties: { title: L(200), description: L(8000), ...TASK, epic: L(64), after: IDS } } },
  { name: 'epic', isDeferred: false, description: 'Milestone only. Add an epic to the roadmap: title, goal, size (1-7 tasks), core?, paths?, after?. Or {id, planned:true} once its tasks are drafted. Answer: {id, plan, revision}.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { id: L(64), title: L(200), goal: L(2000), size: { type: 'integer', minimum: 1 }, core: B, paths: LIST(20, 200), after: IDS, planned: B } } },
  { name: 'amend', isDeferred: false, description: 'Change a task (or the draft plan) by id: any field task takes, after (more ids to wait for), or remove:true for a draft. expectedRevision: the revision your last answer gave. An approved task needs reason and evidence; each scenario or field of it changes once.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['id', 'expectedRevision'], properties: { id: L(64), expectedRevision: N, title: L(200), description: L(8000), ...TASK, size: { type: 'integer', minimum: 1 }, critique: L(1500), after: IDS, remove: B, reason: L(500), evidence: L(1000) } } },
  { name: 'explore', isDeferred: false, description: 'Ask a read-only explorer a question about the code; it starts when your turn ends and its answer comes back as a message. {id} reads a full answer again.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { question: L(2000), id: L(64) } } },
  { name: 'ask', isDeferred: false, description: 'Record an open question for the user on the draft plan; the plan cannot be approved while one is open. Ask the user, then {id, answer} records their answer. Before a goal\'s plan, {clarity:{outcome,scope,acceptance,constraints}} (each 0-1) records how clear it is; the answer says what comes next.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { question: L(500), id: L(16), answer: L(2000), clarity: { type: 'object', properties: { outcome: { type: 'number' }, scope: { type: 'number' }, acceptance: { type: 'number' }, constraints: { type: 'number' } } } } } },
  { name: 'status', isDeferred: false, description: 'Read the plan: {} lists its tasks, {id} shows one (scenarios, contract, changelog, records). Move one on: {id, set:"completed"} completes a task, epic or plan; "pending" gives a task back; "deleted" cancels it (reason). {id, choice, reason?} decides a flagged task by the choice key its brief names; {id, args} answers a blocked worker\'s question.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { id: L(64), set: { type: 'string', enum: ['completed', 'pending', 'deleted'] }, choice: L(16), args: L(1000), reason: L(300) } } },
] as const
export const PREFS_SPEC = { name: 'preferences', isDeferred: false, description: 'Hand over the user\'s setup preferences: mode "auto"|"yolo", maxTurns, maxCostUsd, maxWallMinutes, concurrency, maxEpics (0 = no limit on the last two). Only during setup.',
  inputSchema: { type: 'object', additionalProperties: false, properties: { mode: { type: 'string', enum: ['auto', 'yolo'] }, maxTurns: N, maxCostUsd: { type: 'number' }, maxWallMinutes: N, concurrency: N, maxEpics: N } } } as const
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
  // a refusal for the form of the report (an over-long value, an unknown field, a wrong type) is counted on the task, never on the run's tries (planners and unbound agents: unchanged)
  const noShape = async (m: string) => {
    const b = (await h.bind.read())[agentId]; if (!b || b.role === 'planner') return no(m)
    const n = await charge(h, b.taskId, 'shapeRefusals'), max = d.cfg.limits.shapeRetries
    if (n >= max) { await shapeBlock(h, d, b.taskId, n); return bad(`${m}\nThe task now waits for the user after ${n} malformed reports. Stop.`) }
    return bad(`${m} (malformed report ${n}/${max})`)
  }
  const env = reportRefusal(r); if (env) return env.code === 'shape' ? noShape(env.msg) : no(env.msg)
  if (!(await h.bind.read())[agentId] && (await askOf(h, agentId))) return (await askOf(h, agentId))!.role === 'specifier' ? r.role === 'specifier' ? specAnswer(h, d, agentId, r) : bad('role: you are a specifier; report role "specifier" with notes and deviation') : r.role === 'explorer' ? askAnswer(h, agentId, r) : bad('role: you are an explorer; report role "explorer" with answer and citations')
  if ((await h.bind.read())[agentId]?.role === 'planner') return r.role === 'planner' ? planned(h, d, agentId, r).then(async t => (await step(h, agentId, { type: t.startsWith('error') ? 'report.refused' : 'report.ok' }), t)) : bad('role: you are the planner; report role "planner" with tasks')   // a ready epic's planner (core/planner)
  const b = (await h.bind.read())[agentId], ok = async () => step(h, agentId, { type: 'report.ok', wait: (await h.board.read()).tasks.find(t => t.id === b?.taskId)?.state === 'blocked' })
  try {
    const text = await report(h, d, agentId, r); await ok(); return text
  } catch (x) {
    const msg = (x as Error).message, s = (await runOf(h, agentId))?.state, n = s?.state === 'refused' ? s.n : 0   // refusals so far, on its run
    // a reviewer's semantic (6.3) refusal is declared (core/validate Refusal), never read from its text; after limits.reportRetries the report is accepted unvalidated + flagged
    if (n >= d.cfg.limits.reportRetries && x instanceof Refusal && x.code === 'semantic') {
      await raise(h, b.taskId, 'report-unvalidated'); const text = await report(h, d, agentId, r, { lax: true }); await ok(); return text
    }
    return no(msg)
  }
}

// the brief's heading reads "TASK-c-8-1"; small models copy it into the id field, so the prefix is accepted
export const sameTask = (a: unknown, id: string) => typeof a === 'string' && (a === id || a.replace(/^TASK-/i, '') === id)   // exact first: a configured tracker prefix may itself start with `task-`
const SAFE = /^[\w./@^~:{}+-]+$/
async function onInspect(h: Host, d: Deps, agentId: string | undefined, i: any): Promise<string> {
  const b = agentId ? (await h.bind.read())[agentId] : undefined, tree = b?.worktree || d.root, what = i.what
  if (!['status', 'files', 'log', 'diff', 'show'].includes(what)) return bad('what: expected status|files|log|diff|show')
  if (!agentId && !['status', 'files', 'log'].includes(what)) return bad('main may inspect status, files and log only; read a file with Read, or ask explore what the code does')
  if (i.task && b && !sameTask(i.task, b.taskId)) return bad(`task: you are bound to ${b.taskId}`)
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
  if (!sameTask(i.task, b.taskId)) return bad(`task: you are bound to ${b.taskId}`)
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
// tool.call for mcp__cadre__*. Claude Code takes a string, an array or nothing as an MCP tool's result and refuses an object (main read an error although
// the write had happened): a structured answer goes out as its JSON text. A refusal goes out as {deny}: a hook's only error result (is_error:true;
// d.ts ToolCallResult.deny), where a {result} text is an accepted answer whatever it says
const wired = (r: any) => (typeof r?.result === 'string' && r.result.startsWith('error: ') ? { deny: modelText('deny', r.result) }
  : r && r.result !== undefined && typeof r.result !== 'string' && !Array.isArray(r.result) ? { ...r, result: JSON.stringify(r.result) } : r)
export const handle: Hook = async (h, e, next) => (MAIN.some(t => e.tool === `mcp__cadre__${t.name}`) ? mainTool(h, e).then(wired, x => wired({ result: modelText('tool-result', bad(String((x as Error).message ?? x))) })) as any
  : TOOLS.some(t => e.tool === `mcp__cadre__${t}`) ? (await warm(h), handleWith(h, await resolveDeps(h), e).then(wired)) : next(e))
