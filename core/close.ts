// report -> review -> verdict -> close (DESIGN 3.4, 3.8, 6.3). Slot #2 `observe`; `report` is called by tools/index; LIFECYCLE + ROUTES.resolve register at load.
// Every function takes explicit Deps (admission.resolveDeps in the slots) so tests drive them with a MemoryStore and a scripted run.
import { NUDGE as ASK_NUDGE, askOf, askStopped } from './asks'
import type { Binding, Hook, Host, SnapTask } from '../types'
import type { Task } from '../task-management/store'
import { pipeOf } from '../task-management/registry'
import { LIFECYCLE } from './plantools'
import { ROUTES } from './dispatch'
import { resolveDeps, type Deps } from './admission'
import { Refusal, SPEC_SCENARIO, coverageGaps, overlap, pathsOf, specTestsOf } from './validate'
import { agentsOf, fnv1a64, patchBinding } from './board'
import { apply, STEP_CAT, transition } from './machine'
import { emit } from './events'
import { card, comment, spawnIt, commitMessage, noReportCard, startNew, type Rec } from './render'
import { checkpoint, resolveGit, sweep } from './effect'
import { policyOf } from '../policy/guards'
import { integrateEpic } from './integrate'
import { green as tddGreen, lockedViolations, verifyOf, redOf, resolveSpec, specChange, testerDone, ASK_SETUP } from './tdd'
import { inRepo, modeOf, pkgOf, unitsOfTask } from './specview'
import * as G from './git'
import { decided, hardStop, limited, stop } from './drive'
import { queueBrief } from './lanes'
import { ask, yoloOn } from './decide'
import { capAsk, coreLanded, refresh, rework, trial } from './rebase'
import { branchOf, epicOf, goOn } from './milestone'
import { planStopped } from './planner'
import { held } from './session'
import { REPEAT, charge, prune, retry, runOf, settled, step } from './lifecycle'
import { drop as dropNeed, helperDone, helperStopped, request } from './needs'
// the worker's report kept for the reviewer and the merge: the report contract caps its fields (validate.REPORTS), so it is kept whole
export const reportMeta = (r: any) => JSON.stringify({ summary: String(r.summary ?? ''), risks: r.risks ?? [], questions: r.questions ?? [] })
export const reportOf = (m?: string): { summary?: string } => { try { return m ? JSON.parse(m) : {} } catch { return { summary: m?.slice(0, 800) } } }   // reports stored by older versions may be cut mid-string


export const NUDGE: Record<string, string> = { worker: 'You stopped without calling report; a hand-back message is not a report. Call the report tool now: {"schemaVersion":1,"role":"worker","outcome":"done","summary":"…"} (or outcome "blocked" with reason).', tester: 'You stopped without calling report; a hand-back message is not a report. Call the report tool now with role "tester", outcome "done", summary and tests.', reviewer: 'You stopped without calling report; a hand-back message is not a report. Call the report tool now with role "reviewer", verdict, summary, findings, coverage and contractStatus.', explorer: ASK_NUDGE }
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
const end = (h: Host, agentId: string, reason: string, cause: 'done' | 'released' | 'blocked' | 'cancelled' | 'retry') => step(h, agentId, { type: 'end', cause, reason })
async function record(h: Host, d: Deps, id: string, kind: string, actor: string, computed: Record<string, unknown>, claimed: Record<string, unknown> = {}) {   // 6.5: the record rides the task's meta
  const text = comment({ schemaVersion: 1, kind, taskId: id, at: await h.now(), actor, computed, claimed } as Rec)
  await d.store.setMeta(id, { [`cadre.rec.${kind}`]: text.slice(0, 1800) }, d.actor)
}
const pipe = (d: Deps) => pipeOf(d.reg)
// a resolve task (core/rebase.resolveTask) takes the other side's protected files (its changelog) as they are: those are not its edits
// a resolve task's commit is a merge with the other side: squashing it would drop that parent and the landing would conflict again, so it goes in as a merge
const keep = async (h: Host, wt: string, tip: string, C: string, msg: string) => { await G.git(h.run, wt, ['checkout', '-q', '--detach', tip]); if ((await h.run(['git', '-C', wt, 'merge', '--no-ff', '--no-verify', '-m', msg, C])).exitCode) { await h.run(['git', '-C', wt, 'merge', '--abort']); throw new Error(`conflict merging ${C.slice(0, 7)}`) } return G.tip(h.run, wt, 'HEAD') }
const ours = async (h: Host, wt: string, onto?: string, rev?: string) => { if (!onto) return () => false; const diff = new Set((await G.git(h.run, wt, ['diff', '--name-only', onto, ...(rev ? [rev] : [])])).split('\n')); return (p: string) => !diff.has(p) }
const ownerOf = (bind: Record<string, Binding>, id: string, role: string) => agentsOf(bind, id).find(a => !a.startsWith('~') && bind[a].role === role)

// ---- checks in the jail (3.10): the named argv of the task's package, overlay jail on the tree; result = header + capped body + log path ----
export async function runCheck(h: Host, d: Deps, task: Task, wt: string, name: string): Promise<{ found: boolean; ok: boolean; secs: number; text: string }> {
  const pkg = pkgOf(d, task), argv = pkg?.checks?.[name]
  if (!argv) return { found: false, ok: true, secs: 0, text: `no check "${name}" for package ${task.meta['cadre.package'] ?? '.'} (checks: ${Object.keys(pkg?.checks ?? {}).join(', ') || 'none'})` }
  const pkgRoot = !pkg.root || pkg.root === '.' ? wt : `${wt}/${pkg.root}`, scratch = `${d.wtRoot}/${d.key}.scratch/${task.id}`, t0 = await h.now()
  await h.run(['mkdir', '-p', scratch])
  const r = await G.checkRun(h.run, await modeOf(h, d), { wt, scratch, pkgRoot, argv, writable: d.cfg.jailWritable })
  const secs = Math.round(((await h.now()) - t0) / 1000), out = r.stdout + r.stderr, cut = out.length > 16384, path = `${d.top ?? d.root}/.cadre/tmp/logs/${task.id}-${name}-${t0}.log`
  await h.write(path, out).catch(() => {})
  await emit(h, 'check.ran', { taskId: task.id, name, ok: r.exitCode === 0, secs, ...(task.meta['cadre.step'] ? { phase: task.meta['cadre.step'] } : {}) }, { taskId: task.id })
  if (r.exitCode || task.meta['cadre.lastCheck']) await d.store.setMeta(task.id, { 'cadre.lastCheck': r.exitCode ? `${name} failed (exit ${r.exitCode}):\n${out.slice(-1200).replaceAll(`${wt}/`, '')}` : '' }, d.actor).catch(() => {})   // the failing tests a respawned agent starts from (admission's handoff)
  return { found: true, ok: r.exitCode === 0, secs, text: `exit=${r.exitCode} · ${secs}s · truncated=${cut ? 'yes' : 'no'}\n${cut ? out.slice(-4096) : out}` }
}

