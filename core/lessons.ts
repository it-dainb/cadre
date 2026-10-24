// H10 lessons (ADR 0028): what the work taught, kept per repo, fed to later briefs by path. Fully automatic: records and the human's own feedback become inputs with a
// durable key {kind, ref, at}; one capped side-model pass (lessons.model) turns the fresh ones into lessons with evidence; a lesson that repeats, spans repos or is critical
// moves to the user scope (path-free); unused ones decay. The repo doc lives in the task store's control doc (CAS), the user scope in a file.
import type { Host } from '../types'
import { StoreError } from '../task-management/store'
import { scoped } from '../commands/init'
import { fnv1a64, safe } from './board'
import { cfgOf, storeOf } from './dispatch'
import { casDrive } from './drive'
import { emit, subscribe } from './events'
import { modelIssues } from './queue'
import { leaks, modelText } from './say'
import { overlap } from './validate'

const DAY = 86_400_000, MAX_IN = 200, MAX_BYTES = 24 * 1024, MAX_LESSON = 300, BRIEF = 1500, PER_REPO = 50   // BRIEF (A2) and the input caps are limits, never settings
export interface Lesson { id: string; text: string; paths?: string[]; ev: string[]; n: number; uses: number; born: number; seen: number; crit?: boolean }
interface In { k: string; text: string; at: number }   // k = kind:ref:at, durable across a ring rebuild
interface Doc { passes: { day: string; n: number }; spent?: number; mark: number; due?: boolean; inbox: In[]; items: Lesson[]; pruned: string[]; fed: Record<string, string[]> }
interface User { items: Lesson[]; seen: Record<string, string[]>; gone: string[] }   // gone: normalised texts the human pruned: they never come back
const empty = (): Doc => ({ passes: { day: '', n: 0 }, mark: 0, inbox: [], items: [], pruned: [], fed: {} })

