// Epic integration and release (DESIGN 3.9). integrateEpic is called by the status {epic, set completed} lifecycle (core/close); /cadre release is ROUTES.release.
// Everything that moves a ref is inside git.op (branches.ts); suites run in a throwaway worktree, outside it.
import type { Host } from '../types'
import { fnv1a64 } from './board'
import { ROUTES, cfgOf, mirror, storeOf } from './dispatch'
import { emit } from './events'
import { ask, settleIf, yoloOn } from './decide'
import { epicNext } from './machine'
import { blocks } from './flags'
import { modeOf } from './specview'
import { ownerOf, unitsOf } from './discover'
import { casRef, exists, git, ok, op, subInit, tip, worktreeRemove } from './git'
import { baseOf, baseRef, checkedOut, landDev, mergeEpic, move, pendingRef, release, wtPath, wtRootOf } from './branches'
import { active } from './pipeline'
import { modrun } from './modrun'
import { deliver, retryHooks, runHooks } from './hooks'
import { runSlot } from './gate'
import type { LandResult } from '../types/profile'
import { clearKnownRed, repoKeyOf, scoped } from '../commands/init'
import { redFix } from './drive'
import { epicOf, freshen, isMs, stopEpic } from './milestone'
import { coreLanded, refresh, refreshEpics, resolveTask, trial } from './rebase'
import { resolveDeps, type Deps } from './admission'


const setPlan = (h: Host, ev: string, patch: Record<string, unknown> = {}) =>
  h.board.update(b => { const n = b.plan && epicNext(b.plan.state, ev); return n ? { ...b, plan: { ...b.plan!, ...patch, state: n } } : b })
const gitFlags = async (h: Host) => Object.keys((await h.git.read()).flags ?? {}).filter(f => f.startsWith('git:'))
const tail = (r: { stdout: string; stderr: string }) => `${r.stdout}\n${r.stderr}`.trim().slice(-400)
const dirsOf = async (h: Host, cfg?: any) => { const root = await h.cwd(); return { root, wtRoot: await wtRootOf(h, cfg ?? (await cfgOf(h))), key: repoKeyOf(root) } }

// The landing gate (plan 2.6): per touched unit (files = null: every unit) the `landing.prepare` slot in its own jail, then each check of `landing.suites` (absent: the unit's other checks), offline.
// Returns the failure text, or null when green. A known-red check runs and never gates; a check red when the plan started does not block under `baseline: tolerate`.
export async function runSuites(h: Host, cfg: any, wt: string, files: string[] | null, epicId: string, kr: { root: string; n: string }[] = []): Promise<string | null> {
  const L = active().landing, pkgs: any[] = unitsOf(cfg), hit = new Set(files?.map(f => ownerOf(pkgs, f))), touched = pkgs.filter(p => !files || hit.has(p))
  const mode = await modeOf(h, { cfg }).catch((e: Error) => e); if (mode instanceof Error) return mode.message
  const sub = await subInit(h.run, await h.cwd(), wt); if (sub) return sub   // the parent's checks build against its submodules at the commits it records
  const base = JSON.parse((await Promise.resolve().then(async () => (await storeOf(h)).get(epicId)).catch(() => null))?.meta['cadre.baseline'] || '{}')
  const scratch = `${wt}-scratch`; await h.run(['mkdir', '-p', scratch])
  try {
    for (const p of touched) {
      const dir = p.root === '.' ? wt : `${wt}/${p.root}`, run = (slot: string) => runSlot(h, { mode, wt, scratch, pkgRoot: dir, argv: p.checks[slot], slot, writable: cfg.jailWritable })
      if (L.prepare && p.checks[L.prepare]) { const r = await run(L.prepare); if (r.exit) return `${p.root}: ${L.prepare} failed: ${r.tail!()}` }
      for (const n of L.suites ?? Object.keys(p.checks).filter(k => k !== L.prepare)) {
        if (!p.checks[n]) continue
        const r = await run(n); await emit(h, 'check.ran', { taskId: epicId, name: `${p.root}:${n}`, ok: !r.exit, exit: r.exit })
        if (p.knownRed?.includes(n)) { if (!r.exit) kr.push({ root: p.root, n }); continue }   // green now = its mark goes after the landing (ADR 0014)
        if (r.exit && L.baseline === 'tolerate' && base[`${p.root}:${n}`]?.exit) continue   // red when the plan started too: the tasks' green gates guard new failures (core/tdd.oldFailure)
        if (r.exit) return `${p.root}:${n} failed (exit ${r.exit}): ${r.tail!()}`
      }
    }
  } finally { await h.run(['rm', '-rf', scratch]) }
  return null
}

