// Scenario kit (dev loop, docs/dev/ui-dev.md). A scenario is a View plus `about` (and optional `width`/`tab`): snapshot (b), events (ring), secret (sec), ui, cfg (c), now.
// Built from tests/fixtures/ui/epic.ts wherever possible; `bare` is the repo-with-no-plan shape for init/setup cards.
import type { Decision, Snapshot } from '../types'
import { emptySnapshot } from '../core/board'
import { type View, CFG } from '../ui/model'

export type Scenario = View & { about: string; width?: number; tab?: string }
export const sc = (about: string, v: View, o: { width?: number; tab?: string } = {}): Scenario => ({ about, ...v, ...o })
export const dec = (id: string, kind: string, title: string, lines: string[], options: Decision['options'], o: Partial<Decision> = {}): Decision => ({ id, kind, title, lines, hash: 'h', options, ...o })
export function bare(about: string, b: Partial<Snapshot>, o: { ui?: Record<string, unknown>; width?: number; tab?: string } = {}): Scenario {
  const s: Snapshot = { ...emptySnapshot('repo'), seq: 1, ...b }
  return { about, b: s, ring: [], sec: {}, ui: { ...o.ui }, c: { ...CFG }, now: 1_000_000, sx: 'strict', t: null, width: o.width, tab: o.tab }
}