// secret-shaped strings never reach the side model or a brief
const SECRET = /\b(?:sk-[\w-]{10,}|gh[pousr]_\w{20,}|AKIA\w{12,}|xox[abp]-[\w-]+|eyJ[\w-]{10,}\.[\w-]+\.[\w-]+|[A-Fa-f0-9]{32,})\b|\bBearer\s+\S+|\b(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*\S+/gi
export const scrub = (s: string): string => s.replace(SECRET, '[removed]')
// the user scope is shared by every repo: no path, file name or home reference (a stricter lint than the repo's)
// one line of plain words: a lesson text cannot open a heading, a list or a quote in the brief that carries it
const oneLine = (t: string): string => scrub(t).replace(/\s+/g, ' ').replace(/^[#>*\-\s]+/, '').trim()
const bytes = (s: string): number => new TextEncoder().encode(s).length
export const pathFree = (t: string): boolean => !/[/\\~]|\b\w+\.\w{2,4}\b/.test(t) && !leaks('lesson', t).length

async function cas(h: Host, fn: (d: Doc) => Doc | undefined): Promise<Doc> {
  const store = await storeOf(h)
  for (let i = 0; i < 3; i++) {
    const r = (await store.control()).doc.lessons as Doc | undefined, n = fn({ ...empty(), ...r })
    if (!n) return { ...empty(), ...r }
    try { await store.setControl({ lessons: n }, { lessons: r }); return n } catch (e) { if (!(e instanceof StoreError && e.code === 'GuardMismatch')) throw e }
  }
  throw new StoreError('Busy', 'lessons kept moving')
}
export const read = (h: Host): Promise<Doc> => cas(h, () => undefined)
const rank = (l: Lesson) => (l.crit ? 1e6 : 0) + l.n * 10 + l.uses
const capIn = (xs: In[]): In[] => { let b = 0, n = 0; const out: In[] = []; for (const x of [...xs].reverse()) { b += x.k.length + x.text.length; if (++n > MAX_IN || b > MAX_BYTES) break; out.unshift(x) } return out }   // newest kept

// ---- inputs ----
export async function note(h: Host, kind: string, ref: string, text: string, at: number): Promise<void> {
  const t = scrub(text).trim().slice(0, MAX_LESSON), k = `${kind}:${ref}:${at}`
  if (!t || leaks('lesson', t).length) return
  await cas(h, d => (d.inbox.some(i => i.k === k) || d.pruned.includes(k) ? undefined : { ...d, inbox: capIn([...d.inbox, { k, text: t, at }]) }))
}
const INPUT: Record<string, (d: any) => [kind: string, ref: string, text: string] | undefined> = {
  'flag.raised': d => ['flag', d.taskId, `task ${d.taskId} was flagged ${d.flag}`],
  'check.ran': d => (d.ok === false ? ['failure', d.taskId, `check ${d.name} failed on task ${d.taskId}`] : undefined),
  'help.done': d => (d.ok === false ? ['helper', d.taskId, `a ${d.helper} helper failed for task ${d.taskId}`] : undefined),
  'drive.decided': d => ['decided', d.taskId ?? d.kind, `${d.kind}: ${d.text}`],
  'decision.answered': d => ['answer', d.id ?? '', `the human answered ${d.choice}`],
  'config.changed': d => ['config', d.key, `the human changed ${d.key} from ${JSON.stringify(d.from)} to ${JSON.stringify(d.to)}`],
  'task.retried': d => ['retry', d.taskId, `the human retried task ${d.taskId}`],
  'task.cancelled': d => ['cancel', d.taskId, `task ${d.taskId} was cancelled`],
  'amend.recorded': d => ['amend', d.taskId, `task ${d.taskId} was amended: ${d.reason ?? ''}`],
}
subscribe((h, ev) => safe(h, 'lessons', async () => {
  const x = INPUT[ev.type]?.(ev.data); if (x) await note(h, x[0], String(x[1]), x[2], ev.at)
  if (ev.type === 'plan.landed') await cas(h, d => ({ ...d, due: true }))   // a pass after each landed plan
  if (ev.type === 'task.transitioned' && ev.data.to === 'done') {   // a use counts only when the task landed with no matching refusal or finding
    const id = String(ev.data.taskId)
    await cas(h, d => { const f = d.fed[id]; if (!f) return undefined; const bad = d.inbox.some(i => /^(flag|failure):/.test(i.k) && i.k.split(':')[1] === id), { [id]: _, ...fed } = d.fed
      return { ...d, fed, items: bad ? d.items : d.items.map(l => (f.includes(l.id) ? { ...l, uses: l.uses + 1, seen: ev.at } : l)) } })
  }
}))

// ---- decay, age cap, per-repo cap ----
const tidy = (xs: Lesson[], now: number, cfg: { lessons: { decayDays: number; maxAgeDays: number } }, decay = true): Lesson[] =>
  xs.filter(l => now - l.born <= cfg.lessons.maxAgeDays * DAY && (!decay || now - l.seen <= cfg.lessons.decayDays * DAY)).sort((a, b) => rank(b) - rank(a)).slice(0, PER_REPO)

// ---- the user scope ----
const ufile = async (h: Host) => `${await h.home()}/.claude/cadre/lessons.json`
async function userDoc(h: Host): Promise<User> { try { return { items: [], seen: {}, gone: [], ...JSON.parse((await h.readText(await ufile(h))) ?? '{}') } } catch { return { items: [], seen: {}, gone: [] } } }
async function userSave(h: Host, u: User): Promise<void> { const f = await ufile(h); await h.write(`${f}.tmp`, JSON.stringify(u)); await h.run(['mv', `${f}.tmp`, f]) }
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim()
// repeats in this repo, a second repo with the same lesson, or critical once; a lesson that is not path-free stays in its repo
async function promote(h: Host, cfg: any, items: Lesson[], now: number): Promise<string[]> {
  const repo = fnv1a64(await h.cwd()).slice(0, 8), u = await userDoc(h), gone: string[] = []
  for (const l of items) {
    const k = norm(l.text); if (u.gone.includes(k)) { gone.push(l.id); continue }
    const r = (u.seen[k] = [...new Set([...(u.seen[k] ?? []), repo])])
    if ((l.crit || l.n >= cfg.lessons.repeats || r.length >= cfg.lessons.repos) && pathFree(l.text)) { if (!u.items.some(x => norm(x.text) === k)) u.items.push({ id: l.id, text: l.text, ev: [], n: l.n, uses: 0, born: now, seen: now, crit: l.crit }); gone.push(l.id) }
  }
  u.items = tidy(u.items, now, cfg, false); await userSave(h, u); return gone
}

// ---- the pass ----
const SYS = 'You turn short records of one repository\'s work into lessons for later task briefs. Answer with JSON only: {"lessons":[{"text":"one rule, at most 300 characters","paths":["optional folders it applies to"],"evidence":["record keys"],"reinforces":"id of an existing lesson","critical":false}]}. Cite only record keys from the list. Write a lesson only when the records support it; reinforce an existing one instead of repeating it. critical is for harm that must never happen again. Never include secrets or absolute paths.'
// critical needs a record of a flag or a failed check behind it: the model's say-so is not enough
const crit = (x: any, ev: string[]): true | undefined => (x?.critical === true && ev.some(k => /^(flag|failure):/.test(k)) ? true : undefined)
export async function pass(h: Host, idle: boolean): Promise<void> {
  const cfg = await cfgOf(h), c = cfg.lessons
  if (!cfg.lessons.passesPerDay || !h.model || modelIssues(cfg).some(i => i.startsWith('lessons.model'))) return
  const now = await h.now(), day = new Date(now).toISOString().slice(0, 10)
  let batch: In[] = [], claimed = false, prev = empty().passes
  const d0 = await cas(h, d => {   // the claim: the cap counts in the store, so two sessions cannot both pass it
    prev = d.passes; const p = d.passes.day === day ? d.passes.n : 0; batch = d.inbox.filter(i => i.at > d.mark)
    claimed = !!batch.length && p < cfg.lessons.passesPerDay && (d.due || idle)
    return claimed ? { ...d, passes: { day, n: p + 1 } } : undefined
  })
  if (!claimed) return
  const u = await userDoc(h), known = [...d0.items, ...u.items]
  const r = await h.model.complete({ model: c.model, maxTokens: 800, timeoutMs: 20_000, system: modelText('lesson', SYS),
    prompt: modelText('lesson', `Existing lessons:\n${known.map(l => `- ${l.id}: ${l.text}`).join('\n') || 'none'}\n\nRecords:\n${batch.map(i => `- ${i.k} | ${i.text}`).join('\n')}`) }).catch(() => undefined)
  await emit(h, 'lesson.pass', { n: d0.passes.n, ok: !!r?.isAnswered })
  if (!r?.isAnswered) return void (await cas(h, d => ({ ...d, passes: d.passes.n <= 1 ? prev : { day, n: d.passes.n - 1 } })))   // nothing changes: the claim is given back
  await spend(h, cfg, r.usage, c.model)
  let out: any[] = []; try { out = JSON.parse(String(r.text).replace(/^\s*```(?:json)?|```\s*$/g, '')).lessons } catch { /* an unreadable answer adds nothing; the batch is spent */ }
  const keys = new Set(batch.map(i => i.k)), mark = Math.max(...batch.map(i => i.at)), hit = new Set<string>()   // hit: the lessons this answer made or reinforced: only they can be promoted
  const d = await cas(h, d => {
    const items = d.items.map(l => ({ ...l })), bumped = new Set<string>(); hit.clear()
    for (const x of Array.isArray(out) ? out : []) {
      const ev: string[] = (Array.isArray(x?.evidence) ? x.evidence : []).filter((k: unknown) => typeof k === 'string' && keys.has(k)), text = typeof x?.text === 'string' ? oneLine(x.text) : ''
      if (!ev.length || !text || text.length > MAX_LESSON || leaks('lesson', text).length || ev.every(k => d.pruned.includes(k))) continue   // evidence outside the sent batch is dropped
      const old = items.find(l => l.id === x.reinforces)
      if (old) { if (!bumped.has(old.id) && ev.some(k => !old.ev.includes(k))) { old.n++; bumped.add(old.id) }   // once per lesson per pass, and only for a record it had not seen
        old.ev = [...new Set([...old.ev, ...ev])].slice(-20); old.seen = now; old.crit ||= crit(x, ev); hit.add(old.id); continue }
      const paths = Array.isArray(x.paths) ? x.paths.filter((p: unknown) => typeof p === 'string' && p.length <= 200).slice(0, 5) : []
      hit.add(`l${fnv1a64(text).slice(0, 6)}`); items.push({ id: `l${fnv1a64(text).slice(0, 6)}`, text, ...(paths.length ? { paths } : {}), ev, n: 1, uses: 0, born: now, seen: now, ...(crit(x, ev) ? { crit: true } : {}) })
    }
    return { ...d, items: tidy(items, now, cfg), mark, due: false }
  })
  for (const l of d.items) if (hit.has(l.id) && !d0.items.some(o => o.id === l.id)) { await emit(h, 'lesson.added', { id: l.id, ev: l.ev }); h.log(`lesson.added ${l.id}`) }
  const gone = await promote(h, cfg, d.items.filter(l => hit.has(l.id)), now).catch(e => (h.log(`lessons: promotion failed: ${e}`), [] as string[]))
  if (gone.length) await cas(h, x => ({ ...x, items: x.items.filter(l => !gone.includes(l.id)) }))
  await rows(h).then(r => h.ui.update(x => ({ ...x, 'lessons.rows': r }))).catch(() => {})   // the pane's rows (the tab shows once there are lessons)
}
// the side model's tokens count in the session cost; its dollars (cost.prices) in the drive record unrounded (`side`, summed at the bound check), so maxCostUsd holds them
async function spend(h: Host, cfg: any, u: any = {}, model: string): Promise<void> {
  const i = u.input_tokens ?? 0, o = u.output_tokens ?? 0, k = await scoped(h, 'cost:all'), a = ((await h.store.get(k)) as any) ?? { in: 0, out: 0, cr: 0, cw: 0 }
  await h.store.set(k, { ...a, in: a.in + i, out: a.out + o })
  const p = Object.entries((cfg.cost.prices ?? {}) as Record<string, any>).find(([n]) => model.includes(n))?.[1], usd = p && (i * p.in + o * p.out) / 1e6
  if (usd) await cas(h, d => ({ ...d, spent: (d.spent ?? 0) + usd }))   // the session's side spend, drive or not
  if (usd) await casDrive(h, await storeOf(h), r => (r?.on ? { ...r, side: (r.side ?? 0) + usd } : undefined))
}

// ---- the feed (A2): by path, at most perBrief lessons and BRIEF bytes in all, the lowest-ranked dropped until it fits ----
export async function feed(h: Host, taskId: string, paths: string[]): Promise<string> {
  const cfg = await cfgOf(h), d = await read(h), u = await userDoc(h), now = await h.now()
  const mine = (l: Lesson) => (l.paths?.length ? (paths.some(p => l.paths!.some(q => overlap(q, p))) ? 2 : 0) : 1)
  const pick = [...d.items, ...u.items.filter(l => !d.items.some(x => norm(x.text) === norm(l.text)))].filter(l => mine(l) && now - l.born <= cfg.lessons.maxAgeDays * DAY && !leaks('lesson', l.text).length)
    .sort((a, b) => mine(b) - mine(a) || rank(b) - rank(a)).slice(0, cfg.lessons.perBrief)
  while (pick.length && bytes(pick.map(l => `- ${l.text}`).join('\n')) > BRIEF - 12) pick.pop()   // bytes, not characters   // 12: the section title
  if (pick.length && taskId) await cas(h, x => ({ ...x, fed: { ...x.fed, [taskId]: pick.map(l => l.id) } }))
  return pick.length ? modelText('lesson', pick.map(l => `- ${l.text}`).join('\n')) : ''
}

// ---- the pane: x prunes; the pruned evidence keys never produce the lesson again ----
export const rows = async (h: Host): Promise<{ id: string; text: string; scope: 'repo' | 'user'; ev: number }[]> =>
  [...(await read(h)).items.map(l => ({ id: l.id, text: l.text, scope: 'repo' as const, ev: l.ev.length })), ...(await userDoc(h)).items.map(l => ({ id: l.id, text: l.text, scope: 'user' as const, ev: l.n }))]
export async function prune(h: Host, id: string): Promise<string> {
  const u = await userDoc(h); let hit = false
  const gone = u.items.find(l => l.id === id)
  if (gone) { u.items = u.items.filter(l => l !== gone); u.gone = [...new Set([...u.gone, norm(gone.text)])]; await userSave(h, u); hit = true }
  await cas(h, d => { const l = d.items.find(x => x.id === id); if (!l) return undefined; hit = true; return { ...d, items: d.items.filter(x => x !== l), pruned: [...new Set([...d.pruned, ...l.ev])].slice(-MAX_IN * 2) } })
  return hit ? `lesson ${id} pruned` : `no lesson ${id}`
}
// the drain's call: started, never awaited (a turn does not wait on the side model); a timer frame where the host has one
export const kick = (h: Host, idle: boolean): void => { const go = () => pass(h, idle).catch(e => h.log(`lessons: pass failed: ${e}`)); if (h.ops) h.ops.after(0, go); else void go() }
export const spentOf = async (h: Host): Promise<number> => (await read(h).catch(() => undefined))?.spent ?? 0