export async function propose(h: Host, root: string, dev: string): Promise<void> {
  if (await exists(h.run, root, pendingRef(dev))) return   // a release waits for the landing: offered once it is in the user's checkout
  const at = await baseOf(h, dev), r = await runHooks(h, await dirsOf(h), 'release', await tip(h.run, root, at), { at, dev }, {}, true), version = 'why' in r ? '' : r.version   // the release hook names the version
  if (!version) return   // no release hook (or it has nothing to say): a release stays the person's command
  await h.ui.update(u => ({ ...u, rel: version }))
  await ask(h, { id: `release:${version}`, kind: 'release', title: `release v${version}?`, lines: [`${dev} merges into main with an annotated tag v${version}`], hash: version, tab: 'epic', options: [{ key: 'r', label: 'Release', verb: 'release', run: `release ${version}` }] })
  await emit(h, 'release.proposed', { version }); h.toast(`${isMs((await h.board.read()).plan) ? 'Milestone' : 'Epic'} landed on ${dev} · release v${version}? · press 1`)
}

// fix: red checks get a fix task; a merge conflict with dev is the human's ("make the checks pass" does not fit it)
async function failed(h: Host, epicId: string, why: string, flag: boolean, fix = flag, tmp = ''): Promise<string> {
  const p = (await h.board.read()).plan!, ep = epicOf({ plan: p }, epicId), store = await storeOf(h)
  if (tmp) await worktreeRemove(h.run, await h.cwd(), tmp).catch(() => {})
  if (fix && !(isMs(p) && !ep) && (await redFix(h, epicId, why).catch(e => (h.log(`fix task: ${e}`), false)))) flag = false   // driving: the first red gets one fix task, no flag (ADR 0013)
  if (ep) { await setPlan(h, 'fail'); if (flag) await stopEpic(h, epicId, why.slice(0, 200)); else await mirror(h, store); return why }   // an epic: the milestone goes on; a 2nd red or a conflict stops this epic only
  await setPlan(h, 'fail', { pr: undefined, ...(flag ? { flags: [...(p.flags ?? []).filter(f => f !== 'integration-failed'), 'integration-failed'] } : {}) })
  if (flag) await emit(h, 'flag.raised', { taskId: epicId, flag: 'integration-failed' })
  return why
}
// the plan is on dev (directly, or its pull request merged): landed, known red cleared, a release proposed
async function onDev(h: Host, epicId: string, dev: string, sha: string, kr: { root: string; n: string }[]): Promise<null> {
  const cfg = await cfgOf(h), p = (await h.board.read()).plan!
  await setPlan(h, 'land', { landed: { dev, sha, at: await h.now() }, flags: (p.flags ?? []).filter(f => f !== 'integration-failed'), pr: undefined })
  await emit(h, 'plan.landed', { planId: epicId, sha })
  await deliver(h, await dirsOf(h, cfg), 'epic.landed', { id: epicId, base: dev, input: { id: epicId, sha }, vars: { id: epicId, title: p.slug } })
  await clearKnownRed(h, kr, epicId).catch(e => h.log(`known red not cleared: ${e}`))
  const dr = (await h.board.read()).drive; if (active().landing.onEpicDone === 'propose' && !(yoloOn(dr) && dr.epicId === epicId)) await propose(h, await h.cwd(), dev)   // a running yolo run of this plan stops at landed on dev (drive's toast); a stopped one, or another epic's mode, gets the proposal
  return null
}

