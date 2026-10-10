// report -> review -> verdict -> close (DESIGN 3.4, 3.8, 6.3). Slot #2 `observe`; `report` is called by tools/index; LIFECYCLE + ROUTES.resolve register at load.
// Every function takes explicit Deps (admission.resolveDeps in the slots) so tests drive them with a MemoryStore and a scripted run.
import type { Binding, Hook, Host, SnapTask } from '../types'
import type { Task } from '../task-management/store'
import { pipeOf } from '../task-management/registry'
import { LIFECYCLE } from '../native/tasks'
import { ROUTES } from './dispatch'
import { resolveDeps, type Deps } from './admission'
import { agentsOf, unbindAgent } from './board'
import { apply, STEP_CAT } from './machine'
import { emit } from './events'
import { card, comment, commitMessage, type Rec } from './render'
import { queueResume } from './reuse'
import { resolveGit, sweep } from './effect'
import { policyOf } from '../policy/guards'
import { integrateEpic } from './integrate'
import { green as tddGreen, lockedViolations, resolveSpec, specChange, testerDone } from './tdd'
import { modeOf, pkgOf } from './specview'
import * as G from './git'


const PROTECTED = ['.git/', '.cadre/', '.beads/', '.claude/', '.mcp.json', 'CHANGELOG.md']
const isProt = (p: string) => PROTECTED.some(x => (x.endsWith('/') ? p.startsWith(x) : p === x))
const NUDGE: Record<string, string> = { worker: 'You stopped without calling mcp__cadre__report. Call it now: {"schemaVersion":1,"role":"worker","outcome":"done","summary":"…"} (or outcome "blocked" with reason).', tester: 'You stopped without calling mcp__cadre__report. Call it now with role "tester", outcome "done", summary and tests.', reviewer: 'You stopped without calling mcp__cadre__report. Call it now with role "reviewer", verdict, summary, findings, coverage and contractStatus.', explorer: 'You stopped without calling mcp__cadre__report. Call it now with role "explorer" and your answer.' }
const num = (v?: string) => Number(v ?? 0) || 0
const sha7 = (s: string) => s.slice(0, 7)

// ---- small shared pieces ----
const patch = (h: Host, id: string, fn: (t: SnapTask) => SnapTask) => h.board.update(s => ({ ...s, tasks: s.tasks.map(t => (t.id === id ? fn(t) : t)) }))
export const raise = async (h: Host, id: string, flag: string) => { await patch(h, id, t => (t.flags.includes(flag) ? t : { ...t, flags: [...t.flags, flag] })); await emit(h, 'flag.raised', { taskId: id, flag }, { taskId: id }) }
export const clear = async (h: Host, id: string, pre: string) => {
  const had = ((await h.board.read()).tasks.find(t => t.id === id)?.flags ?? []).filter(f => f.startsWith(pre))
  await patch(h, id, t => ({ ...t, flags: t.flags.filter(f => !f.startsWith(pre)) }))
  for (const f of had) await emit(h, 'flag.resolved', { taskId: id, flag: f }, { taskId: id })
}
async function unbind(h: Host, agentId: string, reason: string, taskId?: string) { await unbindAgent(h, agentId); await emit(h, 'agent.unbound', { agentId, reason }, { agentId, taskId }) }
async function record(h: Host, d: Deps, id: string, kind: string, actor: string, computed: Record<string, unknown>, claimed: Record<string, unknown> = {}) {   // 6.5: meta + comment, same text
  const text = comment({ schemaVersion: 1, kind, taskId: id, at: await h.now(), actor, computed, claimed } as Rec)
  await d.store.setMeta(id, { [`cadre.rec.${kind}`]: text.slice(0, 1800) }, d.actor); await d.store.comment(id, text, d.actor)
}
const pipe = (d: Deps) => pipeOf(d.reg)
const ownerOf = (bind: Record<string, Binding>, id: string, role: string) => agentsOf(bind, id).find(a => !a.startsWith('~') && bind[a].role === role)

