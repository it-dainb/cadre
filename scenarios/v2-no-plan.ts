import { bare } from './base'
const b = bare('v2: cadre on, no plan yet', { mission: 'Auth v2' }, { ui: { cfg: { v2: true } } })
export default { ...b, sec: { active: true } }
