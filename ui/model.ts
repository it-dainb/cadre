// UI shared (UI-DESIGN 6.0, 8): readers, tag/glyph table, task classification, depth layout, ring fold, line/segment drawing. Pure; reads only the human view, the ring, the secret.
import type { CadreEvent, Decision, Host, Secret, Snapshot, SnapTask } from '../types'
import { humanView } from '../core/board'
import { ofEpic } from '../core/events'

export type Cfg = { glyphs: 'unicode' | 'ascii'; flash: boolean; notify: 'on' | 'off'; escalateAfterMs: number; maxTurns: number }
export const CFG: Cfg = { glyphs: 'unicode', flash: true, notify: 'on', escalateAfterMs: 120_000, maxTurns: 100 }
// A drawn line = segments: text, theme color, bold/inverse, and (for presses) a Button key, hotkey and action. Tests flatten them with txt().
export type Seg = { t: string; c?: string; b?: boolean; i?: boolean; d?: boolean; k?: string; hk?: string; p?: () => void; inp?: (v: string) => void; chg?: (v: string) => void; il?: string; iv?: string; af?: true }   // inp: an Input (submit), chg: on change, il/iv: its label/value
export type Line = Seg[]
export type View = { b: Snapshot; ring: CadreEvent[]; sec: Secret; ui: Record<string, any>; c: Cfg; now: number; sx: string; t: number | null }
export type Acts = { go(tab: string): void; pick(id: string): void; fill(cmd: string): void; press(id: string, key: string, hash: string): void; step(what: string, d: number): void; input?(id: string, key: string, v: string): void; run?(cmd: string): void }   // handlers; the render never writes state

export async function read(h: Host): Promise<View> {
  const [s, r, sec, ui, now] = await Promise.all([h.board.read(), h.events.read(), h.secret.read(), h.ui.read(), h.now()])
  const b = humanView(s)
  return { b, ring: ofEpic(r, b.epic ?? ''), sec, ui, c: { ...CFG, ...(ui.cfg as object) }, now, sx: (ui.sx as string | undefined) ?? h.options.strictness ?? 'strict', t: typeof ui.t === 'number' ? ui.t : null }
}

export type TagK = 'attn' | 'crit' | 'warn' | 'run' | 'ok' | 'ready' | 'wait' | 'idle'
const TAG: Record<TagK, [string, string, string, string]> = {   // word, unicode, ascii, semantic color
  attn: ['ATTN', '⚑', '!', 'warning'], crit: ['CRIT', '✗', 'x', 'error'], warn: ['WARN', '⚠', '~', 'warning'], run: ['RUN', '▶', '>', 'suggestion'],
  ok: ['OK', '✓', '+', 'success'], ready: ['READY', '○', 'o', 'text'], wait: ['WAIT', '⏸', '=', 'inactive'], idle: ['IDLE', '◌', '.', 'inactive'],
}
export const gl = (c: Cfg, k: TagK) => TAG[k][c.glyphs === 'ascii' ? 2 : 1]
export const tg = (k: TagK) => `[${TAG[k][0]}]`
export const col = (k: TagK) => TAG[k][3]
export const REDO = (c: Cfg) => (c.glyphs === 'ascii' ? 'r' : '↻')
// drawing marks (strip, edges, node borders, timeline cells) are written in unicode and mapped once for ascii; tag glyphs never pass through this
const ASC: Record<string, string> = { '━': '=', '─': '-', '┄': '.', '┃': '|', '│': '|', '┆': ':', '▶': '>', '▷': '>', '●': '#', '◉': '@', '○': '-', '█': '#', '▒': '%', '░': ':', '╌': '-', '↷': '^', '▼': 'v', '═': '=', '║': '|' }
export const T = (c: Cfg, s: string) => (c.glyphs === 'ascii' ? s.replace(/[━─┄┃│┆▶▷↷●◉○█▒░╌▼═║┏┓┗┛┌┐└┘├┤┬┴┼┣┫┳┻╋╔╗╚╝╭╮╰╯]/g, m => ASC[m] ?? '+') : s)

export const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s)
export const fit = (s: string, n: number) => cut(s, n).padEnd(n)
export const S = (t: string, c?: string, o: Partial<Seg> = {}): Seg => ({ t, ...(c ? { c } : {}), ...o })
export const L = (t: string, c?: string): Line => [S(t, c)]
export const wid = (l: Line) => l.reduce((n, s) => n + s.t.length + (s.hk ? s.hk.length + 2 : 0), 0)
export const padL = (l: Line, w: number): Line => [...l, S(' '.repeat(Math.max(0, w - wid(l))))]
export const txt = (ls: Line[]) => ls.map(l => l.map(s => (s.hk ? `${s.hk}: ` : '') + s.t).join(''))   // a plain Button draws `hotkey: label` itself (UI-14): labels carry no key
export const ago = (ms: number) => `${Math.max(0, Math.round(ms / 60000))}m`
const pr = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
// Line[] -> element tree. Only place that builds elements: E = $.ui.resolve(e); constructors take `children` among the props.
export const draw = (E: any, ls: Line[]) =>
  E.Box({ flexDirection: 'column', children: ls.map(l => E.Box({ flexDirection: 'row', children: (l.length ? l : [S(' ')]).map(s => {
    if (s.inp) return E.Input(pr({ key: s.k, label: s.il, value: s.iv, placeholder: s.il ? undefined : 'task id', autoFocus: s.il ? s.af : true, onSubmit: s.inp, onInput: s.chg }))
    const x = E.Text(pr({ color: s.c, dimColor: s.d || undefined, bold: s.b || undefined, inverse: s.i || undefined, wrap: 'truncate-end', children: s.t }))
    return s.k ? E.Button(pr({ key: s.k, plain: true, hotkey: s.hk, onPress: s.p, children: [x] })) : x
  }) })) })

