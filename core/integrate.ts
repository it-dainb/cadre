// Epic integration and release (DESIGN 3.9). integrateEpic is called by the status {epic, set completed} lifecycle (core/close); /cadre release is ROUTES.release.
// Everything that moves a ref is inside git.op (branches.ts); suites run in a throwaway worktree, outside it.
import type { Host } from '../types'
import { fnv1a64 } from './board'
import { ROUTES, cfgOf, mirror, storeOf } from './dispatch'
import { emit } from './events'
import { ask, settleIf, yoloOn } from './decide'
import { epicNext } from './machine'
import { blocks } from './flags'
import { cut, insert } from './changelog'
import { modeOf } from './specview'
import { ownerOf, unitsOf } from './discover'
import { casRef, checkRun, exists, git, ok, op, subInit, tip, worktreeRemove, writableJail } from './git'
import { baseOf, baseRef, checkedOut, inferVersion, landDev, lastTag, mergeEpic, move, pendingRef, release, wtPath, wtRootOf } from './branches'
import { clearKnownRed, repoKeyOf, scoped } from '../commands/init'
import { redFix } from './drive'
import { epicOf, freshen, isMs, stopEpic } from './milestone'
import { coreLanded, refresh, refreshEpics, resolveTask, trial } from './rebase'
import { resolveDeps, type Deps } from './admission'


const setPlan = (h: Host, ev: string, patch: Record<string, unknown> = {}) =>
  h.board.update(b => { const n = b.plan && epicNext(b.plan.state, ev); return n ? { ...b, plan: { ...b.plan!, ...patch, state: n } } : b })
const gitFlags = async (h: Host) => Object.keys((await h.git.read()).flags ?? {}).filter(f => f.startsWith('git:'))
const tail = (r: { stdout: string; stderr: string }) => `${r.stdout}\n${r.stderr}`.trim().slice(-400)
const commitPaths = async (h: Host, wt: string, paths: string[], msg: string, amend = false) => {
  await git(h.run, wt, ['add', '--', ...paths]); await git(h.run, wt, ['commit', '--no-verify', ...(amend ? ['--amend', '--no-edit'] : ['-m', msg])]); return tip(h.run, wt, 'HEAD')
}

// setup + suites.integration per touched unit (files = null: every unit), each unit once. Returns the failure text, or null when green.
export async function runSuites(h: Host, cfg: any, wt: string, files: string[] | null, epicId: string, kr: { root: string; n: string }[] = []): Promise<string | null> {
  const pkgs: any[] = unitsOf(cfg), own = pkgs.filter(p => !p.ownGit), hit = new Set(files?.map(f => { const u = ownerOf(pkgs, f); return u?.ownGit ? ownerOf(own, f) : u }))
  const touched = own.filter(p => !files || hit.has(p))   // a submodule's checks ran in its own repository (subMerge); its pointer bump gates the unit that holds it
  const mode = await modeOf(h, { cfg }).catch((e: Error) => e); if (mode instanceof Error) return mode.message
  const sub = await subInit(h.run, await h.cwd(), wt); if (sub) return sub   // the parent's checks build against its submodules at the commits it records
  const base = JSON.parse((await Promise.resolve().then(async () => (await storeOf(h)).get(epicId)).catch(() => null))?.meta['cadre.baseline'] || '{}')
  const scratch = `${wt}-scratch`; await h.run(['mkdir', '-p', scratch])
  try {
    for (const p of touched) {
      const dir = p.root === '.' ? wt : `${wt}/${p.root}`, j = { wt, scratch, pkgRoot: dir }
      if (p.setup?.length) { const r = await h.run(mode === 'none' ? p.setup : writableJail({ ...j, argv: p.setup, writable: cfg.jailWritable }), { cwd: dir, timeoutMs: 600000 }); if (r.exitCode) return `${p.root}: setup failed: ${tail(r)}` }
      const want = Array.isArray(cfg.suites?.integration) ? cfg.suites.integration : Object.keys(p.checks ?? {})
      for (const n of want) {
        if (!p.checks?.[n]) continue
        const r = await checkRun(h.run, mode, { ...j, argv: p.checks[n], writable: cfg.jailWritable }); await emit(h, 'check.ran', { taskId: epicId, name: `${p.root}:${n}`, ok: !r.exitCode, exit: r.exitCode })
        if (p.knownRed?.includes(n)) { if (!r.exitCode) kr.push({ root: p.root, n }); continue }   // known red runs, never gates; green now = its mark goes after the landing (ADR 0014)
        if (r.exitCode && base[`${p.root}:${n}`]?.exit) continue   // red when the plan started too: the tasks' green gates guard new failures (core/tdd.oldFailure)
        if (r.exitCode) return `${p.root}:${n} failed (exit ${r.exitCode}): ${tail(r)}`
      }
    }
  } finally { await h.run(['rm', '-rf', scratch]) }
  return null
}