// ---- checks in the jail (3.10): the named argv of the task's package, overlay jail on the tree; result = header + capped body + log path ----
export async function runCheck(h: Host, d: Deps, task: Task, wt: string, name: string): Promise<{ found: boolean; ok: boolean; secs: number; text: string }> {
  const pkg = pkgOf(d, task), argv = pkg?.checks?.[name]
  if (!argv) return { found: false, ok: true, secs: 0, text: `no check "${name}" for package ${task.meta['cadre.package'] ?? '.'} (checks: ${Object.keys(pkg?.checks ?? {}).join(', ') || 'none'})` }
  const pkgRoot = !pkg.root || pkg.root === '.' ? wt : `${wt}/${pkg.root}`, scratch = `${d.wtRoot}/${d.key}.scratch/${task.id}`, t0 = await h.now()
  await h.run(['mkdir', '-p', scratch])
  const r = await G.checkRun(h.run, await modeOf(h, d), { wt, scratch, pkgRoot, argv, writable: d.cfg.jailWritable })
  const secs = Math.round(((await h.now()) - t0) / 1000), out = r.stdout + r.stderr, cut = out.length > 16384, path = `${d.root}/.cadre/tmp/logs/${task.id}-${name}-${t0}.log`
  await h.write(path, out).catch(() => {})
  await emit(h, 'check.ran', { taskId: task.id, name, ok: r.exitCode === 0 }, { taskId: task.id })
  return { found: true, ok: r.exitCode === 0, secs, text: `exit=${r.exitCode} · ${secs}s · truncated=${cut ? 'yes' : 'no'}\n${cut ? out.slice(-4096) : out}\nlog: ${path}` }
}

// ---- 6.3 semantic validation of a reviewer report ----
async function semantic(h: Host, task: Task, wt: string, r: any): Promise<string | null> {
  const C = task.meta['cadre.sourceCommit'], fs: any[] = r.findings
  if (!Array.isArray(fs) || !Array.isArray(r.coverage) || !Array.isArray(r.contractStatus)) return 'findings, coverage, contractStatus: expected arrays (may be empty)'
  for (const [i, f] of fs.entries()) {
    if (!['blocker', 'major', 'minor', 'nit'].includes(f?.severity) || typeof f?.file !== 'string' || typeof f?.issue !== 'string') return `findings[${i}]: expected {"severity":"major","file":"src/a.ts","line":3,"issue":"…","fix":"…"}, severity in blocker|major|minor|nit`
    if (!(await G.ok(h.run, wt, ['cat-file', '-e', `${C}:${f.file}`]))) return `findings[${i}].file: ${f.file} does not exist at sourceCommit ${sha7(C)}`
  }
  if (r.verdict === 'changes' && !fs.some(f => f.severity === 'blocker' || f.severity === 'major')) return 'verdict changes needs at least one blocker or major finding; minor/nit alone is a pass'
  if (r.verdict === 'pass' && fs.some(f => f.severity === 'blocker')) return 'verdict pass is refused while a blocker finding is listed'
  const key = (s: unknown) => /^S\d+/.exec(String(s))?.[0] ?? String(s)
  const want = (task.acceptance ?? '').split('\n').map(l => /^S\d+/.exec(l)?.[0]).filter(Boolean) as string[], got = r.coverage.map((c: any) => key(c?.scenario))
  if (want.some(s => !got.includes(s))) return `coverage must name every scenario; missing ${want.filter(s => !got.includes(s)).join(', ')} (e.g. {"scenario":"S1","test":"path","ok":true})`
  const syms: string[] = (task.design ? JSON.parse(task.design).symbols ?? [] : []).map((s: any) => s.name), have = r.contractStatus.map((c: any) => c?.name)
  if (syms.some(s => !have.includes(s))) return `contractStatus must name every contract symbol; missing ${syms.filter(s => !have.includes(s)).join(', ')} (e.g. {"name":"login","ok":true})`
  return null
}