// ---- 6.3 semantic validation of a reviewer report ----
async function semantic(h: Host, task: Task, wt: string, r: any, enforce: boolean): Promise<string | null> {
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
  const gaps = r.verdict === 'pass' ? coverageGaps(enforce, task.acceptance, specTestsOf(task), r.coverage) : []   // ADR 0022: coverage is a hard check
  if (gaps.length) return `coverage: verdict pass is refused: ${gaps.join('; ')}. Report verdict changes with a major finding for each (or give the test that really checks it, ok:true)`
  const syms: string[] = (task.design ? JSON.parse(task.design).symbols ?? [] : []).map((s: any) => s.name), have = r.contractStatus.map((c: any) => c?.name)
  if (syms.some(s => !have.includes(s))) return `contractStatus must name every contract symbol; missing ${syms.filter(s => !have.includes(s)).join(', ')} (e.g. {"name":"login","ok":true})`
  return null
}

// ---- worker done: protected/locked paths, mod commit, green gate, -> review ----
async function numstat(h: Host, wt: string, range: string) {
  const rows = (await G.git(h.run, wt, ['diff', '--numstat', range])).split('\n').filter(Boolean).map(l => l.split('\t'))
  return { files: rows.length, add: rows.reduce((n, r) => n + num(r[0]), 0), del: rows.reduce((n, r) => n + num(r[1]), 0) }
}
async function workerDone(h: Host, d: Deps, t: SnapTask, b: Binding, r: any): Promise<string> {
  const task = await d.store.get(t.id), wt = b.worktree, base = task.meta['cadre.base'], pol = await policyOf(h)
  const dirty = (await G.git(h.run, wt, ['status', '--porcelain'])).split('\n').filter(Boolean).flatMap(l => l.slice(3).split(' -> ')), changed = new Set([...dirty, ...(await G.git(h.run, wt, ['diff', '--name-only', `${task.meta['cadre.specCommit'] ?? base}..HEAD`])).split('\n').filter(Boolean)])   // since the red commit: the spec files it added are the worker's baseline, not its edits
  const theirs = await ours(h, wt, task.meta['cadre.resolve']), locked = pol.locks?.[t.id] ?? [], bad = [...changed].filter(p => (G.isProt(p, d.cfg.changelog.path) && !theirs(p)) || locked.includes(`${wt}/${p}`))
  if (bad.length) throw new Error(`protected or locked paths changed: ${bad.join(', ')}. Restore them (git checkout ${sha7(base)} -- <path>) and report again`)
  const core = pol.core?.[t.id] ?? [], mine = [...dirty, ...(await G.git(h.run, wt, ['diff', '--name-only', `${base}..HEAD`])).split('\n')].filter(p => core.includes(`${wt}/${p}`))   // since the last plan tip merged in: the core's own landing is not this task's edit
  if (mine.length) throw new Error(`shared core files changed: ${mine.join(', ')}. Restore them (git checkout ${sha7(base)} -- <path>); report outcome "blocked" with the change you need in the core`)
  const sum = String(r.summary ?? '').split('\n')[0].slice(0, 60)
  const C = (await G.op(h, () => G.commitAll(h.run, wt, `wip(${t.id}): ${sum || 'work'}`))) ?? (await G.tip(h.run, wt, 'HEAD'))
  if (C === base) throw new Error('nothing changed since the task base; make the change, then report')
  let green: { ok: boolean; check: string; secs: number } | undefined
  if (pipe(d)(t.type, t.lane).includes('green')) {
    const g = await tddGreen(h, d, task, wt); if (!g.ok) throw new Error(`green gate failed: ${g.why}\nFix it and report again`)
    green = { ok: true, check: 'verify', secs: Math.round(Number(/\((\d+(?:\.\d+)?)s\)/.exec(g.card)?.[1] ?? 0)) }
  }
  const st = await numstat(h, wt, `${base}..${C}`), p = pipe(d)(t.type, t.lane), at = await h.now()
  for (let i = p.indexOf('worker'); p[i] !== 'reviewer'; i++) { const m = await apply(h, { kind: 'advance', id: t.id, at, actor: 'mod' }, pipe(d)); if (!m.ok) throw new Error(m.error) }
  await d.store.setMeta(t.id, { 'cadre.sourceCommit': C, 'cadre.step': 'reviewer', 'cadre.report': reportMeta(r), 'cadre.checks': green ? 'verify' : '' }, d.actor)
  await d.store.move(t.id, 'review', d.actor)
  await record(h, d, t.id, 'report', 'worker', { commit: C, ...st, green: green ? `${green.ok ? 'pass' : 'fail'} (${green.secs}s)` : 'n/a' }, { outcome: 'done', summary: r.summary, risks: r.risks })
  await followups(d, t.id, r.followups)
  const bind = await h.bind.read(), rv = ownerOf(bind, t.id, 'reviewer'), last = rv && bind[rv].lastReviewedCommit
  if (!rv) await patch(h, t.id, x => ({ ...x, owner: undefined }))   // no reviewer yet: the next step is "spawn the reviewer", not "running" (live: main waited on a reviewer that never existed); a bound one is resumed below
  if (rv) await step(h, rv, { type: 'resume', text: `Re-review ${t.id}: the worker reworked. Review ${last ? `${sha7(last)}..` : ''}${sha7(C)} (sourceCommit ${C}) and report your verdict.` })
  const flags = ((await h.board.read()).tasks.find(x => x.id === t.id)?.flags) ?? []
  await patch(h, t.id, x => ({ ...x, card: card({ id: t.id, title: t.title, role: 'worker', to: 'review', green, ...st, commit: C, flags, next: rv ? 'reviewer resumed' : startNew(t.id, 'reviewer', 'worker') }) }))
  return `report accepted: commit ${sha7(C)}, ${st.files} files (+${st.add} −${st.del})${green ? `, verify ${green.ok ? '✓' : '✗'}` : ''}. Now in review; stop and wait.`
}

