// The 3 MCP tools (DESIGN 5.2, 6.2, 6.6): report, inspect, run_check; strict schemas with schemaVersion, isDeferred:false. Registered in session.start from SPECS (register.ts).
// Handlers answer `{result}` (an `error: …` text is a refusal the agent can retry). Descriptions are byte-stable.
import { modelText } from '../core/say'
import type { Hook, Host } from '../types'
import { resolveDeps, type Deps } from '../core/admission'
import { raise, report, runCheck } from '../core/close'
import { warm } from '../core/session'
import { askAnswer, askOf } from '../core/asks'
import { RETRIES, refuse, clearRetries, validateReport } from '../core/validate'
import * as G from '../core/git'

export const TOOLS = ['report', 'inspect', 'run_check'] as const
const S = { type: 'string' }, ARR = { type: 'array' }
const V = { type: 'integer', enum: [1] }
export const SPECS = [
  { name: 'report', isDeferred: false, description: 'Finish your step. Worker: {schemaVersion:1,role:"worker",outcome:"done"|"blocked"|"spec_change",summary,reason?,risks?,questions?}. Tester: role "tester", outcome "done", summary, tests[{path,name,scenario}]. Reviewer: role "reviewer", verdict "pass"|"changes", summary, findings[{severity,file,line?,issue,fix?}], coverage[{scenario,test?,ok}], contractStatus[{name,ok}]. Explorer: role "explorer", answer, citations[{path,line}]. Call it once, then stop.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['schemaVersion', 'role'], properties: { schemaVersion: V, role: { type: 'string', enum: ['worker', 'tester', 'reviewer', 'explorer'] }, outcome: { type: 'string', enum: ['done', 'blocked', 'spec_change'] }, summary: S, reason: S, risks: ARR, questions: ARR, tests: ARR, followups: ARR, verdict: { type: 'string', enum: ['pass', 'changes'] }, findings: ARR, coverage: ARR, contractStatus: ARR, answer: S, citations: ARR } } },
  { name: 'inspect', isDeferred: false, description: 'Read git facts of your task tree. what: status | files | log | diff | show. rev and path are optional; show needs a path. Output: exit, seconds, truncated, capped body.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['what'], properties: { schemaVersion: V, what: { type: 'string', enum: ['status', 'files', 'log', 'diff', 'show'] }, task: S, rev: S, path: S } } },
  { name: 'run_check', isDeferred: false, description: 'Run a named check of your task package on your tree. Output: exit, seconds, truncated, capped body.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['name', 'task'], properties: { schemaVersion: V, name: S, task: S } } },
] as const

const bad = (m: string) => `error: ${m}`

async function onReport(h: Host, d: Deps, agentId: string | undefined, r: any): Promise<string> {
  const key = `report:${agentId ?? 'main'}`
  if (!agentId) return bad('only a spawned agent reports')
  const env = validateReport(r); if (env) return bad(await refuse(h, key, env))
  if (!(await h.bind.read())[agentId] && (await askOf(h, agentId))) return r.role === 'explorer' ? askAnswer(h, agentId, r) : bad('role: you are an explorer; report role "explorer" with answer and citations')
  try {
    const text = await report(h, d, agentId, r); await clearRetries(h, key); return text
  } catch (x) {
    const msg = (x as Error).message, n = (((await h.ui.read()).retries as Record<string, number>) ?? {})[key] ?? 0
    // semantic (6.3) failures only; after limits.reportRetries the report is accepted unvalidated + flagged
    if (n >= Math.min(RETRIES, d.cfg.limits.reportRetries) && /^(findings|coverage|contractStatus|verdict)/.test(msg)) {
      const b = (await h.bind.read())[agentId]; if (b) await raise(h, b.taskId, 'report-unvalidated')
      const text = await report(h, d, agentId, r, { lax: true }); await clearRetries(h, key); return text
    }
    return bad(await refuse(h, key, msg))
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
  const i = e.input ?? e, id = e.agentId as string | undefined
  try {
    switch (String(e.tool).replace(/^mcp__cadre__/, '')) {
      case 'report': return { result: modelText('tool-result', await onReport(h, d, id, i)) }
      case 'inspect': return { result: modelText('tool-result', await onInspect(h, d, id, i)) }
      default: return { result: modelText('tool-result', await onCheck(h, d, id, i)) }
    }
  } catch (x) { return { result: modelText('tool-result', bad(String((x as Error).message ?? x))) } }
}
// tool.call for mcp__cadre__*: answer {result}.
export const handle: Hook = async (h, e, next) => (TOOLS.some(t => e.tool === `mcp__cadre__${t}`) ? (await warm(h), handleWith(h, await resolveDeps(h), e)) : next(e))
