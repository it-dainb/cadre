// /cadre setup (once per machine) and /cadre doctor (read-only diagnosis). ADR 0007, 0010: setup's fixing is done by Claude (guides/setup.md, commands/agentrun);
// this file holds the machine CHECKS both share. The command text is ONE line; the report goes to the human surface only (pane tab "doctor" + ui.log).
import type { Host } from '../types'
import type { Config } from '../config'
import { fnv1a64, leaseLive } from '../core/board'
import { cfgOf, initConfirm, initPropose, storeOf } from '../core/dispatch'
import { exists, identity, jailMode, ok as gitOk } from '../core/git'
import { wtRootOf } from '../core/branches'
import { qk } from '../core/session'
import { assess } from '../policy/containment'
import { EXIT, extraRoles } from '../core/roles'
import { loaded } from '../core/profile'
import { policyOf } from '../policy/guards'
import { call } from '../task-management/protocol'
import { openPane } from '../ui/index'
import { GATE, GATE_REV, gated, progress, scoped, type Item } from './init'
import { prefsItem, prefsRow } from './prefs'
import { doctorRows } from '../config/route'
import { runOf } from '../core/lifecycle'
import { probeOf } from '../core/gate'
import { unitsOf } from '../core/discover'

export type Row = ['ok' | 'warn' | 'crit', string, string?]   // level, line, fix (a command for the human)
const PIN = '2.1.295', EXITS = '2.1.299', STAMP = 'cadre:setup', USER_CARD = 91, UNSET_CARD = 92, TODO = 'CLAUDE_CODE_ENABLE_TODO_TOOLS', KEPT = 'cadre:setup:todo'
const ver = (s: string) => s.match(/\d+(\.\d+)+/)?.[0] ?? ''
const atLeast = (v: string, min: string) => { const a = v.split('.').map(Number), b = min.split('.').map(Number); for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0); return true }
// The oldest Claude Code cadre runs on: 2.1.295 added Button children (every press in the band and the pane; older builds throw "needs a label" and nothing
// draws), $.ui.notify; 2.1.293 isDeferred, 2.1.292 workflow agents at agent.spawn, 2.1.289 one agent id across hook events. Older: cadre stays off, says so (register.ts).
export const MIN_CC = '2.1.295'
export const tooOld = (v: string) => !!ver(v) && !atLeast(ver(v), MIN_CC)
export const oldLine = (v: string) => `cadre needs Claude Code ≥ ${MIN_CC}; you have ${ver(v)} · update with: claude update`

