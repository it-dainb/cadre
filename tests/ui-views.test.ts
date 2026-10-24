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
import { rowsOf } from '../ui/settings'
import { configPress, refreshSettings } from '../config/route'
import { fakeHost } from './support'
const rowsOfFor = (s: any) => rowsOf({ ...s, ui: { ...s.ui, cfg: { v2: true } } } as any)

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
  test('settings: drive.mode carries its plain note when selected', () => {
    const s = SCENARIOS['settings-drive'], i = rowsOfFor(s).findIndex(r => r.key === 'drive.mode')
    expect(i).toBeGreaterThanOrEqual(0)
    const t = txt(settings({ ...s, ui: { ...s.ui, ssel: i, cfg: { v2: true } } }, 120, 40, NOOP).lines).join('\n')
    expect(t).toContain('yolo: no questions after approval')
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

describe('units rows (Settings, Workspace units)', () => {
  const REPO = '/repo/.cadre/config.json', U = [{ root: '.', setup: ['npm', 'ci'], checks: { test: ['npm', 'test'] } }, { root: 'api', checks: { test: ['go', 'test'] } }]
  test('one edit writes .cadre/config.json once, with the .bak; a bad value or an unknown model writes nothing', async () => {
    const files: Record<string, string> = { [REPO]: JSON.stringify({ units: U }) }, h = fakeHost({ files }), writes: string[] = [], w = h.write
    h.write = async (p: string, t: string) => { writes.push(p); return w(p, t) }
    await refreshSettings(h)
    expect(((await h.ui.read())['settings.rows'] as any[]).filter(r => r.key.startsWith('units.')).map(r => r.key)).toHaveLength(6)
    expect((await configPress(h, 'set units.1.runner text')).text).toBe('api runner = "text" · saved to the repo')
    expect(writes).toEqual([`${REPO}.bak`, REPO]); expect(JSON.parse(files[REPO]).units[1]).toEqual({ ...U[1], runner: 'text' }); expect(files[`${REPO}.bak`]).toBe(JSON.stringify({ units: U }))
    await configPress(h, 'set units.0.concurrency 2'); await configPress(h, 'set units.0.setup ["make","deps"]')
    expect(JSON.parse(files[REPO]).units[0]).toMatchObject({ concurrency: 2, setup: ['make', 'deps'] })
    writes.length = 0
    for (const bad of ['set units.0.runner xml', 'set units.0.concurrency -1', 'set units.0.setup nope', 'set units.9.runner text']) expect((await configPress(h, bad)).text).toMatch(/^refused: /)
    expect(writes).toEqual([])
  })
})

