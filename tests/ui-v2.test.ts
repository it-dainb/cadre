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
  test('working: now line, drive cell with 0: stop; nothing when dormant', () => {
    const l = txt(band(SCENARIOS['v2-driving-yolo'], 120, A))
    expect(l[0]).toMatch(/^› a2 Session refresh · implement · 23m +p3 auth-login · 4\/7$/)
    expect(l[1]).toMatch(/^yolo · turn 31\/100 · \$4\.70 +0: stop$/)
    expect(band(SCENARIOS['v2-dormant'], 120, A)).toEqual([])
  })
  test('needs you: line 2 with 1: answer; stopped: 0: resume; problem replaces line 1', () => {
    expect(txt(band(SCENARIOS['v2-board'], 100, A))[1]).toMatch(/^! NEEDS YOU · .* 1: answer$/)
    expect(txt(band(SCENARIOS['v2-stopped'], 100, A))[1]).toMatch(/stopped · turn limit reached +0: resume$/)
    expect(txt(band(SCENARIOS['v2-degraded'], 100, A))[0]).toContain('containment degraded · /cadre doctor')
    band(SCENARIOS['v2-stopped'], 100, A).flat().find(s => s.hk === '0')!.p!()
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
    expect(flat('v2-dormant', 80).join('\n')).toContain('Ready when you are · /cadre <goal> to start')
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

// 0.9.0 fix round (design review must-fixes 1-4, should-fixes)
const SC = SCENARIOS
const bandTxt = (s: string, w: number) => txt(band(SC[s], w, A)).join('\n')
describe('docked band (must 1)', () => {
  test('at 24 and 30 cells every scenario fits; the key and the "+N more" count are never cut', () => {
    for (const [n, s] of Object.entries(SC)) for (const w of [20, 24, 30, 40]) {
      const l = txt(band(s, w, A)); expect([n, w, l.filter(x => [...x].length > w)]).toEqual([n, w, []])
    }
    const two = { ...SC['flags'], ui: {} }, l = txt(band(two, 24, A)).join('\n')
    expect(l).toMatch(/\+\d+ more/); expect(l).toContain('1: answer')
    expect(bandTxt('v2-board', 24)).toContain('1: answer')
  })
  test('drive cell at 24 cells keeps its key (0)', () => { expect(bandTxt('v2-driving-yolo', 24)).toMatch(/0: stop$/) })
})
describe('init run is progress (must 2)', () => {
  test('no NEEDS YOU, no key 1, no warning mark on the band or the board; the checklist sits under the header', () => {
    const b = band(SC['v2-run'], 60, A)
    expect(txt(b).join('\n')).toBe('> init is running · Claude is on it'.replace('>', '›'))
    expect(b.flat().some(s => s.hk)).toBe(false)
    const t = flat('v2-run', 60).join('\n')
    expect(t).not.toContain('NEEDS YOU'); expect(t).not.toContain('1: answer')
    expect(t.indexOf('no plan yet')).toBeLessThan(t.indexOf('git identity'))
  })
})
describe('tab row (must 3)', () => {
  test('the current tab is inverse; "!" is a separate mark; 1 stays plain text while a decision waits', () => {
    const row = pane(SC['v2-board'], 80, 40, A).before[0]
    expect(row.filter(s => s.i).map(s => s.t)).toEqual(['1: Board'])
    expect(row.find(s => s.t === ' !')).toBeTruthy()
    const g = pane({ ...SC['v2-driving-yolo'], ui: { ...SC['v2-driving-yolo'].ui, tab: 'graph' } }, 60, 40, A).before[0]
    expect(g.filter(s => s.i).map(s => s.t)).toEqual(['Graph'])
    expect(txt([pane({ ...SC['v2-board'], ui: { tab: 'graph' } }, 40, 40, A).before[0]])[0].length).toBeLessThanOrEqual(40)
  })
})
describe('should-fix', () => {
  test('replay shows no live decision and no 1: answer (the band stays live)', () => {
    const t = flat('v2-replay', 120).join('\n')
    expect(t).not.toContain('NEEDS YOU'); expect(t).not.toContain('answer'); expect(t).toContain('replay')
    expect(bandTxt('v2-replay', 120)).toContain('1: answer')
  })
  test('a short inline pane draws the one-line decision form and keeps the footer', () => {
    const s = SC['v2-inline-decision'], p = pane(s, 60, s.rows!, A), t = txt([...p.before, ...p.after])
    expect(t.filter(l => /^\s*!/.test(l))).toHaveLength(1)
    expect(t.at(-1)).toContain('k: keys')
    expect(t.length).toBeLessThanOrEqual(s.rows! + 6)
  })
  test('a decision shows at most two detail lines on a short pane; no "!" inside a body; a command shows as "$ command"', () => {
    const t = flat('setup-sudo-and-fields', 120).join('\n')
    expect(t).not.toMatch(/^ {4,}!/m); expect(t).toContain('$ sudo')
    expect(txt(pane(SC['setup-sudo-and-fields'], 120, 12, A).before).join('\n')).not.toContain('$ sudo')   // short pane: the one-line form
  })
  test('drive stops: a limit is not a failure; the header does not repeat the drive reason', () => {
    expect(band(SC['v2-stopped'], 100, A)[1][0].c).toBe('inactive')
    expect(flat('v2-stopped', 100)[1]).not.toContain('drive stopped')
  })
  test('Done counts what is done, skipped on its own; the tail never ends on a bare section title', () => {
    const t = flat('v2-board', 120).join('\n'), n = txt(band(SC['v2-board'], 120, A)).join('').match(/(\d+)\/\d+/)![1]
    expect(t).toContain(`Done  ${n} · 1 skipped`)   // the count is the progress numerator
    const s = SC['settings'], p = txt(pane({ ...s, ui: { ...s.ui, tab: 'settings' } }, 80, 12, A).before)
    p.forEach((l, i) => { if (/^\s*\+\d+ more$/.test(l)) expect(/^(Workflow|Agents & models|Drive|Cost|Sync|UI|Security)$/.test(p[i - 1].trim())).toBe(false) })
  })
  test('timeline: the legend names the blocks; plain words: no code tokens', () => {
    expect(flat('timeline-multi', 120, 'timeline').join('\n')).toContain('█ work  ▓ review  ░ offline')
    for (const n of Object.keys(SC)) expect([n, flat(n, 120).join('\n').match(/git:\w+:\w+|spec_change|\bpm\b|agent\(s\)/)]).toEqual([n, null])
  })
})