// 3.1 discovered work: each worker followup -> a draft in the lazily created `cadre-backlog` epic, discovered-from this task
export async function followups(d: Deps, from: string, fs: unknown) {
  const list = (Array.isArray(fs) ? fs : []).slice(0, 5).filter((f: any) => typeof f?.title === 'string' && f.title.trim())
  if (!list.length) return
  const backlog = (await d.store.list({})).find(x => x.type === 'epic' && x.title === 'cadre-backlog')?.id ?? await d.store.createEpic('cadre-backlog', 'discovered work, not yet planned')
  for (const f of list as any[]) await d.store.createDraft({ title: f.title.slice(0, 120), description: String(f.description ?? '').slice(0, 1000), type: 'feature', parent: backlog, discoveredFrom: from })
}
// the task's cap of malformed reports (limits.shapeRetries): the agent was refused every time and is not told to stop trying, so the task waits for the user (flag `shape`)
export async function shapeBlock(h: Host, d: Deps, taskId: string, n: number): Promise<void> {
  const t = (await h.board.read()).tasks.find(x => x.id === taskId); if (t && t.state !== 'blocked') await blockTask(h, d, t, `${n} reports were refused for their form`, 'shape', {})
}
async function blockTask(h: Host, d: Deps, t: SnapTask, why: string, flag: string, claimed: Record<string, unknown>) {
  const m = await apply(h, { kind: 'block', id: t.id, at: await h.now(), actor: 'mod' }, pipe(d)); if (!m.ok) throw new Error(m.error)
  await d.store.move(t.id, 'blocked', d.actor); await d.store.setMeta(t.id, { 'cadre.blocked': flag }, d.actor)   // the flag survives /clear (core/session.reask)
  await record(h, d, t.id, 'blocked', t.step, { why }, claimed); await raise(h, t.id, flag)
}

// ---- reviewer verdict ----
async function verdict(h: Host, d: Deps, t: SnapTask, b: Binding, agentId: string, r: any): Promise<string> {
  const task = await d.store.get(t.id), C = task.meta['cadre.sourceCommit'], wt = b.worktree, at = await h.now()
  const gaps = r.verdict === 'pass' ? coverageGaps(d.cfg.review.coverage.enforce, task.acceptance, specTestsOf(task), r.coverage) : []   // a pass accepted unvalidated still cannot skip coverage
  if (gaps.length) r = { ...r, verdict: 'changes', findings: [...r.findings, ...gaps.map(g => ({ severity: 'major', file: '', issue: `${g}. Add or strengthen a test named after it; if that test is a locked spec test, report outcome "spec_change" asking for it` }))] }
  const inDiff = new Set((await G.git(h.run, wt, ['diff', '--name-only', `${task.meta['cadre.base'] ?? C}..${C}`])).split('\n'))
  const findings = (r.findings as any[]).map(f => ({ ...f, inDiff: inDiff.has(f.file) }))
  // findings on spec tests the worker may not edit, and findings on files outside the task's own files (live: CI and README, "needs a scope decision": the worker blocked)
  const locks = (await policyOf(h)).locks?.[t.id] ?? [], onLocked = [...new Set(findings.filter(f => f.file && locks.includes(`${task.meta['cadre.worktree'] ?? wt}/${f.file}`)).map(f => f.file as string))]
  const mine = pathsOf(task), outside = new Set(mine.length ? findings.filter(f => f.file && !f.inDiff && !onLocked.includes(f.file) && !mine.some(p => overlap(p, f.file))).map(f => f.file as string) : [])
  // a `changes` whose every blocking finding is outside the task's files is a pass with followups: the worker cannot fix those, so a re-review would ask forever
  const blockers = findings.filter(f => !['minor', 'nit'].includes(String(f.severity))); let filed = ''   // filed: the card's note that the pass carries followups
  if (r.verdict === 'changes' && blockers.length && blockers.every(f => outside.has(f.file)) && !coverageGaps(d.cfg.review.coverage.enforce, task.acceptance, specTestsOf(task), r.coverage).length) {   // coverage still counts: a pass cannot skip it
    r = { ...r, verdict: 'pass' }
    await followups(d, t.id, findings.map(f => ({ title: `${f.file}: ${String(f.issue).split('\n')[0]}`.slice(0, 120), description: `${f.issue}${f.fix ? ` (fix: ${f.fix})` : ''}`.slice(0, 1000) })))
    filed = ` · passed with ${Math.min(5, findings.length)} followup(s)${findings.length > 5 ? ` (+${findings.length - 5} more not filed)` : ''}`   // followups() files at most 5
    await decided(h, 'rework', `${t.id}: passed with its findings outside the task's files as followups${findings.length > 5 ? ` (+${findings.length - 5} more not filed)` : ''}`, t.id)
  }
  const m = await apply(h, { kind: 'verdict', id: t.id, at, actor: 'reviewer', verdict: r.verdict }, pipe(d)); if (!m.ok) throw new Error(m.error)
  await patchBinding(h, agentId, { lastReviewedCommit: C })
  await record(h, d, t.id, 'review', 'reviewer', { verdict: r.verdict, sourceCommit: C, findings: findings.length }, { summary: r.summary, findings, coverage: r.coverage, contractStatus: r.contractStatus })
  if (r.verdict === 'pass') {
    await d.store.setMeta(t.id, { 'cadre.review': `pass@${C}`, 'cadre.step': 'merge' }, d.actor)
    await patch(h, t.id, x => ({ ...x, card: card({ id: t.id, title: t.title, role: 'reviewer', to: 'review✓', commit: C, flags: x.flags, next: `complete TASK-${t.id}${filed}` }) }))
    return `verdict accepted: pass@${sha7(C)}. Stop.`
  }
  const n = await charge(h, t.id, 'rework'), max = d.cfg.review.maxRework, dr = (await h.board.read()).drive
  if (n > max && dr.on && !dr.stopped) {   // past the cap while driving (both modes): cancel it and go on, unless other open tasks need it: then the run stops (ADR 0013)
    const all = (await h.board.read()).tasks, need = all.filter(x => x.deps.some(p => p.id === t.id) && x.state !== 'done' && x.state !== 'cancelled').map(x => x.id)
    if (!need.length) {
      const e = await cancelTask(h, d, t.id, `review asked for changes ${n} times`); if (e) throw new Error(e)
      await decided(h, 'rework', `${t.id} cancelled: review asked for changes ${n} times (limit ${max})`, t.id)
      return `verdict accepted: changes (${n}/${max}); the task is over its limit and was cancelled. Stop.`
    }
    await stop(h, `${t.id} failed review ${n} times and ${need.join(', ')} need${need.length === 1 ? 's' : ''} it`, { taskId: t.id, flag: 'rework:' })
  }
  const asked = findings.map(f => `- [${f.severity}] ${f.file}${f.line ? `:${f.line}` : ''} ${f.issue}${f.fix ? ` (fix: ${f.fix})` : ''}`).join('\n')
  await d.store.resume(t.id, d.actor); await d.store.setMeta(t.id, { 'cadre.step': 'worker', 'cadre.review': '', 'cadre.rejected': `review of ${sha7(C)}: ${r.summary}\n${asked}` }, d.actor)   // the handoff's Rejected (briefs.handoffOf)
  await clear(h, t.id, 'rework:'); if (n > max) await raise(h, t.id, `rework:${n}/${max}`)
  const bind = await h.bind.read(), w = ownerOf(bind, t.id, 'worker')
  const lockedNote = onLocked.length ? `\nA finding on ${onLocked.join(', ')} cannot be fixed by editing it (locked spec test): if it is right, report outcome "spec_change" with scenario: the changed scenario in full; fix the others.` : ''
  const outNote = outside.size ? `\nA finding on ${[...outside].slice(0, 5).map(f => f.slice(0, 120)).join(', ')}${outside.size > 5 ? ` and ${outside.size - 5} more` : ''} ${outside.size === 1 ? 'is' : 'are'} outside your files: do not edit ${outside.size === 1 ? 'it' : 'them'} and do not block on ${outside.size === 1 ? 'it' : 'them'}; list ${outside.size === 1 ? 'it' : 'them'} under followups, fix the others, then report done.` : ''
  const text = `Review of ${sha7(C)} asks for changes (${n}/${max}):\n${r.summary}\n${asked}${lockedNote}${outNote}\nFix them, then report done again.`.slice(0, 3000)
  if (w) await step(h, w, { type: 'resume', text })
  await patch(h, t.id, x => ({ ...x, card: card({ id: t.id, title: t.title, role: 'reviewer', to: 'worker', commit: C, flags: x.flags, next: w ? 'worker resumed' : startNew(t.id, 'worker', 'reviewer') }) }))
  return `verdict accepted: changes (${n}/${max}). Stop.`
}

