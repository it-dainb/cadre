// Every dev scenario (scenarios/index.ts) renders band + each pane tab at 60 and 120 columns without throwing: catches a broken scenario or a renderer that cannot take its shape.
import { describe, expect, test } from 'claude-code/testing'
import { SCENARIOS } from '../scenarios/index'
import { band } from '../ui/band'
import { pane } from '../ui/pane'
import { txt } from '../ui/model'
import { NOOP } from './fixtures/ui/epic'

describe('ui-dev scenarios', () => {
  for (const [name, s] of Object.entries(SCENARIOS)) test(name, () => {
    expect(s.about.length > 0).toBe(true)
    for (const w of [60, 120]) {
      txt(band(s, w, NOOP))
      for (const tab of ['epic', 'plan', 'doctor', 'card']) {
        const p = pane({ ...s, ui: { ...s.ui, tab } }, w, 40, NOOP)
        expect(txt([...p.before, ...p.after]).length > 0).toBe(true)
      }
    }
  })
})

test('regression: an empty board (fresh init) draws the epic and card tabs at 60 and 120', () => {
  const s = SCENARIOS['empty-dormant']
  for (const w of [60, 120]) for (const tab of ['epic', 'card']) {
    const t = txt(pane({ ...s, ui: { tab } }, w, 40, NOOP).before).join('\n')
    expect(t).toContain('no tasks yet')
  }
})
