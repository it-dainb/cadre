// v2 pane views (graph, timeline, activity, doctor, settings): fit every width, use only BRAND glyphs, honour ui.density and ASCII.
import { describe, expect, test } from 'claude-code/testing'
import { SCENARIOS } from '../scenarios/index'
import { txt } from '../ui/model'
import { ALLOWED } from '../ui/tokens'
import { width } from '../ui/layout'
import { graph } from '../ui/views/graph'
import { timeline } from '../ui/views/timeline'
import { activity } from '../ui/views/activity'
import { doctor } from '../ui/views/doctor'
import { settings } from '../ui/views/settings'
import { NOOP } from './fixtures/ui/epic'

const VIEWS = { graph, timeline, activity, doctor, settings }, WIDTHS = [40, 60, 80, 120, 160]
const lines = (o: ReturnType<typeof graph>) => [...txt(o.lines), ...txt([o.keys])].map(l => l.trimEnd())
const odd = (ls: string[]) => [...new Set([...ls.join('').replace(/\s/g, '')].filter(ch => ch.charCodeAt(0) > 126 && !ALLOWED.has(ch)))]

describe('v2 views', () => {
  for (const [name, s] of Object.entries(SCENARIOS)) test(name, () => {
    for (const [vn, f] of Object.entries(VIEWS)) for (const w of WIDTHS) for (const ascii of [false, true]) {
      const v = { ...s, ui: { ...s.ui, cfg: { v2: true, ascii } } }, o = f(v, w, 30, NOOP), ls = lines(o), at = `${name} ${vn} ${w} ${ascii}`
      expect([at, ls.filter(l => width(l) > w)]).toEqual([at, []])
      expect([at, odd(ls)]).toEqual([at, []])
      if (ascii) expect([at, ls.join('').match(/[^\x00-\x7e…—·›]/g)?.filter(ch => !ALLOWED.has(ch) || ch.charCodeAt(0) > 126 && !'…—·›'.includes(ch))]).toEqual([at, undefined])
    }
  })
  test('density: compact has no blank rows, relaxed has more rows than normal', () => {
    const n = (density: string) => doctor({ ...SCENARIOS['doctor-drive-stopped'], ui: { ...SCENARIOS['doctor-drive-stopped'].ui, cfg: { v2: true, density } } }, 80, 60, NOOP).lines
    expect(txt(n('compact')).filter(l => !l.trim())).toEqual([])
    expect(n('relaxed').length).toBeGreaterThan(n('normal').length)
  })
  test('timeline: only lanes that had activity, plain names; narrow shows activity only', () => {
    const v = { ...SCENARIOS['timeline-multi'], ui: { cfg: { v2: true } } }
    expect(timeline(v, 120, 30, NOOP).raster?.rows).toBe(7)   // axis + tester, worker 1, worker 2, reviewer, explorer, sync
    expect(timeline(v, 59, 30, NOOP).raster).toBeUndefined()
    expect(timeline({ ...SCENARIOS['empty-dormant'], ui: { cfg: { v2: true } } }, 120, 30, NOOP).raster).toBeUndefined()
  })
  test('activity: plain sentences, no heartbeat; the drive decision text and pauses are included', () => {
    const t = txt(activity(SCENARIOS['activity-drive'], 120, 40, NOOP).lines).join('\n')
    expect(t).toContain('accepted the spec change on a2'); expect(t).toContain('drive paused: approve p3 release notes')
    expect(t).not.toMatch(/phase|heartbeat|agent\./)
  })
})
