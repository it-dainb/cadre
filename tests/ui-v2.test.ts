// UI v2 band, frame and board (TUI-DESIGN §3-§5): the band in its states, the keys, the states that replace the board.
import { describe, expect, test } from 'claude-code/testing'
import { SCENARIOS } from '../scenarios/index'
import { band } from '../ui/band'
import { pane } from '../ui/pane'
import { txt } from '../ui/model'
import { NOOP } from './fixtures/ui/epic'

const calls: string[] = []
const A = { ...NOOP, drive: (w: string) => calls.push(w), answer: (id: string) => calls.push(`answer ${id}`) }
const flat = (s: string, w: number, tab = 'board') => { const v = { ...SCENARIOS[s], ui: { ...SCENARIOS[s].ui, tab } }, p = pane(v, w, 40, A); return txt([...p.before, ...p.after]) }

describe('band v2', () => {
  test('working: now line, drive cell with 2: stop; nothing when dormant', () => {
    const l = txt(band(SCENARIOS['v2-driving-yolo'], 120, A))
    expect(l[0]).toMatch(/^› a2 Session refresh · implement · 23m +p3 auth-login · 4\/7$/)
    expect(l[1]).toMatch(/^yolo · turn 31\/100 · \$4\.70 +2: stop$/)
    expect(band(SCENARIOS['v2-dormant'], 120, A)).toEqual([])
  })
  test('needs you: line 2 with 1: answer; stopped: 2: resume; problem replaces line 1', () => {
    expect(txt(band(SCENARIOS['v2-board'], 100, A))[1]).toMatch(/^! NEEDS YOU · .* 1: answer$/)
    expect(txt(band(SCENARIOS['v2-stopped'], 100, A))[1]).toMatch(/stopped · turn limit reached +2: resume$/)
    expect(txt(band(SCENARIOS['v2-degraded'], 100, A))[0]).toContain('containment degraded · /cadre doctor')
    band(SCENARIOS['v2-stopped'], 100, A).flat().find(s => s.hk === '2')!.p!()
    expect(calls).toContain('resume')
  })
  test('narrow tier', () => {
    const l = txt(band(SCENARIOS['v2-driving-yolo'], 40, A))
    expect(l[0]).toBe('› a2 · 4/7')
  })
})

describe('frame + board', () => {
  test('board sections in order; wide has the inspector beside', () => {
    const t = flat('v2-big-epic', 120).join('\n')
    expect(['Agents', 'Running', 'Waiting', 'Done'].map(x => t.indexOf(x))).toEqual([...['Agents', 'Running', 'Waiting', 'Done'].map(x => t.indexOf(x))].sort((a, b) => a - b))
    expect(t).toContain('ctx ')
    expect(flat('v2-big-epic', 60).join('\n')).not.toContain('ctx ')
  })
  test('states: dormant, no plan, run checklist', () => {
    expect(flat('v2-dormant', 80).join('\n')).toContain('cadre is off in this repo · /cadre init')
    expect(flat('v2-no-plan', 80).join('\n')).toContain('no tasks yet · /cadre <goal> to start')
    expect(flat('v2-run', 80).join('\n')).toContain('init is running')
  })
  test('a view that throws draws the fallback line', () => {
    const v = { ...SCENARIOS['v2-board'], b: { ...SCENARIOS['v2-board'].b, tasks: null as never }, ui: { cfg: { v2: true }, tab: 'graph' } }
    expect(txt(pane(v, 80, 40, A).before).join('\n')).toContain("couldn't draw this view · /cadre doctor")
  })
  test('key sheet and tab row', () => {
    const v = { ...SCENARIOS['v2-driving-yolo'], ui: { ...SCENARIOS['v2-driving-yolo'].ui, ks: true } }
    expect(txt(pane(v, 80, 40, A).before).join('\n')).toContain('switch view')
    expect(flat('v2-driving-yolo', 80)[0]).toBe('1: Board  2: Graph  3: Timeline  4: Activity  8: Doctor  9: Settings')
  })
})
