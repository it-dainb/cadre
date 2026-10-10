// /cadre setup (once per machine: preflight, a plan of user-level actions, one confirm, execute, stamp) and /cadre doctor (read-only diagnosis). ADR 0007.
// The command text is ONE line; the report goes to the human surface only (pane tab "doctor" + ui.log). Setup runs only user-level actions after the confirm; sudo and PATH fixes stay with the human.
import type { Host } from '../types'
import type { Config } from '../config'
import { canon, fnv1a64, leaseLive } from '../core/board'
import { cfgOf, initConfirm, initPropose, storeOf } from '../core/dispatch'
import { ask, handOff, settle } from '../core/decide'
import { exists, jailMode, ok as gitOk } from '../core/git'
import { wtRootOf } from '../core/branches'
import { qk } from '../core/session'
import { assess } from '../policy/containment'
import { policyOf } from '../policy/guards'
import { apply as mapply, plan as mplan } from '../policy/settings'
import { call } from '../task-management/protocol'
import { openPane } from '../ui/index'
import { after as initAfter, progress } from './init'

export type Row = ['ok' | 'warn' | 'crit', string, string?]   // level, line, fix (a command for the human)
const PIN = '2.1.295', SETUP = 90, STAMP = 'cadre:setup', PATCH = { env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' } }
const ver = (s: string) => s.match(/\d+(\.\d+)+/)?.[0] ?? ''
const atLeast = (v: string, min: string) => { const a = v.split('.').map(Number), b = min.split('.').map(Number); for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0); return true }
const userPath = async (h: Host) => `${await h.home()}/.claude/settings.json`

