// How to ask the human (ADR 0008, 0012, CONTRACTS): `ask` puts a Decision on the board (human view), `settle` clears it. The native dialog answers any Decision (ui/index.answerDialog
// -> core/dispatch.answer); the pane lists it read-only (ui/needs). Every human-in-the-loop phase calls ask when it needs the human and settle when it is answered; none draws UI.
import type { Decision, Host, Snapshot } from '../types'

// yolo while it runs (core/drive): main decides spec changes and blocked questions, so they never become a decision for the human
export const yoloOn = (d: Snapshot['drive']): boolean => d.on && !d.stopped && d.mode === 'yolo'
export const BLOCKING = /^(git:|external$|drift$|conflict$|lost-|integration-failed$)/   // core/machine re-exports it (events needs it without a load cycle)
// the flags drive holds on (core/drive.gate): under yolo only these become a decision for the human; the rest stay on the task, recorded (yolo: zero dialogs after approval)
export const holds = (flag: string): boolean => BLOCKING.test(flag) || flag === 'red' || flag.startsWith('rework:') || flag.startsWith('quarantine')   // red: tests that cannot be made red are the human's (core/close.redAsk)

// the id without its instance parts (task, plan, version, stage...): flag:t1:conflict -> flag.conflict, run:init -> run.init, plan:p1 -> plan
const keyOf = (id: string) => /^(flag):[^:]*:([^:]+)/.exec(id)?.slice(1).join('.') ?? (/^(init:goal|run:\w+|cfg:.+|goal:held)$/.test(id) ? id.replace(':', '.') : id.split(':')[0] === 'init' ? 'init.stage' : id.split(':')[0])
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

// a flag raised on a task / the epic / a git ref (core/events.emit calls this for every flag.raised; a phase that knows more asks first under the same id and wins)
export const RESTART = ['attempts', 'no-report', 'stagnant', 'stale', 'loop', 'blocked']   // an agent that stopped for good: Keep going restarts the task with a fresh agent (core/close ROUTES.resolve)
const O = (key: string, label: string, run: string, verb = 'keep') => ({ key, label, verb, run })
export function flagDecision(taskId: string, flag: string, title?: string): Decision | null {
  if (flag === 'lost-wip') return null   // released automatically, nothing to decide
  const git = flag.startsWith('git:') || flag.startsWith('quarantine'), r = (how: string) => `resolve ${taskId} ${how}`
  const options = git ? [O('r', 'Restore', `resolve git restore ${flag}`, 'restore'), O('k', 'Keep', `resolve git keep ${flag}`)]
    : flag === 'spec_change' ? [O('a', 'Accept', r('accept'), 'accept'), O('x', 'Reject', r('reject'), 'reject')]
    : flag === 'shape' ? [O('r', 'Retry', r('retry'), 'accept'), O('x', 'Cancel task', r('cancel'), 'cancel')]
    : flag === 'lost-epic' ? [O('r', 'Re-cut', r('recut'), 'restore'), O('x', 'End epic', r('cancel'), 'cancel')]
    : [...(flag === 'conflict' || flag === 'drift' ? [O('a', 'Accept', r('accept'), 'accept')] : []), O('k', RESTART.includes(flag) ? 'Keep going' : 'Keep', r('keep')), ...(flag === 'integration-failed' ? [] : [O('x', 'Cancel task', r('cancel'), 'cancel')])]
  const text = git ? `${flag} · ${flag.split(':')[1] ?? flag} moved outside a cadre merge · merges blocked` : `${taskId} flagged ${flag}`
  const why = git ? 'a branch moved outside a cadre merge. Restore: the tip is saved under refs/cadre/quarantine and the branch goes back. Keep: accept the move.'
    : flag === 'spec_change' ? 'the worker asks to change the locked spec. Accept: the tester amends it and a new red follows. Reject: it conforms to the locked tests.'
    : flag === 'shape' ? 'its agent kept sending reports in a wrong form (an over-long value, an unknown field, a wrong type). Retry: it starts again. Cancel task ends it.'
    : flag === 'lost-epic' ? 'the epic branch is gone. Re-cut it from dev, or end the epic.' : RESTART.includes(flag) ? `${flag}: Keep going: a fresh agent continues from the last checkpoint. Cancel task ends it.` : `${flag}: Keep accepts the state${options.some(o => o.verb === 'cancel') ? ', Cancel task ends it' : ''}.`
  return { id: `flag:${taskId}:${flag}`, kind: 'flag', title: text, short: git ? `${flag} moved` : undefined, lines: [...(title && title !== taskId ? [title] : []), why], hash: flag, options, tab: 'epic', sel: git ? undefined : taskId, crit: git }   // the id is in the title: each fact once
}