async function explorerDone(h: Host, d: Deps, t: SnapTask, agentId: string, r: any): Promise<string> {
  const p = pipe(d), at = await h.now()
  await apply(h, { kind: 'advance', id: t.id, at, actor: 'mod' }, p)
  const m = await apply(h, { kind: 'close', id: t.id, at, actor: 'mod', cites: (r.citations ?? []).length }, p); if (!m.ok) throw new Error(m.error)
  await record(h, d, t.id, 'answer', 'explorer', { citations: (r.citations ?? []).length }, { answer: r.answer })
  await d.store.close(t.id, { outcome: 'done', note: String(r.answer ?? '').slice(0, 500), session: d.session })
  const next = await lastNext(h, (await h.board.read()).plan?.id, 'read the answer (status)')
  await patch(h, t.id, x => ({ ...x, card: card({ id: t.id, title: t.title, role: 'explorer', to: 'done', flags: x.flags, next }) }))
  await end(h, agentId, 'answer', 'done'); return 'answer recorded; the spike is done. Stop.'
}

// The one entry for an accepted report (tools/index validated the envelope). Returns the text the agent sees; a thrown Error is a refusal the agent may retry.
export async function report(h: Host, d: Deps, agentId: string | undefined, r: any, o: { lax?: boolean } = {}): Promise<string> {
  const b = agentId ? (await h.bind.read())[agentId] : undefined, s = await h.board.read(), t = b && s.tasks.find(x => x.id === b.taskId)
  if (b?.parent) return helperDone(h, b, r)   // a helper answers its requester, before the task lookup (a planner's task is an epic), the step gate and the role dispatch
  if (!b || !t) throw new Error('no task is bound to this agent; only a spawned owner reports')
  if (r.outcome === 'request') return request(h, agentId!, b, r)   // the requester waits on its answer
  if (r.role !== b.role) throw new Error(`role: this agent is bound as ${b.role}, got ${r.role}`)
  if (!(t.step === b.step && STEP_CAT[b.step] === t.state)) throw new Error(`${t.id} is ${t.state}·${t.step}: nothing to report at your step`)
  if (r.role === 'tester') {
    const task = await d.store.get(t.id), g = await testerDone(h, d, task, task.meta['cadre.worktree'], b.worktree, r.tests, agentId, r.run)
    if (!g.ok) {   // bounded (limits.testerRounds, across agents: the task budget's red): past it, or a setup fault the tester cannot fix, the task blocks once with one dialog naming the check
      const n = await charge(h, t.id, 'red')   // only the dialog's Retry clears it
      const pkgMissing = g.setup && /\(missing module\)/.test(g.why ?? '')   // a package: the tester can ask for it; a missing runner stays a dialog
      if ((!g.setup || pkgMissing) && n < d.cfg.limits.testerRounds) throw new Error(`red gate refused: ${g.why}\n${g.card}${pkgMissing ? `\n${ASK_SETUP}` : ''}`)
      await redAsk(h, d, t.id, g.setup ? g.why! : `check "${redOf(pkgOf(d, task)!)}" after ${n} tester rounds: ${g.why}`)
      await blockTask(h, d, t, `red: ${g.why}`, 'red', { summary: r.summary, tests: r.tests })
      return 'Your tests are kept, but they cannot be made to fail for the right reason here; the task now waits for the user. Stop.'
    }
    const nx = (await h.board.read()).tasks.find(x => x.id === t.id), rv = nx?.state === 'review'   // no worker step (a test task): the reviewer is next, and the claim's owner goes with the card (it would keep the reviewer from being spawned; live: idle after the tester's accepted tests)
    await record(h, d, t.id, 'red', 'tester', { gate: 'red ✓' }, { summary: r.summary, tests: r.tests }); await patch(h, t.id, x => ({ ...x, ...(rv ? { owner: undefined } : {}), card: card({ id: t.id, title: t.title, role: 'tester', to: rv ? 'reviewer' : 'worker', flags: x.flags, next: startNew(t.id, rv ? 'reviewer' : 'worker', 'tester') }) }))
    return `${g.card}\nred accepted; stop.`
  }
  if (r.role === 'explorer') return explorerDone(h, d, t, agentId!, r)
  if (r.role === 'reviewer') { const err = o.lax ? null : await semantic(h, await d.store.get(t.id), b.worktree, r, d.cfg.review.coverage.enforce); if (err) throw new Refusal(err, 'semantic'); return verdict(h, d, t, b, agentId!, r) }
  if (r.outcome === 'done') return workerDone(h, d, t, b, r)
  const spec = r.outcome === 'spec_change', why = String(r.reason ?? r.summary ?? '').slice(0, 400)
  if (spec && r.scenario !== undefined && r.scenario !== '' && !SPEC_SCENARIO.test(String(r.scenario))) throw new Error('scenario: expected one line "S<n>: Given … When … Then …"')   // before anything is written: the worker fixes it at once
  if (spec) { await specChange(h, d, t.id, why, String(r.scenario ?? '')); await record(h, d, t.id, 'blocked', t.step, { why }, { summary: r.summary, reason: r.reason }); await raise(h, t.id, 'spec_change') }
  else { await d.store.setMeta(t.id, { 'cadre.question': why }, d.actor); await blockTask(h, d, t, why, 'blocked', { summary: r.summary, reason: r.reason, questions: r.questions }) }   // yolo: main answers it from this (core/drive)
  return spec ? 'spec change recorded; it is decided for you. Stop and wait.' : 'blocked recorded; you are resumed with the answer. Stop and wait.'
}