// ---- machine checks (shared by setup and doctor); every probe goes through h.run so tests inject fixtures ----
// acts = what setup can run itself (user-level, no sudo); human = what only the human can run once (sudo, PATH fixes)
export type Act = { label: string; argv?: string[]; settings?: true }
const BD_SH = 'curl -fsSL https://raw.githubusercontent.com/gastownhall/beads/main/scripts/install.sh | bash'
// a human-run fix is a script under <cache>/cadre/fix (0700, harmless until run); the card, the pane and the copy button only ever show the ONE short line that runs it (ADR 0007, 0.5.1)
export type Script = { path: string; text: string; run?: string; full?: string; exec?: true }   // run = the short line that runs it; full = the same fix as one copy-safe command
export async function machine(h: Host, cfg: Config): Promise<{ rows: Row[]; facts: Record<string, string>; acts: Act[]; human: string[]; own: Row[]; scripts: Script[] }> {
  const r = (argv: string[]) => h.run(argv, { timeoutMs: 5000 }).catch(() => undefined), text = (x?: { stdout: string; stderr: string }) => `${x?.stdout}${x?.stderr}`, out = async (argv: string[]) => (await r(argv))?.stdout.trim() ?? ''
  const mac = (await r(['uname', '-s']))?.stdout.trim() === 'Darwin', pm = mac ? 'brew install' : 'apt install', rows: Row[] = [], facts: Record<string, string> = {}, acts: Act[] = [], human: string[] = [], own: Row[] = [], scripts: Script[] = []
  const add = (x: Row, mine = false): void => { rows.push(x); if (mine) own.push(x); if (x[2]?.startsWith('! ') && !mine) human.push(x[2]) }
  const home = await h.home(), dir = `${(await h.env()).XDG_CACHE_HOME || `${home}/.cache`}/cadre/fix`, shown = dir.startsWith(`${home}/`) ? `~${dir.slice(home.length)}` : dir
  const fix = (name: string, why: string, cmd: string, root = true): string => {
    const run = `${root ? 'sudo ' : ''}sh ${shown}/${name}.sh`
    scripts.push({ path: `${dir}/${name}.sh`, exec: true, run, full: `${root ? 'sudo ' : ''}sh -c '${cmd.split('\n').join(' && ').replaceAll("'", "'\\''")}'`, text: `#!/bin/sh\n# cadre setup: ${why}\n# Run it once, yourself: ${run}\nset -eu\n${cmd}\n` })
    return `! ${run}`
  }
  facts.cc = (await h.version?.().catch(() => '')) ?? ''
  const cmp = ver(facts.cc) && !atLeast(PIN, ver(facts.cc)) ? 'newer than' : 'older than'
  add(!facts.cc ? ['warn', 'Claude Code version unreadable'] : facts.cc === PIN ? ['ok', `Claude Code ${PIN} (the pinned build)`] : ['warn', `Claude Code ${facts.cc}: ${cmp} the tested ${PIN}; ${cmp === 'newer than' ? 'usually fine' : 'update it with claude update'}`])
  const g = await r(['git', '--version']), gv = ver(text(g))
  add(!g || g.exitCode || !gv ? ['crit', 'git not found', fix('git', 'installs git (needed for worktrees).', `${pm} git`, !mac)] : atLeast(gv, '2.17') ? ['ok', `git ${gv}`] : ['crit', `git ${gv} is too old for worktrees`, fix('git', 'upgrades git to 2.17 or newer (needed for worktrees).', `${pm} git`, !mac)])
  const b = await r([cfg.store.bin, 'version']), bv = ver(text(b)); facts.bd = bv
  const rev = b?.exitCode === 0 && /--if-revision/.test(text(await r([cfg.store.bin, 'update', '--help'])))
  if (b && !b.exitCode && bv && atLeast(bv, '1.3.0')) add(['ok', `bd ${bv} (${rev ? 'if-revision supported' : 'no if-revision: read-check-write fallback'})`])
  else {
    const head = b && !b.exitCode && bv ? `bd ${bv} is older than 1.3.0` : `${cfg.store.bin} not found`, where = await out(['sh', '-c', 'command -v "$0"', cfg.store.bin])
    const npm = (await r(['npm', '--version']))?.exitCode === 0, pre = npm ? await out(['npm', 'prefix', '-g']) : '', alt = pre && `${pre}/bin/${cfg.store.bin}`, av = alt && alt !== where ? ver(text(await r([alt, 'version']))) : ''
    const mine = !!where && where.startsWith(`${await h.home()}/`), aside: Act = { label: `moving the old ${cfg.store.bin} aside`, argv: ['mv', where, `${where}.cadre-old`] }   // a stale bd in a folder the user owns: reversible move, never rm, never in a system folder
    if (where && av && atLeast(av, '1.3.0')) { if (mine) acts.push(aside); add(['crit', `bd ${bv || '?'} at ${where} shadows bd ${av} at ${alt}`, mine ? `! mv ${where} ${where}.cadre-old` : fix('rm-bd', `removes the old bd at ${where} that shadows bd ${av} at ${alt}. Alternative without sudo: put ${pre}/bin first in PATH.`, `rm ${where}`)], mine) }
    else if (npm) { acts.push({ label: 'installing bd', argv: ['npm', 'install', '-g', '@beads/bd@latest'] }); if (mine && bv && where !== alt) acts.push(aside); add(['crit', head, '! npm install -g @beads/bd@latest'], true) }
    else if ((await r(['curl', '--version']))?.exitCode === 0) { acts.push({ label: 'installing bd', argv: ['sh', '-c', BD_SH] }); add(['crit', head, `! ${BD_SH}`], true) }
    else { add(['crit', head, 'install Node.js (npm) or curl first']); human.push('install Node.js (npm) or curl, then /cadre setup again') }
  }
  if (mac) { facts.jail = 'none'; add(['warn', 'no bwrap on macOS: throwaway-worktree mode, network unenforced']) }
  else {
    const w = await r(['bwrap', '--version']), wv = ver(text(w)); facts.bwrap = wv; facts.jail = await jailMode(h.run)
    if (!w || w.exitCode) add(['crit', 'bwrap not found: checks run unjailed', fix('bwrap', 'installs bubblewrap and socat (the Claude sandbox needs them).', `${pm} bubblewrap socat`, !mac)])
    else if (facts.jail === 'none') {
      const apparmor = (await h.readText('/proc/sys/kernel/apparmor_restrict_unprivileged_userns'))?.trim(), clone = (await h.readText('/proc/sys/kernel/unprivileged_userns_clone'))?.trim()
      if (apparmor === '1') {
        const bin = (await out(['sh', '-c', 'command -v bwrap'])) || '/usr/bin/bwrap'
        add(['warn', `bwrap ${wv} is blocked by AppArmor (kernel.apparmor_restrict_unprivileged_userns=1)`, fix('bwrap-apparmor', `lets only bwrap create user namespaces (AppArmor blocks it: kernel.apparmor_restrict_unprivileged_userns=1). The safest fix.`, `printf 'abi <abi/4.0>,\\ninclude <tunables/global>\\nprofile bwrap ${bin} flags=(unconfined) {\\n  userns,\\n  include if exists <local/bwrap>\\n}\\n' | tee /etc/apparmor.d/bwrap >/dev/null\nsystemctl reload apparmor`)])
        scripts.push({ path: `${dir}/README`, text: `cadre setup: less safe alternatives to ${shown}/bwrap-apparmor.sh\nThey allow user namespaces for EVERY program (Claude Code's sandbox included). Run as root, one of:\n\n  sysctl -w kernel.apparmor_restrict_unprivileged_userns=0   # until reboot\n  echo 'kernel.apparmor_restrict_unprivileged_userns=0' | tee /etc/sysctl.d/60-userns.conf   # keeps it across reboots\n` })
        human.push(`less safe options: ${shown}/README`)
      } else if (clone === '0') add(['warn', `bwrap ${wv} cannot create a user namespace (kernel.unprivileged_userns_clone=0)`, fix('userns-clone', 'allows unprivileged user namespaces (kernel.unprivileged_userns_clone=0 blocks bwrap).', 'sysctl -w kernel.unprivileged_userns_clone=1')])
      else add(['warn', `bwrap ${wv} cannot create a user namespace`, 'see https://code.claude.com/docs/en/sandboxing'])
    } else add(facts.jail === 'copy' ? ['ok', `bwrap ${wv}: copy jail (overlay needs >= 0.11; works, a little slower)`] : ['ok', `bwrap ${wv}: overlay jail`])
    const s = await r(['socat', '-V'])
    add(!s || s.exitCode ? ['crit', 'socat not found (the Claude sandbox needs it)', fix('socat', 'installs socat (the Claude sandbox needs it).', `${pm} socat`, !mac)] : ['ok', 'socat present'])
  }
  const root = await wtRootOf(h, cfg); let p = root   // read-only: the nearest existing ancestor must be writable
  while (p.length > 1 && !(await h.stat(p))) p = p.slice(0, p.lastIndexOf('/')) || '/'
  if ((await r(['test', '-w', p]))?.exitCode === 0) { add(['ok', `${mac ? 'macOS' : 'Linux'}; worktree root ${root} is writable`]); if (p !== root) acts.push({ label: 'creating the worktree folder', argv: ['mkdir', '-p', root] }) }
  else add(['crit', `worktree root ${root} is not writable`, `set worktrees.root in ~/.claude/cadre.json, or fix the permissions of ${p}`])
  return { rows, facts, acts, human, own, scripts }
}
// setup only (doctor stays read-only). Returns path -> reason for every script that could not be written
const put = async (h: Host, ss: Script[]): Promise<Map<string, string>> => {
  const bad = new Map<string, string>()
  for (const s of ss) { try { await h.write(s.path, s.text); if (s.exec && (await h.run(['chmod', '700', s.path])).exitCode) throw new Error('chmod failed') } catch (e) { bad.set(s.path, (e as Error).message.split('\n')[0].slice(0, 60)) } }
  return bad
}
const userPlan = async (h: Host) => mplan(h, await userPath(h), PATCH).catch((e: Error) => e)