// ---- worker done (also the auto-report): protected/locked paths, mod commit, green gate, -> review ----
async function numstat(h: Host, wt: string, range: string) {
  const rows = (await G.git(h.run, wt, ['diff', '--numstat', range])).split('\n').filter(Boolean).map(l => l.split('\t'))
  return { files: rows.length, add: rows.reduce((n, r) => n + num(r[0]), 0), del: rows.reduce((n, r) => n + num(r[1]), 0) }
}
async function workerDone(h: Host, d: Deps, t: SnapTask, b: Binding, r: any, auto = false): Promise<string> {
  const task = await d.store.get(t.id), wt = b.worktree, base = task.meta['cadre.base'], pol = await policyOf(h)
  const dirty = (await G.git(h.run, wt, ['status', '--porcelain'])).split('\n').filter(Boolean).flatMap(l => l.slice(3).split(' -> ')), changed = new Set([...dirty, ...(await G.git(h.run, wt, ['diff', '--name-only', `${base}..HEAD`])).split('\n').filter(Boolean)])
  const locked = pol.locks?.[t.id] ?? [], bad = [...changed].filter(p => isProt(p) || locked.includes(`${wt}/${p}`))
  if (bad.length) throw new Error(`protected or locked paths changed: ${bad.join(', ')}. Restore them (git checkout ${sha7(base)} -- <path>) and report again`)
  const sum = String(r.summary ?? '').split('\n')[0].slice(0, 60)
  const C = (await G.op(h, () => G.commitAll(h.run, wt, `wip(${t.id}): ${sum || 'work'}`))) ?? (await G.tip(h.run, wt, 'HEAD'))
  if (C === base) throw new Error('nothing changed since the task base; make the change, then report')
  let green: { ok: boolean; check: string; secs: number } | undefined
  if (pipe(d)(t.type).includes('green')) {
    const g = await tddGreen(h, d, task, wt); if (!g.ok) throw new Error(`green gate failed: ${g.why}\nFix it and report again`)
    green = { ok: true, check: 'verify', secs: Number(/\((\d+)s\)/.exec(g.card)?.[1] ?? 0) }
  }
  const st = await numstat(h, wt, `${base}..${C}`), p = pipe(d)(t.type), at = await h.now()
  for (let i = p.indexOf('worker'); p[i] !== 'reviewer'; i++) { const m = await apply(h, { kind: 'advance', id: t.id, at, actor: 'mod' }, pipe(d)); if (!m.ok) throw new Error(m.error) }
  await d.store.setMeta(t.id, { 'cadre.sourceCommit': C, 'cadre.step': 'reviewer', 'cadre.report': JSON.stringify({ summary: r.summary, risks: r.risks, questions: r.questions }).slice(0, 1500), 'cadre.checks': green ? 'verify' : '', 'cadre.nudge': '' }, d.actor)
  await d.store.move(t.id, 'review', d.actor)
  await record(h, d, t.id, 'report', 'worker', { commit: C, ...st, green: green ? `${green.ok ? 'pass' : 'fail'} (${green.secs}s)` : 'n/a', auto }, { outcome: 'done', summary: r.summary, risks: r.risks })
  if (auto) await raise(h, t.id, 'auto-reported')
  const bind = await h.bind.read(), rv = ownerOf(bind, t.id, 'reviewer'), last = rv && bind[rv].lastReviewedCommit
  if (rv) await queueResume(h, { agentId: rv, taskId: t.id, text: `Re-review ${t.id}: the worker reworked. Review ${last ? `${sha7(last)}..` : ''}${sha7(C)} (sourceCommit ${C}) and report your verdict.` })
  const flags = ((await h.board.read()).tasks.find(x => x.id === t.id)?.flags) ?? []
  await patch(h, t.id, x => ({ ...x, card: card({ id: t.id, title: t.title, role: 'worker', to: 'review', green, ...st, commit: C, flags, next: rv ? 'reviewer resumed' : `spawn TASK-${t.id} (reviewer)` }) }))
  return `report accepted: commit ${sha7(C)}, ${st.files} files (+${st.add} −${st.del})${green ? `, verify ${green.ok ? '✓' : '✗'}` : ''}. Now in review; stop and wait.`
}

