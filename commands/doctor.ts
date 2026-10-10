// /cadre setup (once per machine: preflight, a plan of user-level actions, one confirm, execute, stamp) and /cadre doctor (read-only diagnosis). ADR 0007.
// The command text is ONE line; the report goes to the human surface only (pane tab "doctor" + ui.log). Setup runs only user-level actions after the confirm; sudo and PATH fixes stay with the human.
import type { Host } from '../types'
import type { Config } from '../config'
import { canon, fnv1a64, leaseLive } from '../core/board'
import { cfgOf, initConfirm, initPropose, storeOf } from '../core/dispatch'
import { exists, jailMode, ok as gitOk } from '../core/git'
import { wtRootOf } from '../core/branches'
import { qk } from '../core/session'
import { assess } from '../policy/containment'
import { policyOf } from '../policy/guards'
import { apply as mapply, plan as mplan } from '../policy/settings'
import { call } from '../task-management/protocol'
import { openPane } from '../ui/index'
import { progress } from './init'

export type Row = ['ok' | 'warn' | 'crit', string, string?]   // level, line, fix (a command for the human)
const PIN = '2.1.295', SETUP = 90, STAMP = 'cadre:setup', PATCH = { env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' } }
const ver = (s: string) => s.match(/\d+(\.\d+)+/)?.[0] ?? ''
const atLeast = (v: string, min: string) => { const a = v.split('.').map(Number), b = min.split('.').map(Number); for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0); return true }
const userPath = async (h: Host) => `${await h.home()}/.claude/settings.json`

