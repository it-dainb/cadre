// How to ask the human (ADR 0008, CONTRACTS): `ask` puts a Decision on the board (human view), `settle` clears it. ui/card draws any Decision; a press is core's `press` (commands/cadre).
// Every human-in-the-loop phase calls ask when it needs the human and settle when it is answered; none draws UI.
import type { Decision, Host } from '../types'

export const ask = async (h: Host, d: Decision): Promise<void> => {
  await h.board.update(b => { const l = b.decisions ?? [], i = l.findIndex(x => x.id === d.id); return { ...b, decisions: i < 0 ? [...l, d] : l.map((x, j) => (j === i ? d : x)) } })   // replace keeps its place in the queue
}
export const settle = async (h: Host, ...ids: string[]): Promise<void> => {
  const on = ids.filter(Boolean); if (!on.length || !((await h.board.read()).decisions ?? []).some(d => on.includes(d.id))) return
  await h.board.update(b => ({ ...b, decisions: (b.decisions ?? []).filter(d => !on.includes(d.id)) }))
}
export const settleIf = async (h: Host, pre: string): Promise<void> => settle(h, ...((await h.board.read()).decisions ?? []).filter(d => d.id.startsWith(pre)).map(d => d.id))

// a flag raised on a task / the epic / a git ref (core/events.emit calls this for every flag.raised; a phase that knows more asks first under the same id and wins)
const O = (key: string, label: string, run: string, verb = 'keep') => ({ key, label, verb, run })
export function flagDecision(taskId: string, flag: string, title?: string): Decision | null {
  if (flag === 'lost-wip') return null   // released automatically, nothing to decide
  const git = flag.startsWith('git:') || flag.startsWith('quarantine'), r = (how: string) => `resolve ${taskId} ${how}`
  const options = git ? [O('r', 'Restore', `resolve git restore ${flag}`, 'restore'), O('k', 'Keep', `resolve git keep ${flag}`)]
    : flag === 'spec_change' ? [O('a', 'Accept', r('accept'), 'accept'), O('x', 'Reject', r('reject'), 'reject')]
    : flag === 'lost-epic' ? [O('r', 'Re-cut', r('recut'), 'restore'), O('x', 'End epic', r('cancel'), 'cancel')]
    : [...(flag === 'conflict' || flag === 'drift' ? [O('a', 'Accept', r('accept'), 'accept')] : []), O('k', 'Keep', r('keep')), ...(flag === 'integration-failed' ? [] : [O('x', 'Cancel task', r('cancel'), 'cancel')])]
  const text = git ? `${flag} · ${flag.split(':')[1] ?? flag} moved outside a cadre merge · merges blocked` : `${taskId} flagged ${flag}`
  const why = git ? 'a branch moved outside a cadre merge. Restore: the tip is saved under refs/cadre/quarantine and the branch goes back. Keep: accept the move.'
    : flag === 'spec_change' ? 'the worker asks to change the locked spec. Accept: the tester amends it and a new red follows. Reject: it conforms to the locked tests.'
    : flag === 'lost-epic' ? 'the epic branch is gone. Re-cut it from dev, or end the epic.' : `${flag}: Keep accepts the state${options.some(o => o.verb === 'cancel') ? ', Cancel task ends it' : ''}.`
  return { id: `flag:${taskId}:${flag}`, kind: 'flag', title: text, short: git ? `${flag} moved` : undefined, lines: [...(title ? [`${taskId} ${title}`] : []), why], hash: flag, options, tab: 'epic', sel: git ? undefined : taskId, crit: git }
}