export async function propose(h: Host, root: string, dev: string): Promise<void> {
  if (await exists(h.run, root, pendingRef(dev))) return   // a release waits for the landing: offered once it is in the user's checkout
  const at = await baseOf(h, dev), tag = await lastTag(h), subj = (await git(h.run, root, ['log', '--no-merges', '--format=%s', tag ? `${tag}..${at}` : at])).split('\n')
  const version = inferVersion(tag, subj)
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
  await clearKnownRed(h, kr, epicId).catch(e => h.log(`known red not cleared: ${e}`))
  const dr = (await h.board.read()).drive; if (cfg.release.onEpicDone === 'propose' && !(yoloOn(dr) && dr.epicId === epicId)) await propose(h, await h.cwd(), dev)   // a running yolo run of this plan stops at landed on dev (drive's toast); a stopped one, or another epic's mode, gets the proposal
  return null
}

// H6 landing.mode pr: the integration commit goes up as one pull request into dev; CI (+ an approval with landing.review) is the gate. The plan waits as integrating.
async function openPr(h: Host, cfg: any, epicId: string, dev: string, devTip: string, sha: string, from: string, tmp: string): Promise<string> {
  const root = await h.cwd(), R = cfg.landing.remote, branch = `cadre/land/${epicId}`, x = async (argv: string[]) => { const r = await h.run(argv, { cwd: root }); if (r.exitCode) throw new Error(`${argv.slice(0, 3).join(' ')}: ${tail(r)}`); return r.stdout }
  await x(['gh', 'auth', 'status']); await x(['git', 'push', R, `${devTip}:refs/heads/${dev}`]); await x(['git', 'push', '--force', R, `${sha}:refs/heads/${branch}`])
  const open = JSON.parse((await x(['gh', 'pr', 'list', '--head', branch, '--base', dev, '--state', 'open', '--json', 'number'])) || '[]')[0]?.number   // a retry after red checks, or a crash before the record: the open one (the push above updated it)
  const n = open ?? Number(/\/pull\/(\d+)/.exec(await x(['gh', 'pr', 'create', '--base', dev, '--head', branch, '--title', `merge ${from} (${epicId})`, '--body', `Plan ${epicId}: it lands on ${dev} when the checks pass.`]))?.[1])
  if (!n) throw new Error('gh pr create printed no pull request URL')
  await worktreeRemove(h.run, root, tmp).catch(() => {})
  const at = await h.now(); await h.store.del(await scoped(h, 'prwait')); await h.board.update(b => ({ ...b, plan: { ...b.plan!, pr: { n, branch, devTip, from, at } } }))   // a new wait starts fresh
  return `pull request #${n} opened: the plan lands on ${dev} when its checks pass${cfg.landing.review ? ' and it is approved' : ''}`
}
// the 5 s tick (autoLand), at most every 30 s: green (+ approved) merges and lands; red or closed takes the red path. A gh failure is never green: it backs off
// (30 s doubling to 10 min) and the same failure a third time takes the red path, naming it. No checks yet: it waits up to 10 min for CI to register any.
// ponytail: a fixed 10 min grace for CI to report; a setting if a repository's CI is slower to start
export async function prPoll(h: Host): Promise<void> {
  const p = (await h.board.read()).plan, pr = p?.pr; if (!pr || p!.state !== 'integrating') return
  const K = await scoped(h, 'prwait'), w = ((await h.store.get(K)) as { n: number; next: number; err?: string } | undefined) ?? { n: 0, next: 0 }, now = await h.now(); if (now < w.next) return
  const cfg = await cfgOf(h), root = await h.cwd(), dev = cfg.branches.dev, gh = (...a: string[]) => h.run(['gh', ...a], { cwd: root })
  const red = async (why: string, fix: boolean) => { await h.store.del(K); await failed(h, p!.id, why, true, fix) }
  try {
    const v = await gh('pr', 'view', String(pr.n), '--json', 'state,reviewDecision'); if (v.exitCode) throw new Error(`gh pr view: ${tail(v)}`)
    const view = JSON.parse(v.stdout); if (view.state === 'CLOSED') return void (await red(`pull request #${pr.n} was closed without merging`, false))
    const c = await gh('pr', 'checks', String(pr.n), '--json', 'name,bucket')   // it exits non-zero on pending or failing checks too: the JSON decides; no JSON is an error, unless none are reported
    let checks: { name: string; bucket: string }[] | null = null; try { checks = JSON.parse(c.stdout) } catch { if (/no checks reported/i.test(c.stderr)) checks = [] }
    if (!Array.isArray(checks)) throw new Error(`gh pr checks: ${tail(c)}`)
    await h.store.set(K, { n: 0, next: now + 30_000 })
    const bad = checks.filter(c => c.bucket === 'fail' || c.bucket === 'cancel').map(c => c.name)
    if (bad.length) return void (await red(`pull request #${pr.n}: checks failed: ${bad.join(', ')}`, true))
    if (view.state !== 'MERGED' && ((!checks.length && now < (pr.at ?? 0) + 600_000) || checks.some(c => c.bucket === 'pending') || (cfg.landing.review && view.reviewDecision !== 'APPROVED'))) return
    if (view.state !== 'MERGED') { const m = await gh('pr', 'merge', String(pr.n), '--merge'); if (m.exitCode) throw new Error(`gh pr merge: ${tail(m)}`) }
    const f = await h.run(['git', 'fetch', cfg.landing.remote, dev], { cwd: root }); if (f.exitCode) throw new Error(tail(f))
    const sha = await tip(h.run, root, 'FETCH_HEAD')
    if (!(await landDev(h, { dev, sha, old: pr.devTip, tmp: '', epic: pr.from }))) {   // the merge is on the remote's dev, the local dev moved meanwhile: it waits as a landing onto the local commits (landPending re-integrates them through the gates)
      const held = await op(h, async () => !(await exists(h.run, root, pendingRef(dev))) && (await casRef(h.run, root, pendingRef(dev), sha, '0'.repeat(40))) && (await git(h.run, root, ['update-ref', baseRef(dev), pr.devTip]), await git(h.run, root, ['branch', '-D', pr.from]).catch(() => ''), true))
      if (!held && (await exists(h.run, root, pendingRef(dev)))) return void h.log(`pull request #${pr.n} merged: it lands after the landing waiting on ${dev}`)   // one pending ref: the merge waits its turn (an integrate again would push an old dev the remote refuses)
      if (!held) return void (await failed(h, p!.id, `${dev} moved here while pull request #${pr.n} merged; integrate again`, false, false))
    }
    await h.run(['git', 'push', cfg.landing.remote, '--delete', pr.branch], { cwd: root }); await h.store.del(K)
    await onDev(h, p!.id, dev, sha, [])
  } catch (e) {
    const err = (e as Error).message.slice(0, 200), same = err.replace(/[0-9a-f]{8,}|\d+/gi, '#'), n = w.err === same ? w.n + 1 : 1; h.log(`pull request #${pr.n}: ${err}`)
    if (n >= 3) return void (await red(`pull request #${pr.n}: the same error three times: ${err}`, false))
    await h.store.set(K, { n, err: same, next: now + Math.min(30_000 * 2 ** n, 600_000) })   // request ids and times differ on each try: the same error with its numbers masked
  }
}