// ---- report: one line to the model; the rows go to the pane and ONE summary line to the log (never a multi-line string: the transcript shows it as U+FFFD) ----
async function report(h: Host, name: string, rows: Row[], text?: string, extra: string[] = []): Promise<string> {
  await h.ui.update(u => ({ ...u, 'doctor.rows': rows }))
  const bad = rows.filter(r => r[0] === 'crit').length, warn = rows.filter(r => r[0] === 'warn').length
  const line = `${name}: ${[...extra, bad && `${bad} fail`, warn && `${warn} warn`, !extra.length && !bad && !warn && 'all ok', 'see the cadre pane'].filter(Boolean).join(' · ')}`
  let fresh = false; await h.ui.update(u => { fresh = u['doctor.last'] !== line; return { ...u, 'doctor.last': line } })
  if (fresh) h.log(line)   // a re-check with the same result adds no new transcript row
  if (h.ops) await openPane(h, 'doctor')
  return text ?? (bad || warn ? `${name}: ${bad} fail, ${warn} warn — report in the cadre pane` : `${name}: all ok`)
}

// ---- setup: preflight, plan, one confirm, execute, then (dormant repos only) hand what is left to the main agent ----
type Plan = { rows: Row[]; facts: Record<string, string>; acts: Act[]; human: string[]; own: Row[]; hash: string; scripts: Script[]; copy?: string }   // copy = what [y] puts on the clipboard
async function preflight(h: Host, cfg: Config): Promise<Plan> {
  const m = await machine(h, cfg), p = await userPlan(h), acts = [...m.acts], bad = await put(h, m.scripts)
  const first = m.scripts.find(x => x.run && m.human.includes(`! ${x.run}`)), copy = first && (bad.has(first.path) ? first.full : first.run)
  for (const x of m.scripts) if (bad.has(x.path) && x.run) {   // no path to a missing file: a pane note, the whole command in ONE log line
    const note = `couldn't write the fix script (${bad.get(x.path)}); the exact command is in the cadre log`
    for (const r of m.rows) if (r[2] === `! ${x.run}`) r[2] = note
    m.human = m.human.map(l => (l === `! ${x.run}` ? note : l)); h.log(`fix command: ${x.full}`)
  }
  if (p instanceof Error) m.rows.push(['crit', p.message])
  else if (p.lines.length) { acts.push({ label: 'writing user settings', settings: true }); m.rows.push(['warn', `user settings need a change (${p.lines.join('; ')})`]) }
  else m.rows.push(['ok', 'user settings: env CLAUDE_CODE_ENABLE_TODO_TOOLS is set'])
  return { ...m, acts, copy, hash: fnv1a64(JSON.stringify(acts) + (p instanceof Error ? '' : p.lines.join('\n') + canon(p.old))) }
}
const shown = (h: Host, P: Pick<Plan, 'acts' | 'human'>, extra: Record<string, unknown> = {}) => h.ui.update(u => ({ ...u, 'setup.plan': { acts: P.acts.map(a => [a.label, '']), human: P.human, ...extra } }))
const left = (P: Plan, planned = false) => P.rows.filter(r => r[0] === 'crit' && !/\bsudo\b/.test(r[2] ?? '') && !(planned && P.own.includes(r)))   // what no password can fix: Claude can try (planned: minus what our own actions are about to fix)
const asleep = async (h: Host) => !(await h.secret.read()).active   // in an active repo main has no shell: only the scripted fixes run there
// the brief main gets: the failing checks with evidence, the goal, the limits, when to stop. Task language only (ADR 0006 lint).
export const brief = (home: string, rows: Row[], failed?: { label: string; argv: string[]; out: string[] }): string => [
  "Please fix this machine's setup. Each check below must pass when you are done.", '',
  ...rows.map((r, i) => `${i + 1}. ${r[1]}${r[2] ? `\n   suggested: ${r[2].replace(/^! /, '')}` : ''}`),
  ...(failed ? ['', `This step failed: ${failed.label} (${failed.argv.join(' ')})`, ...failed.out.map(l => `   ${l}`)] : []), '',
  'Rules: no sudo. Never touch the Claude Code install. Prefer user-level fixes (your home folder, an npm prefix you own, a PATH line in your shell profile). Move things aside instead of deleting them. Say what you changed.',
  'When you are done, stop. The checks run again on their own.',
].join('\n').replaceAll(`${home}/`, '~/')