// --- task classification, strip, depth layout ---
const PIPE: Record<string, string[]> = { code: ['tester', 'red', 'worker', 'green', 'reviewer', 'merge'], docs: ['worker', 'reviewer', 'merge'], spike: ['explorer', 'report'] }
export const PH: Record<string, string> = { tester: 'spec', red: 'red ✓', worker: 'implement', green: 'green ✓', reviewer: 'review', merge: 'review ✓', explorer: 'exploring', report: 'reported', '': 'todo' }
const isCond = (t: SnapTask) => t.deps.some(d => d.type === 'conditional-blocks')
const st = (all: SnapTask[], id: string) => all.find(x => x.id === id)?.state
export function kindOf(t: SnapTask, all: SnapTask[]): TagK {
  if (t.flags.some(f => f.startsWith('git:'))) return 'crit'
  if (t.state === 'done') return 'ok'
  if (t.state === 'active' || t.state === 'review') return 'run'
  if (t.state === 'cancelled' || t.state === 'todo' && t.deps.some(d => d.type === 'conditional-blocks' && st(all, d.id) === 'done')) return 'idle'
  return t.state === 'blocked' || t.deps.some(d => st(all, d.id) !== 'done') ? 'wait' : 'ready'
}
export const waitWord = (t: SnapTask, all: SnapTask[]) => {
  const c = t.deps.find(d => d.type === 'conditional-blocks')
  return c ? `if ${c.id} fails` : `waits ${t.deps.filter(d => st(all, d.id) !== 'done').map(d => d.id).join(' ')}`
}
export const stepsOf = (t: SnapTask) => PIPE[t.kind] ?? PIPE.code
export const word = (t: SnapTask, all: SnapTask[]) => t.state === 'done' ? (t.kind === 'spike' ? 'reported' : 'merged') : t.state === 'cancelled' ? 'skipped' : t.state === 'todo' && kindOf(t, all) === 'wait' ? waitWord(t, all) : PH[t.step] ?? t.step
// pipeline marks: done -> all filled; else filled before the current step, a ring on it, empty after
export const marks = (t: SnapTask) => stepsOf(t).map((s, i, a) => t.state === 'done' ? '●' : !t.step || t.state === 'cancelled' ? '○' : i < a.indexOf(t.step) ? '●' : i === a.indexOf(t.step) ? '◉' : '○')
export function cols(ts: SnapTask[]): SnapTask[][] {   // column = longest dependency path; row = plan order, conditional branches last
  const d = new Map<string, number>()
  const dep = (t: SnapTask, vis: string[] = []): number => {
    if (d.has(t.id)) return d.get(t.id)!
    if (vis.includes(t.id)) return 0
    const n = Math.max(-1, ...t.deps.map(x => { const u = ts.find(y => y.id === x.id); return u ? dep(u, [...vis, t.id]) : -1 })) + 1
    d.set(t.id, n); return n
  }
  const out: SnapTask[][] = []
  for (const t of ts) (out[dep(t)] ??= []).push(t)
  return out.map(c => [...c].sort((a, b) => +isCond(a) - +isCond(b)))
}
// Replay: the board as of time t = pure fold of the ring over the epic's tasks (same code path as live with t = null)
export function at(v: View): Snapshot {
  if (v.t === null) return v.b
  const ts = new Map(v.b.tasks.map(x => [x.id, { ...x, state: 'todo' as SnapTask['state'], step: '', phaseSince: 0, flags: [] as string[] }]))
  for (const e of v.ring) {
    const x = ts.get(String(e.taskId ?? e.data.taskId)); if (e.at > v.t || !x) continue
    if (e.type === 'task.transitioned') x.state = e.data.to as SnapTask['state']
    else if (e.type === 'task.phase_changed') { x.step = String(e.data.to); x.phaseSince = e.at }
    else if (e.type === 'flag.raised') x.flags = [...x.flags, String(e.data.flag)]
    else if (e.type === 'flag.resolved') x.flags = x.flags.filter(f => f !== e.data.flag)
  }
  const p = v.b.plan
  return { ...v.b, tasks: [...ts.values()], plan: p && { ...p, landed: p.landed && p.landed.at <= v.t ? p.landed : undefined, released: p.released && p.released.at <= v.t ? p.released : undefined } }
}
export const t0 = (v: View) => v.b.plan?.approvedAt ?? v.ring[0]?.at ?? v.now

// --- attention items (derived from the board + secret; no secrets in text) ---
// attention = the pending decisions (board.decisions, oldest first; ONE record kind, drawn by ui/card) + two states that are not decisions
export type Item = { key: string; tag: TagK; text: string; short?: string; tab: string; sel?: string; d?: Decision }
export function attention(v: View): Item[] {
  const b = v.b, out: Item[] = (b.decisions ?? []).map(d => ({ key: `dec:${d.id}`, tag: d.crit ? 'crit' : d.kind === 'flag' ? 'warn' : 'attn', text: d.title, short: d.short, tab: d.tab ?? 'epic', sel: d.sel, d }))
  if (b.containment.state === 'degraded') out.push({ key: 'mode:containment', tag: 'crit', text: 'Containment degraded · run /cadre init', tab: 'epic' })
  for (const t of b.tasks) if (t.state === 'blocked') out.push({ key: `q:${t.id}`, tag: 'attn', text: `${t.id} blocked: needs an answer`, tab: 'epic', sel: t.id })
  return out
}