async function blockTask(h: Host, d: Deps, t: SnapTask, why: string, flag: string, claimed: Record<string, unknown>) {
  const m = await apply(h, { kind: 'block', id: t.id, at: await h.now(), actor: 'mod' }, pipe(d)); if (!m.ok) throw new Error(m.error)
  await d.store.move(t.id, 'blocked', d.actor); await record(h, d, t.id, 'blocked', t.step, { why }, claimed); await raise(h, t.id, flag)
}

// ---- reviewer verdict ----
async function verdict(h: Host, d: Deps, t: SnapTask, b: Binding, agentId: string, r: any): Promise<string> {
  const task = await d.store.get(t.id), C = task.meta['cadre.sourceCommit'], wt = b.worktree, at = await h.now()
  const inDiff = new Set((await G.git(h.run, wt, ['diff', '--name-only', `${task.meta['cadre.base'] ?? C}..${C}`])).split('\n'))
  const findings = (r.findings as any[]).map(f => ({ ...f, inDiff: inDiff.has(f.file) }))
  const m = await apply(h, { kind: 'verdict', id: t.id, at, actor: 'reviewer', verdict: r.verdict }, pipe(d)); if (!m.ok) throw new Error(m.error)
  await h.bind.update(x => (x[agentId] ? { ...x, [agentId]: { ...x[agentId], lastReviewedCommit: C } } : x))
  await record(h, d, t.id, 'review', 'reviewer', { verdict: r.verdict, sourceCommit: C, findings: findings.length }, { summary: r.summary, findings, coverage: r.coverage, contractStatus: r.contractStatus })
  if (r.verdict === 'pass') {
    await d.store.setMeta(t.id, { 'cadre.review': `pass@${C}`, 'cadre.step': 'merge' }, d.actor)
    await patch(h, t.id, x => ({ ...x, card: card({ id: t.id, title: t.title, role: 'reviewer', to: 'review✓', commit: C, flags: x.flags, next: `complete TASK-${t.id}` }) }))
    return `verdict accepted: pass@${sha7(C)}. Stop.`
  }
  const n = num(task.meta['cadre.rework']) + 1, max = d.cfg.review.maxRework
  await d.store.resume(t.id, d.actor); await d.store.setMeta(t.id, { 'cadre.rework': String(n), 'cadre.step': 'worker', 'cadre.review': '' }, d.actor)
  await clear(h, t.id, 'rework:'); if (n > max) await raise(h, t.id, `rework:${n}/${max}`)
  const bind = await h.bind.read(), w = ownerOf(bind, t.id, 'worker')
  const text = `Review of ${sha7(C)} asks for changes (${n}/${max}):\n${r.summary}\n${findings.map(f => `- [${f.severity}] ${f.file}${f.line ? `:${f.line}` : ''} ${f.issue}${f.fix ? ` (fix: ${f.fix})` : ''}`).join('\n')}\nFix them, then report done again.`.slice(0, 3000)
  if (w) await queueResume(h, { agentId: w, taskId: t.id, text })
  await patch(h, t.id, x => ({ ...x, card: card({ id: t.id, title: t.title, role: 'reviewer', to: 'worker', commit: C, flags: x.flags, next: w ? 'worker resumed' : `spawn TASK-${t.id} (worker)` }) }))
  return `verdict accepted: changes (${n}/${max}). Stop.`
}

async function explorerDone(h: Host, d: Deps, t: SnapTask, agentId: string, r: any): Promise<string> {
  const p = pipe(d), at = await h.now()
  await apply(h, { kind: 'advance', id: t.id, at, actor: 'mod' }, p)
  const m = await apply(h, { kind: 'close', id: t.id, at, actor: 'mod' }, p); if (!m.ok) throw new Error(m.error)
  await record(h, d, t.id, 'answer', 'explorer', { citations: (r.citations ?? []).length }, { answer: r.answer })
  await d.store.close(t.id, { outcome: 'done', note: String(r.answer ?? '').slice(0, 500), session: d.session })
  await patch(h, t.id, x => ({ ...x, card: card({ id: t.id, title: t.title, role: 'explorer', to: 'done', flags: x.flags, next: 'read the answer (TaskGet)' }) }))
  await unbind(h, agentId, 'answer', t.id); return 'answer recorded; the spike is done. Stop.'
}

