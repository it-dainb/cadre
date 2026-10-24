// UI v2 · Settings, Workspace units: each existing unit's scalar fields as settings rows (add and remove stay in init). A row's key is `units.<i>.<field>`;
// a press runs `config …` like any row and config/route writes .cadre/config.json (one write, .bak). Rendered by views/settings.
import type { Row } from '../../config/index'
import { RUNNERS, type Pkg } from '../../core/discover'

export const UNIT = /^units\.(\d+)\.(runner|concurrency|setup)$/
export const unitRows = (us: Pkg[]): Row[] => us.flatMap((u, i): Row[] => {
  const r = (f: string, kind: Row['kind'], value: unknown, def: unknown, desc: string, opts?: string[]): Row => ({ key: `units.${i}.${f}`, cat: 'Workspace units', cls: 'O', desc: `${u.root}: ${desc}`, safety: false, value, def, src: 'repo', kind, ...(opts ? { opts } : {}) })
  return [r('runner', 'enum', u.runner ?? 'junit', 'junit', 'junit reads a JUnit report, text reads the test output', [...RUNNERS]),
    r('concurrency', 'number', u.concurrency ?? 0, 0, 'tasks of this unit at once (0 = no unit cap)'),
    r('setup', 'text', JSON.stringify(u.setup ?? []), '[]', 'the setup command as a JSON argument list, e.g. ["npm","ci"]')]
})
