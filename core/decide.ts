// How to ask the human (ADR 0008, 0012, CONTRACTS): `ask` puts a Decision on the board (human view), `settle` clears it. The native dialog answers any Decision (ui/index.answerDialog
// -> core/dispatch.answer); the pane lists it read-only (ui/needs). Every human-in-the-loop phase calls ask when it needs the human and settle when it is answered; none draws UI.
import type { Decision, Host, Snapshot } from '../types'

// yolo while it runs (core/drive): main decides spec changes and blocked questions, so they never become a decision for the human
export const yoloOn = (d: Snapshot['drive']): boolean => d.on && !d.stopped && d.mode === 'yolo'
// the id without its instance parts (task, plan, version, stage...): flag:t1:conflict -> flag.conflict, run:init -> run.init, plan:p1 -> plan
const keyOf = (id: string) => {
  const [a, , c] = id.split(':')
  return a === 'flag' && c ? `flag.${c}` : id === 'init:goal' || id === 'goal:held' || (a === 'run' && id.split(':').length === 2) || id.startsWith('cfg:') ? id.replace(':', '.') : a === 'init' ? 'init.stage' : a
}
export const ask = async (h: Host, d0: Decision): Promise<void> => {
  const d = { ...d0, key: d0.key ?? keyOf(d0.id) }
  await h.board.update(b => { const l = b.decisions ?? [], i = l.findIndex(x => x.id === d.id); return { ...b, decisions: i < 0 ? [...l, d] : l.map((x, j) => (j === i ? d : x)) } })   // replace keeps its place in the queue
}
export const settle = async (h: Host, ...ids: string[]): Promise<void> => {
  const on = ids.filter(Boolean); if (!on.length || !((await h.board.read()).decisions ?? []).some(d => on.includes(d.id))) return
  await h.board.update(b => ({ ...b, decisions: (b.decisions ?? []).filter(d => !on.includes(d.id)) }))
}
export const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`
export const settleIf = async (h: Host, pre: string): Promise<void> => settle(h, ...((await h.board.read()).decisions ?? []).filter(d => d.id.startsWith(pre)).map(d => d.id))