// The one entry for an accepted report (tools/index validated the envelope). Returns the text the agent sees; a thrown Error is a refusal the agent may retry.
export async function report(h: Host, d: Deps, agentId: string | undefined, r: any, o: { lax?: boolean } = {}): Promise<string> {
  const b = agentId ? (await h.bind.read())[agentId] : undefined, s = await h.board.read(), t = b && s.tasks.find(x => x.id === b.taskId)
  if (!b || !t) throw new Error('no task is bound to this agent; only a spawned owner reports')
  if (r.role !== b.role) throw new Error(`role: this agent is bound as ${b.role}, got ${r.role}`)
  if (!(t.step === b.step && STEP_CAT[b.step] === t.state)) throw new Error(`${t.id} is ${t.state}·${t.step}: nothing to report at your step`)
  if (r.role === 'tester') {
    const task = await d.store.get(t.id), g = await testerDone(h, d, task, task.meta['cadre.worktree'], b.worktree, r.tests, agentId)
    if (!g.ok) throw new Error(`red gate refused: ${g.why}\n${g.card}`)
    await record(h, d, t.id, 'red', 'tester', { gate: 'red ✓' }, { summary: r.summary, tests: r.tests }); await patch(h, t.id, x => ({ ...x, card: card({ id: t.id, title: t.title, role: 'tester', to: 'worker', flags: x.flags, next: `spawn TASK-${t.id} (worker)` }) }))
    return `${g.card}\nred accepted; stop.`
  }
  if (r.role === 'explorer') return explorerDone(h, d, t, agentId!, r)
  if (r.role === 'reviewer') { const err = o.lax ? null : await semantic(h, await d.store.get(t.id), b.worktree, r); if (err) throw new Error(err); return verdict(h, d, t, b, agentId!, r) }
  if (r.outcome === 'done') return workerDone(h, d, t, b, r)
  const spec = r.outcome === 'spec_change', why = String(r.reason ?? r.summary ?? '').slice(0, 400)
  if (spec) { await specChange(h, d, t.id, why); await record(h, d, t.id, 'blocked', t.step, { why }, { summary: r.summary, reason: r.reason }); await raise(h, t.id, 'spec_change') }
  else await blockTask(h, d, t, why, 'blocked', { summary: r.summary, reason: r.reason, questions: r.questions })
  return spec ? 'spec change recorded; the human decides (/cadre resolve). Stop and wait.' : 'blocked recorded; main asks the human and you are resumed with the decision. Stop and wait.'
}

