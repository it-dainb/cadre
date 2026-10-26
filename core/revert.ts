// H9 revert to this point (1.0). A landed task, epic or milestone is undone by revert commits made on a cadre branch and landed through the integrate primitives
// (mergeEpic, the suites, landDev -> move, all inside op): dev is never moved by anything else. A target that never landed is abandoned: its recorded branches go.
// Two confirms (revert: -> revert-sure:); a revert is a store record, and a record is never reverted. Branches are found by the ids the store recorded, never by name.
import type { Host } from '../types'
import type { Task, TaskStore } from '../task-management/store'
import { fnv1a64 } from './board'
import { ROUTES, cfgOf, storeOf } from './dispatch'
import { ask, settle } from './decide'
import { git, exists, ok, op, tip, worktreeAdd, worktreeRemove } from './git'
import { baseOf, landDev, mergeEpic, wtPath, wtRootOf } from './branches'
import { offer, runSuites } from './integrate'
import { repoKeyOf } from '../commands/init'
import { reportOf } from './close'
import { insert } from './changelog'
import { modelText } from './say'

export type RevertCode = 'unknown' | 'revert-of-revert' | 'already-reverted' | 'not-landed' | 'busy' | 'pr-mode'   // declared: a refusal carries its code, never read from its text
export class RevertRefusal extends Error { constructor(readonly code: RevertCode, msg: string) { super(msg) } }
type Plan = { id: string; title: string; on: string; sha: string; merge: boolean; branches: Record<string, string>; known: string[]; ids: string[]; lines: string[] }   // branches: the recorded ones that exist, with their tips at the card; known: the shas the store recorded

const subtree = async (store: TaskStore, id: string): Promise<Task[]> => { const c = await store.list({ parent: id }); return [...c, ...(await Promise.all(c.map(x => subtree(store, x.id)))).flat()] }
// the branches the store (or, for the current plan, the board) recorded for the target and everything under it, and the commits it recorded
async function recorded(h: Host, store: TaskStore, t: Task): Promise<{ own?: string; names: string[]; known: string[]; ids: string[]; live: boolean }> {
  const p = (await h.board.read()).plan, all = [t, ...(await subtree(store, t.id))]
  const own = p?.id === t.id ? p.epicBranch : t.meta['cadre.branch']
  return { own, names: [...new Set([own, ...all.map(x => x.meta['cadre.branch'])].filter(Boolean))], ids: all.map(x => x.id), live: all.some(x => x.category === 'active' || x.category === 'review'),
    known: all.flatMap(x => [x.meta['cadre.sourceCommit'], /^squash: (\S+)/m.exec(x.meta['cadre.rec.close'] ?? '')?.[1], x.meta['cadre.landed']?.split('@')[1]].filter(Boolean) as string[]) }
}