// ---- machine checks (shared by setup and doctor); every probe goes through h.run so tests inject fixtures. A row's fix is the command Claude (or, for sudo, the human) runs ----
// a human-run fix is a script under <cache>/cadre/fix (0700, harmless until run); the card and the follow-up only ever show the ONE short line that runs it (ADR 0007, 0.5.1)
export type Script = { path: string; text: string; run?: string; full?: string; exec?: true }   // run = the short line that runs it; full = the same fix as one copy-safe command
export async function machine(h: Host, cfg: Config): Promise<{ rows: Row[]; facts: Record<string, string>; scripts: Script[] }> {
  const r = (argv: string[]) => h.run(argv, { timeoutMs: 5000 }).catch(() => undefined), text = (x?: { stdout: string; stderr: string }) => `${x?.stdout}${x?.stderr}`, out = async (argv: string[]) => (await r(argv))?.stdout.trim() ?? ''
  const rows: Row[] = [], facts: Record<string, string> = {}, scripts: Script[] = []
  const add = (x: Row): void => { rows.push(x) }
  const home = await h.home(), dir = `${(await h.env()).XDG_CACHE_HOME || `${home}/.cache`}/cadre/fix`, shown = dir.startsWith(`${home}/`) ? `~${dir.slice(home.length)}` : dir
  const fix = (name: string, why: string, cmd: string, root = true): string => {
    const run = `${root ? 'sudo ' : ''}sh ${shown}/${name}.sh`
    scripts.push({ path: `${dir}/${name}.sh`, exec: true, run, full: `${root ? 'sudo ' : ''}sh -c '${cmd.split('\n').join(' && ').replaceAll("'", "'\\''")}'`, text: `#!/bin/sh\n# cadre setup: ${why}\n# Run it once, yourself: ${run}\nset -eu\n${cmd}\n` })
    return `! ${run}`
  }
  facts.cc = (await h.version?.().catch(() => '')) ?? ''
  const cmp = ver(facts.cc) && !atLeast(PIN, ver(facts.cc)) ? 'newer than' : 'older than'
  add(!facts.cc ? ['warn', 'Claude Code version unreadable'] : tooOld(facts.cc) ? ['crit', oldLine(facts.cc), 'claude update'] : facts.cc === PIN ? ['ok', `Claude Code ${PIN} (the pinned build)`] : ['warn', `Claude Code ${facts.cc}: ${cmp} the tested ${PIN}; ${cmp === 'newer than' ? 'usually fine' : 'update it with claude update'}`])
  if (facts.cc && !atLeast(EXITS, ver(facts.cc))) add(['warn', `an agent that is done is ended by cadre itself; that is tested up to Claude Code ${EXITS} (yours: ${facts.cc})`])   // exit rule 5 (forced exit), S0 on 2.1.295 and 2.1.299
  add(['ok', `agent exit tools${facts.cc ? ` of Claude Code ${facts.cc}` : ''}: ${EXIT.join(', ')} (never refused; no role may drop them) · roles of your own: ${extraRoles().map(r => r[0]).join(', ') || 'none'}`])   // exit rule 6
  for (const [n, f] of Object.entries((await h.secret.read()).roles?.failed ?? {})) if (f.n >= 2) add(['warn', `custom role ${n} is not available: ${f.why}`])   // refused by rule 6, or rejected twice (hooks/register.roles)
  const pl = loaded(), bad = (await h.secret.read()).profileBad ?? pl?.bad; add(bad ? ['crit', `repo profile invalid: ${bad.slice('repo profile: '.length)}`, 'fix .cadre/profile.json, then start a new session'] : pl?.user && pl.user !== 'inline' ? ['warn', `your profile is refused: ${pl.user}`] : ['ok', `profile ${pl?.name ?? 'default'}${pl?.repo ? ' + the repo profile' : ''}${pl?.user === 'inline' ? ' + your own layer' : ''}`])
  const started = (await h.secret.read()).start; if (started?.failed) add(['warn', `cadre started only in part this session (${started.failed})`, 'restart Claude Code; if it repeats, report it with /cadre doctor'])   // hooks/register session.start
  const inj = ((await h.store.get(await scoped(h, 'injected'))) as string[] | undefined) ?? []; if (inj.length) add(['warn', `tools Claude Code gave the agents that cadre does not know: ${inj.join(', ')}`])   // exit rule 3: observed, judged like any other call
  const g = await r(['git', '--version']), gv = ver(text(g))
  add(!g || g.exitCode || !gv ? ['crit', 'git not found', fix('git', 'installs git (needed for worktrees).', 'apt install git')] : atLeast(gv, '2.17') ? ['ok', `git ${gv}`] : ['crit', `git ${gv} is too old for worktrees`, fix('git', 'upgrades git to 2.17 or newer (needed for worktrees).', 'apt install git')])
  const id = g && !g.exitCode ? await identity(h.run, await h.env()) : undefined   // commits land on the user's branches: their own name and email, asked, never made up (ADR 0009)
  if (id?.ok) add(['ok', 'git identity set'])
  else if (id) add(['crit', 'git identity missing: commits need your name and email', 'ask for them, then git config --global user.name and user.email'])
  const w = await r(['bwrap', '--version']), wv = ver(text(w)); facts.bwrap = wv; facts.jail = await jailMode(h.run)
  if (!w || w.exitCode) add(['crit', 'bwrap not found: checks run unjailed', fix('bwrap', 'installs bubblewrap and socat (Claude Code needs them to run commands safely).', 'apt install bubblewrap socat')])
  else if (facts.jail === 'none') {
    const apparmor = (await h.readText('/proc/sys/kernel/apparmor_restrict_unprivileged_userns'))?.trim(), clone = (await h.readText('/proc/sys/kernel/unprivileged_userns_clone'))?.trim()
    if (apparmor === '1') {
      const bin = (await out(['sh', '-c', 'command -v bwrap'])) || '/usr/bin/bwrap'
      add(['warn', `bwrap ${wv} is blocked by AppArmor (kernel.apparmor_restrict_unprivileged_userns=1)`, fix('bwrap-apparmor', `lets only bwrap create user namespaces (AppArmor blocks it: kernel.apparmor_restrict_unprivileged_userns=1). The safest fix.`, `printf 'abi <abi/4.0>,\\ninclude <tunables/global>\\nprofile bwrap ${bin} flags=(unconfined) {\\n  userns,\\n  include if exists <local/bwrap>\\n}\\n' | tee /etc/apparmor.d/bwrap >/dev/null\nsystemctl reload apparmor`)])
      scripts.push({ path: `${dir}/README`, text: `cadre setup: less safe alternatives to ${shown}/bwrap-apparmor.sh\nThey allow user namespaces for EVERY program (Claude Code's sandbox included). Run as root, one of:\n\n  sysctl -w kernel.apparmor_restrict_unprivileged_userns=0   # until reboot\n  echo 'kernel.apparmor_restrict_unprivileged_userns=0' | tee /etc/sysctl.d/60-userns.conf   # keeps it across reboots\n` })
    } else if (clone === '0') add(['warn', `bwrap ${wv} cannot create a user namespace (kernel.unprivileged_userns_clone=0)`, fix('userns-clone', 'allows unprivileged user namespaces (kernel.unprivileged_userns_clone=0 blocks bwrap).', 'sysctl -w kernel.unprivileged_userns_clone=1')])
    else add(['warn', `bwrap ${wv} cannot create a user namespace`, 'see https://code.claude.com/docs/en/sandboxing'])
  } else add(facts.jail === 'copy' ? ['ok', `bwrap ${wv}: copy jail (overlay needs >= 0.11; works, a little slower)`] : ['ok', `bwrap ${wv}: overlay jail`])
  const s = await r(['socat', '-V'])
  add(!s || s.exitCode ? ['crit', 'socat not found (Claude Code needs it on Linux)', fix('socat', 'installs socat (Claude Code needs it on Linux).', 'apt install socat')] : ['ok', 'socat present'])
  const root = await wtRootOf(h, cfg); let p = root   // read-only: the nearest existing ancestor must be writable
  while (p.length > 1 && !(await h.stat(p))) p = p.slice(0, p.lastIndexOf('/')) || '/'
  if ((await r(['test', '-w', p]))?.exitCode === 0) add(['ok', `Linux; worktree root ${root} is writable`])
  else add(['crit', `worktree root ${root} is not writable`, `set worktrees.root in ~/.claude/cadre.json, or fix the permissions of ${p}`])
  return { rows, facts, scripts }
}
// setup only (doctor stays read-only). Returns path -> reason for every script that could not be written
const put = async (h: Host, ss: Script[]): Promise<Map<string, string>> => {
  const bad = new Map<string, string>()
  for (const s of ss) { try { await h.write(s.path, s.text); if (s.exec && (await h.run(['chmod', '700', s.path])).exitCode) throw new Error('chmod failed') } catch (e) { bad.set(s.path, (e as Error).message.split('\n')[0].slice(0, 60)) } }
  return bad
}