// ---- machine checks (shared by setup and doctor); every probe goes through h.run so tests inject fixtures ----
// acts = what setup can run itself (user-level, no sudo); human = what only the human can run once (sudo, PATH fixes)
export type Act = { label: string; argv?: string[]; settings?: true }
const BD_SH = 'curl -fsSL https://raw.githubusercontent.com/gastownhall/beads/main/scripts/install.sh | bash'
export async function machine(h: Host, cfg: Config): Promise<{ rows: Row[]; facts: Record<string, string>; acts: Act[]; human: string[] }> {
  const r = (argv: string[]) => h.run(argv, { timeoutMs: 5000 }).catch(() => undefined), text = (x?: { stdout: string; stderr: string }) => `${x?.stdout}${x?.stderr}`, out = async (argv: string[]) => (await r(argv))?.stdout.trim() ?? ''
  const mac = (await r(['uname', '-s']))?.stdout.trim() === 'Darwin', pm = mac ? 'brew install' : 'sudo apt install', rows: Row[] = [], facts: Record<string, string> = {}, acts: Act[] = [], human: string[] = []
  const add = (x: Row, mine = false): void => { rows.push(x); if (x[2]?.startsWith('! ') && !mine) human.push(x[2]) }
  facts.cc = (await h.version?.().catch(() => '')) ?? ''
  const cmp = ver(facts.cc) && !atLeast(PIN, ver(facts.cc)) ? 'newer than' : 'older than'
  add(!facts.cc ? ['warn', 'Claude Code version unreadable'] : facts.cc === PIN ? ['ok', `Claude Code ${PIN} (the pinned build)`] : ['warn', `Claude Code ${facts.cc}: ${cmp} the tested ${PIN}; ${cmp === 'newer than' ? 'usually fine' : 'update it with claude update'}`])
  const g = await r(['git', '--version']), gv = ver(text(g))
  add(!g || g.exitCode || !gv ? ['crit', 'git not found', `! ${pm} git`] : atLeast(gv, '2.17') ? ['ok', `git ${gv}`] : ['crit', `git ${gv} is too old for worktrees`, `! ${pm} git  # >= 2.17`])
  const b = await r([cfg.store.bin, 'version']), bv = ver(text(b)); facts.bd = bv
  const rev = b?.exitCode === 0 && /--if-revision/.test(text(await r([cfg.store.bin, 'update', '--help'])))
  if (b && !b.exitCode && bv && atLeast(bv, '1.3.0')) add(['ok', `bd ${bv} (${rev ? 'if-revision supported' : 'no if-revision: read-check-write fallback'})`])
  else {
    const head = b && !b.exitCode && bv ? `bd ${bv} is older than 1.3.0` : `${cfg.store.bin} not found`, where = await out(['sh', '-c', 'command -v "$0"', cfg.store.bin])
    const npm = (await r(['npm', '--version']))?.exitCode === 0, pre = npm ? await out(['npm', 'prefix', '-g']) : '', alt = pre && `${pre}/bin/${cfg.store.bin}`, av = alt && alt !== where ? ver(text(await r([alt, 'version']))) : ''
    if (where && av && atLeast(av, '1.3.0')) add(['crit', `bd ${bv || '?'} at ${where} shadows bd ${av} at ${alt}`, `! ${where.startsWith(await h.home()) ? '' : 'sudo '}rm ${where}  # or put ${pre}/bin first in PATH`])
    else if (npm) { acts.push({ label: 'installing bd', argv: ['npm', 'install', '-g', '@beads/bd@latest'] }); add(['crit', head, '! npm install -g @beads/bd@latest'], true) }
    else if ((await r(['curl', '--version']))?.exitCode === 0) { acts.push({ label: 'installing bd', argv: ['sh', '-c', BD_SH] }); add(['crit', head, `! ${BD_SH}`], true) }
    else { add(['crit', head, 'install Node.js (npm) or curl first']); human.push('! # install Node.js (npm) or curl, then /cadre setup again') }
  }
  if (mac) { facts.jail = 'none'; add(['warn', 'no bwrap on macOS: throwaway-worktree mode, network unenforced']) }
  else {
    const w = await r(['bwrap', '--version']), wv = ver(text(w)); facts.bwrap = wv; facts.jail = await jailMode(h.run)
    if (!w || w.exitCode) add(['crit', 'bwrap not found: checks run unjailed', `! ${pm} bubblewrap socat`])
    else if (facts.jail === 'none') {
      const apparmor = (await h.readText('/proc/sys/kernel/apparmor_restrict_unprivileged_userns'))?.trim(), clone = (await h.readText('/proc/sys/kernel/unprivileged_userns_clone'))?.trim()
      if (apparmor === '1') {
        const bin = (await out(['sh', '-c', 'command -v bwrap'])) || '/usr/bin/bwrap'
        add(['warn', `bwrap ${wv} is blocked by AppArmor (kernel.apparmor_restrict_unprivileged_userns=1)`, `! printf 'abi <abi/4.0>,\\ninclude <tunables/global>\\nprofile bwrap ${bin} flags=(unconfined) {\\n  userns,\\n  include if exists <local/bwrap>\\n}\\n' | sudo tee /etc/apparmor.d/bwrap >/dev/null && sudo systemctl reload apparmor`])
        human.push('! sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0  # quicker alternative; loosens it for every program, Claude Code\'s sandbox included', "! echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/60-userns.conf  # keeps the alternative across reboots")
      } else if (clone === '0') add(['warn', `bwrap ${wv} cannot create a user namespace (kernel.unprivileged_userns_clone=0)`, '! sudo sysctl -w kernel.unprivileged_userns_clone=1'])
      else add(['warn', `bwrap ${wv} cannot create a user namespace`, 'see https://code.claude.com/docs/en/sandboxing'])
    } else add(facts.jail === 'copy' ? ['warn', `bwrap ${wv}: no overlay (needs >= 0.11), checks run in a throwaway copy`, `! ${pm} bubblewrap  # upgrade to >= 0.11`] : ['ok', `bwrap ${wv}: overlay jail`])
    const s = await r(['socat', '-V'])
    add(!s || s.exitCode ? ['crit', 'socat not found (the Claude sandbox needs it)', `! ${pm} socat`] : ['ok', 'socat present'])
  }
  const root = await wtRootOf(h, cfg); let p = root   // read-only: the nearest existing ancestor must be writable
  while (p.length > 1 && !(await h.stat(p))) p = p.slice(0, p.lastIndexOf('/')) || '/'
  if ((await r(['test', '-w', p]))?.exitCode === 0) { add(['ok', `${mac ? 'macOS' : 'Linux'}; worktree root ${root} is writable`]); if (p !== root) acts.push({ label: 'creating the worktree folder', argv: ['mkdir', '-p', root] }) }
  else add(['crit', `worktree root ${root} is not writable`, `set worktrees.root in ~/.claude/cadre.json, or fix the permissions of ${p}`])
  return { rows, facts, acts, human }
}
const userPlan = async (h: Host) => mplan(h, await userPath(h), PATCH).catch((e: Error) => e)

// ---- report: one line to the model; the rows go to the pane and, one short line each, to the log (never a multi-line string: the transcript shows it as U+FFFD) ----
const TAG = { crit: 'CRIT', warn: 'WARN', ok: 'OK' }
async function report(h: Host, name: string, rows: Row[], text?: string): Promise<string> {
  await h.ui.update(u => ({ ...u, 'doctor.rows': rows }))
  for (const [k, t, f] of rows) h.log(`${name} [${TAG[k]}] ${t}${f ? ` — fix: ${f}` : ''}`)
  if (h.ops) await openPane(h, 'doctor')
  const bad = rows.filter(r => r[0] === 'crit').length, warn = rows.filter(r => r[0] === 'warn').length
  return text ?? (bad || warn ? `${name}: ${bad} fail, ${warn} warn — report in the cadre pane` : `${name}: all ok`)
}

