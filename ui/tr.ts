// The one translation point (H11, ui.language = en): ui/** only, never core/commands/hooks/tools or a model exit (tests/language.test.ts, scripts/budget.mjs). Covers option labels, the decision title shown and field labels. No table ships; a language is a table here.
import type { Decision, DecisionOption } from '../types'
export const TABLE: Record<string, string> = {}
export const tr = (key: string, en: string) => TABLE[key] ?? en
// the label a person sees, and the ONE match back to its option: both sides use `lab`, so a translated label cannot desync from the option
const lab = (d: Decision, o: DecisionOption) => tr(`${d.kind}.${o.key}`, o.label)
export const labels = (d: Decision, os: DecisionOption[]) => os.map(o => lab(d, o))
export const pick = (d: Decision, os: DecisionOption[], x: string) => os.find(o => lab(d, o) === x)
export const title = (d: Decision) => tr(`${d.kind}.title`, d.title)
export const fieldLabel = (d: Decision, f: { key: string; label: string }) => tr(`${d.kind}.${f.key}`, f.label)