// ---- report: one line to the model; the rows go to the pane and ONE summary line to the log (never a multi-line string: the transcript shows it as U+FFFD) ----
async function report(h: Host, name: string, rows: Row[], open = true): Promise<string> {
  await h.ui.update(u => ({ ...u, 'doctor.rows': rows }))
  const bad = rows.filter(r => r[0] === 'crit').length, warn = rows.filter(r => r[0] === 'warn').length
  const line = `${name}: ${[bad && `${bad} fail`, warn && `${warn} warn`, !bad && !warn && 'all ok', 'see the cadre pane'].filter(Boolean).join(' · ')}`
  let fresh = false; await h.ui.update(u => { fresh = u['doctor.last'] !== line; return { ...u, 'doctor.last': line } })
  if (fresh) h.log(line)   // a re-check with the same result adds no new transcript row
  if (h.ops && open) await openPane(h, 'doctor')
  return bad || warn ? `${name}: ${bad} fail, ${warn} warn — report in the cadre pane` : `${name}: all ok`
}

// ---- setup's checklist (commands/agentrun re-runs it at every main turn end): the machine rows plus the user settings; fix scripts for sudo are written here.
// No crit row left = done, and the stamp is written. Warn rows never block.
export async function setupItems(h: Host): Promise<Item[]> {
  const m = await machine(h, await cfgOf(h)), bad = await put(h, m.scripts), path = `${await h.home()}/.claude/settings.json`
  for (const x of m.scripts) if (bad.has(x.path) && x.run) {   // no path to a missing file: a note, the whole command in ONE log line
    for (const r of m.rows) if (r[2] === `! ${x.run}`) r[2] = `couldn't write the fix script (${bad.get(x.path)}); the exact command is in the cadre log`
    h.log(`fix command: ${x.full}`)
  }
  m.rows.push(await userRow(h))
  await report(h, 'setup', m.rows, false)   // the run card holds the checklist; the pane's doctor tab has the rows
  if (!m.rows.some(r => r[0] === 'crit')) await h.store.set(STAMP, { cc: m.facts.cc, bwrap: m.facts.bwrap ?? '', jail: m.facts.jail, at: await h.now() })
  const home = await h.home()
  return [...m.rows.map(([l, t, f]) => ({ name: t.replaceAll(`${home}/`, '~/'), st: l === 'crit' ? 'fail' : l === 'warn' ? 'warn' : 'ok', why: l === 'ok' ? undefined : f?.replace(/^! /, '').replaceAll(`${home}/`, '~/') })), await prefsItem(h)]
}
// The user settings are never edited by a model (ADR 0010). An older cadre put the todo flag there for every project; it now lives in each set-up project's own
// settings (commands/init.GATE). A warn row and a card (init:91) offer to remove it: .bak, write, re-read, like init's safety settings.
const userPlan = async (h: Host) => {
  const path = `${await h.home()}/.claude/settings.json`, old = await h.readText(path); let cur: any = {}
  try { cur = old ? JSON.parse(old) : {} } catch { return { path, error: 'not valid JSON' } }
  if (cur?.env?.[TODO] === undefined) return { path, old, next: null }
  const { [TODO]: _t, ...env } = cur.env, next = { ...cur, env }; if (!Object.keys(env).length) delete next.env
  return { path, old, next, sig: fnv1a64((old ?? '') + TODO) }
}
async function userRow(h: Host): Promise<Row> {
  const p = await userPlan(h); if ('error' in p) return ['warn', `user settings unreadable: ${p.error}`, 'fix ~/.claude/settings.json by hand']
  if (!p.next) return ['ok', 'user settings: nothing of cadre\'s']
  if (await h.store.get(KEPT)) return ['ok', `user settings: env ${TODO} is yours; kept`]   // the user set it themselves (the card's Keep it)
  if ((await h.ui.read())['setup.pending'] !== p.sig || !(await h.board.read()).decisions?.some(d => d.id === `init:${USER_CARD}`)) {
    await h.ui.update(u => ({ ...u, 'setup.pending': p.sig }))
    await initPropose(h, USER_CARD, `setup user settings\n${p.sig}`, { title: 'setup · user settings · confirm', short: 'setup user settings', sub: 'setup', keep: 'setup mine', lines: ['cadre removes this after you confirm (a .bak is kept):', `  ~/.claude/settings.json: - env.${TODO}`, 'each set-up project carries it in its own settings now'] })
  }
  return ['warn', `user settings carry env ${TODO} from an older cadre; it now lives in each project's settings`, 'press 1: remove it in the dialog']
}
export async function confirmUser(h: Host): Promise<string> {
  const was = (await h.ui.read())['setup.pending'], good = await initConfirm(h, USER_CARD), p = await userPlan(h)
  if (!good || !was) return 'setup: nothing pending; press 1 for the current card'
  if ('error' in p || !p.next || p.sig !== was) return 'setup: the settings file changed since you saw it; nothing written'
  const text = JSON.stringify(p.next, null, 2) + '\n'
  if (p.old !== null) await h.write(`${p.path}.bak`, p.old); await h.write(p.path, text); await h.ui.update(({ 'setup.pending': _p, ...u }) => u)
  return (await h.readText(p.path)) === text ? 'setup: user settings written' : 'setup: ~/.claude/settings.json did not read back as written; the .bak has the old file'
}
// the user card's Keep it: the flag is the user's own; Doctor stops offering to remove it
export async function keepUser(h: Host): Promise<string> {
  await initConfirm(h, USER_CARD); await h.store.set(KEPT, true); await h.ui.update(({ 'setup.pending': _p, ...u }) => u)
  return `setup: env ${TODO} stays in your user settings`
}
// clean break (spec 3b): no /cadre off exists; a repo turns cadre off by dropping .cadre/config.json. Its settings.local still carries the gate keys init
// added (scoped 'settings'.added): a card removes exactly those that still hold cadre's value (.bak, write, re-read), then the stamp
const unsetPlan = async (h: Host) => {
  const path = `${await h.cwd()}/.claude/settings.local.json`, st = (await h.store.get(await scoped(h, 'settings'))) as { added?: string[] } | undefined, old = await h.readText(path)
  let cur: any = {}; try { cur = old ? JSON.parse(old) : {} } catch { return null }
  const keys = (st?.added ?? []).filter(k => cur?.env?.[k] !== undefined && cur.env[k] === (GATE as Record<string, string>)[k]); if (!keys.length) return null
  const { ...env } = cur.env; for (const k of keys) delete env[k]; const next = { ...cur, env }; if (!Object.keys(env).length) delete next.env
  return { path, old, keys, next, sig: fnv1a64((old ?? '') + keys.join()) }
}
async function unsetRows(h: Host): Promise<Row[]> {
  const p = await unsetPlan(h); if (!p) return []
  if ((await h.ui.read())['unset.pending'] !== p.sig || !(await h.board.read()).decisions?.some(d => d.id === `init:${UNSET_CARD}`)) {
    await h.ui.update(u => ({ ...u, 'unset.pending': p.sig }))
    await initPropose(h, UNSET_CARD, `setup unset\n${p.sig}`, { title: 'cadre is off here · its settings · confirm', short: 'remove cadre settings', sub: 'setup', confirm: 'setup unset', keep: 'setup keepunset', lines: ['cadre removes these after you confirm (a .bak is kept):', ...p.keys.map(k => `  .claude/settings.local.json: - env.${k}`)] })
  }
  return [['warn', `cadre is not set up here, but its task-tool settings remain (${p.keys.join(', ')})`, 'press 1: remove them in the dialog']]
}
export async function confirmUnset(h: Host, keep = false): Promise<string> {
  const was = (await h.ui.read())['unset.pending'], good = await initConfirm(h, UNSET_CARD), p = await unsetPlan(h)
  await h.ui.update(({ 'unset.pending': _p, ...u }) => u)
  if (keep) { await h.store.del(await scoped(h, 'settings')); return 'setup: the settings stay; cadre no longer counts them as its own' }
  if (!good || !was) return 'setup: nothing pending; press 1 for the current card'
  if (!p || p.sig !== was) return 'setup: the settings file changed since you saw it; nothing written'
  const text = JSON.stringify(p.next, null, 2) + '\n'
  if (p.old !== null) await h.write(`${p.path}.bak`, p.old); await h.write(p.path, text); await h.store.del(await scoped(h, 'settings'))
  return (await h.readText(p.path)) === text ? 'setup: cadre\'s task-tool settings removed from this project · restart Claude Code for it to apply' : 'setup: settings.local.json did not read back as written; the .bak has the old file'
}
// session.start: no stamp, or the Claude Code build changed since: one toast
export async function setupDue(h: Host): Promise<boolean> {   // also registers main's preferences tool in a dormant repo (hooks/register)
  const s = (await h.store.get(STAMP)) as { cc?: string } | undefined, cc = await h.version?.().catch(() => undefined)
  return !s || (!!cc && s.cc !== cc)
}
// the task-tool gate of this repo (commands/init.GATE): its stamp's rev and the live file (the gate keys only)
export async function gateDue(h: Host): Promise<boolean> {
  const st = (await h.store.get(await scoped(h, 'settings'))) as { rev?: number } | undefined, t = await h.readText(`${await h.cwd()}/.claude/settings.local.json`)
  let local = {}; try { local = t ? JSON.parse(t) : {} } catch { /* unreadable: the gate is due */ }
  return st?.rev !== GATE_REV || !gated(local)
}
export async function nudge(h: Host): Promise<void> { if (await setupDue(h)) h.toast('cadre: run /cadre setup'); else if (await gateDue(h)) h.toast('cadre: run /cadre init') }
// main's tools: Claude Code refused them, or the repo turned on after this session started (they load at main's next turn: hooks/register.arm)
export async function toolsRow(h: Host): Promise<Row> {
  const s = await h.secret.read(), t = s.tools
  if (t?.refused.length) return ['crit', `Claude Code refused cadre's tools: ${t.refused.join(', ')}`, 'cadre needs its tools: drop allowedMcpServers from managed settings, or start Claude Code without --bare']
  if (s.active && t && !t.on.includes('plan')) return ['warn', 'the planning tools load at Claude\'s next turn', 'send Claude any message; if they stay missing, restart Claude Code']
  if (s.active && t?.task?.length) return ['crit', `the built-in task tools are on in this session (${t.task.join(', ')})`, '/cadre init, then restart Claude Code']
  return s.active && (await gateDue(h)) ? ['crit', 'settings.local lacks the task-tool gate', '/cadre init'] : ['ok', 'cadre tools loaded']
}

