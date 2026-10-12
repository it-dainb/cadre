// Epic integration and release (DESIGN 3.9). integrateEpic is called by the TaskUpdate{epic, completed} lifecycle (core/close); /cadre release is ROUTES.release.
// Everything that moves a ref is inside git.op (branches.ts); suites run in a throwaway worktree, outside it.
import type { Host } from '../types'
import { ROUTES, cfgOf, storeOf } from './dispatch'
import { emit } from './events'
import { ask, settleIf, yoloOn } from './decide'
import { BLOCKING, epicNext } from './machine'
import { cut, insert } from './changelog'
import { casRef, checkRun, exists, git, jailMode, op, tip, worktreeRemove, writableJail } from './git'
import { inferVersion, landDev, lastTag, mergeEpic, release, wtPath, wtRootOf } from './branches'
import { clearKnownRed, repoKeyOf } from '../commands/init'
import { redFix } from './drive'


const setPlan = (h: Host, ev: string, patch: Record<string, unknown> = {}) =>
  h.board.update(b => { const n = b.plan && epicNext(b.plan.state, ev); return n ? { ...b, plan: { ...b.plan!, ...patch, state: n } } : b })
const gitFlags = async (h: Host) => Object.keys((await h.git.read()).flags ?? {}).filter(f => f.startsWith('git:'))
const tail = (r: { stdout: string; stderr: string }) => `${r.stdout}\n${r.stderr}`.trim().slice(-400)
// a branch checked out in the repo root follows its ref by a two-tree merge: unrelated human edits stay, conflicting ones refuse (never reset --hard: it eats them)
const checkedOut = async (h: Host, root: string, br: string) => (await h.run(['git', '-C', root, 'symbolic-ref', '-q', 'HEAD'])).stdout.trim() === `refs/heads/${br}`
const refresh = async (h: Host, root: string, br: string, was: boolean, old: string) => {
  if (was) await op(h, async () => git(h.run, root, ['read-tree', '-m', '-u', old, await tip(h.run, root, br)])).catch(() => h.toast(`cadre: ${br} moved; your edits kept · git stash, then checkout ${br}`))
}
const commitPaths = async (h: Host, wt: string, paths: string[], msg: string, amend = false) => {
  await git(h.run, wt, ['add', '--', ...paths]); await git(h.run, wt, ['commit', '--no-verify', ...(amend ? ['--amend', '--no-edit'] : ['-m', msg])]); return tip(h.run, wt, 'HEAD')
}

// setup + suites.integration per touched package (files = null: every package). Returns the failure text, or null when green.
async function runSuites(h: Host, cfg: any, wt: string, files: string[] | null, epicId: string, kr: { root: string; n: string }[] = []): Promise<string | null> {
  const pkgs: any[] = cfg.packages ?? [], owner = (f: string) => pkgs.reduce<any>((best, p) => (p.root === '.' || f === p.root || f.startsWith(`${p.root}/`)) && (!best || p.root.length > best.root.length) ? p : best, null)
  const hit = new Set(files?.map(owner)), touched = pkgs.filter(p => !files || hit.has(p))
  const mode = cfg.jail === 'off' ? 'none' as const : await jailMode(h.run)
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
        if (r.exitCode) return `${p.root}:${n} failed (exit ${r.exitCode}): ${tail(r)}`
      }
    }
  } finally { await h.run(['rm', '-rf', scratch]) }
  return null
}

export async function propose(h: Host, root: string, dev: string): Promise<void> {
  const tag = await lastTag(h), subj = (await git(h.run, root, ['log', '--no-merges', '--format=%s', tag ? `${tag}..${dev}` : dev])).split('\n')
  const version = inferVersion(tag, subj)
  await h.ui.update(u => ({ ...u, rel: version }))
  await ask(h, { id: `release:${version}`, kind: 'release', title: `release v${version}?`, lines: [`${dev} merges into main with an annotated tag v${version}`], hash: version, tab: 'epic', options: [{ key: 'r', label: 'Release', verb: 'release', run: `release ${version}` }] })
  await emit(h, 'release.proposed', { version }); h.toast(`Epic landed on ${dev} · release v${version}? · press 1`)
}