// the red block's dialog (asked before the flag is raised, so it wins over the generic one): what failed, Retry (back to the tester, fresh rounds) or Cancel
async function redAsk(h: Host, d: Deps, id: string, why: string) {
  await ask(h, { id: `flag:${id}:red`, kind: 'flag', title: `${id}: its tests cannot be made red`, tab: 'epic', sel: id, hash: fnv1a64(why), lines: [...why.slice(0, 400).split('\n').filter(Boolean), 'Retry: fix the cause (the package checks, or the test setup), then a new tester writes the tests again. Cancel task: end it.'],
    options: [{ key: 'r', label: 'Retry', verb: 'restore', run: `resolve ${id} retry` }, { key: 'x', label: 'Cancel task', verb: 'cancel', run: `resolve ${id} cancel` }] })
}

// ---- #2 turn.complete: L3 sweep every turn; an agent that stopped without reporting is nudged (limits.nudges), then ends: its work is not accepted as a result, one dialog ----
async function release(h: Host, d: Deps, t: SnapTask, b: Binding, agentId: string, why: string) {
  const n = await charge(h, t.id, 'silentRuns')
  if (b.worktree) await checkpoint(h, d.store, d.actor, t.id, b.worktree).catch(() => {})
  await end(h, agentId, 'stopped', n >= d.cfg.limits.silentRuns ? 'blocked' : 'released')
  if (n >= d.cfg.limits.silentRuns) { await blockTask(h, d, t, `${n} attempts ended without a report`, 'attempts', {}); return }
  await apply(h, { kind: 'release', id: t.id, at: await h.now(), actor: 'mod' }, pipe(d)); await d.store.release(t.id, d.actor, why)
}
export async function stopped(h: Host, d: Deps, e: any): Promise<void> {
  const b = (await h.bind.read())[e.agentId], t = b && (await h.board.read()).tasks.find(x => x.id === b.taskId)
  if (b && (await runOf(h, e.agentId))?.state?.state === 'waiting') return   // a parked run (a decision, a rework, a need): no nudge, charge or card
  if (b?.parent) return helperStopped(h, b, e)   // a helper ends and answers exactly once (core/needs), whatever its role's step is
  if (b?.role === 'planner') return planStopped(h, d, e)   // an epic's planner (core/planner)
  if (b && t && (await runOf(h, e.agentId))?.exit) { await end(h, e.agentId, 'loop', 'blocked'); return blockTask(h, d, t, `its agent made the same call ${REPEAT} times in a row`, 'loop', {}) }   // the breaker spent it (exit rule 4): one dialog
  if (!b || !t || !(t.step === b.step && STEP_CAT[b.step] === t.state)) return   // no binding, or it reported/moved on
  if (e.reason === 'answer') {
    const run = await runOf(h, e.agentId), k = run?.state?.state === 'silent' ? run.state.n : 0, stag = (run?.stag ?? 0) >= d.cfg.limits.stagnantNudges   // this run's nudges so far · nudged that often with no tool call between
    if (!stag && k < d.cfg.limits.nudges) {
      await step(h, e.agentId, { type: 'turn.end', text: NUDGE[b.role] }); await charge(h, t.id, 'nudges')
      await patch(h, t.id, x => ({ ...x, card: noReportCard(x, b.role, b.step) }))   // (wrap builds the same card for the Agent result, which returns before this stop is observed)
      return
    }
    if (b.role === 'reviewer') { await patch(h, t.id, x => ({ ...x, owner: undefined })); return end(h, e.agentId, 'stopped', 'released') }   // a verdict is never invented; main spawns a fresh reviewer
    if (b.worktree) await checkpoint(h, d.store, d.actor, t.id, b.worktree).catch(() => {})   // its edits are kept for whoever goes on, never accepted as its result
    await end(h, e.agentId, 'stopped', 'blocked')   // it ends (exit rule 1): the stop itself is never refused
    return blockTask(h, d, t, stag ? `its ${b.role} stopped ${run!.stag} times in a row without a report or a tool call; nothing it did was accepted as a result` : `its ${b.role} ended without a report; nothing it did was accepted as a result`, stag ? 'stagnant' : 'no-report', {})
  }
  if (await limited(h, e)) { await end(h, e.agentId, 'stopped', 'released'); if (b.role === 'reviewer') return patch(h, t.id, x => ({ ...x, owner: undefined })); await apply(h, { kind: 'release', id: t.id, at: await h.now(), actor: 'mod' }, pipe(d)); return void (await d.store.release(t.id, d.actor, 'usage limit')) }   // not an attempt: the drive waits for the reset
  if (b.role === 'reviewer') { await patch(h, t.id, x => ({ ...x, owner: undefined })); return end(h, e.agentId, 'stopped', 'released') }
  await release(h, d, t, b, e.agentId, String(e.reason ?? 'stopped'))
}
// the 5 s tick: the stall timers (ADR 0024 B2). first: no model request since its start; stale: no activity for lifecycle.staleMin (the run is cancelled and its task blocks, never replaced by itself);
// gone: its session is gone. Each ends the run, so each fires once. first and stale only by the session that holds the agent; gone by any session.
export async function stalls(h: Host, me: string): Promise<void> {
  const d = await resolveDeps(h), now = await h.now(), bind = await h.bind.read(), tasks = (await h.board.read()).tasks
  for (const [a, b] of Object.entries(bind)) {
    const r = a.startsWith('~') || b.parent || b.retired || b.role === 'planner' ? undefined : await runOf(h, a), t = tasks.find(x => x.id === b.taskId)
    if (!r || r.exit || !['running', 'refused', 'silent'].includes(r.state?.state ?? '') || !t || !(t.step === b.step && STEP_CAT[b.step] === t.state) || (await askOf(h, a))) continue
    const idle = now - (b.lastAt ?? b.startedAt), hd = await held(h, b.sessionId), mine = hd === 'here' || b.sessionId === me
    const kind = hd === 'gone' && !mine ? (idle > d.cfg.lifecycle.goneSec * 1000 ? 'gone' : null) : !mine ? null : idle > d.cfg.lifecycle.staleMin * 60_000 ? 'stale' : !b.lastAt && idle > d.cfg.lifecycle.firstOutputSec * 1000 ? 'first' : null
    if (!kind) continue
    if (b.worktree) await checkpoint(h, d.store, d.actor, t.id, b.worktree).catch(() => {})
    if (kind === 'stale') await end(h, a, 'stalled', 'cancelled')
    else if (b.role === 'reviewer') { await patch(h, t.id, x => ({ ...x, owner: undefined })); await end(h, a, 'stalled', 'released') }   // a verdict is never invented; main spawns a fresh reviewer
    else await release(h, d, t, b, a, `stalled (${kind})`)
    if (kind !== 'gone') await h.stopAgent?.(a).catch(() => {})
    if (kind === 'stale') await blockTask(h, d, t, `its ${b.role} did nothing for ${d.cfg.lifecycle.staleMin} minutes and was stopped`, 'stale', {})
  }
}
export async function observeWith(h: Host, d: Deps, e: any, next: (e: any) => any): Promise<any> {
  await sweep(h).catch(x => h.log(`sweep failed: ${x}`))
  if (e.agentId) await settled(h, e.agentId).catch(() => {})
  if (e.agentId) await ((await askOf(h, e.agentId)) ? askStopped(h, e) : stopped(h, d, e)).catch(x => h.log(`observe failed: ${x}`))
  return next(e)
}
export const observe: Hook = async (h, e, next) => observeWith(h, await resolveDeps(h), e, next)