export async function planOf(h: Host, id: string): Promise<Plan> {
  const store = await storeOf(h), t = await store.get(id).catch(() => null), root = await h.cwd(), cfg = await cfgOf(h), dev = cfg.branches.dev
  const no = (code: RevertCode, m: string): never => { throw new RevertRefusal(code, m) }
  if (!t) return no('unknown', `${id}: no such task, epic or milestone`)
  if (t.meta['cadre.revert']) return no('revert-of-revert', `${id} is a revert; it is not reverted again: make the change as a new task`)
  if (t.meta['cadre.reverted']) return no('already-reverted', `${id} was already reverted`)
  const own = t.meta['cadre.landed'], up = t.parent ? (await store.get(t.parent).catch(() => null))?.meta['cadre.landed'] : undefined   // `branch@sha` of the merge that took it in
  const [lb, ls] = (own ?? up ?? '').split('@'), sq = /^squash: (\S+)/m.exec(t.meta['cadre.rec.close'] ?? '')?.[1]
  const sha = own ? ls : up && sq ? sq : '', merge = !!own
  const rec = await recorded(h, store, t), live = Object.fromEntries(await Promise.all(rec.names.map(async b => [b, (await exists(h.run, root, b)) ? await tip(h.run, root, b) : '']))), names = Object.keys(live).filter(b => live[b])
  if (sha && cfg.landing.mode === 'pr' && lb === dev) no('pr-mode', 'reverts land through the pull-request flow; not yet supported')
  if (!sha) {   // abandon: only an idle target with its own branch (a landed epic has none left)
    const bd = (await h.board.read()), bp = bd.plan, mine = bp && (bp.id === id || bp.epics?.some(e => e.id === id)), run = bp?.epics?.some(e => (e.id === id || bp.id === id) && (e.state === 'running' || e.state === 'planning'))
    if (rec.live || (mine && (bp.state === 'integrating' || bp.pr || run || bd.tasks.some(x => x.state === 'active' || x.state === 'review')))) no('busy', `${id} is still running or landing; wait for it to stop first`)
  }
  const on = sha && (await exists(h.run, root, lb)) ? lb : dev
  const sibs = t.parent ? await store.list({ parent: t.parent }) : [], later = new Set<string>()
  const grow = (x: string): void => { for (const s of sibs) if (!later.has(s.id) && s.category !== 'cancelled' && s.deps.some(d => d.id === x)) { later.add(s.id); grow(s.id) } }; grow(id)
  let files: string[] = [], commits: string[] = []
  if (sha) { files = (await git(h.run, root, ['diff', '--name-only', `${sha}^`, sha])).split('\n').filter(Boolean); commits = (await git(h.run, root, ['log', '--format=%h %s', `${sha}^..${sha}`])).split('\n').filter(Boolean) }
  else if (t.type === 'epic' && rec.own && live[rec.own]) { const b = rec.own; files = (await git(h.run, root, ['diff', '--name-only', `${dev}...${b}`])).split('\n').filter(Boolean); commits = (await git(h.run, root, ['log', '--format=%h %s', `${dev}..${b}`])).split('\n').filter(Boolean) }
  else return no('not-landed', t.category === 'done' ? (cfg.landing.mode === 'pr' ? `${id} landed through a pull request, which is not recorded; reverts there are not yet supported` : `${id} has no recorded landing${up === undefined && t.parent ? ' (its epic has not landed)' : ''}`) : `${id} has not landed, and has no branch to abandon`)
  const ce = t.meta['cadre.changelog'] ? JSON.parse(t.meta['cadre.changelog']) : null, list = (xs: string[]) => (xs.length ? xs.slice(0, 5).join(', ') + (xs.length > 5 ? ` +${xs.length - 5}` : '') : 'none')
  const lines = [`changelog: ${ce?.entry ?? 'none'}`, `summary: ${reportOf(t.meta['cadre.report']).summary || t.description.slice(0, 120) || 'none'}`,
    `result: ${sha ? `landed ${sha.slice(0, 7)} on ${on}` : `never landed; removes ${names.join(', ')}`} · tests: ${t.meta['cadre.checks'] || 'none recorded'}`,
    `files lost (${files.length}): ${list(files)}`, `commits (${commits.length}): ${list(commits.map(c => c.split(' ')[0]))}`, `later tasks that depend on it: ${list([...later])}`]
  return { id, title: t.title, on, sha, merge, branches: Object.fromEntries(names.map(b => [b, live[b]])), known: rec.known, ids: rec.ids, lines }
}

const NO = (h: Host, id: string, why: string) => ask(h, { id: `revert-fail:${id}`, kind: 'flag', title: `${id} was not reverted`, hash: fnv1a64(why), tab: 'epic', sel: id, lines: [why.slice(0, 300), 'Nothing changed.'], options: [{ key: 'k', label: 'Understood', verb: 'keep', run: `revert ${id} dismiss` }] })
// The recorded branches go, each only if it is safe: never main or dev; after a revert only a branch that is merged (or at a commit the store recorded); in an abandon the tip
// the card showed (the confirm covers exactly that). A branch that moved since, or is in use, stays. Others, whatever their names, are never looked at.
async function drop(h: Host, p: Plan): Promise<{ gone: string[]; kept: string[]; failed: string[] }> {
  const [root, cfg] = [await h.cwd(), await cfgOf(h)], r = { gone: [] as string[], kept: [] as string[], failed: [] as string[] }, no = [cfg.branches.dev, cfg.branches.main, 'main', 'master']
  for (const [b, was] of Object.entries(p.branches)) {
    if (no.includes(b)) { r.kept.push(`${b} (protected)`); continue }
    const st = await op(h, async () => {
      if (!(await exists(h.run, root, b))) return 'gone'
      const now = await tip(h.run, root, b)
      if (now !== was || (p.sha && !p.known.includes(now) && !(await ok(h.run, root, ['merge-base', '--is-ancestor', now, p.on])) && !(await ok(h.run, root, ['merge-base', '--is-ancestor', now, cfg.branches.dev])))) return 'kept'
      await git(h.run, root, ['branch', '-D', b]); return 'done'
    }).catch(() => 'failed')
    if (st === 'done') r.gone.push(b); else if (st === 'kept') r.kept.push(`${b} (changed or not merged)`); else if (st === 'failed') r.failed.push(b)
  }
  return r
}
const dropText = (r: { gone: string[]; kept: string[]; failed: string[] }) => `${r.gone.length} recorded branch${r.gone.length === 1 ? '' : 'es'} removed${r.kept.length ? `; kept: ${r.kept.join(', ')}` : ''}${r.failed.length ? `; could not remove (in use): ${r.failed.join(', ')}` : ''}`