// ---- #2 turn.complete: L3 sweep every turn; an agent that stopped without reporting is nudged x2, auto-reported, or released ----
async function release(h: Host, d: Deps, t: SnapTask, b: Binding, agentId: string, why: string) {
  const task = await d.store.get(t.id), n = num(task.meta['cadre.attempts']) + 1
  if (b.worktree) await G.op(h, () => G.commitAll(h.run, b.worktree, `wip(${t.id}): checkpoint (${why})`)).catch(() => {})
  await unbind(h, agentId, 'stopped', t.id); await d.store.setMeta(t.id, { 'cadre.attempts': String(n), 'cadre.nudge': '' }, d.actor)
  if (n >= 3) { await blockTask(h, d, t, `${n} attempts ended without a report`, 'attempts', {}); return }
  await apply(h, { kind: 'release', id: t.id, at: await h.now(), actor: 'mod' }, pipe(d)); await d.store.release(t.id, d.actor, why)
}
export async function stopped(h: Host, d: Deps, e: any): Promise<void> {
  const b = (await h.bind.read())[e.agentId], t = b && (await h.board.read()).tasks.find(x => x.id === b.taskId)
  if (!b || !t || !(t.step === b.step && STEP_CAT[b.step] === t.state)) return   // no binding, or it reported/moved on
  if (e.reason === 'answer') {
    const task = await d.store.get(t.id), [st, n] = (task.meta['cadre.nudge'] ?? '').split(':'), k = st === b.step ? num(n) : 0
    if (k < 2) { await d.store.setMeta(t.id, { 'cadre.nudge': `${b.step}:${k + 1}` }, d.actor); return queueResume(h, { agentId: e.agentId, taskId: t.id, text: NUDGE[b.role] }) }
    if (b.role === 'reviewer') return unbind(h, e.agentId, 'stopped', t.id)   // a verdict is never invented; main spawns a fresh reviewer
    const text = String(e.answer ?? '').slice(0, 300)
    try {
      if (b.role === 'worker') await workerDone(h, d, t, b, { summary: `(auto-report: stopped without report) ${text}` }, true)
      else if (b.role === 'explorer') await explorerDone(h, d, t, e.agentId, { answer: text || '(no answer)', citations: [] })
      else await release(h, d, t, b, e.agentId, 'no report')
    } catch (x) { await release(h, d, t, b, e.agentId, `auto-report failed: ${(x as Error).message}`.slice(0, 200)) }
    return
  }
  if (b.role === 'reviewer') return unbind(h, e.agentId, 'stopped', t.id)
  await release(h, d, t, b, e.agentId, String(e.reason ?? 'stopped'))
}
export async function observeWith(h: Host, d: Deps, e: any, next: (e: any) => any): Promise<any> {
  await sweep(h).catch(x => h.log(`cadre: sweep failed: ${x}`))
  if (e.agentId) await stopped(h, d, e).catch(x => h.log(`cadre: observe failed: ${x}`))
  return next(e)
}
export const observe: Hook = async (h, e, next) => observeWith(h, await resolveDeps(h), e, next)