// ---- close (3.4, 3.8): review✓ -> squash into the epic -> done -> cleanup ----
async function cleanup(h: Host, d: Deps, id: string, task: Task, keep?: string) {
  await dropNeed(h, id)
  const gone = agentsOf(await h.bind.read(), id); for (const a of gone) await end(h, a, 'answer', keep ? 'cancelled' : 'done')
  await prune(h, id, gone)   // the ended records and the budget of a closed task go
  const wt = task.meta['cadre.worktree'], br = task.meta['cadre.branch']; d = inRepo(d, pkgOf(d, task))
  if (keep && br && (await G.exists(h.run, d.root, br))) await G.git(h.run, d.root, ['update-ref', keep, await G.tip(h.run, d.root, br)])
  if (wt) await G.op(h, () => G.worktreeRemove(h.run, d.root, wt, br))
  await h.run(['rm', '-rf', `${d.wtRoot}/${d.key}.views/${id}`])
}
// the close of the plan's last open task nudges main once (the card's next line) to complete the plan, so it lands and a new goal is accepted
export const lastNext = async (h: Host, plan: string | undefined, or: string, epic?: string) => { const b = await h.board.read(); return plan && b.plan?.id === plan && b.plan.state === 'approved' && b.tasks.every(x => (epic && x.epic !== epic) || x.state === 'done' || x.state === 'cancelled') ? `every task ${epic ? `of epic ${epic} ` : ''}is done: complete ${epic ? 'it' : 'the plan'} (status {id:"${epic ?? plan}", set:"completed"})` : or }
export async function closeTask(h: Host, d: Deps, id: string, actor: 'main' | 'mod' = 'main'): Promise<string | null> {   // 'mod': the spawner closes it (ADR 0018)
  const t = (await h.board.read()).tasks.find(x => x.id === id)
  if (!t) return `no task ${id}`
  if (!(t.state === 'review' && t.step === 'merge')) return `${id} is ${t.state}${t.step ? `·${t.step}` : ''}: only a review-passed task (review✓) can be completed`
  await sweep(h).catch(() => {})
  const gf = Object.keys((await h.git.read()).flags ?? {}).find(f => f.startsWith('git:')); if (gf) return `merges are refused while git flag ${gf} is open; ask the human to keep or restore it (they answer it in the cadre dialog)`
  d = inRepo(d, pkgOf(d, await d.store.get(id)))   // a submodule unit's task squashes into that repository's epic branch (H7)
  const task = await d.store.get(id), C = task.meta['cadre.sourceCommit'], wt = task.meta['cadre.worktree'], base = task.meta['cadre.base'], spec = d.reg[t.type], plan = (await h.board.read()).plan, br = branchOf({ plan }, t)   // a milestone task squashes into its epic's branch (ADR 0015)
  if (!plan || !C || !wt) return `${id} has no reviewed commit`
  if (task.meta['cadre.review'] !== `pass@${C}`) return `${id} has no pass@${sha7(C)} review`
  if ((await G.tip(h.run, wt, 'HEAD')) !== C) return `${id}: the worktree moved past the reviewed commit ${sha7(C)}`
  if (await G.git(h.run, wt, ['status', '--porcelain'])) return `${id}: the worktree has uncommitted changes`
  if (!task.meta['cadre.changelog']) return `${id}: no changelog decision`
  const files = (await G.git(h.run, wt, ['diff', '--name-only', `${base}..${C}`])).split('\n').filter(Boolean), spc = task.meta['cadre.specCommit']
  const theirs = await ours(h, wt, task.meta['cadre.resolve'], C), bad = [...files.filter(p => G.isProt(p, d.cfg.changelog.path) && !theirs(p)), ...(spc ? await lockedViolations(h.run, wt, spc, JSON.parse(task.meta['cadre.locked'] ?? '[]'), C) : [])]; if (bad.length) return `${id}: protected or locked paths differ: ${bad.join(', ')}`
  const rep = reportOf(task.meta['cadre.report']).summary
  const msg = commitMessage({ type: spec.commit ?? 'chore', scope: task.meta['cadre.scope'] || undefined, breaking: task.meta['cadre.breaking'] === 'true', description: t.title, summary: rep, id, reviewSha: C, checks: task.meta['cadre.checks'] ? [task.meta['cadre.checks']] : [] })
  let sha = '', fail = ''
  const back = () => G.git(h.run, wt, ['checkout', '-q', '-f', task.meta['cadre.branch']]).catch(() => {})   // squash detaches; a failed close returns the worker to its branch, its files intact for the rework
  const moved = async (why: 'conflict' | 'red', tip: string, files: string[], detail = '') => {   // the plan moved under it: its worker reworks it (core/rebase), past the cap it is blocked and asked
    const r = await rework(h, d, t, task, tip, why, detail); if (r) return r
    await blockTask(h, d, t, `still ${why === 'red' ? 'red' : 'conflicting'} after ${d.cfg.limits.rebaseRounds} reworks`, why === 'red' ? 'merge-red' : 'conflict', {}); if (why === 'conflict') await capAsk(h, d, t, task, tip, files)
    return `${id} still ${why === 'red' ? 'fails its checks' : 'conflicts'} on the plan after ${d.cfg.limits.rebaseRounds} reworks; it waits for the user. Go on with the other tasks.`
  }
  { const tip = await G.tip(h.run, d.root, br), c = tip === base ? null : await trial(h, d.root, tip, C); if (c?.length) return moved('conflict', tip, c) }   // a trial merge first (git >= 2.38): no squash attempt to undo
  for (let i = 0; i < 2 && !sha; i++) {
    const r = await G.op(h, async () => {
      const epicTip = await G.tip(h.run, d.root, br)
      let s: string
      try { s = task.meta['cadre.resolve'] ? await keep(h, wt, epicTip, C, msg) : await G.squash(h.run, wt, epicTip, C, msg) } catch (x) { return { fail: `conflict: ${(x as Error).message}`, flag: 'conflict', tip: epicTip } }
      const us = unitsOfTask(d, task), cross = us.length > 1   // a cross-unit task: one integration check, every unit it touches (H7)
      if (epicTip !== base || cross) {   // the unit's own verify checks (as the green gate runs them); a missing check is a failure, not a pass
        for (const u of cross ? us : [pkgOf(d, task)]) for (const n of u ? verifyOf(u) : ['verify']) {
          const c = await runCheck(h, d, cross ? { ...task, meta: { ...task.meta, 'cadre.package': u!.root } } : task, wt, n); if (!c.found || !c.ok) return { fail: `verify (${cross ? `${u!.root}:` : ''}${n}) failed on the squash commit:\n${c.text.slice(0, 1200)}`, flag: 'merge-red', tip: epicTip }
        }
      }
      return (await G.casRef(h.run, d.root, `refs/heads/${br}`, s, epicTip)) ? { s } : { retry: true }
    }) as { s?: string; fail?: string; flag?: string; tip?: string; retry?: boolean }
    if (r.s) sha = r.s; else if (r.fail) { await back(); return moved(r.flag === 'merge-red' ? 'red' : 'conflict', r.tip!, [], r.flag === 'merge-red' ? r.fail : '') } else fail = 'the epic moved twice while squashing'
  }
  if (!sha) { await back(); await blockTask(h, d, t, fail, 'conflict', {}); return fail }
  const at = await h.now(), m = await apply(h, { kind: 'close', id, at, actor }, pipe(d)); if (!m.ok) return m.error
  await d.store.close(id, { outcome: 'done', note: `squashed ${sha7(sha)} into ${br}`, session: d.session })
  await record(h, d, id, 'close', 'mod', { squash: sha, epic: br, reviewed: C })
  const next = await lastNext(h, plan.id, 'wait', t.epic)
  await patch(h, id, x => ({ ...x, card: card({ id, title: t.title, role: 'main', to: 'done', commit: sha, flags: [], next }) }))
  await cleanup(h, d, id, task)
  if (task.meta['cadre.core'] === 'true') await coreLanded(h, d, files, task.design).catch(e => h.log(`core lock: ${e}`))   // its files are locked for the other tasks of the plan
  if (!d.top) await refresh(h, d, sha, id).catch(e => h.log(`refresh after ${id}: ${e}`))   // running siblings get the new tip now (core/rebase); a submodule's tip is not the plan's
  return null
}