// A module provider (plan 2.8): the plan's commit goes to it (submit); it answers landed (ref = the commit now on dev), pending (ref names the request) or failed. A crashed or
// invalid answer is {code:'module'}. The wait is core's: it polls at 30 s doubling to 10 min, and the third equal error.code in a row fails the landing.
const RED = 'checks'   // the one code core knows: a failed landing with it gets the plan's one fix task (a closed request does not)
async function land(h: Host, op: 'submit' | 'poll', input: Record<string, unknown>): Promise<LandResult> {
  const L = active().landing, d = await dirsOf(h), scratch = `${d.wtRoot}/${d.key}.scratch/land-${h.rand(4)}`
  const r = await modrun(h, { argv: ['node', L.provider], cwd: d.root, input: { op, args: L.args ?? {}, ...input }, scratch, envPass: L.envPass, timeoutMs: 120_000 }); await h.run(['rm', '-rf', scratch])
  const v = r.result as LandResult | undefined, str = (x: unknown) => typeof x === 'string'
  return !r.exit && !r.timedOut && !r.bad && v && ['landed', 'pending', 'failed'].includes(v.state) && (v.ref === undefined || str(v.ref)) && (v.error === undefined || (str(v.error.code) && str(v.error.message))) ? v
    : { state: 'pending', error: { code: 'module', message: r.timedOut ? 'the landing module timed out' : r.bad ?? 'the landing module failed or answered wrongly' } }
}
// the integration commit goes to the provider; it waits as integrating (landPoll) until the provider lands it
async function submit(h: Host, epicId: string, dev: string, devTip: string, sha: string, from: string, tmp: string): Promise<string> {
  const r = await land(h, 'submit', { id: epicId, dev, devTip, sha, from })
  if (r.state !== 'pending' || r.error || !r.ref) throw new Error(r.error?.message ?? 'the landing was refused')
  await worktreeRemove(h.run, await h.cwd(), tmp).catch(() => {})
  const at = await h.now(); await h.store.del(await scoped(h, 'prwait')); await h.board.update(b => ({ ...b, plan: { ...b.plan!, pr: { ref: r.ref!, devTip, from, at } } }))   // a new wait starts fresh
  return `handed over (${r.ref}): the plan lands on ${dev} once it is merged`
}
// the 5 s tick (autoLand), at most every 30 s. A provider that is not done leaves it waiting; its error is never a pass: it backs off and the same code a third time takes the red path.
export async function landPoll(h: Host): Promise<void> {
  const p = (await h.board.read()).plan, pr = p?.pr; if (!pr || p!.state !== 'integrating') return
  const K = await scoped(h, 'prwait'), w = ((await h.store.get(K)) as { n: number; next: number; code?: string } | undefined) ?? { n: 0, next: 0 }, now = await h.now(); if (now < w.next) return
  const cfg = await cfgOf(h), root = await h.cwd(), dev = cfg.branches.dev, red = async (why: string, fix: boolean) => { await h.store.del(K); await failed(h, p!.id, why, true, fix) }
  try {
    const v = await land(h, 'poll', { ref: pr.ref, at: pr.at, now })
    if (v.state === 'failed') return void (await red(v.error?.message ?? 'the landing failed', v.error?.code === RED))
    if (v.state === 'pending') {
      if (!v.error) return void (await h.store.set(K, { n: 0, next: now + 30_000 }))
      throw Object.assign(new Error(v.error.message), { code: v.error.code })
    }
    const sha = v.ref!
    if (!(await landDev(h, { dev, sha, old: pr.devTip, tmp: '', epic: pr.from }))) {   // the merge is on the remote's dev, the local dev moved meanwhile: it waits as a landing onto the local commits (landPending re-integrates them through the gates)
      const held = await op(h, async () => !(await exists(h.run, root, pendingRef(dev))) && (await casRef(h.run, root, pendingRef(dev), sha, '0'.repeat(40))) && (await git(h.run, root, ['update-ref', baseRef(dev), pr.devTip]), await git(h.run, root, ['branch', '-D', pr.from]).catch(() => ''), true))
      if (!held && (await exists(h.run, root, pendingRef(dev)))) return void h.log(`landing ${pr.ref} merged: it lands after the landing waiting on ${dev}`)   // one pending ref: the merge waits its turn
      if (!held) return void (await failed(h, p!.id, `${dev} moved here while ${pr.ref} merged; integrate again`, false, false))
    }
    await h.store.del(K)
    await onDev(h, p!.id, dev, sha, [])
  } catch (e) {
    const err = (e as Error).message.slice(0, 200), code = (e as { code?: string }).code ?? 'land', n = w.code === code ? w.n + 1 : 1; h.log(`landing ${pr.ref}: ${err}`)
    if (n >= 3) return void (await red(`the same error three times (${code}): ${err}`, false))
    await h.store.set(K, { n, code, next: now + Math.min(30_000 * 2 ** n, 600_000) })
  }
}

