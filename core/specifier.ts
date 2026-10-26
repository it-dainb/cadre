// The specifier (A1, default off: roles.specifier.enabled): one read-only run per task, before the task is claimed, that writes how-to notes for the worker. It never changes WHAT:
// its report has no scenario field (an unknown field is refused), and the one way to say the task is wrong is the declared deviation kind, which shows the human one dialog.
// State on the task: cadre.specified = running@<ms> while it works, done after; cadre.how = the notes (the worker's brief only: the tester's brief cannot take them).
import type { Host } from '../types'
import type { Deps } from './admission'
import { ask } from './decide'
import { askAnswer, askOf } from './asks'
import { modelText } from './say'

const STALE = 10 * 60_000   // a specifier that never answered (its session died) stops holding the task
const WHAT: Record<string, string> = {
  wrong_path: 'a file or folder the task names is not where the work belongs',
  scenario_conflict: 'two scenarios, or a scenario and the contract, cannot both hold',
  missing_dep: 'the task needs code that no earlier task provides',
}
// 'specify': start the specifier now · 'wait': one is running · 'claim': go on (off, done, or too old to wait for)
export async function specNeeded(h: Host, d: Deps, id: string): Promise<'specify' | 'wait' | 'claim'> {
  if (!d.cfg.roles.specifier.enabled) return 'claim'
  const m = (await d.store.get(id)).meta['cadre.specified']
  return m === undefined ? 'specify' : m === 'done' ? 'claim' : (await h.now()) - Number(m.split('@')[1]) > STALE ? 'claim' : 'wait'
}
export const specMark = async (h: Host, d: Deps, id: string, v?: 'done') => void (await d.store.setMeta(id, { 'cadre.specified': v ?? `running@${await h.now()}` }, d.actor))
// report{role:"specifier"} from its run (tools/index, after the envelope check)
export async function specAnswer(h: Host, d: Deps, agentId: string, r: { notes: string; deviation: string }): Promise<string> {
  const a = await askOf(h, agentId); if (!a?.task) return 'error: no task behind this run'
  await askAnswer(h, agentId, { answer: r.notes.trim() || r.deviation })   // answered: its stop is not nudged for a report it already made
  await d.store.setMeta(a.task, { 'cadre.specified': 'done', ...(r.notes.trim() ? { 'cadre.how': r.notes.trim() } : {}) }, d.actor)
  if (r.deviation !== 'none') {
    const t = (await h.board.read()).tasks.find(x => x.id === a.task)
    await ask(h, { id: `spec:${a.task}`, key: 'specifier', kind: 'flag', title: `${a.task}: the specifier found a problem with the task`, hash: a.task, tab: 'epic', sel: a.task,
      lines: [modelText('card', `${t?.title ?? a.task}: ${WHAT[r.deviation]}. The task goes on as planned; change the plan if it should not.`)], options: [{ key: 'k', label: 'OK', verb: 'keep' }] })
  }
  return 'notes recorded. Stop.'
}
// its turn ended (reported or not): the task is no longer held for it
export async function specSettle(h: Host, d: Deps, agentId: string): Promise<void> {
  const a = await askOf(h, agentId); if (a?.role === 'specifier' && a.task && (await d.store.get(a.task)).meta['cadre.specified'] !== 'done') await specMark(h, d, a.task, 'done')
}