// §3.9 Integration. null = landed on dev; otherwise the refusal / failure text (also left as a comment on the epic).
export async function integrateEpic(h: Host, epicId: string): Promise<string | null> {
  const s = await h.board.read(), p = s.plan
  if (!p || s.epic !== epicId || p.id !== epicId) return `${epicId} is not the current epic`
  if (p.state !== 'approved') return p.state === 'integrating' ? 'integration is already running' : `epic is ${p.state}; only an approved epic integrates`
  const open = s.tasks.filter(t => t.state !== 'done' && t.state !== 'cancelled').map(t => t.id)
  if (open.length) return `children still open: ${open.join(', ')}`
  const gf = await gitFlags(h); if (gf.length) return `git flag ${gf[0]} is open (someone changed a protected ref); ask the human to keep or restore it in the cadre dialog first`
  let got = false; await h.board.update(b => { got = b.plan?.state === 'approved'; return got ? { ...b, plan: { ...b.plan!, state: 'integrating' } } : b })
  if (!got) return 'integration is already running'
  const [root, cfg, store] = [await h.cwd(), await cfgOf(h), await storeOf(h)]
  const dev = cfg.branches.dev, tmp = wtPath(await wtRootOf(h, cfg), repoKeyOf(root), `int-${epicId}`)
  const fail = async (why: string, flag: boolean, fix = flag) => {   // fix: red checks get a fix task; a merge conflict with dev is the human's ("make the checks pass" does not fit it)
    await worktreeRemove(h.run, root, tmp).catch(() => {})
    if (fix && (await redFix(h, epicId, why).catch(e => (h.log(`fix task: ${e}`), false)))) flag = false   // driving: the first red gets one fix task, no flag (ADR 0013)
    await setPlan(h, 'fail', flag ? { flags: [...(p.flags ?? []).filter(f => f !== 'integration-failed'), 'integration-failed'] } : {})
    if (flag) await emit(h, 'flag.raised', { taskId: epicId, flag: 'integration-failed' })
    await store.comment(epicId, `integration ${flag ? 'failed' : 'refused'}: ${why}`, 'cadre').catch(() => {})
    return why
  }
  try {
    const m = await mergeEpic(h, { dev, epic: p.epicBranch, tmp, msg: `merge ${p.epicBranch} (${epicId})` }).catch(e => e as Error)
    if (m instanceof Error) return await fail(`merge of ${p.epicBranch} into ${dev} failed: ${m.message}`, true, false)
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
    const on = await checkedOut(h, root, dev)
    if (!(await landDev(h, { dev, sha, old: m.devTip, tmp, epic: p.epicBranch }))) return await fail(`${dev} moved during integration; call TaskUpdate completed again`, false)
    await refresh(h, root, dev, on, m.devTip)
    const at = await h.now()
    await setPlan(h, 'land', { landed: { dev, sha, at }, flags: (p.flags ?? []).filter(f => f !== 'integration-failed') })
    await emit(h, 'plan.landed', { planId: epicId, sha })
    await clearKnownRed(h, kr, epicId).catch(e => h.log(`known red not cleared: ${e}`))
    const dr = (await h.board.read()).drive; if (cfg.release.onEpicDone === 'propose' && !(yoloOn(dr) && dr.epicId === epicId)) await propose(h, root, dev)   // a running yolo run of this plan stops at landed on dev (drive's toast); a stopped one, or another epic's mode, gets the proposal
    return null
  } catch (e) { return await fail(`integration error: ${(e as Error).message}`, false) }
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
    await h.write(`${tmp}/${cfg.changelog.path}`, cutText); cdev = await commitPaths(h, tmp, [cfg.changelog.path], `chore(release): v${version}`)
  } finally { await op(h, () => worktreeRemove(h.run, root, tmp)) }
  const [onDev, onMain, mainWas] = [await checkedOut(h, root, dev), await checkedOut(h, root, main), await tip(h.run, root, main)]
  if (!(await op(h, () => casRef(h.run, root, `refs/heads/${dev}`, cdev, devTip)))) return no(`${dev} moved during release; retry`)
  let sha: string
  try { sha = await release(h, { dev, main, version, tmp: wtPath(await wtRootOf(h, cfg), key, `relm-${version}`), msg: `release v${version}` }) }
  catch (e) { await op(h, () => casRef(h.run, root, `refs/heads/${dev}`, devTip, cdev)); return no(`merge into ${main} failed: ${(e as Error).message}; ${dev} restored`) }
  await refresh(h, root, dev, onDev, devTip); await refresh(h, root, main, onMain, mainWas)
  if (s.plan?.state === 'done-on-dev') await setPlan(h, 'release', { released: { version, at: await h.now() } })
  await h.ui.update(({ rel: _r, ...u }) => u); await settleIf(h, 'release:')
  await emit(h, 'plan.released', { version, sha })
  return `Released v${version}: ${dev} merged into ${main} (${sha.slice(0, 7)}), tag v${version}.`
}
ROUTES.release = async (h, c) => ({ text: await releaseDev(h, c.args[0]) })