// §3.9 Integration. null = landed on dev; otherwise the refusal / failure text (also left as a comment on the epic).
export async function integrateEpic(h: Host, epicId: string): Promise<string | null> {
  const s = await h.board.read(), p = s.plan, ep = epicOf(s, epicId)   // a milestone's epic lands on the milestone branch; the milestone lands on dev (ADR 0015)
  if (!p || (!ep && (s.epic !== epicId || p.id !== epicId))) return `${epicId} is not the current epic`
  if (p.state !== 'approved') return p.state === 'integrating' ? 'integration is already running; set it completed again (status) after it' : `epic is ${p.state}; only an approved epic integrates`
  if (ep && ep.state !== 'running') return `epic ${epicId} is ${ep.state}${ep.why ? `: ${ep.why}` : ''}`
  const left = (p.epics ?? []).filter(e => e.state !== 'landed').map(e => e.id); if (!ep && left.length) return `epics still open: ${left.join(', ')}`
  const open = s.tasks.filter(t => (!ep || t.epic === epicId) && t.state !== 'done' && t.state !== 'cancelled').map(t => t.id)
  if (open.length) return `children still open: ${open.join(', ')}`
  const gf = await gitFlags(h); if (gf.length) return `git flag ${gf[0]} is open (someone changed a protected ref); ask the human to keep or restore it in the cadre dialog first`
  const units = unitsOf(await cfgOf(h)), own = units.find(u => u.ownGit); if (own) return `${own.root} is its own repository: landing a submodule is not supported`
  await autoLand(h).catch(x => h.log(`land: ${x}`))   // a landing that waited for the user's checkout goes first where it can
  let got = false; await h.board.update(b => { got = b.plan?.state === 'approved'; return got ? { ...b, plan: { ...b.plan!, state: 'integrating' } } : b })
  if (!got) return 'integration is already running'
  const [root, cfg, store] = [await h.cwd(), await cfgOf(h), await storeOf(h)]
  const dev = ep ? p.epicBranch : cfg.branches.dev, from = ep ? ep.branch : p.epicBranch, tmp = wtPath(await wtRootOf(h, cfg), repoKeyOf(root), `int-${epicId}`)
  const fail = (why: string, flag: boolean, fix = flag) => failed(h, epicId, why, flag, fix, tmp)
  try {
    const c = await trial(h, root, await tip(h.run, root, await baseOf(h, dev)), from)   // a trial merge first (ADR 0015 wave 2)
    const m = c?.length ? new Error(`conflicts in ${c.join(', ')}`) : await mergeEpic(h, { dev, epic: from, tmp, msg: `merge ${from} (${epicId})${ep ? `\n\nMilestone: ${p.id} ${p.slug}` : ''}` }).catch(e => e as Error)
    if (m instanceof Error) {   // a conflict: a resolve task in that epic (both modes, at most 2); past that the epic stops (auto asks; yolo: the independent epics go on) or the plan is flagged
      const r = ep || !isMs(p) ? await resolveTask(h, await resolveDeps(h), epicId, from, dev, c ?? []).catch(x => (h.log(`resolve task: ${x}`), null)) : null
      if (r) { await worktreeRemove(h.run, root, tmp).catch(() => {}); await setPlan(h, 'fail'); await mirror(h, store); return r }
      return await fail(`merge of ${from} into ${dev} failed: ${m.message}${ep ? ` (with ${(p.epics ?? []).filter(x => x.state === 'landed').map(x => x.id).join(', ') || dev})` : ''}`, true, false)
    }
    const sha = m.sha
    if (!ep && active().landing.provider !== 'direct') return await submit(h, epicId, dev, m.devTip, sha, from, tmp)   // the provider's checks are the gate there
    const files = (await git(h.run, tmp, ['diff', '--name-only', `${m.devTip}..${sha}`])).split('\n').filter(Boolean)
    const si = await subInit(h.run, root, tmp); if (si) return await fail(si, true, false)   // a pinned submodule commit this machine lacks: one dialog, no fix task
    const kr: { root: string; n: string }[] = [], red = await runSuites(h, cfg, tmp, files, epicId, kr); if (red) return await fail(red, true)
    if (!(await landDev(h, { dev, sha, old: m.devTip, tmp, epic: from }))) return await fail(`${dev} moved during integration; set it completed again (status)`, false)
    await Promise.resolve().then(() => store.setMeta(epicId, { 'cadre.landed': `${dev}@${sha}` }, 'cadre')).catch(x => h.log(`landed not recorded: ${x}`))   // core/revert finds the merge by this
    await offer(h, dev)   // the user has it checked out: the landing waits for them
    if (ep) return await landed(h, store, epicId, sha, files, cfg.branches.dev, tmp)
    return await onDev(h, epicId, dev, sha, kr)
  } catch (e) { return await fail(`integration error: ${(e as Error).message}`, false) }
}

