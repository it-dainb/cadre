// The flag table (plan 2.5): what each kind of flag offers and whether drive holds on it. The table is the profile's `flags` (profiles/default.ts is the default, `setFlags` replaces it once at
// boot); every read is synchronous so core/decide, core/events and core/drive stay leaves. The effects an option runs live with the helpers they call (core/close.resolve).
import { flags } from '../profiles/default'
import type { Decision } from '../types'
import type { FlagSpec, Option } from '../types/profile'

let TABLE: Record<string, FlagSpec> = flags
export const setFlags = (f: Record<string, FlagSpec>): void => { TABLE = f }
export const kindOf = (flag: string): string => flag.split(':')[0]   // rework:2/3 -> rework, git:dev -> git
export const specOf = (flag: string): FlagSpec | undefined => TABLE[kindOf(flag)]
export const holds = (flag: string): boolean => !!specOf(flag)?.holds   // the flags drive holds on: under yolo only these become a decision for the human
export const yoloMain = (flag: string): boolean => specOf(flag)?.yolo === 'main'   // main decides these under yolo
// the option a typed key or main's choice names: its key, or its label's first word ("accept")
export const pick = (o: Option[], c: string): Option | undefined => o.find(x => x.key === c || x.label.toLowerCase().split(' ')[0] === c)
// the dialog a flag raises (core/events.emit for every flag.raised; a phase that knows more asks first under the same id and wins). `lines` replaces the default (title, why);
// `ids`: the raised flag carries ids (offers `needs:'ids'` options); `keys`: also offers these `needs:'keys'` options and only the options named here
export function flagDecision(taskId: string, flag: string, title?: string, o: { lines?: string[]; title?: string; short?: string; hash?: string; ids?: string[]; keys?: string[] } = {}): Decision | null {
  const s = specOf(flag); if (!s?.options.length) return null   // no options = released automatically (lost-wip), or no row
  const ref = s.target === 'ref', options = s.options.filter(x => (x.needs === 'keys' ? !!o.keys?.includes(x.key) : x.needs === 'ids' ? !!o.ids?.length : !o.keys || o.keys.includes(x.key))).map(x => ({ key: x.key, label: x.label, verb: x.effect[0].how ?? x.effect[0].do, run: `resolve ${ref ? 'git' : taskId} ${x.key}${ref ? ` ${flag}` : x.needs === 'ids' ? ` ${o.ids!.join(',')}` : ''}` }))
  return { id: `flag:${taskId}:${flag}`, kind: 'flag', title: o.title ?? (ref ? `${flag} · ${flag.split(':')[1] ?? flag} moved outside a cadre merge · merges blocked` : `${taskId} flagged ${flag}`), short: o.short ?? (ref ? `${flag} moved` : undefined),
    lines: o.lines ?? [...(title && title !== taskId ? [title] : []), s.why.replace('{flag}', flag)], hash: o.hash ?? flag, options, tab: 'epic', sel: ref || s.target === 'epic' ? undefined : taskId, crit: ref }   // the id is in the title: each fact once
}
