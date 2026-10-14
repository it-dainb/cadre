// Epic integration and release (DESIGN 3.9). integrateEpic is called by the TaskUpdate{epic, completed} lifecycle (core/close); /cadre release is ROUTES.release.
// Everything that moves a ref is inside git.op (branches.ts); suites run in a throwaway worktree, outside it.
import type { Host } from '../types'
import { fnv1a64 } from './board'
import { ROUTES, cfgOf, mirror, registryOf, storeOf } from './dispatch'
import { emit } from './events'
import { ask, settleIf, yoloOn } from './decide'
import { BLOCKING, epicNext } from './machine'
import { cut, insert } from './changelog'
import { modeOf } from './specview'
import { casRef, checkRun, exists, git, op, tip, worktreeRemove, writableJail } from './git'
import { baseOf, baseRef, checkedOut, inferVersion, landDev, lastTag, mergeEpic, move, pendingRef, release, wtPath, wtRootOf } from './branches'
import { clearKnownRed, repoKeyOf } from '../commands/init'
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

// setup + suites.integration per touched package (files = null: every package). Returns the failure text, or null when green.
async function runSuites(h: Host, cfg: any, wt: string, files: string[] | null, epicId: string, kr: { root: string; n: string }[] = []): Promise<string | null> {
  const pkgs: any[] = cfg.packages ?? [], owner = (f: string) => pkgs.reduce<any>((best, p) => (p.root === '.' || f === p.root || f.startsWith(`${p.root}/`)) && (!best || p.root.length > best.root.length) ? p : best, null)
  const hit = new Set(files?.map(owner)), touched = pkgs.filter(p => !files || hit.has(p))
  const mode = await modeOf(h, { cfg }).catch((e: Error) => e); if (mode instanceof Error) return mode.message
  const base = JSON.parse((await Promise.resolve().then(async () => (await storeOf(h)).get(epicId)).catch(() => null))?.meta['cadre.baseline'] || '{}')
  const scratch = `${wt}-scratch`; await h.run(['mkdir', '-p', scratch])
  try {
    for (const p of touched) {
      const dir = p.root === '.' ? wt : `${wt}/${p.root}`, j = { wt, scratch, pkgRoot: dir }
      if (p.setup?.length) { const r = await h.run(mode === 'none' ? p.setup : writableJail({ ...j, argv: p.setup }), { cwd: dir, timeoutMs: 600000 }); if (r.exitCode) return `${p.root}: setup failed: ${tail(r)}` }
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

// §3.9 Integration. null = landed on dev; otherwise the refusal / failure text (also left as a comment on the epic).
export async function integrateEpic(h: Host, epicId: string): Promise<string | null> {
  const s = await h.board.read(), p = s.plan, ep = epicOf(s, epicId)   // a milestone's epic lands on the milestone branch; the milestone lands on dev (ADR 0015)
  if (!p || (!ep && (s.epic !== epicId || p.id !== epicId))) return `${epicId} is not the current epic`
  if (p.state !== 'approved') return p.state === 'integrating' ? 'integration is already running; call TaskUpdate completed again after it' : `epic is ${p.state}; only an approved epic integrates`
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
  const fail = async (why: string, flag: boolean, fix = flag) => {   // fix: red checks get a fix task; a merge conflict with dev is the human's ("make the checks pass" does not fit it)
    await worktreeRemove(h.run, root, tmp).catch(() => {})
    if (fix && !(isMs(p) && !ep) && (await redFix(h, epicId, why).catch(e => (h.log(`fix task: ${e}`), false)))) flag = false   // driving: the first red gets one fix task, no flag (ADR 0013)
    if (ep) { await setPlan(h, 'fail'); if (flag) await stopEpic(h, epicId, why.slice(0, 200)); else await mirror(h, store, await registryOf(h)); return why }   // an epic: the milestone goes on; a 2nd red or a conflict stops this epic only
    await setPlan(h, 'fail', flag ? { flags: [...(p.flags ?? []).filter(f => f !== 'integration-failed'), 'integration-failed'] } : {})
    if (flag) await emit(h, 'flag.raised', { taskId: epicId, flag: 'integration-failed' })
    await store.comment(epicId, `integration ${flag ? 'failed' : 'refused'}: ${why}`, 'cadre').catch(() => {})
    return why
  }
  try {
    const c = await trial(h, root, await tip(h.run, root, await baseOf(h, dev)), from)   // a trial merge first (ADR 0015 wave 2)
    const m = c?.length ? new Error(`conflicts in ${c.join(', ')}`) : await mergeEpic(h, { dev, epic: from, tmp, msg: `merge ${from} (${epicId})${ep ? `\n\nMilestone: ${p.id} ${p.slug}` : ''}` }).catch(e => e as Error)
    if (m instanceof Error) {   // a conflict: a resolve task in that epic (both modes, at most 2); past that the epic stops (auto asks; yolo: the independent epics go on) or the plan is flagged
      const r = ep || !isMs(p) ? await resolveTask(h, await resolveDeps(h), epicId, from, dev, c ?? []).catch(x => (h.log(`resolve task: ${x}`), null)) : null
      if (r) { await worktreeRemove(h.run, root, tmp).catch(() => {}); await setPlan(h, 'fail'); await mirror(h, store, await registryOf(h)); return r }
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
    const files = (await git(h.run, tmp, ['diff', '--name-only', `${m.devTip}..${sha}`])).split('\n').filter(Boolean)
    const kr: { root: string; n: string }[] = [], red = await runSuites(h, cfg, tmp, files, epicId, kr); if (red) return await fail(red, true)
    if (!(await landDev(h, { dev, sha, old: m.devTip, tmp, epic: from }))) return await fail(`${dev} moved during integration; call TaskUpdate completed again`, false)
    await offer(h, dev)   // the user has it checked out: the landing waits for them
    if (ep) return await landed(h, store, epicId, sha, files, cfg.branches.dev, tmp)
    const at = await h.now()
    await setPlan(h, 'land', { landed: { dev, sha, at }, flags: (p.flags ?? []).filter(f => f !== 'integration-failed') })
    await emit(h, 'plan.landed', { planId: epicId, sha })
    await clearKnownRed(h, kr, epicId).catch(e => h.log(`known red not cleared: ${e}`))
    const dr = (await h.board.read()).drive; if (cfg.release.onEpicDone === 'propose' && !(yoloOn(dr) && dr.epicId === epicId)) await propose(h, root, dev)   // a running yolo run of this plan stops at landed on dev (drive's toast); a stopped one, or another epic's mode, gets the proposal
    return null
  } catch (e) { return await fail(`integration error: ${(e as Error).message}`, false) }
}

// an epic landed on the milestone branch: closed, recorded; a core epic's files are locked for the others; the milestone takes dev's news; the last one lands the milestone on dev.
async function landed(h: Host, store: Awaited<ReturnType<typeof storeOf>>, epicId: string, sha: string, files: string[], dev: string, tmp: string): Promise<string | null> {
  const p = (await h.board.read()).plan!, e = epicOf({ plan: p }, epicId)!
  await store.close(epicId, { outcome: 'done', note: `landed ${sha.slice(0, 7)} on ${p.epicBranch}` }); await setPlan(h, 'fail'); await mirror(h, store, await registryOf(h))
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
  const gf = await gitFlags(h), bf = [...(s.plan?.flags ?? []), ...s.tasks.flatMap(t => t.flags)].find(f => BLOCKING.test(f))
  if (gf.length || bf) return no(`flag ${gf[0] ?? bf} is open; ask the human to resolve it in the cadre dialog first`)
  if (want && !/^\d+\.\d+\.\d+$/.test(want)) return no(`version "${want}": expected x.y.z`)
  const [root, cfg] = [await h.cwd(), await cfgOf(h)], dev = cfg.branches.dev
  const main = cfg.branches.main || ((await exists(h.run, root, 'main')) ? 'main' : 'master')
  if (!(await exists(h.run, root, dev))) return no(`no ${dev} branch`)
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
  catch (e) { await op(h, () => move(h, dev, devTip, cdev)); return no(`merge into ${main} failed: ${(e as Error).message}; ${dev} restored`) }
  await offer(h, dev); await offer(h, main)   // a release that leaves main pending tags the commit the user's main gains on the click
  if (s.plan?.state === 'done-on-dev') await setPlan(h, 'release', { released: { version, at: await h.now() } })
  await h.ui.update(({ rel: _r, ...u }) => u); await settleIf(h, 'release:')
  await emit(h, 'plan.released', { version, sha })
  return `Released v${version}: ${dev} merged into ${main} (${sha.slice(0, 7)}), tag v${version}.`
}
ROUTES.release = async (h, c) => ({ text: await releaseDev(h, c.args[0]) })

// ---- H5: a landing that waits for the user's checkout (core/branches.move). One dialog offers to land it; it lands by itself once the branch is checked out nowhere. ----
const ask1 = (h: Host, b: string, line: string) => ask(h, { id: `pending:${b}`, kind: 'flag', title: `${b} has new work for your checkout`, hash: fnv1a64(line), tab: 'epic', lines: [line, 'Land: bring it into your checkout now (your own commits and edits are kept).'], options: [{ key: 'l', label: 'Land', verb: 'change', run: `land ${b}` }] })
async function offer(h: Host, b: string) { if (await exists(h.run, await h.cwd(), pendingRef(b))) await ask1(h, b, `cadre did not move ${b}: you have it checked out.`) }
// (2) the user committed on b meanwhile: their commit is never dropped; the landing re-integrates onto it through the gates (trial merge, suites); (1) the click:
// HEAD is b and b is the base: a fast-forward moves ref, index and files together (it refuses on conflicting local edits). Checked out nowhere: it lands by CAS.
export async function landPending(h: Host, b: string, click = false): Promise<string | null> {
  const root = await h.cwd(), cfg = await cfgOf(h), P = pendingRef(b)
  for (let round = 0; round < 3; round++) {
    if (!(await exists(h.run, root, P))) return null
    const [sha, base, cur, wt] = [await tip(h.run, root, P), await tip(h.run, root, baseRef(b)), await tip(h.run, root, b), await checkedOut(h, b)]
    if (round === 2) break
    if (cur !== base) {
      const tmp = wtPath(await wtRootOf(h, cfg), repoKeyOf(root), `land-${b.replace(/\W/g, '-')}`), c = await trial(h, root, cur, sha)
      if (c?.length) { await ask1(h, b, `your commits on ${b} conflict with the landing in ${c.join(', ')}: resolve them on ${b}, then Land.`); return 'conflict' }
      const why = await op(h, async () => {
        await git(h.run, root, ['worktree', 'add', '--detach', tmp, cur])
        try {
          await git(h.run, tmp, ['merge', '--no-ff', '--no-verify', '-m', `merge the landing into your ${b}`, sha])
          const next = await tip(h.run, tmp, 'HEAD'), red = await runSuites(h, cfg, tmp, (await git(h.run, tmp, ['diff', '--name-only', `${cur}..${next}`])).split('\n').filter(Boolean), '')
          if (red) return red
          if (await casRef(h.run, root, P, next, sha)) await git(h.run, root, ['update-ref', baseRef(b), cur])
          return null
        } finally { await worktreeRemove(h.run, root, tmp).catch(() => {}) }
      })
      if (why) { await ask1(h, b, `the landing does not pass its checks on your ${b}: ${why.slice(0, 200)}`); return 'red' }
      continue
    }
    if (!wt) { if (await op(h, () => casRef(h.run, root, `refs/heads/${b}`, sha, cur))) return clean(h, b); continue }   // checked out nowhere: it lands by itself
    if (!click) return 'waits'
    const r = await op(h, () => h.run(['git', '-C', wt, 'merge', '--ff-only', sha]))
    if (r.exitCode) { await ask1(h, b, `your uncommitted edits touch the same files as the landing: commit or stash them, then Land. ${r.stderr.trim().slice(0, 120)}`); return 'edits' }
    return clean(h, b)
  }
  await ask1(h, b, `${b} kept moving while it landed: Land again.`); return 'moved'
}
async function clean(h: Host, b: string) {
  const root = await h.cwd(), cfg = await cfgOf(h); for (const r of [pendingRef(b), baseRef(b)]) await git(h.run, root, ['update-ref', '-d', r]); await settleIf(h, `pending:${b}`)
  if (b === cfg.branches.dev && (await h.board.read()).plan?.state === 'done-on-dev' && cfg.release.onEpicDone === 'propose') await propose(h, root, b)
  return null
}
// the next landing, session start and the 5 s tick: what waits lands where it can; a dev the user moved is merged into the running plan, and its workers get it
export async function autoLand(h: Host): Promise<void> {
  const cfg = await cfgOf(h), root = await h.cwd(), s = await h.board.read()
  for (const b of [cfg.branches.dev, cfg.branches.main || 'main']) await landPending(h, b)
  if (s.plan?.state !== 'approved' || isMs(s.plan) || !(await exists(h.run, root, s.plan.epicBranch))) return
  const was = await tip(h.run, root, s.plan.epicBranch); await freshen(h, root, s.plan.epicBranch, await baseOf(h, cfg.branches.dev), wtPath(await wtRootOf(h, cfg), repoKeyOf(root), 'freshen'))
  const now = await tip(h.run, root, s.plan.epicBranch); if (now !== was) await refresh(h, await resolveDeps(h), now, '')
}
ROUTES.land = async (h, c) => ({ text: (await landPending(h, c.args[0] ?? (await cfgOf(h)).branches.dev, true)) ? 'not landed: the dialog says why' : `${c.args[0]}: landed into your checkout` })