// an epic landed on the milestone branch: closed, recorded; a core epic's files are locked for the others; the milestone takes dev's news; the last one lands the milestone on dev.
async function landed(h: Host, store: Awaited<ReturnType<typeof storeOf>>, epicId: string, sha: string, files: string[], dev: string, tmp: string): Promise<string | null> {
  const p = (await h.board.read()).plan!, e = epicOf({ plan: p }, epicId)!
  await store.close(epicId, { outcome: 'done', note: `landed ${sha.slice(0, 7)} on ${p.epicBranch}` }); await setPlan(h, 'fail'); await mirror(h, store)
  await emit(h, 'plan.landed', { planId: epicId, sha, on: p.epicBranch })
  if (e.core) await coreLanded(h, { store, actor: 'cadre' } as Deps, files).catch(x => h.log(`core lock: ${x}`))   // a core epic's files: locked for every later task of the milestone
  await freshen(h, await h.cwd(), p.epicBranch, await baseOf(h, dev), tmp).catch(x => h.log(`milestone freshen: ${x}`))
  await refreshEpics(h, await resolveDeps(h), await tip(h.run, await h.cwd(), p.epicBranch), epicId).catch(x => h.log(`epic refresh: ${x}`))   // the other running epics take the new milestone tip now
  return (await h.board.read()).plan?.epics?.every(x => x.state === 'landed') ? integrateEpic(h, p.id) : null
}