async function card(h: Host, P: Plan, fixing?: number, ran = false): Promise<void> {
  const L = left(P, !ran), can = !!L.length && await asleep(h), code = (await h.secret.read()).initConfirm?.code
  const lines = fixing !== undefined ? [`Claude is fixing setup… (${fixing} issue${fixing > 1 ? 's' : ''})`] : [
    ...(P.acts.length ? ['cadre runs:', ...P.acts.map((a, i) => `  ${i + 1}. ${a.label}`)] : []),
    ...(can ? ['then Claude is asked to fix:', ...L.map(r => `  · ${r[1]}`)] : L.length ? ['Open Claude in another folder to let it fix the rest:', ...L.map(r => `  · ${r[1]}`)] : []),
    ...(P.human.length ? ['Run in a terminal (needs your password; ! sudo inside Claude cannot ask for it):', ...P.human.map(x => `  ${x.replace(/^! /, '')}`)] : []),
  ]
  if (!lines.length) return settle(h, `init:${SETUP}`)
  const ok = !!code && fixing === undefined && (P.acts.length || can)
  await ask(h, { id: `init:${SETUP}`, kind: 'init', title: fixing !== undefined ? 'setup · Claude is fixing it' : 'setup · needs you', short: 'setup needs you', lines, hash: fnv1a64(P.hash + lines.join('\n')), tab: 'epic', fallback: '/cadre setup confirm {code}',
    options: [...(ok ? [{ key: 'a', label: 'Fix all', verb: 'approve', run: 'setup confirm {code}' }] : []), ...(h.ops?.copy && P.copy ? [{ key: 'y', label: 'Copy command', verb: 'change', run: 'setup copy' }] : []), { key: 'r', label: 'Re-check', verb: 'change', run: 'setup' }, { key: 'x', label: 'Cancel', verb: 'reject', run: 'setup cancel' }] }, code)
}
type Failed = { label: string; argv: string[]; out: string[] }
// the plan's actions in order; the first failure stops the run (its last output lines are the evidence)
async function runActs(h: Host, P: Plan, path: string): Promise<{ st: string[][]; failed?: Failed }> {
  const st: string[][] = P.acts.map(a => [a.label, '']), tail: string[] = []
  for (const [i, a] of P.acts.entries()) {
    st[i][1] = 'run'; await shown(h, P, { acts: st }); h.toast(`setup: ${a.label}`)
    let bad = ''
    if (a.settings) await mapply({ readText: h.readText, writeText: h.write }, path, PATCH).catch((e: Error) => { bad = e.message })
    else { const x = await h.run(a.argv!, { timeoutMs: 300000 }).catch((e: Error) => ({ exitCode: 1, stdout: '', stderr: e.message })); if (x.exitCode) { bad = `exit ${x.exitCode}`; tail.push(...`${x.stdout}\n${x.stderr}`.split('\n').filter(Boolean).slice(-8)) } }
    st[i][1] = bad ? 'fail' : 'ok'
    if (bad) return { st, failed: { label: a.label, argv: a.argv ?? ['write', 'user settings'], out: tail.length ? tail : [bad] } }
  }
  return { st }
}
// one hand-off per run (core/decide.handOff); only the end of the turn it started (turnStarted, below) re-checks.
// ours = the brief itself, or a turn with no typed prompt (the engine may not pass a plugin message as text); a user's own prompt in between differs.
// turn.start (every turn, any caller of $.prompt.submit: a press's own call is invisible to our prompt.submit hook, G6): the first turn after the send whose text is our brief (or empty) is the fix turn
export async function turnStarted(h: Host, e: { text?: string; turnId?: string }): Promise<void> {
  const f = (await h.secret.read()).setupFix
  if (f?.sent && !f.turn && e.turnId && (!e.text || e.text.includes(f.text))) await h.secret.update(s => ({ ...s, setupFix: { ...f, turn: e.turnId } }))
}
// main's turn.complete: send a queued brief; at the end of the fix turn run the scripted actions it skipped, then re-check (card, stamp). Never hands off again.
export async function afterFix(h: Host, e: { turnId?: string } = {}): Promise<void> {
  const f = (await h.secret.read()).setupFix
  if (!f) return initAfter(h, false)   // init discovery may have reported in a later turn
  if (!f.sent) { await h.secret.update(s => ({ ...s, setupFix: { ...f, sent: true } })); return void (await h.submit?.(f.text!).catch(() => h.secret.update(({ setupFix: _f, ...s }) => s))) }
  if (!f.turn || f.turn !== e.turnId) return   // another turn ended (the one that was running when the brief was queued, or the brief has not started): no early re-check
  await h.secret.update(({ setupFix: _f, ...s }) => s)
  if (f.kind === 'init') return initAfter(h, true)
  const P = await preflight(h, await cfgOf(h)); if (P.acts.length) await runActs(h, P, await userPath(h))
  await setup(h, [])
}
export async function setup(h: Host, args: string[]): Promise<string> {
  const cfg = await cfgOf(h), path = await userPath(h)
  let P = await preflight(h, cfg), note = '', fixed = 0, ran = false, fixing: number | undefined, stopped = ''
  if (args[0] === 'copy') { return P.copy && (await h.ops?.copy?.(P.copy))?.isCopied ? 'copied' : 'not copied: select the line in the card' }
  if (args[0] === 'confirm') {
    const was = ((await h.ui.read())['setup.pending'] as string | undefined), good = await initConfirm(h, SETUP, args[1] ?? '')   // burns on every attempt
    if (!good) return 'setup: wrong code or nothing pending (burned); run /cadre setup again'
    if (P.hash !== was) note = 'setup: the plan changed since it was shown; nothing ran; confirm again with the new code'
    else {
      await h.ui.update(({ 'setup.pending': _p, ...u }) => u)
      const r = await runActs(h, P, path), st = r.st, failed = r.failed
      if (failed) stopped = `setup: stopped at "${failed.label}"; output in the cadre pane`
      ran = true; fixed = st.filter(x => x[1] === 'ok').length
      const before = P; P = await preflight(h, cfg)
      const rest = left(P)
      if ((failed || rest.length) && await asleep(h)) { fixing = rest.length || 1; await handOff(h, brief(await h.home(), rest.length ? rest : before.rows.filter(r => r[0] !== 'ok'), failed), fixing); stopped = '' }
      await shown(h, { acts: [], human: P.human }, failed ? { acts: st, out: failed.out } : { done: st })
      if (failed && fixing === undefined) { await card(h, P, undefined, true); return report(h, 'setup', P.rows, stopped, [fixed && `${fixed} fixed`, P.human.length && `${P.human.length} needs sudo`].filter(Boolean) as string[]) }
    }
  }
  const sudo = P.human.length
  if (P.acts.length || sudo || left(P, !ran).length) { await h.ui.update(u => ({ ...u, 'setup.pending': P.hash })); await initPropose(h, SETUP, P.hash); await card(h, P, fixing, ran); if (fixing === undefined && (P.acts.length || await asleep(h) && left(P, !ran).length)) await shown(h, P); else await shown(h, { acts: [], human: P.human }) }
  else { await settle(h, `init:${SETUP}`); if (args[0] !== 'confirm' || note) await h.ui.update(({ 'setup.plan': _s, ...u }) => u) }
  if (!P.rows.some(r => r[0] === 'crit') && !P.acts.length) await h.store.set(STAMP, { cc: P.facts.cc, bd: P.facts.bd, bwrap: P.facts.bwrap ?? '', jail: P.facts.jail, at: await h.now() })
  const sum = [fixed && `${fixed} fixed`, sudo && `${sudo} needs sudo`, fixing !== undefined && 'Claude is fixing the rest'].filter(Boolean) as string[]
  return report(h, 'setup', P.rows, note || (fixing !== undefined ? `setup: Claude is fixing ${fixing} issue${fixing > 1 ? 's' : ''}; the checks run again when it stops` : P.acts.length ? `setup: ${P.acts.length} action${P.acts.length > 1 ? 's' : ''} ready · confirm with the code on the band` : undefined), sum)
}
// session.start: no stamp, or the Claude Code build changed since: one toast
export async function nudge(h: Host): Promise<void> {
  const s = (await h.store.get(STAMP)) as { cc?: string } | undefined, cc = await h.version?.().catch(() => undefined)
  if (!s || (cc && s.cc !== cc)) h.toast('cadre: run /cadre setup')
}

