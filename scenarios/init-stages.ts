import { bare, dec } from './base'
export default bare('/cadre init in flight: stages 1-2 done, stage 3 proposes a diff; the Doctor tab shows a report (key 8)', {
  mission: 'Auth v2', init: [{ stage: 1, state: 'done' }, { stage: 2, state: 'done' }, { stage: 3, state: 'proposed' }, { stage: 4, state: 'pending' }],
  containment: { state: 'degraded', unsandboxed: 2 },
  decisions: [dec('init:3', 'init', 'init stage 3 discovery ready · confirm it', ['stage 3 discovery: proposed changes', '  + types.docs', '  + suites.unit', '  ~ gates.lint'], [{ key: 'a', label: 'Confirm', verb: 'approve', run: 'init confirm' }, { key: 'x', label: 'Cancel', verb: 'reject', run: 'init cancel' }, { key: 'c', label: 'Change', verb: 'change', run: 'init 3' }])],
}, { ui: { 'doctor.rows': [['ok', 'git identity set'], ['warn', 'bd 1.0.2 is older than 1.0.3', '/cadre setup'], ['crit', 'containment degraded: 2 unsandboxed tools', '/cadre init']] } })