// ---- doctor: machine rows + project rows; no writes ----
async function project(h: Host, cfg: Config): Promise<Row[]> {
  const root = await h.cwd(), rows: Row[] = [], safe = async <T>(f: () => Promise<T>, d: T) => f().catch(() => d)
  if (!(await h.secret.read()).active && !(await h.readText(`${root}/.cadre/config.json`))) return [['warn', 'project: not set up here (no .cadre/config.json)', '/cadre <goal> sets it up'], ...(await unsetRows(h))]
  if (!(await gitOk(h.run, root, ['rev-parse', '--git-dir']))) return [['crit', 'not inside a git repo', '/cadre init']]
  const miss = (await progress(h)).filter(s => !s.done)
  rows.push(miss.length ? ['warn', `init incomplete: ${miss.map(s => s.name).join(', ')}`, '/cadre init'] : ['ok', 'init complete'])
  const us = unitsOf(cfg), ROW = { yes: ['ok', 'test check writes JUnit: yes'], no: ['warn', 'test check writes JUnit: no: red checks use the exit code only', 'rerun /cadre init'], unprobed: ['warn', 'test check writes JUnit: not probed on this machine: rerun /cadre init'], none: ['ok', 'test check: none: the first feature/bug task sets one up'] } as const
  for (const u of us) { const r = ROW[await probeOf(h, u)]; rows.push([r[0], `${us.length > 1 ? `${u.root}: ` : ''}${r[1]}`, r[2]]) }   // read from the store: Doctor probes nothing
  const pol = await policyOf(h), c = assess(await safe(() => h.settings(), {}), pol.repo, pol.wtRoot)
  rows.push(c.state === 'contained' ? ['ok', 'containment contained'] : ['warn', `containment degraded: ${c.why.join('; ')}`, '/cadre init'])
  for (const old of ['.beads', '.cadre/store']) if (await h.stat(`${root}/${old}`)) rows.push(['warn', `${old}: a task store from an older version; it is not read`, `finish its plans with that version, then delete ${old}`])   // clean break (0.15)
  if ((await h.store.get(`sync.control:${(await h.board.read()).repo}`)) || (await h.store.get(await scoped(h, 'runs'))) || (await h.store.get(await scoped(h, 'board')))) rows.push(['warn', 'run and sync state from an older version is not read', 'finish those plans with that version; sync starts over from a full compare'])
  let tasks: Awaited<ReturnType<Awaited<ReturnType<typeof storeOf>>['list']>> = []
  try { const s = await storeOf(h), p = await s.probe(); rows.push(!p.ok ? ['crit', `task store: ${p.detail.slice(0, 100)}`, 'cadre stays off here: put the project on a disk with hard links'] : p.journal ? ['ok', 'task store in .cadre/state, journal on'] : ['warn', 'task store journal off', '/cadre init']); if (p.ok) tasks = await s.list({}) }
  catch (e) { rows.push(['crit', `task store unreachable: ${(e as Error).message.slice(0, 100)}`, 'cadre stays off here: put the project on a disk with hard links']) }
  if (await oldState(h, tasks)) rows.push(['warn', 'finish or cancel plans from the previous version before upgrading', 'its run state is not read: finish or cancel those plans with the previous version'])
  if (cfg.landing.mode === 'pr') {   // H6: plans land as pull requests; without gh (or signed out) nothing is pushed and the plan waits
    const v = await h.run(['gh', '--version'], { timeoutMs: 5000 }).catch(() => undefined), a = v && !v.exitCode ? await h.run(['gh', 'auth', 'status'], { timeoutMs: 5000 }).catch(() => undefined) : undefined
    rows.push(!v || v.exitCode ? ['crit', 'landing.mode is pr but gh is not installed', 'install the GitHub CLI (gh), or set landing.mode direct'] : !a || a.exitCode ? ['crit', 'landing.mode is pr but gh is not signed in', 'gh auth login'] : ['ok', 'gh ready: plans land as pull requests'])
  }
  for (const b of [cfg.branches.main, cfg.branches.dev]) rows.push(b && await exists(h.run, root, b) ? ['ok', `branch ${b} exists`] : ['crit', `branch ${b || '(main unset)'} missing`, '/cadre init'])
  const now = await h.now(), stale = tasks.filter(t => t.assignee && ['active', 'review', 'blocked'].includes(t.category) && !leaseLive(t, now)).map(t => t.id), bound = Object.keys(await h.bind.read()).filter(k => !k.startsWith('~')).length
  rows.push(stale.length ? ['warn', `expired leases: ${stale.join(', ')}`, 'main spawns them again; they rebind'] : ['ok', `no stale leases; ${bound} agent(s) bound`])
  const b = await h.board.read(), fl = b.tasks.filter(t => t.flags.length)
  const sh = b.tasks.filter(t => t.flags.includes('shape')).map(t => t.id); if (sh.length) rows.push(['warn', `blocked by malformed reports (over limits.shapeRetries): ${sh.join(', ')}`, 'press 1: Retry starts the agent again'])
  rows.push(fl.length ? ['warn', `open flags: ${fl.map(t => `${t.id} ${t.flags.join('+')}`).join(', ')}`, 'press 1: answer it in the dialog'] : ['ok', 'no open flags'])
  const q = (await h.run(['git', '-C', root, 'for-each-ref', 'refs/cadre/quarantine', '--format=%(refname)'])).stdout.split('\n').filter(Boolean).length
  rows.push(q ? ['warn', `${q} quarantined ref(s)`, 'press 1: keep or restore in the dialog'] : ['ok', 'no quarantined refs'])
  const rq = ((await h.store.get(await qk(h))) as unknown[] | undefined)?.length ?? 0
  rows.push(rq ? ['warn', `${rq} resume(s) queued`, 'they are sent at the next turn'] : ['ok', 'no queued resumes'])
  for (const [t, v] of Object.entries(cfg.sync)) {
    const a = (cfg.adapters as Record<string, any>)[(v as any)?.adapter ?? t]
    rows.push(await call(h, t, a ?? {}, 'ping', {}, 5000).then((): Row => ['ok', `sync ${t} answers`], (e): Row => ['warn', `sync ${t}: ${e.message}`, '/cadre sync now']))
  }
  rows.push(b.drive.stopped ? ['warn', `drive stopped: ${b.drive.stopped}`, 'press 0 on the band to resume'] : b.drive.paused ? ['warn', `drive paused: ${b.drive.paused}`, 'it continues by itself after you answer'] : ['ok', `drive ${b.drive.on ? `on, ${b.drive.turns} turns` : 'off until a plan is approved'}`])
  return rows
}
// clean break (0.14): what 0.13 kept is not read: its counters on open tasks, hand-back marks, agents bound with no run record (they started from a TASK-<id> prompt)
export async function oldState(h: Host, tasks: { category: string; meta: Record<string, string> }[]): Promise<boolean> {
  const bind = await h.bind.read(), keys = ['attempts', 'testerRounds', 'rework', 'rebase', 'nudge'].map(k => `cadre.${k}`)   // read only: the write scan (scripts/budget.mjs) matches these names
  if (tasks.some(t => ['active', 'review', 'blocked'].includes(t.category) && keys.some(k => t.meta[k])) || 'handed' in (await h.ui.read())) return true
  for (const a of Object.keys(bind)) if (!a.startsWith('~') && !(await runOf(h, a))) return true
  return false
}
export async function doctor(h: Host): Promise<string> {
  const cfg = await cfgOf(h)
  const m = await machine(h, cfg)   // read-only: a fix line only when its script already exists (setup writes them)
  for (const x of m.scripts) if (x.run && (await h.readText(x.path)) === null) for (const r of m.rows) if (r[2] === `! ${x.run}`) r[2] = 'run /cadre setup to prepare the fix'
  const pe = (await h.ui.read()).paneErr as { reason: string } | undefined   // ui/index.openPane: the last open that failed this session
  return report(h, 'doctor', [...m.rows, await userRow(h), await prefsRow(h), await toolsRow(h), ...(await doctorRows(h)), ...(pe ? [['warn', `the cadre pane could not open: ${pe.reason}`, 'run /cadre to open it; if it keeps failing, report the reason'] as Row] : []), ...(await project(h, cfg))])
}