// 5b: each submodule unit the plan changed merges in its own repository (its epic branch into its own dev, through its own checks) and the parent's pointer moves
// to that merge in the integration commit, so the parent's gates see the bump. Nothing lands here: subLand moves the submodules' dev only once the parent is
// green, and their epic branches go only once the parent's dev carries the bump. A submodule that landed while the parent's dev moved keeps its epic branch, so
// the retry finds it on the submodule's dev but not in the recorded pointer and bumps again: the bump is never lost. A milestone has no branch in a submodule:
// its epics land on the submodule's own dev. A submodule without that dev gets it at the commit the parent records.
// ponytail: pr mode refuses submodule changes (one pull request per repository is not built).
// ponytail: a milestone epic moves the submodule's dev when it integrates into the milestone branch; a milestone abandoned after that leaves those commits on
// the submodule's dev, never recorded by the parent (revert them there). Holding them until the milestone lands needs a milestone branch per submodule.
type Sub = { root: string; sr: string; st: string; sha: string; devTip: string }
async function subMerge(h: Host, cfg: any, root: string, tmp: string, from: string, epicId: string, pr: boolean): Promise<{ why: string; fix: boolean } | Sub[]> {
  const dev = cfg.branches.dev, out: Sub[] = []
  const fail = async (why: string, fix = false) => { for (const x of out) await worktreeRemove(h.run, x.sr, x.st).catch(() => {}); return { why, fix } }   // red checks get a fix task; a conflict or a refusal does not
  for (const u of unitsOf(cfg).filter(u => u.ownGit)) {
    const sr = `${root}/${u.root}`, hs: Host = { ...h, cwd: async () => sr }, st = `${tmp}-${u.root.replace(/\W/g, '-')}`
    if (!(await exists(h.run, sr, from))) continue   // nothing of this plan in it
    const pin = (await git(h.run, tmp, ['ls-tree', 'HEAD', u.root])).split(/\s+/)[2] ?? ''
    if (!(await exists(h.run, sr, dev))) await op(h, () => git(h.run, sr, ['branch', dev, pin || 'HEAD']))
    const done = await ok(h.run, sr, ['merge-base', '--is-ancestor', from, dev])
    if (done && pin && (await ok(h.run, sr, ['merge-base', '--is-ancestor', from, pin]))) continue   // landed and recorded
    if (pr) return fail(`${u.root} is its own repository: a pull request landing does not carry its changes; set landing.mode to "direct", then set ${epicId} completed again (status)`)
    let sha = await tip(h.run, sr, dev)
    if (!done) {
      const m = await mergeEpic(hs, { dev, epic: from, tmp: st, msg: `merge ${from} (${epicId})` }).catch(e => e as Error); if (m instanceof Error) return fail(`${u.root}: merge of ${from} into ${dev} failed: ${m.message}`)
      out.push({ root: u.root, sr, st, sha: m.sha, devTip: m.devTip }); sha = m.sha
      const red = await runSuites(h, { ...cfg, units: [{ ...u, root: '.', ownGit: false }] }, st, null, epicId); if (red) return fail(`${u.root}: ${red}`, true)
    }
    await git(h.run, tmp, ['update-index', '--cacheinfo', `160000,${sha},${u.root}`]); await git(h.run, tmp, ['commit', '--no-verify', '-m', `chore: ${u.root} to ${sha.slice(0, 7)} (${epicId})`])
  }
  return out
}
// the parent is green: each submodule's dev moves to its merge (by CAS). Returns the failure text, or null.
async function subLand(h: Host, dev: string, subs: Sub[]): Promise<string | null> {
  try {
    for (const x of subs) if (!(await op(h, () => move({ ...h, cwd: async () => x.sr }, dev, x.sha, x.devTip)))) return `${x.root}: ${dev} moved during integration; set it completed again (status)`
    return null
  } finally { for (const x of subs) await worktreeRemove(h.run, x.sr, x.st).catch(() => {}) }
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
  await autoLand(h).catch(x => h.log(`land: ${x}`))   // a landing that waited for the user's checkout goes first where it can
  let got = false; await h.board.update(b => { got = b.plan?.state === 'approved'; return got ? { ...b, plan: { ...b.plan!, state: 'integrating' } } : b })
  if (!got) return 'integration is already running'
  const [root, cfg, store] = [await h.cwd(), await cfgOf(h), await storeOf(h)]
  const dev = ep ? p.epicBranch : cfg.branches.dev, from = ep ? ep.branch : p.epicBranch, tmp = wtPath(await wtRootOf(h, cfg), repoKeyOf(root), `int-${epicId}`)
  let subs: Sub[] = []
  const fail = async (why: string, flag: boolean, fix = flag) => { for (const x of subs) await worktreeRemove(h.run, x.sr, x.st).catch(() => {}); return failed(h, epicId, why, flag, fix, tmp) }
  try {
    const c = await trial(h, root, await tip(h.run, root, await baseOf(h, dev)), from)   // a trial merge first (ADR 0015 wave 2)
    const m = c?.length ? new Error(`conflicts in ${c.join(', ')}`) : await mergeEpic(h, { dev, epic: from, tmp, msg: `merge ${from} (${epicId})${ep ? `\n\nMilestone: ${p.id} ${p.slug}` : ''}` }).catch(e => e as Error)
    if (m instanceof Error) {   // a conflict: a resolve task in that epic (both modes, at most 2); past that the epic stops (auto asks; yolo: the independent epics go on) or the plan is flagged
      const r = ep || !isMs(p) ? await resolveTask(h, await resolveDeps(h), epicId, from, dev, c ?? []).catch(x => (h.log(`resolve task: ${x}`), null)) : null
      if (r) { await worktreeRemove(h.run, root, tmp).catch(() => {}); await setPlan(h, 'fail'); await mirror(h, store); return r }
      return await fail(`merge of ${from} into ${dev} failed: ${m.message}${ep ? ` (with ${(p.epics ?? []).filter(x => x.state === 'landed').map(x => x.id).join(', ') || dev})` : ''}`, true, false)
    }
    let sha = m.sha
    const path = `${tmp}/${cfg.changelog.path}`, text = await h.readText(path)
    if (text !== null) {   // each closed child's entry, amended into the merge
      let out = text
      for (const t of (await store.list({ parent: epicId })).filter(t => t.category === 'done').sort((a, b) => (a.id < b.id ? -1 : 1))) {
        const c = t.meta['cadre.changelog'] ? JSON.parse(t.meta['cadre.changelog']) : null
        if (c?.category && c.entry && !out.includes(`(${t.id})`)) out = insert(out, c.category, c.entry, t.id)
      }
      if (out !== text) { await h.write(path, out); sha = await commitPaths(h, tmp, [cfg.changelog.path], '', true) }
    }
    const sm = await subMerge(h, cfg, root, tmp, from, epicId, !ep && cfg.landing.mode === 'pr'); if (!Array.isArray(sm)) return await fail(sm.why, true, sm.fix)
    subs = sm
    sha = await tip(h.run, tmp, 'HEAD')
    if (!ep && cfg.landing.mode === 'pr') return await openPr(h, cfg, epicId, dev, m.devTip, sha, from, tmp)   // CI is the gate there
    const files = (await git(h.run, tmp, ['diff', '--name-only', `${m.devTip}..${sha}`])).split('\n').filter(Boolean)
    const si = await subInit(h.run, root, tmp); if (si) return await fail(si, true, false)   // a pinned submodule commit this machine lacks: one dialog, no fix task
    const kr: { root: string; n: string }[] = [], red = await runSuites(h, cfg, tmp, files, epicId, kr); if (red) return await fail(red, true)
    const sl = await subLand(h, cfg.branches.dev, subs); subs = []; if (sl) return await fail(sl, false)
    if (!(await landDev(h, { dev, sha, old: m.devTip, tmp, epic: from }))) return await fail(`${dev} moved during integration; set it completed again (status)`, false)
    await Promise.resolve().then(() => store.setMeta(epicId, { 'cadre.landed': `${dev}@${sha}` }, 'cadre')).catch(x => h.log(`landed not recorded: ${x}`))   // core/revert finds the merge by this
    for (const u of unitsOf(cfg).filter(u => u.ownGit)) { const sr = `${root}/${u.root}`; if ((await exists(h.run, sr, from)) && (await ok(h.run, sr, ['merge-base', '--is-ancestor', from, cfg.branches.dev]))) await op(h, () => git(h.run, sr, ['branch', '-D', from])).catch(x => h.log(`${u.root}: ${x}`)) }   // the parent records it: its epic branch goes
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
  const devTip = await tip(h.run, root, dev), cl = await h.run(['git', '-C', root, 'show', `${devTip}:${cfg.changelog.path}`])
  if (cl.exitCode) return no(`${cfg.changelog.path} is missing on ${dev}`)
  const tag = await lastTag(h), version = want ?? inferVersion(tag, (await git(h.run, root, ['log', '--no-merges', '--format=%s', tag ? `${tag}..${dev}` : dev])).split('\n'))
  let cutText: string
  try { cutText = cut(cl.stdout, version, new Date(await h.now()).toISOString().slice(0, 10)) } catch (e) { return no((e as Error).message) }
  if (await exists(h.run, root, `refs/tags/v${version}`)) return no(`tag v${version} already exists`)
  const key = repoKeyOf(root), tmp = wtPath(await wtRootOf(h, cfg), key, `rel-${version}`)
  await op(h, () => git(h.run, root, ['worktree', 'add', '--detach', tmp, devTip]))
  let cdev = ''
  try {
    const red = await runSuites(h, cfg, tmp, null, s.epic ?? ''); if (red) return no(`${dev} is not green: ${red}`)
    await git(h.run, tmp, ['reset', '--hard', '-q', devTip]); await git(h.run, tmp, ['clean', '-fdq'])   // drop what setup left behind
    await h.write(`${tmp}/${cfg.changelog.path}`, cutText); cdev = await commitPaths(h, tmp, [cfg.changelog.path], `chore(release): v${version}${isMs(s.plan) && s.plan!.landed ? ` — milestone ${s.plan!.id} ${s.plan!.slug}` : ''}`)
  } finally { await op(h, () => worktreeRemove(h.run, root, tmp)) }
  if (!(await op(h, () => move(h, dev, cdev, devTip)))) return no(`${dev} moved during release; retry`)
  let sha: string
  try { sha = await release(h, { dev, main, version, tmp: wtPath(await wtRootOf(h, cfg), key, `relm-${version}`), msg: `release v${version}` }) }
  catch (e) { await op(h, () => move(h, dev, devTip, cdev)); await landPending(h, dev).catch(() => null); return no(`merge into ${main} failed: ${(e as Error).message}; ${dev} restored`) }
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
  if (b === cfg.branches.dev && (await h.board.read()).plan?.state === 'done-on-dev' && cfg.release.onEpicDone === 'propose') await propose(h, root, b)
  return null
}
// the next landing, session start and the 5 s tick: what waits lands where it can; a dev the user moved is merged into the running plan, and its workers get it
export async function autoLand(h: Host): Promise<void> {
  await prPoll(h)
  const cfg = await cfgOf(h), root = await h.cwd(), s = await h.board.read()
  for (const b of [cfg.branches.dev, await mainOf(h, cfg, root)]) await landPending(h, b).catch(x => h.log(`land ${b}: ${x}`))   // a busy lock: the next tick retries
  if (s.plan?.state !== 'approved' || isMs(s.plan) || !(await exists(h.run, root, s.plan.epicBranch))) return
  const was = await tip(h.run, root, s.plan.epicBranch), dev = await baseOf(h, cfg.branches.dev), pair = `${await tip(h.run, root, dev)} ${was}`, K = await scoped(h, 'freshen')
  if ((await h.store.get(K)) === pair) return   // that dev did not merge into this plan cleanly: tried once, again when either moves
  await freshen(h, root, s.plan.epicBranch, dev, wtPath(await wtRootOf(h, cfg), repoKeyOf(root), 'freshen'))
  const now = await tip(h.run, root, s.plan.epicBranch); if (now !== was) await refresh(h, await resolveDeps(h), now, ''); else if (!(await ok(h.run, root, ['merge-base', '--is-ancestor', dev, now]))) await h.store.set(K, pair)
}
ROUTES.land = async (h, c) => { const r = await landPending(h, c.args[0] ?? (await cfgOf(h)).branches.dev, true); return { text: r === 'busy' ? 'not landed yet: its checks are running; Land again when they finish' : r ? 'not landed: the dialog says why' : `${c.args[0]}: landed into your checkout` } }