// ---- close (3.4, 3.8): review✓ -> squash into the epic -> done -> cleanup ----
async function cleanup(h: Host, d: Deps, id: string, task: Task, keep?: string) {
  for (const a of agentsOf(await h.bind.read(), id)) await unbind(h, a, 'answer', id)
  const wt = task.meta['cadre.worktree'], br = task.meta['cadre.branch']
  if (keep && br && (await G.exists(h.run, d.root, br))) await G.git(h.run, d.root, ['update-ref', keep, await G.tip(h.run, d.root, br)])
  if (wt) await G.op(h, () => G.worktreeRemove(h.run, d.root, wt, br))
  await h.run(['rm', '-rf', `${d.wtRoot}/${d.key}.views/${id}`])
}
export async function closeTask(h: Host, d: Deps, id: string): Promise<string | null> {
  const t = (await h.board.read()).tasks.find(x => x.id === id)
  if (!t) return `no task ${id}`
  if (!(t.state === 'review' && t.step === 'merge')) return `${id} is ${t.state}${t.step ? `·${t.step}` : ''}: only a review-passed task (review✓) can be completed`
  await sweep(h).catch(() => {})
  const gf = Object.keys((await h.git.read()).flags ?? {}).find(f => f.startsWith('git:')); if (gf) return `merges are refused while git flag ${gf} is open (/cadre resolve git keep|restore)`
  const task = await d.store.get(id), C = task.meta['cadre.sourceCommit'], wt = task.meta['cadre.worktree'], base = task.meta['cadre.base'], spec = d.reg[t.type], plan = (await h.board.read()).plan
  if (!plan || !C || !wt) return `${id} has no reviewed commit`
  if (task.meta['cadre.review'] !== `pass@${C}`) return `${id} has no pass@${sha7(C)} review`
  if ((await G.tip(h.run, wt, 'HEAD')) !== C) return `${id}: the worktree moved past the reviewed commit ${sha7(C)}`
  if (await G.git(h.run, wt, ['status', '--porcelain'])) return `${id}: the worktree has uncommitted changes`
  if (!task.meta['cadre.changelog']) return `${id}: no changelog decision`
  const files = (await G.git(h.run, wt, ['diff', '--name-only', `${base}..${C}`])).split('\n').filter(Boolean), spc = task.meta['cadre.specCommit']
  const bad = [...files.filter(isProt), ...(spc ? await lockedViolations(h.run, wt, spc, JSON.parse(task.meta['cadre.locked'] ?? '[]'), C) : [])]; if (bad.length) return `${id}: protected or locked paths differ: ${bad.join(', ')}`
  const rep = task.meta['cadre.report'] ? JSON.parse(task.meta['cadre.report']).summary : undefined
  const msg = commitMessage({ type: spec.commit ?? 'chore', scope: task.meta['cadre.scope'] || undefined, breaking: task.meta['cadre.breaking'] === 'true', description: t.title, summary: rep, id, reviewSha: C, checks: task.meta['cadre.checks'] ? [task.meta['cadre.checks']] : [] })
  let sha = '', fail = ''
  for (let i = 0; i < 2 && !sha; i++) {
    const r = await G.op(h, async () => {
      const epicTip = await G.tip(h.run, d.root, plan.epicBranch)
      let s: string
      try { s = await G.squash(h.run, wt, epicTip, C, msg) } catch (x) { return { fail: `conflict: ${(x as Error).message}`, flag: 'conflict' } }
      if (epicTip !== base) { const c = await runCheck(h, d, task, wt, 'verify'); if (!c.ok) return { fail: `verify failed on the squash commit:\n${c.text.slice(0, 1200)}`, flag: 'merge-red' } }
      return (await G.casRef(h.run, d.root, `refs/heads/${plan.epicBranch}`, s, epicTip)) ? { s } : { retry: true }
    }) as { s?: string; fail?: string; flag?: string; retry?: boolean }
    if (r.s) sha = r.s; else if (r.fail) { await blockTask(h, d, t, r.fail, r.flag!, {}); return r.fail } else fail = 'the epic moved twice while squashing'
  }
  if (!sha) { await blockTask(h, d, t, fail, 'conflict', {}); return fail }
  const at = await h.now(), m = await apply(h, { kind: 'close', id, at, actor: 'main' }, pipe(d)); if (!m.ok) return m.error
  await d.store.close(id, { outcome: 'done', note: `squashed ${sha7(sha)} into ${plan.epicBranch}`, session: d.session })
  await record(h, d, id, 'close', 'mod', { squash: sha, epic: plan.epicBranch, reviewed: C })
  await patch(h, id, x => ({ ...x, card: card({ id, title: t.title, role: 'main', to: 'done', commit: sha, flags: [], next: 'wait' }) }))
  await cleanup(h, d, id, task); return null
}