// ---- doctor: machine rows + project rows; no writes ----
async function project(h: Host, cfg: Config): Promise<Row[]> {
  const root = await h.cwd(), rows: Row[] = [], safe = async <T>(f: () => Promise<T>, d: T) => f().catch(() => d)
  if (!(await h.secret.read()).active && !(await h.readText(`${root}/.cadre/config.json`))) return [['warn', 'project: cadre off here (no .cadre/config.json)', '/cadre init']]
  if (!(await gitOk(h.run, root, ['rev-parse', '--git-dir']))) return [['crit', 'not inside a git repo', '/cadre init 1']]
  const miss = (await progress(h)).filter(s => !s.done)
  rows.push(miss.length ? ['warn', `init stages incomplete: ${miss.map(s => `${s.n} ${s.name}`).join(', ')}`, '/cadre init'] : ['ok', 'init stages complete'])
  const pol = await policyOf(h), c = assess(await safe(() => h.settings(), {}), pol.repo, pol.wtRoot)
  rows.push(c.state === 'contained' ? ['ok', 'containment contained'] : ['warn', `containment degraded: ${c.why.join('; ')}`, '/cadre init containment'])
  let tasks: Awaited<ReturnType<Awaited<ReturnType<typeof storeOf>>['list']>> = []
  try { const s = await storeOf(h), p = await s.probe(); rows.push(!p.ok ? ['crit', `beads: ${p.detail.slice(0, 100)}`, '/cadre init store'] : p.journal ? ['ok', `beads ${p.version} reachable, journal on`] : ['warn', 'beads reachable, journal off', '/cadre init store']); if (p.ok) tasks = await s.list({}) }
  catch (e) { rows.push(['crit', `beads unreachable: ${(e as Error).message.slice(0, 100)}`, '/cadre init store']) }
  for (const b of [cfg.branches.main, cfg.branches.dev]) rows.push(b && await exists(h.run, root, b) ? ['ok', `branch ${b} exists`] : ['crit', `branch ${b || '(main unset)'} missing`, '/cadre init repo'])
  const now = await h.now(), stale = tasks.filter(t => t.assignee && ['active', 'review', 'blocked'].includes(t.category) && !leaseLive(t, now)).map(t => t.id), bound = Object.keys(await h.bind.read()).filter(k => !k.startsWith('~')).length
  rows.push(stale.length ? ['warn', `expired leases: ${stale.join(', ')}`, 'main spawns them again; they rebind'] : ['ok', `no stale leases; ${bound} agent(s) bound`])
  const b = await h.board.read(), fl = b.tasks.filter(t => t.flags.length)
  rows.push(fl.length ? ['warn', `open flags: ${fl.map(t => `${t.id} ${t.flags.join('+')}`).join(', ')}`, '/cadre resolve <id> keep|accept|reject|cancel'] : ['ok', 'no open flags'])
  const q = (await h.run(['git', '-C', root, 'for-each-ref', 'refs/cadre/quarantine', '--format=%(refname)'])).stdout.split('\n').filter(Boolean).length
  rows.push(q ? ['warn', `${q} quarantined ref(s)`, '/cadre resolve git keep|restore'] : ['ok', 'no quarantined refs'])
  const rq = ((await h.store.get(await qk(h))) as unknown[] | undefined)?.length ?? 0
  rows.push(rq ? ['warn', `${rq} resume(s) queued`, 'they are sent at the next turn'] : ['ok', 'no queued resumes'])
  for (const [t, v] of Object.entries(cfg.sync)) {
    const a = (cfg.adapters as Record<string, any>)[(v as any)?.adapter ?? t]
    rows.push(await call(h, t, a ?? {}, 'ping', {}, 5000).then((): Row => ['ok', `sync ${t} answers`], (e): Row => ['warn', `sync ${t}: ${e.message}`, '/cadre sync now']))
  }
  rows.push(b.drive.paused ? ['warn', `drive paused: ${b.drive.paused}`, '/cadre drive on'] : ['ok', `drive ${b.drive.on ? `on, ${b.drive.turns} turns` : 'off'}`])
  return rows
}
export async function doctor(h: Host): Promise<string> {
  const cfg = await cfgOf(h)
  const m = await machine(h, cfg)   // read-only: a fix line only when its script already exists (setup writes them)
  for (const x of m.scripts) if (x.run && (await h.readText(x.path)) === null) for (const r of m.rows) if (r[2] === `! ${x.run}`) r[2] = 'run /cadre setup to prepare the fix'
  return report(h, 'doctor', [...m.rows, ...(await project(h, cfg))])
}
