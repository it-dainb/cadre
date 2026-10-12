import { sc, dec } from './base'
import { view } from '../tests/fixtures/ui/epic'
export default sc('epic landed on dev; release v1.4.0 proposed (1: the dialog, Release or Not now)', view(95, { ui: { ctx: 41, rel: 'v1.4.0' }, board: { cost: { tokens: 1, cachePct: 88 }, decisions: [dec('release:1.4.0', 'release', 'release v1.4.0?', ['dev merges into main with an annotated tag v1.4.0'], [{ key: 'r', label: 'Release', verb: 'release', run: 'release 1.4.0' }])] } }))