// §3.9 /cadre release [x.y.z] (human-gated by the dispatcher)
export async function releaseDev(h: Host, want?: string): Promise<string> {
  const s = await h.board.read(), no = (w: string) => `refused: ${w}`
  if (s.plan?.state === 'integrating') return no('an integration is running')
  const gf = await gitFlags(h), bf = [...(s.plan?.flags ?? []), ...s.tasks.flatMap(t => t.flags)].find(blocks)
  if (gf.length || bf) return no(`flag ${gf[0] ?? bf} is open; ask the human to resolve it in the cadre dialog first`)
  if (want && !/^\d+\.\d+\.\d+$/.test(want)) return no(`version "${want}": expected x.y.z`)
  const [root, cfg] = [await h.cwd(), await cfgOf(h)], dev = cfg.branches.dev
  const main = await mainOf(h, cfg, root)
  if (!(await exists(h.run, root, dev))) return no(`no ${dev} branch`)
  for (const b of [dev, main]) await landPending(h, b).catch(() => null)   // what can land does (a stale one is cleared)
  const waits = (await Promise.all([dev, main].map(async b => ((await exists(h.run, root, pendingRef(b))) ? b : '')))).find(Boolean)
  if (waits) return no(`a landing on ${waits} waits for your checkout: land it first (the cadre dialog's Land)`)
  const devTip = await tip(h.run, root, dev), d = await dirsOf(h, cfg); let version = want
  if (!version) { const r = await runHooks(h, d, 'release', devTip, { at: dev, dev }, {}, true); if ('why' in r) return no(r.why); version = r.version }   // the release hook names the version
  if (!version) return no('no version: name one (release x.y.z)')
  if (await exists(h.run, root, `refs/tags/v${version}`)) return no(`tag v${version} already exists`)
  const rh = await runHooks(h, d, 'release', devTip, { at: dev, dev, today: new Date(await h.now()).toISOString().slice(0, 10) }, { version }); if ('why' in rh) return no(rh.why)   // the hook's commit (the changelog cut), judged by the suites below and landed by CAS
  const cdev = rh.sha, key = repoKeyOf(root), tmp = wtPath(await wtRootOf(h, cfg), key, `rel-${version}`)
  await op(h, () => git(h.run, root, ['worktree', 'add', '--detach', tmp, cdev]))
  try { const red = await runSuites(h, cfg, tmp, null, s.epic ?? ''); if (red) return no(`${dev} is not green: ${red}`) } finally { await op(h, () => worktreeRemove(h.run, root, tmp)) }
  if (cdev !== devTip && !(await op(h, () => move(h, dev, cdev, devTip)))) return no(`${dev} moved during release; retry`)
  let sha: string
  try { sha = await release(h, { dev, main, version, tmp: wtPath(await wtRootOf(h, cfg), key, `relm-${version}`), msg: `release v${version}` }) }
  catch (e) { if (cdev !== devTip) await op(h, () => move(h, dev, devTip, cdev)); await landPending(h, dev).catch(() => null); return no(`merge into ${main} failed: ${(e as Error).message}; ${dev} restored`) }
  await offer(h, dev); await offer(h, main)   // a release that leaves main pending tags the commit the user's main gains on the click
  if (s.plan?.state === 'done-on-dev') await setPlan(h, 'release', { released: { version, at: await h.now() } })
  await h.ui.update(({ rel: _r, ...u }) => u); await settleIf(h, 'release:')
  await emit(h, 'plan.released', { version, sha })
  return `Released v${version}: ${dev} merged into ${main} (${sha.slice(0, 7)}), tag v${version}.`
}
ROUTES.release = async (h, c) => ({ text: await releaseDev(h, c.args[0]) })

