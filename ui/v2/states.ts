// UI v2 States that replace the Board body (TUI-DESIGN §7): dormant, no plan, a setup/init run. Replay and degraded are drawn by the frame; a render error by frame's catch.
import { type Line, type View, S } from '../model'
import { color, SEP } from '../tokens'
import { clip } from '../layout'

const note = (t: string, w: number): Line[] => [[S(clip(t, w), color('muted'))]]
export const dormant = (v: View): boolean => !v.sec.active && !v.b.plan && !v.b.tasks.length && !v.b.init.length && !v.sec.run
export const dormantBody = (w: number): Line[] => note(`cadre is off in this repo${SEP}/cadre init`, w)
export const noPlanBody = (w: number): Line[] => note(`no tasks yet${SEP}/cadre <goal> to start`, w)
export const errorBody = (w: number): Line[] => note(`couldn't draw this view${SEP}/cadre doctor`, w)
