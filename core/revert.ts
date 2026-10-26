// H9 revert to this point (1.0). A landed task, epic or milestone is undone by revert commits made on a cadre branch and landed through the integrate primitives
// (mergeEpic, the suites, landDev -> move, all inside op): dev is never moved by anything else. A target that never landed is abandoned: its recorded branches go.
// Two confirms (revert: -> revert-sure:); a revert is a store record, and a record is never reverted. Branches are found by the ids the store recorded, never by name.
import type { Host } from '../types'
import type { Task, TaskStore } from '../task-management/store'
import { fnv1a64 } from './board'
import { ROUTES, cfgOf, storeOf } from './dispatch'
import { ask, settle } from './decide'
import { git, exists, op, worktreeAdd, worktreeRemove } from './git'
import { baseOf, landDev, mergeEpic, wtPath, wtRootOf } from './branches'
import { offer, runSuites } from './integrate'
import { repoKeyOf } from '../commands/init'
import { reportOf } from './close'
import { modelText } from './say'

export type RevertCode = 'unknown' | 'revert-of-revert' | 'already-reverted' | 'not-landed'   // declared: a refusal carries its code, never read from its text
export class RevertRefusal extends Error { constructor(readonly code: RevertCode, msg: string) { super(msg) } }
type Plan = { id: string; title: string; on: string; sha: string; merge: boolean; branches: string[]; lines: string[] }

const subtree = async (store: TaskStore, id: string): Promise<Task[]> => { const c = await store.list({ parent: id }); return [...c, ...(await Promise.all(c.map(x => subtree(store, x.id)))).flat()] }
// the branches the store (or, for the current plan, the board) recorded for the target and everything under it
async function recorded(h: Host, store: TaskStore, t: Task): Promise<string[]> {
  const p = (await h.board.read()).plan
  return [...new Set([p?.id === t.id ? p.epicBranch : t.meta['cadre.branch'], ...(await subtree(store, t.id)).map(x => x.meta['cadre.branch'])].filter(Boolean))]
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
  const branches = await recorded(h, store, t), live = (await Promise.all(branches.map(async b => ((await exists(h.run, root, b)) ? b : '')))).filter(Boolean)
  const on = sha && (await exists(h.run, root, lb)) ? lb : dev
  const sibs = t.parent ? await store.list({ parent: t.parent }) : [], later = new Set<string>()
  const grow = (x: string): void => { for (const s of sibs) if (!later.has(s.id) && s.category !== 'cancelled' && s.deps.some(d => d.id === x)) { later.add(s.id); grow(s.id) } }; grow(id)
  let files: string[] = [], commits: string[] = []
  if (sha) { files = (await git(h.run, root, ['diff', '--name-only', `${sha}^`, sha])).split('\n').filter(Boolean); commits = (await git(h.run, root, ['log', '--format=%h %s', `${sha}^..${sha}`])).split('\n').filter(Boolean) }
  else if (t.type === 'epic' && live.length) { const b = live[0]; files = (await git(h.run, root, ['diff', '--name-only', `${dev}...${b}`])).split('\n').filter(Boolean); commits = (await git(h.run, root, ['log', '--format=%h %s', `${dev}..${b}`])).split('\n').filter(Boolean) }
  else return no('not-landed', `${id} has not landed, and has no branch to abandon`)
  const ce = t.meta['cadre.changelog'] ? JSON.parse(t.meta['cadre.changelog']) : null, list = (xs: string[]) => (xs.length ? xs.slice(0, 5).join(', ') + (xs.length > 5 ? ` +${xs.length - 5}` : '') : 'none')
  const lines = [`changelog: ${ce?.entry ?? 'none'}`, `summary: ${reportOf(t.meta['cadre.report']).summary || t.description.slice(0, 120) || 'none'}`,
    `result: ${sha ? `landed ${sha.slice(0, 7)} on ${on}` : 'never landed; its branches are removed'} · tests: ${t.meta['cadre.checks'] || 'none recorded'}`,
    `files lost (${files.length}): ${list(files)}`, `commits (${commits.length}): ${list(commits.map(c => c.split(' ')[0]))}`, `later tasks that depend on it: ${list([...later])}`]
  return { id, title: t.title, on, sha, merge, branches: live, lines }
}

const NO = (h: Host, id: string, why: string) => ask(h, { id: `revert-fail:${id}`, kind: 'flag', title: `${id} was not reverted`, hash: fnv1a64(why), tab: 'epic', sel: id, lines: [why.slice(0, 300), 'Nothing changed.'], options: [{ key: 'k', label: 'Understood', verb: 'keep', run: `revert ${id} dismiss` }] })
// the recorded branches of the target and everything under it (a milestone: its epics' and tasks') go; others, whatever their names, stay
async function drop(h: Host, branches: string[]): Promise<void> { const root = await h.cwd(); for (const b of branches) await op(h, () => git(h.run, root, ['branch', '-D', b])).catch(x => h.log(`${b} stays: ${x}`)) }