// ---- release / cancel / decision (TaskUpdate pending|deleted, metadata.decision) ----
async function releaseTask(h: Host, d: Deps, id: string): Promise<string | null> {
  const t = (await h.board.read()).tasks.find(x => x.id === id), task = await d.store.get(id), wt = task.meta['cadre.worktree']
  if (!t) return `no task ${id}`
  if (!['active', 'review', 'blocked'].includes(t.state)) return `${id} is ${t.state}: nothing to release`
  for (const a of agentsOf(await h.bind.read(), id)) await unbind(h, a, 'stopped', id)
  if (wt && (await h.stat(wt))) await G.op(h, () => G.commitAll(h.run, wt, `wip(${id}): checkpoint (released)`)).catch(() => {})
  const m = await apply(h, { kind: 'release', id, at: await h.now(), actor: 'main' }, pipe(d)); if (!m.ok) return m.error
  await d.store.release(id, d.actor, 'released by main'); return null
}
async function cancelTask(h: Host, d: Deps, id: string, why: string): Promise<string | null> {
  const t = (await h.board.read()).tasks.find(x => x.id === id), task = await d.store.get(id)
  if (!t) return `no task ${id}`
  const m = await apply(h, { kind: 'cancel', id, at: await h.now(), actor: 'main' }, pipe(d)); if (!m.ok) return m.error
  await cleanup(h, d, id, task, `refs/cadre/quarantine/${id}-${await h.now()}`)
  await d.store.close(id, { outcome: 'cancelled', note: `failed: ${why}`.slice(0, 300), session: d.session }); return null
}
async function decide(h: Host, d: Deps, id: string, text: string): Promise<string | null> {
  const t = (await h.board.read()).tasks.find(x => x.id === id)
  if (t?.state !== 'blocked') return `${id} is not blocked; nothing to decide`
  if ((await d.store.get(id)).meta['cadre.blocked'] === 'spec_change') return `${id} awaits a spec change decision: the human runs /cadre resolve ${id} accept|reject`
  return unblock(h, d, id, `Decision from the human: ${text}`, 'blocked')
}
async function unblock(h: Host, d: Deps, id: string, text: string, flag: string): Promise<string | null> {
  const m = await apply(h, { kind: 'unblock', id, at: await h.now(), actor: 'main' }, pipe(d)); if (!m.ok) return m.error
  await d.store.resume(id, d.actor); await d.store.setMeta(id, { 'cadre.decision': text.slice(0, 1000) }, d.actor)
  await d.store.record('decision', `${id}: ${text.slice(0, 60)}`, text, id); await clear(h, id, flag)
  const w = ownerOf(await h.bind.read(), id, 'worker'); if (w) await queueResume(h, { agentId: w, taskId: id, text })
  return null
}
const wrapL = (f: (h: Host, d: Deps, id: string, e: any) => Promise<string | null>) => async (h: Host, id: string, e: any) => f(h, await resolveDeps(h), id, e)
LIFECYCLE.completed = wrapL(async (h, d, id, e) => (id === (await h.board.read()).epic ? integrateEpic(h, id) : closeTask(h, d, id)))
LIFECYCLE.pending = wrapL((h, d, id) => releaseTask(h, d, id))
LIFECYCLE.deleted = wrapL(async (h, d, id, e) => (id === (await h.board.read()).epic ? 'the epic cannot be deleted; reject the plan instead' : cancelTask(h, d, id, String(e.metadata?.reason ?? 'deleted by main'))))
LIFECYCLE.decision = wrapL((h, d, id, e) => (typeof e.metadata?.decision === 'string' && e.metadata.decision.trim() ? decide(h, d, id, e.metadata.decision) : Promise.resolve('metadata.decision: expected the human\'s answer as a string')))

// ---- /cadre resolve <id> keep|accept|reject|cancel · resolve git keep|restore [flag] ----
ROUTES.resolve = async (h, c) => {
  const [a, b, f] = c.args
  if (a === 'git') {
    const open = Object.keys((await h.git.read()).flags ?? {}).filter(x => x.startsWith('git:') || x.startsWith('quarantine')), flag = f ?? (open.length === 1 ? open[0] : '')
    if (b !== 'keep' && b !== 'restore') return { text: 'usage: /cadre resolve git keep|restore [flag]' }
    if (!flag) return { text: `name the flag: ${open.join(', ') || 'none open'}` }
    const r = await resolveGit(h, flag, b); return { text: r.ok ? `${flag}: ${b} done` : `refused: ${r.error}` }
  }
  const t = (await h.board.read()).tasks.find(x => x.id === a), d = await resolveDeps(h)
  if (!t || !['keep', 'accept', 'reject', 'cancel'].includes(b)) return { text: 'usage: /cadre resolve <taskId> keep|accept|reject|cancel · /cadre resolve git keep|restore' }
  const out = async (e: Promise<string | null>) => ({ text: (await e) ?? `${a}: ${b} done` })
  if (b === 'cancel' || (b === 'reject' && t.flags.some(x => x.startsWith('rework:')))) return out(cancelTask(h, d, a, 'ended by the human'))
  if (t.flags.includes('spec_change') && (b === 'accept' || b === 'reject')) { const r = await resolveSpec(h, a, b); if (/accepted|rejected/.test(r.text)) await clear(h, a, 'spec_change'); return r }
  await patch(h, a, x => ({ ...x, flags: x.flags.filter(y => y.startsWith('git:')) })); await emit(h, 'flag.resolved', { taskId: a, flag: t.flags.join(',') || b }, { taskId: a })   // keep: accept the state, clear the task's flags
  return { text: `${a}: flags cleared (${b})` }
}