const mainOf = async (h: Host, cfg: any, root: string) => cfg.branches.main || ((await exists(h.run, root, 'main')) ? 'main' : 'master')
// ---- H5: a landing that waits for the user's checkout (core/branches.move). One dialog offers to land it; it lands by itself once the branch is checked out nowhere. ----
const ask1 = (h: Host, b: string, line: string) => ask(h, { id: `pending:${b}`, kind: 'flag', title: `${b} has new work for your checkout`, hash: fnv1a64(line), tab: 'epic', lines: [line, 'Land: bring it into your checkout now (your own commits and edits are kept).'], options: [{ key: 'l', label: 'Land', verb: 'change', run: `land ${b}` }] })
export async function offer(h: Host, b: string) { if (await exists(h.run, await h.cwd(), pendingRef(b))) await ask1(h, b, `cadre did not move ${b}: you have it checked out.`) }
const asked = async (h: Host, b: string) => ((await h.board.read()).decisions ?? []).some(d => d.id === `pending:${b}`)   // a new process starts with no dialogs: the tick asks again
const inFlight = new Set<string>()   // ponytail: per process; two sessions on one repo each get their own tmp (a random suffix), so they only repeat the suites
// (2) the user committed on b meanwhile: their commit is never dropped; the landing re-integrates onto it through the gates (trial merge, suites); (1) the click:
// HEAD is b and b is the base: a fast-forward moves ref, index and files together (it refuses on conflicting local edits). Checked out nowhere: it lands by CAS.
// A failed re-integration (a real conflict or red checks on the user's commits) is held under its inputs {pending, base, the user's tip} with its reason: the tick
// does not try it again until one of them moves, or the user presses Land; it re-asks the held dialog when it is gone. Anything else (git busy, a failed merge
// step) throws and backs off (backoff): the tick skips it until its time, and a Land click tries now. The suites run outside the git lock, one re-integration
// per branch at a time, each in its own tmp.
export async function landPending(h: Host, b: string, click = false): Promise<string | null> {
  const root = await h.cwd(), cfg = await cfgOf(h), P = pendingRef(b), K = await scoped(h, `land:${b}`), W = await scoped(h, `landwait:${b}`)
  let key = '', tmp = ''
  try {
    for (let round = 0; round < 3; round++) {
      if (!(await exists(h.run, root, P))) return null
      const [sha, base, cur] = [await tip(h.run, root, P), await tip(h.run, root, baseRef(b)), await tip(h.run, root, b)]; key = `${sha} ${base} ${cur}`
      if (sha === cur) return clean(h, b)   // nothing left to land (a rolled-back release)
      if (round === 2) break
      const w = click ? undefined : ((await h.store.get(W)) as Wait | undefined); if (w?.key === key && (await h.now()) < w.next) return 'wait'
      if (cur !== base) {
        const held = click ? undefined : ((await h.store.get(K)) as { key: string; why: string } | undefined)
        if (held?.key === key) { if (!(await asked(h, b))) await ask1(h, b, held.why); return 'held' }
        const F = `${root} ${b}`; if (inFlight.has(F)) return 'busy'
        tmp = wtPath(await wtRootOf(h, cfg), repoKeyOf(root), `land-${b.replace(/\W/g, '-')}-${Math.random().toString(36).slice(2, 8)}`)
        inFlight.add(F)
        let why: string | null = null
        try {
          const c = await trial(h, root, cur, sha)
          if (c?.length) why = `your commits on ${b} conflict with the landing in ${c.join(', ')}: resolve them on ${b}, then Land.`
          else {
            const next = await op(h, async () => { await git(h.run, root, ['worktree', 'add', '--detach', tmp, cur]); await git(h.run, tmp, ['merge', '--no-ff', '--no-verify', '-m', `merge the landing into your ${b}`, sha]); return tip(h.run, tmp, 'HEAD') })
            const red = await runSuites(h, cfg, tmp, (await git(h.run, tmp, ['diff', '--name-only', `${cur}..${next}`])).split('\n').filter(Boolean), '')
            if (red) why = `the landing does not pass its checks on your ${b}: ${red.slice(0, 200)}`
            else await op(h, async () => (await casRef(h.run, root, P, next, sha)) && casRef(h.run, root, baseRef(b), cur, base))   // pending and its base move together, each by CAS
          }
        } finally { inFlight.delete(F); await worktreeRemove(h.run, root, tmp).catch(() => {}) }   // no ref moves: outside the lock, so a busy lock never leaves it behind
        if (why) { await h.store.set(K, { key, why }); await ask1(h, b, why); return 'held' }
        continue
      }
      const wt = await checkedOut(h, b)
      if (!wt) { if (await op(h, () => casRef(h.run, root, `refs/heads/${b}`, sha, cur))) return clean(h, b); continue }   // checked out nowhere: it lands by itself
      if (!click) { if (!(await asked(h, b))) await offer(h, b); return 'waits' }
      const r = await op(h, async () => (await h.run(['git', '-C', wt, 'symbolic-ref', '-q', 'HEAD'])).stdout.trim() !== `refs/heads/${b}` || (await tip(h.run, wt, 'HEAD')) !== cur ? null : h.run(['git', '-C', wt, 'merge', '--ff-only', sha]))   // the worktree still has b at the base, checked under the lock
      if (!r) continue
      if (r.exitCode) { await ask1(h, b, `your uncommitted edits touch the same files as the landing: commit or stash them, then Land. ${r.stderr.trim().slice(0, 120)}`); return 'edits' }
      return clean(h, b)
    }
  } catch (e) { const m = (e as Error).message ?? String(e); if (!click && m !== 'git busy') await backoff(h, b, W, key, tmp ? m.split(tmp).join('its tmp') : m); throw e }   // a busy lock is not a failure
  await ask1(h, b, `${b} kept moving while it landed: Land again.`); return 'moved'
}
// F1: a machine failure (worktree add, the merge step) under one key backs off from 5 s, doubling to 10 min; the third repeat of the same error asks once, naming
// it. A moved key starts over; clean() drops the record with land:<b>.
type Wait = { key: string; err: string; n: number; next: number }
async function backoff(h: Host, b: string, W: string, key: string, err: string) {
  const w = (await h.store.get(W)) as Wait | undefined, n = w?.key === key && w.err === err ? w.n + 1 : 1
  await h.store.set(W, { key, err, n, next: (await h.now()) + Math.min(5000 * 2 ** (n - 1), 600000) })
  if (n === 3) await ask1(h, b, `could not land ${b}, the same error three times: ${err.slice(0, 200)}. Land tries again now.`)
}
async function clean(h: Host, b: string) {
  const root = await h.cwd(), cfg = await cfgOf(h); for (const r of [pendingRef(b), baseRef(b)]) await git(h.run, root, ['update-ref', '-d', r]); for (const k of [`land:${b}`, `landwait:${b}`]) await h.store.del(await scoped(h, k)); await settleIf(h, `pending:${b}`)
  if (b === cfg.branches.dev && (await h.board.read()).plan?.state === 'done-on-dev' && active().landing.onEpicDone === 'propose') await propose(h, root, b)
  return null
}
// the next landing, session start and the 5 s tick: what waits lands where it can; a dev the user moved is merged into the running plan, and its workers get it
export async function autoLand(h: Host): Promise<void> {
  await retryHooks(h, await dirsOf(h)).catch(x => h.log(`hooks: ${x}`)); await landPoll(h)
  const cfg = await cfgOf(h), root = await h.cwd(), s = await h.board.read()
  for (const b of [cfg.branches.dev, await mainOf(h, cfg, root)]) await landPending(h, b).catch(x => h.log(`land ${b}: ${x}`))   // a busy lock: the next tick retries
  if (s.plan?.state !== 'approved' || isMs(s.plan) || !(await exists(h.run, root, s.plan.epicBranch))) return
  const was = await tip(h.run, root, s.plan.epicBranch), dev = await baseOf(h, cfg.branches.dev), pair = `${await tip(h.run, root, dev)} ${was}`, K = await scoped(h, 'freshen')
  if ((await h.store.get(K)) === pair) return   // that dev did not merge into this plan cleanly: tried once, again when either moves
  await freshen(h, root, s.plan.epicBranch, dev, wtPath(await wtRootOf(h, cfg), repoKeyOf(root), 'freshen'))
  const now = await tip(h.run, root, s.plan.epicBranch); if (now !== was) await refresh(h, await resolveDeps(h), now, ''); else if (!(await ok(h.run, root, ['merge-base', '--is-ancestor', dev, now]))) await h.store.set(K, pair)
}
ROUTES.land = async (h, c) => { const r = await landPending(h, c.args[0] ?? (await cfgOf(h)).branches.dev, true); return { text: r === 'busy' ? 'not landed yet: its checks are running; Land again when they finish' : r ? 'not landed: the dialog says why' : `${c.args[0]}: landed into your checkout` } }