// ---- setup: preflight, plan, one confirm, execute ----
type Plan = { rows: Row[]; facts: Record<string, string>; acts: Act[]; human: string[]; hash: string }
async function preflight(h: Host, cfg: Config): Promise<Plan> {
  const m = await machine(h, cfg), p = await userPlan(h), acts = [...m.acts]
  if (p instanceof Error) m.rows.push(['crit', p.message])
  else if (p.lines.length) { acts.push({ label: 'writing user settings', settings: true }); m.rows.push(['warn', `user settings need a change (${p.lines.join('; ')})`]) }
  else m.rows.push(['ok', 'user settings: env CLAUDE_CODE_ENABLE_TODO_TOOLS is set'])
  return { ...m, acts, hash: fnv1a64(JSON.stringify(acts) + (p instanceof Error ? '' : p.lines.join('\n') + canon(p.old))) }
}
const shown = (h: Host, P: Pick<Plan, 'acts' | 'human'>, extra: Record<string, unknown> = {}) => h.ui.update(u => ({ ...u, 'setup.plan': { acts: P.acts.map(a => [a.label, '']), human: P.human, ...extra } }))
export async function setup(h: Host, args: string[]): Promise<string> {
  const cfg = await cfgOf(h), path = await userPath(h)
  let P = await preflight(h, cfg), note = ''
  if (args[0] === 'confirm') {
    const was = ((await h.ui.read())['setup.pending'] as string | undefined), good = await initConfirm(h, SETUP, args[1] ?? '')   // burns on every attempt
    if (!good) return 'setup: wrong code or nothing pending (burned); run /cadre setup again'
    if (P.hash !== was) note = 'setup: the plan changed since it was shown; nothing ran; confirm again with the new code'
    else {
      await h.ui.update(({ 'setup.pending': _p, ...u }) => u)
      const st: string[][] = P.acts.map(a => [a.label, '']), tail: string[] = []
      for (const [i, a] of P.acts.entries()) {
        st[i][1] = 'run'; await shown(h, P, { acts: st }); h.toast(`setup: ${a.label}`)
        let bad = ''
        if (a.settings) await mapply({ readText: h.readText, writeText: h.write }, path, PATCH).catch((e: Error) => { bad = e.message })
        else { const x = await h.run(a.argv!, { timeoutMs: 300000 }).catch((e: Error) => ({ exitCode: 1, stdout: '', stderr: e.message })); if (x.exitCode) { bad = `exit ${x.exitCode}`; tail.push(...`${x.stdout}\n${x.stderr}`.split('\n').filter(Boolean).slice(-8)) } }
        st[i][1] = bad ? 'fail' : 'ok'
        if (bad) { await shown(h, P, { acts: st, out: tail.length ? tail : [bad] }); return report(h, 'setup', P.rows, `setup: stopped at "${a.label}"; output in the cadre pane`) }
      }
      P = await preflight(h, cfg); await shown(h, { acts: [], human: P.human }, { done: st })
    }
  }
  if (P.acts.length) { await h.ui.update(u => ({ ...u, 'setup.pending': P.hash })); await initPropose(h, SETUP, P.hash, { title: 'setup plan ready · confirm it', short: 'setup plan ready', sub: 'setup', change: 'setup', lines: [...P.acts.map((a, i) => `  ${i + 1}. ${a.label}`), ...(P.human.length ? ['you run once:', ...P.human.map(x => `  ${x}`)] : [])] }); await shown(h, P) }
  else if (args[0] !== 'confirm' || note) await h.ui.update(({ 'setup.plan': _s, ...u }) => u)
  if (!P.rows.some(r => r[0] === 'crit') && !P.acts.length) await h.store.set(STAMP, { cc: P.facts.cc, bd: P.facts.bd, bwrap: P.facts.bwrap ?? '', jail: P.facts.jail, at: await h.now() })
  return report(h, 'setup', P.rows, note || (P.acts.length ? `setup: ${P.acts.length} action${P.acts.length > 1 ? 's' : ''} ready · confirm with the code on the band` : undefined))
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
  return report(h, 'doctor', [...(await machine(h, cfg)).rows, ...(await project(h, cfg))])
}