// ---- release / cancel / decision (status set pending|deleted, decision) ----
async function releaseTask(h: Host, d: Deps, id: string): Promise<string | null> {
  const t = (await h.board.read()).tasks.find(x => x.id === id), task = await d.store.get(id), wt = task.meta['cadre.worktree']
  if (!t) return `no task ${id}`
  if (!['active', 'review', 'blocked'].includes(t.state)) return `${id} is ${t.state}: nothing to release`
  await dropNeed(h, id); for (const a of agentsOf(await h.bind.read(), id)) await end(h, a, 'stopped', 'released')
  if (wt && (await h.stat(wt))) await checkpoint(h, d.store, d.actor, id, wt).catch(() => {})
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
  const y = yoloOn((await h.board.read()).drive), why = y ? await hardStop(h) : null
  if (why) { await stop(h, why); return `${id}: the run stopped (${why}); the user decides this task in the cadre dialog now. Stop and wait.` }   // a hard stop mid-turn: main's decision is not applied
  const meta = (await d.store.get(id)).meta
  if (meta['cadre.blocked'] === 'spec_change') {   // yolo: main accepts or rejects it, through the same path as the dialog (recorded)
    if (!y) return `${id} awaits a spec change decision: the human accepts or rejects it in the cadre dialog`
    const m = /^\s*(accept|reject)\s*:\s*(\S[\s\S]*)$/i.exec(text); if (!m) return `${id}: decision must be "accept: <reason>" or "reject: <reason>"`   // the exact word and a colon: "acceptable… reject: …" must never read as accept
    const how = m[1].toLowerCase(), n = Number(meta['cadre.specAccepts'] || 0)
    if (how === 'accept' && n >= 2) { const w = `${id} asked to change its locked spec ${n + 1} times`; await stop(h, w, { taskId: id, flag: 'spec_change' }); return `${id}: the run stopped (${w}); the user decides this task in the cadre dialog now. Stop and wait.` }   // accept, rewind, accept… never counts as no progress: cap it
    const r = await resolveSpec(h, id, how, 'main', m[2].trim()); if (!/accepted|rejected/.test(r.text)) return r.text
    if (how === 'accept') await d.store.setMeta(id, { 'cadre.specAccepts': String(n + 1) }, d.actor)
    await clear(h, id, 'spec_change'); await decided(h, 'spec', `${id}: spec change ${how}ed: ${m[2].trim()}`, id); return null
  }
  const e = await unblock(h, d, id, y ? `Decision: ${text}` : `Decision from the human: ${text}`, 'blocked')
  if (!e && y) await decided(h, 'question', `${id}: ${text}`, id)
  return e
}
async function unblock(h: Host, d: Deps, id: string, text: string, flag: string): Promise<string | null> {
  const m = await apply(h, { kind: 'unblock', id, at: await h.now(), actor: 'main' }, pipe(d)); if (!m.ok) return m.error
  await d.store.resume(id, d.actor); await d.store.setMeta(id, { 'cadre.decision': text.slice(0, 1000), 'cadre.blocked': '' }, d.actor)
  await d.store.record('decision', `${id}: ${text.slice(0, 60)}`, text, id); await clear(h, id, flag)
  const w = ownerOf(await h.bind.read(), id, 'worker'); if (w) await step(h, w, { type: 'resume', text })
  return null
}
const wrapL = (f: (h: Host, d: Deps, id: string, e: any) => Promise<string | null>) => async (h: Host, id: string, e: any) => f(h, await resolveDeps(h), id, e)
const isEpic = async (h: Host, id: string) => { const s = await h.board.read(); return id === s.epic || !!epicOf(s, id) }   // the plan, or an epic of a milestone (ADR 0015)
LIFECYCLE.completed = wrapL(async (h, d, id, e) => ((await isEpic(h, id)) ? integrateEpic(h, id) : closeTask(h, d, id)))
LIFECYCLE.pending = wrapL((h, d, id) => releaseTask(h, d, id))
LIFECYCLE.deleted = wrapL(async (h, d, id, e) => ((await isEpic(h, id)) ? 'the epic cannot be deleted; reject the plan instead' : cancelTask(h, d, id, String(e.metadata?.reason ?? 'deleted by main'))))
LIFECYCLE.decision = wrapL((h, d, id, e) => (typeof e.metadata?.decision === 'string' && e.metadata.decision.trim() ? decide(h, d, id, e.metadata.decision) : Promise.resolve('decision: expected the answer as a string')))