async function perform(h: Host, p: Plan): Promise<string> {
  const [root, cfg, store] = [await h.cwd(), await cfgOf(h), await storeOf(h)]
  if (!p.sha) { await drop(h, p.branches); await store.setMeta(p.id, { 'cadre.reverted': 'abandoned' }, 'cadre'); return `${p.id} abandoned: ${p.branches.length} recorded branch${p.branches.length === 1 ? '' : 'es'} removed` }
  const gf = Object.keys((await h.git.read()).flags ?? {}).find(f => f.startsWith('git:')); if (gf) return `refused: git flag ${gf} is open; keep or restore it in the dialog first`
  const rb = `revert/${p.id}`, key = repoKeyOf(root), wt = wtPath(await wtRootOf(h, cfg), key, `rev-${p.id}`), tmp = wtPath(await wtRootOf(h, cfg), key, `int-rev-${p.id}`)
  const rv = await op(h, async () => {
    await worktreeAdd(h.run, root, wt, rb, await baseOf(h, p.on))
    const r = await h.run(['git', '-C', wt, 'revert', '--no-edit', ...(p.merge ? ['-m', '1'] : []), p.sha])
    if (r.exitCode) await h.run(['git', '-C', wt, 'revert', '--abort'])
    await worktreeRemove(h.run, root, wt, r.exitCode ? rb : undefined)
    return r.exitCode ? `reverting ${p.id} conflicts with what landed after it: ${`${r.stdout}\n${r.stderr}`.trim().slice(-200)}` : ''
  }), stop = async (why: string) => { await worktreeRemove(h.run, root, tmp, rb).catch(() => {}); await NO(h, p.id, why); return `refused: ${why}` }
  if (rv) { await NO(h, p.id, rv); return `refused: ${rv}` }
  let m: { sha: string; devTip: string }
  try { m = await mergeEpic(h, { dev: p.on, epic: rb, tmp, msg: `revert ${p.id}: ${p.title}` }) } catch (e) { return stop((e as Error).message) }
  const red = await runSuites(h, cfg, tmp, (await git(h.run, tmp, ['diff', '--name-only', `${m.devTip}..${m.sha}`])).split('\n').filter(Boolean), p.id); if (red) return stop(red)
  if (!(await landDev(h, { dev: p.on, sha: m.sha, old: m.devTip, tmp, epic: rb }))) return stop(`${p.on} moved during the revert; try again`)
  await offer(h, p.on)   // the user has it checked out: the revert waits for them like any landing
  const rec = await store.record('decision', `reverted ${p.id}: ${p.title}`, p.lines.join('\n'), p.id)
  await store.setMeta(rec, { 'cadre.revert': p.id, 'cadre.branch': rb }, 'cadre'); await store.setMeta(p.id, { 'cadre.reverted': rec }, 'cadre')
  await drop(h, p.branches)
  return `${p.id} reverted: ${p.on} has the revert (${m.sha.slice(0, 7)})`
}

// the pane's press opens the card (confirm 1); its answer asks again (confirm 2); only that answer reverts. `first`/`yes` need their own decision on the board, whoever sends them.
ROUTES.revert = async (h, c) => {
  const [id = '', step = ''] = c.args, say = (t: string) => ({ text: modelText('context', t) })
  try {
    if (step === 'cancel' || step === 'dismiss') { await settle(h, `revert:${id}`, `revert-sure:${id}`, `revert-fail:${id}`); return say('nothing reverted') }
    const p = await planOf(h, id)
    const on = async (k: string) => ((await h.board.read()).decisions ?? []).some(d => d.id === `${k}:${id}`)
    const hash = fnv1a64(`${p.sha}${p.branches}`), what = p.sha ? `${id} ${p.title}: revert it on ${p.on}?` : `${id} ${p.title}: abandon it?`
    if (!step) {
      await ask(h, { id: `revert:${id}`, kind: 'revert', title: what, short: `revert ${id}?`, hash, tab: 'epic', sel: id, lines: p.lines, options: [{ key: p.sha ? 'c' : 'a', label: p.sha ? 'Revert to this point' : 'Abandon it', verb: 'approve', run: `revert ${id} first` }, { key: 'x', label: 'Keep it', verb: 'reject', run: `revert ${id} cancel` }] })
      return say(`${id}: the card is in the dialog (press 1)`)
    }
    if (step === 'first' && (await on('revert'))) {
      await settle(h, `revert:${id}`)
      await ask(h, { id: `revert-sure:${id}`, kind: 'revert', title: `Really? ${what}`, short: `revert ${id}: sure?`, hash, tab: 'epic', sel: id, lines: [p.sha ? 'It lands as new revert commits, through the checks.' : 'The branches cannot be brought back.', ...p.lines.slice(3, 6)], options: [{ key: p.sha ? 'y' : 'z', label: p.sha ? 'Yes, revert it' : 'Yes, abandon it', verb: 'approve', run: `revert ${id} yes` }, { key: 'x', label: 'Cancel', verb: 'reject', run: `revert ${id} cancel` }] })
      return say(`${id}: one more confirm in the dialog (press 1)`)
    }
    if (step === 'yes' && (await on('revert-sure'))) { await settle(h, `revert-sure:${id}`); return say(await perform(h, p)) }
    return say(`refused: ${id} is not confirmed; open its card and answer both dialogs`)
  } catch (e) { if (e instanceof RevertRefusal) return say(`refused (${e.code}): ${e.message}`); throw e }
}
