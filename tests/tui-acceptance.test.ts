// TUI v2 acceptance (TUI-DESIGN §12) as specs. The frame checks run against the v2 renderers, so they are live once `ui.v2` defaults on;
// until then the lint functions themselves are pinned on known-good and known-bad frames, so the suite stays green on v1.
import { describe, expect, test } from 'claude-code/testing'
import { SCENARIOS } from '../scenarios/index'
import { band } from '../ui/band'
import { pane } from '../ui/pane'
import { txt } from '../ui/model'
import { ALLOWED } from '../ui/tokens'
import { width } from '../ui/layout'
import { defaults } from '../config/defaults'
import { NOOP } from './fixtures/ui/epic'

const WIDTHS = [40, 60, 80, 120, 160], TABS = ['epic', 'graph', 'timeline', 'activity', 'doctor', 'settings']
const LIVE = defaults().ui.v2   // flips with T4.2; to try v2 earlier, set the default locally

export const overflow = (lines: string[], w: number) => lines.filter(l => width(l) > w)
// a progress count (4/7), an elapsed time (23m, 1h05) or a ctx % (ctx 41%) shows at most once per frame
export const dupes = (lines: string[]) => {
  const seen = new Map<string, number>()
  for (const t of lines.join('\n').match(/\b\d+\/\d+\b|\bctx \d+%|(?<![\d/])\d+h\d\d\b|(?<![\d/])\d+m\b(?! ago)/g) ?? []) seen.set(t, (seen.get(t) ?? 0) + 1)
  return [...seen].filter(([, n]) => n > 1).map(([t]) => t)
}
export const wording = (lines: string[]) => lines.join('\n').match(/\b(w1|rev|syn|tst)\b|!<|!>|\b\d+m o\b/g) ?? []
export const glyphs = (lines: string[]) => [...new Set([...lines.join('').replace(/\s/g, '')].filter(ch => ch.charCodeAt(0) > 126 && !ALLOWED.has(ch)))]

const frame = (s: any, w: number, tab: string) => {
  const v = { ...s, ui: { ...s.ui, tab, cfg: { ...s.ui?.cfg, v2: true } } }, p = pane(v, w, 40, NOOP)
  return [...txt(band(v, w, NOOP)), ...txt([...p.before, ...p.after]), ...(p.tl?.rows ?? [])].map(l => l.trimEnd())
}

describe('acceptance lints (known frames)', () => {
  const good = ['› a2 Session refresh · implement · 23m      p3 · 4/7', '! NEEDS YOU · approve plan p4          1: answer', '  ✓ a1  Add login        merged    9m ago', '────']
  test('a good frame passes all four', () => {
    expect([overflow(good, 60), dupes(good), wording(good), glyphs(good)]).toEqual([[], [], [], []])
  })
  test('bad frames are caught', () => {
    expect(overflow(['x'.repeat(41)], 40)).toHaveLength(1)
    expect(dupes(['p3 · 4/7 done', '4/7 done', 'ctx 41%', 'ctx 41%', 'worker 23m', 'reviewer 23m'])).toEqual(['4/7', 'ctx 41%', '23m'])
    expect(wording(['w1 rev syn tst', 'a2 !< !>', '58m o rev a2'])).toEqual(['w1', 'rev', 'syn', 'tst', '!<', '!>', '58m o', 'rev'])
    expect(glyphs(['⏸ ⚠ ▶ ⚑ ◉ ● ┏━┓ ✓'])).toEqual(['⏸', '⚠', '▶', '⚑', '◉', '●', '┏', '━', '┓'])
  })
})

describe(`v2 frames: every scenario x tab x width${LIVE ? '' : ' (runs when ui.v2 is on)'}`, () => {
  for (const [name, s] of Object.entries(SCENARIOS)) test(name, () => {
    if (!LIVE) return
    for (const w of WIDTHS) for (const tab of TABS) {
      const f = frame(s, w, tab), at = `${name} ${tab} ${w}`
      expect([at, overflow(f, w)]).toEqual([at, []])
      expect([at, dupes(f)]).toEqual([at, []])
      expect([at, wording(f)]).toEqual([at, []])
      expect([at, glyphs(f)]).toEqual([at, []])
    }
  })
})
