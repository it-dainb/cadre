import { bare, dec } from './base'
const b = bare('v2: /cadre init in flight: the run checklist replaces the board', {
  mission: 'Auth v2', init: [{ stage: 1, state: 'done' }, { stage: 2, state: 'proposed' }],
  decisions: [dec('run:init', 'init', 'init · 2/5 done · Claude is on it', ['✓ git identity', '✓ tools found', '… test commands: running', '· lint gate', '✗ containment: needs sudo'], [{ key: 'x', label: 'Cancel', verb: 'reject', run: 'init cancel' }])],
}, { ui: { cfg: { v2: true } } })
export default { ...b, sec: { active: true, run: { kind: 'init' as const, at: 1_000_000, turns: 1, follow: 0, guide: 'g' } } }