// accept on a sync flag: conflict -> re-apply the remote values kept in the task's meta; drift -> adopt the remote status through the machine (refused when illegal)
async function acceptRemote(h: Host, d: Deps, t: SnapTask): Promise<string | null> {
  const task = await d.store.get(t.id), rem = (f: string) => task.meta[`cadre.remote.${f}`]
  const up: Record<string, string | number> = {}
  for (const f of ['title', 'description', 'acceptance', 'priority']) if (t.flags.includes('conflict') && rem(f) !== undefined) up[f] = f === 'priority' ? Number(rem(f)) : rem(f)
  if (t.flags.includes('drift') && rem('status') !== undefined) {
    const to = rem('status'), kind = ({ cancelled: 'cancel', blocked: 'block', done: 'close' } as const)[to as 'done'], pp = pipe(d)
    if (!kind) return `the tracker's status "${to}" cannot be adopted; use keep, or move the task through its pipeline`
    const m = transition(await h.board.read(), { kind, id: t.id, at: await h.now(), actor: 'human' }, pp); if (!m.ok) return m.error
    await patch(h, t.id, x => ({ ...x, flags: x.flags.filter(f => f !== 'drift') }))   // apply refuses a task with an open sync flag
    if (kind === 'cancel') { const e = await cancelTask(h, d, t.id, 'cancelled on the tracker'); if (e) return e } else {
    const r = await apply(h, { kind, id: t.id, at: await h.now(), actor: 'human' }, pp); if (!r.ok) return r.error
    if (kind === 'block') await d.store.move(t.id, 'blocked', d.actor); else await d.store.close(t.id, { outcome: 'done', note: 'adopted from the tracker', session: d.session }) }
  }
  if (Object.keys(up).length) await d.store.update(t.id, up as any, d.actor)
  return null
}

// ---- /cadre resolve <id> keep|accept|reject|cancel · resolve git keep|restore [flag] ----
ROUTES.resolve = async (h, c) => {
  const [a, b, f] = c.args
  if (a === 'git') {
    const open = Object.keys((await h.git.read()).flags ?? {}).filter(x => x.startsWith('git:') || x.startsWith('quarantine')), flag = f ?? (open.length === 1 ? open[0] : '')
    if (b !== 'keep' && b !== 'restore') return { text: 'usage: /cadre resolve git keep|restore [flag]' }
    if (!flag) return { text: `name the flag: ${open.join(', ') || 'none open'}` }
    const r = await resolveGit(h, flag, b); return { text: r.ok ? `${flag}: ${b} done` : `refused: ${r.error}` }
  }
  const s0 = await h.board.read(), d = await resolveDeps(h)
  if (epicOf(s0, a) && b === 'keep') { await goOn(h, a); await emit(h, 'flag.resolved', { taskId: a, flag: 'stopped' }, { taskId: a }); return { text: `${a}: the epic goes on; set it completed again (status) if its tasks are done` } }   // a stopped epic's Retry
  if (s0.plan && (a === s0.plan.id || a === s0.epic) && b === 'keep') {   // plan-level flags (integration-failed): a retry is TaskUpdate completed again
    await h.board.update(x => (x.plan ? { ...x, plan: { ...x.plan, flags: [] } } : x)); await emit(h, 'flag.resolved', { taskId: a, flag: (s0.plan.flags ?? []).join(',') || 'plan' }, { taskId: a })
    return { text: `${a}: plan flags cleared; set the epic completed again (status)` }
  }
  const t = s0.tasks.find(x => x.id === a)
  if (t && b === 'rebase' && t.state === 'blocked') {   // the cap dialog's Retry (core/rebase.capAsk): one more round by the same worker
    const task = await d.store.get(a), tip = await G.tip(h.run, d.root, branchOf(s0, t))
    await retry(h, a, 'rebase', d.cfg.limits.rebaseRounds - 1); await d.store.setMeta(a, { 'cadre.blocked': '' }, d.actor); await clear(h, a, 'conflict'); await clear(h, a, 'merge-red')
    return { text: (await rework(h, d, (await h.board.read()).tasks.find(x => x.id === a)!, task, tip, 'conflict')) ?? `${a}: not reworked` }
  }
  if (t && b === 'retry' && t.flags.includes('red')) {   // the red dialog's Retry (redAsk): back to the tester step, rounds reset
    const r = await apply(h, { kind: 'rewind', id: a, at: await h.now(), actor: 'human', on: 'tester' }, pipe(d)); if (!r.ok) return { text: r.error }
    await d.store.resume(a, d.actor); await d.store.setMeta(a, { 'cadre.blocked': '' }, d.actor); await retry(h, a, 'red'); await clear(h, a, 'red')   // human.retry{red}: its stop lifts
    await dropNeed(h, a); for (const x of agentsOf(await h.bind.read(), a)) await end(h, x, 'retry', 'retry')   // the tester that waited on it is done: a new one writes the tests
    const b = await h.board.read(), lifted = b.drive.cause?.taskId === a && !!b.drive.cause.flag?.startsWith('red')   // this answer lifts the stop it caused: the run goes on, so the mode counts as it will be
    return { text: `${a}: back to the tester${spawnIt(lifted ? { drive: { ...b.drive, stopped: undefined } } : b, 'spawn it')}` }
  }
  if (t && b === 'retry' && t.flags.includes('shape')) {   // the shape dialog's Retry: back to its step, its count of malformed reports starts over
    const r = await apply(h, { kind: 'unblock', id: a, at: await h.now(), actor: 'human' }, pipe(d)); if (!r.ok) return { text: r.error }
    await d.store.resume(a, d.actor); await d.store.setMeta(a, { 'cadre.blocked': '' }, d.actor); await retry(h, a, 'shapeRefusals'); await clear(h, a, 'shape')
    return { text: `${a}: its agent starts again${spawnIt(await h.board.read(), 'spawn it')}` }
  }
  if (!t || !['keep', 'accept', 'reject', 'cancel'].includes(b)) return { text: 'usage: /cadre resolve <taskId> keep|accept|reject|cancel · /cadre resolve git keep|restore' }
  const out = async (e: Promise<string | null>) => ({ text: (await e) ?? `${a}: ${b} done` })
  if (b === 'cancel' || (b === 'reject' && t.flags.some(x => x.startsWith('rework:')))) return out(cancelTask(h, d, a, 'ended by the human'))
  if (t.flags.includes('spec_change') && (b === 'accept' || b === 'reject')) {
    const r = await resolveSpec(h, a, b); if (!/accepted|rejected/.test(r.text)) return r
    await clear(h, a, 'spec_change'); const dr = (await h.board.read()).drive
    if (dr.on && !dr.stopped) await queueBrief(h, `Continue: ${r.text}`)   // the human answered in the dialog; main is idle and acts on it (ADR 0013)
    return r
  }
  if (b === 'accept' && t.flags.some(x => x === 'conflict' || x === 'drift')) { const e = await acceptRemote(h, d, t); if (e) return { text: `refused: ${e}` } }
  await patch(h, a, x => ({ ...x, flags: x.flags.filter(y => y.startsWith('git:')) })); await emit(h, 'flag.resolved', { taskId: a, flag: t.flags.join(',') || b }, { taskId: a })   // keep: accept the state, clear the task's flags
  return { text: `${a}: flags cleared (${b})` }
}