async function perform(h: Host, p: Plan): Promise<string> {
  const [root, cfg, store] = [await h.cwd(), await cfgOf(h), await storeOf(h)]
  if (!p.sha) { const r = await drop(h, p); if (!r.failed.length) await store.setMeta(p.id, { 'cadre.reverted': 'abandoned' }, 'cadre'); return `${p.id} ${r.failed.length ? 'is not fully abandoned (try again)' : 'abandoned'}: ${dropText(r)}` }
  const gf = Object.keys((await h.git.read()).flags ?? {}).find(f => f.startsWith('git:')); if (gf) return `refused: git flag ${gf} is open; keep or restore it in the dialog first`
  const rb = `revert/${p.id}`, key = repoKeyOf(root), wt = wtPath(await wtRootOf(h, cfg), key, `rev-${p.id}`), tmp = wtPath(await wtRootOf(h, cfg), key, `int-rev-${p.id}`)
  try {
  const rv = await op(h, async () => {
    await worktreeRemove(h.run, root, wt, rb); await worktreeRemove(h.run, root, tmp)   // what an earlier attempt left
    await worktreeAdd(h.run, root, wt, rb, await baseOf(h, p.on))
    const cl = cfg.changelog.path, r = await h.run(['git', '-C', wt, 'revert', '--no-commit', ...(p.merge ? ['-m', '1'] : []), p.sha])
    const un = r.exitCode ? (await git(h.run, wt, ['diff', '--name-only', '--diff-filter=U'])).split('\n').filter(Boolean) : [], bad = un.filter(f => f !== cl)   // the changelog is cadre's: later releases changed it, so it never blocks a revert
    const why = r.exitCode && (bad.length || !un.length) ? (bad.length ? `reverting ${p.id} conflicts with what landed after it, in ${bad.join(', ')}` : `reverting ${p.id} failed: ${r.stderr.trim().slice(-200)}`) : ''
    if (!why) {   // the changelog stays as dev has it, plus one Removed line
      await h.run(['git', '-C', wt, 'checkout', 'HEAD', '--', cl]); const text = await h.readText(`${wt}/${cl}`)
      if (text !== null) await h.write(`${wt}/${cl}`, insert(text, 'Removed', `Reverted: ${p.title}`, p.id))
      await git(h.run, wt, ['add', '-A']); await git(h.run, wt, ['commit', '--no-verify', '-m', `revert ${p.id}: ${p.title}`])
    } else await h.run(['git', '-C', wt, 'revert', '--abort'])
    await worktreeRemove(h.run, root, wt, why ? rb : undefined)
    return why
  }), stop = async (why: string) => { await worktreeRemove(h.run, root, tmp, rb).catch(() => {}); await NO(h, p.id, why); return `refused: ${why}` }
  if (rv) { await NO(h, p.id, rv); return `refused: ${rv}` }
  let m: { sha: string; devTip: string }
  try { m = await mergeEpic(h, { dev: p.on, epic: rb, tmp, msg: `revert ${p.id}: ${p.title}` }) } catch (e) { return stop((e as Error).message) }
  const red = await runSuites(h, cfg, tmp, (await git(h.run, tmp, ['diff', '--name-only', `${m.devTip}..${m.sha}`])).split('\n').filter(Boolean), p.id); if (red) return stop(red)
  if (!(await landDev(h, { dev: p.on, sha: m.sha, old: m.devTip, tmp, epic: rb }))) return stop(`${p.on} moved during the revert; try again`)
  await offer(h, p.on)   // the user has it checked out: the revert waits for them like any landing
  const rec = await store.record('decision', `reverted ${p.id}: ${p.title}`, p.lines.join('\n'), p.id)
  await store.setMeta(rec, { 'cadre.revert': p.id, 'cadre.branch': rb }, 'cadre'); await store.setMeta(p.id, { 'cadre.reverted': rec }, 'cadre')
  const r = await drop(h, p), mark = new Set(p.ids); await h.board.update(b => ({ ...b, tasks: b.tasks.map(x => (mark.has(x.id) && !x.flags.includes('reverted') ? { ...x, flags: [...x.flags, 'reverted'] } : x)) }))   // the pane shows it
  return `${p.id} reverted: ${p.on} has the revert (${m.sha.slice(0, 7)}); ${dropText(r)}`
  } catch (e) { await worktreeRemove(h.run, root, wt, rb).catch(() => {}); await worktreeRemove(h.run, root, tmp, rb).catch(() => {}); throw e }   // a throw leaves no worktree or branch of ours
}

