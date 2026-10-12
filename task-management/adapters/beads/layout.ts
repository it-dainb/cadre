// Where the task store lives. New repos: <repo>/.cadre/store (every bd call carries BEADS_DIR). Legacy repos keep <repo>/.beads until the human
// confirms the move (doctor). Plain bd with no BEADS_DIR finds .beads by itself, so the legacy answer is "no dir".
import type { Host } from '../../../types'
import type { TaskStore } from '../../store'

export const STORE = '.cadre/store'
export const EXCLUDE_NEW = ['.cadre/store/', '.cadre/store.gate.lock']   // bd keeps its gate lock next to the store folder
export const dirOf = async (h: Host, root: string): Promise<string | undefined> =>
  !(await h.stat(`${root}/${STORE}`)) && (await h.stat(`${root}/.beads`)) ? undefined : `${root}/${STORE}`
export const legacy = async (h: Host, root: string): Promise<boolean> => (await dirOf(h, root)) === undefined

// .git/info/exclude path and the lines it lacks
export async function excludeFile(h: Host, root: string): Promise<{ path: string; have: string[] }> {
  const p = (await h.run(['git', 'rev-parse', '--git-path', 'info/exclude'], { cwd: root })).stdout.trim(), path = p.startsWith('/') ? p : `${root}/${p}`
  return { path, have: ((await h.readText(path)) ?? '').split('\n') }
}

// The one-time move (mod-run, human-confirmed): refuses while a task runs, mv, re-probe, roll back on any failure. Returns a one-line answer.
export async function moveStore(h: Host, root: string, open: (dir?: string) => TaskStore): Promise<string> {
  if (!(await legacy(h, root))) return 'the task store is already in .cadre/store'
  const run = (...a: string[]) => h.run(a, { cwd: root })
  const busy = (await open().list({})).filter(t => ['active', 'review'].includes(t.category))
  if (busy.length) return `not moved: ${busy.length} task(s) are running (${busy.slice(0, 3).map(t => t.id).join(', ')}); stop them first`
  const from = `${root}/.beads`, to = `${root}/${STORE}`
  const back = async () => { await run('mv', to, from) }
  if ((await run('mkdir', '-p', `${root}/.cadre`)).exitCode || (await run('mv', from, to)).exitCode) return 'not moved: could not move .beads'
  const p = await open(to).probe().catch(() => ({ ok: false }))
  if (!p.ok) { await back(); return 'not moved: the store did not answer from its new place; it is back in .beads' }
  await run('rm', '-f', `${root}/.beads.gate.lock`)   // the old store's lock file stays behind; bd makes .cadre/store.gate.lock
  const { path, have } = await excludeFile(h, root), add = EXCLUDE_NEW.filter(l => !have.includes(l))
  if (add.length) await h.write(path, `${have.join('\n').replace(/\n*$/, '\n')}${add.join('\n')}\n`)
  return 'task store moved to .cadre/store'
}
