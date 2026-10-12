// setup's Preferences phase (ADR 0014): main asks the user (AskUserQuestion) for the default mode and the drive limits and hands them over with ONE TaskCreate
// `{kind:"preferences", …}` (the only channel main has to cadre, in a dormant repo too). cadre, never Claude, writes ~/.claude/cadre.json (it holds S keys): a diff on a
// confirm card (`init:93`), then .bak, write, re-read, like the user-settings card. Only the keys that differ from the defaults are kept.
import { modelData, modelText } from '../core/say'
import type { Host } from '../types'
import { fnv1a64 } from '../core/board'
import { DRIVE, cfgOf, initConfirm, initPropose } from '../core/dispatch'
import { defaults } from '../config/index'
import { diff as jdiff } from '../policy/settings'

const CARD = 93, STAMP = 'cadre:prefs'
type Want = { mode: 'auto' | 'yolo'; maxTurns: number; maxCostUsd: number; maxWallMinutes: number }
const LIM: [keyof Want, number][] = [['maxTurns', 10_000], ['maxCostUsd', 10_000], ['maxWallMinutes', 10_080]]
const pathOf = async (h: Host) => `${await h.home()}/.claude/cadre.json`
const readJ = (t: string | null): Record<string, any> | null => { try { const v = t ? JSON.parse(t) : {}; return v && typeof v === 'object' && !Array.isArray(v) ? v : null } catch { return null } }

// metadata -> the wanted values, or why not (an absent key keeps the default)
export function wantOf(m: Record<string, unknown>): Want | string {
  const d = defaults().drive, w: Want = { mode: d.mode as Want['mode'], maxTurns: d.maxTurns, maxCostUsd: d.maxCostUsd, maxWallMinutes: d.maxWallMinutes }
  for (const k of Object.keys(m)) if (!['kind', 'mode', ...LIM.map(l => l[0])].includes(k)) return `metadata.${k}: unknown (allowed: mode, maxTurns, maxCostUsd, maxWallMinutes)`
  if (m.mode !== undefined) { if (m.mode !== 'auto' && m.mode !== 'yolo') return 'metadata.mode: expected "auto" or "yolo"'; w.mode = m.mode }
  for (const [k, max] of LIM) if (m[k] !== undefined) { const v = m[k]; if (typeof v !== 'number' || !(v > 0) || v > max || (k !== 'maxCostUsd' && !Number.isInteger(v))) return `metadata.${k}: expected a ${k === 'maxCostUsd' ? 'number' : 'whole number'} from 1 to ${max}`; (w as any)[k] = v }
  return w
}
// the user file with these choices: a default value drops its key, an emptied drive section goes
export function nextOf(cur: Record<string, any>, w: Want): Record<string, any> {
  const d = defaults().drive as Record<string, unknown>, drive: Record<string, unknown> = { ...cur.drive }
  for (const [k, v] of Object.entries(w)) if (d[k] === v) delete drive[k]; else drive[k] = v
  const { drive: _d, ...rest } = cur; return Object.keys(drive).length ? { ...rest, drive } : rest
}
async function plan(h: Host, w: Want) {
  const path = await pathOf(h), old = await h.readText(path), cur = readJ(old)
  if (!cur) return { error: '~/.claude/cadre.json is not valid JSON; fix it by hand first' }
  const next = nextOf(cur, w), lines = jdiff(cur, next)
  return { path, old, text: JSON.stringify(next, null, 2) + '\n', lines, sig: fnv1a64(JSON.stringify(w) + (old ?? '')) }
}

// tool.call slot 5, before the guards (hooks/register.ts): main's TaskCreate {kind:"preferences"}; anything else passes
export async function prefsCall(h: Host, e: any): Promise<unknown | undefined> {
  if (e.agentId || e.tool !== 'TaskCreate' || e.metadata?.kind !== 'preferences') return undefined
  if ((await h.secret.read()).run?.kind !== 'setup') return { deny: modelText('deny', 'preferences are set during the machine setup; ask the user to run /cadre setup') }
  const w = wantOf(e.metadata); if (typeof w === 'string') return { deny: modelText('deny', w) }
  const p = await plan(h, w); if ('error' in p) return { deny: modelText('deny', p.error!) }
  if (!p.lines.length) { await h.store.set(STAMP, { at: await h.now() }); return { result: modelData('tool-result', { task: { id: 'preferences', subject: 'preferences' } }), context: [modelText('context', 'Nothing to change: these are already the settings. Go on with the next phase.')] } }
  await h.ui.update(u => ({ ...u, 'prefs.pending': { sig: p.sig, want: w } }))
  await initPropose(h, CARD, `setup preferences\n${p.sig}`, { title: 'setup · your preferences · confirm', short: 'setup preferences', sub: 'setup prefs',
    lines: ['cadre writes this after you confirm (a .bak is kept):', ...p.lines.slice(0, 5).map(l => `  ~/.claude/cadre.json: ${l}`)] })
  return { result: modelData('tool-result', { task: { id: 'preferences', subject: 'preferences' } }), context: [modelText('context', 'cadre shows these choices to the user in a dialog. Tell them to confirm it there (press 1), then go on with the next phase.')] }
}
// `setup prefs confirm` (the card's Confirm, dialog only): the file is re-read and must be what the card showed
export async function confirmPrefs(h: Host): Promise<string> {
  const pend = (await h.ui.read())['prefs.pending'] as { sig: string; want: Want } | undefined, good = await initConfirm(h, CARD)
  if (!good || !pend) return 'setup: nothing pending'
  const p = await plan(h, pend.want); if ('error' in p || p.sig !== pend.sig) return 'setup: ~/.claude/cadre.json changed since you saw it; nothing written'
  const write = async () => { if (p.old !== null) await h.write(`${p.path}.bak`, p.old); await h.write(p.path, p.text) }
  if (DRIVE.humanWrite) await DRIVE.humanWrite(h, write); else await write()   // the human's own change: a running drive takes it as its baseline (config/route does the same)
  if ((await h.readText(p.path)) !== p.text) return 'setup: ~/.claude/cadre.json did not read back as written; the .bak has the old file'
  await h.ui.update(({ 'prefs.pending': _p, ...u }) => u); await h.store.set(STAMP, { at: await h.now() })
  return 'setup: your preferences are written'
}
// setup's checklist row: done once chosen (written, or nothing to change), waiting while the card is up, else Claude's to ask
export async function prefsItem(h: Host): Promise<{ name: string; st: 'ok' | 'fail' | 'wait'; why?: string }> {
  if (await h.store.get(STAMP)) return { name: 'preferences', st: 'ok' }
  if ((await h.board.read()).decisions?.some(d => d.id === `init:${CARD}`)) return { name: 'preferences', st: 'wait', why: 'confirm them in the dialog' }
  return { name: 'preferences', st: 'fail', why: 'ask the user for the default mode and the limits (phase 5), then hand them over with TaskCreate' }
}
// doctor's row
export async function prefsRow(h: Host): Promise<['ok', string]> {
  const d = (await cfgOf(h)).drive, has = !!readJ(await h.readText(await pathOf(h)))?.drive
  return ['ok', `your preferences: ${has ? '~/.claude/cadre.json' : 'the defaults'} (mode ${d.mode}, limits ${d.maxTurns}/$${d.maxCostUsd}/${d.maxWallMinutes}m)`]
}