// the pane's press opens the card (confirm 1); its answer asks again (confirm 2); only that answer reverts. `first`/`yes` need their own decision on the board, whoever sends them.
ROUTES.revert = async (h, c) => {
  const [id = '', step = ''] = c.args, say = (t: string) => ({ text: modelText('context', t) })
  try {
    if (step === 'cancel' || step === 'dismiss') { await settle(h, `revert:${id}`, `revert-sure:${id}`, `revert-fail:${id}`); return say('nothing reverted') }
    const p = await planOf(h, id), hash = fnv1a64(JSON.stringify([p.sha, p.on, await tip(h.run, await h.cwd(), await baseOf(h, p.on)).catch(() => ''), p.branches, p.lines]))   // dev, the branches and the preview: a change between the confirms refuses the second
    const what = p.sha ? `${id} ${p.title}: revert it on ${p.on}?` : `${id} ${p.title}: abandon it?`, standing = async (k: string) => ((await h.board.read()).decisions ?? []).find(d => d.id === `${k}:${id}`)
    const card = async () => {
      await settle(h, `revert-sure:${id}`)
      await ask(h, { id: `revert:${id}`, kind: 'revert', title: what, short: `revert ${id}?`, hash, tab: 'epic', sel: id, lines: p.lines, options: [{ key: p.sha ? 'c' : 'a', label: p.sha ? 'Revert to this point' : 'Abandon it', verb: 'approve', run: `revert ${id} first` }, { key: 'x', label: 'Keep it', verb: 'reject', run: `revert ${id} cancel` }] })
    }
    if (!step) { await card(); return say(`${id}: the card is in the dialog (press 1)`) }
    const d = step === 'first' || step === 'yes' ? await standing(step === 'first' ? 'revert' : 'revert-sure') : undefined
    if (!d) return say(`refused: ${id} is not confirmed; open its card and answer both dialogs`)
    if (d.hash !== hash) { await card(); return say(`refused: ${id} changed since the card; review it again (press 1)`) }
    if (step === 'first') {
      await settle(h, `revert:${id}`)
      await ask(h, { id: `revert-sure:${id}`, kind: 'revert', title: `Really? ${what}`, short: `revert ${id}: sure?`, hash, tab: 'epic', sel: id, lines: [p.sha ? 'It lands as new revert commits, through the checks.' : 'The branches cannot be brought back.', ...p.lines.slice(3, 6)], options: [{ key: p.sha ? 'y' : 'z', label: p.sha ? 'Yes, revert it' : 'Yes, abandon it', verb: 'approve', run: `revert ${id} yes` }, { key: 'x', label: 'Cancel', verb: 'reject', run: `revert ${id} cancel` }] })
      return say(`${id}: one more confirm in the dialog (press 1)`)
    }
    if (step === 'yes') { await settle(h, `revert-sure:${id}`); return say(await perform(h, p)) }
    return say(`refused: unknown step ${step}`)
  } catch (e) { if (e instanceof RevertRefusal) return say(`refused (${e.code}): ${e.message}`); throw e }
}
