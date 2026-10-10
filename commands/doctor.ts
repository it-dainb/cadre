// /cadre setup (once per machine: checks + user-settings proposal + stamp) and /cadre doctor (read-only diagnosis). ADR 0007.
// The command text is ONE line; the report goes to the human surface only (pane tab "doctor" + ui.log). Nothing is ever installed: a fix is a command the human runs.
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
export async function machine(h: Host, cfg: Config): Promise<{ rows: Row[]; facts: Record<string, string> }> {
  const r = (argv: string[]) => h.run(argv, { timeoutMs: 5000 }).catch(() => undefined), text = (x?: { stdout: string; stderr: string }) => `${x?.stdout}${x?.stderr}`
  const mac = (await r(['uname', '-s']))?.stdout.trim() === 'Darwin', pm = mac ? 'brew install' : 'sudo apt install', rows: Row[] = [], facts: Record<string, string> = {}
  facts.cc = (await h.version?.().catch(() => '')) ?? ''
  rows.push(!facts.cc ? ['warn', 'Claude Code version unreadable'] : facts.cc === PIN ? ['ok', `Claude Code ${PIN} (the pinned build)`] : ['warn', `Claude Code ${facts.cc}: untested build (cadre is pinned to ${PIN})`, `! npm install -g @anthropic-ai/claude-code@${PIN}`])
  const g = await r(['git', '--version']), gv = ver(text(g))
  rows.push(!g || g.exitCode || !gv ? ['crit', 'git not found', `! ${pm} git`] : atLeast(gv, '2.17') ? ['ok', `git ${gv}`] : ['crit', `git ${gv} is too old for worktrees`, `! ${pm} git  # >= 2.17`])
  const b = await r([cfg.store.bin, 'version']), bv = ver(text(b)); facts.bd = bv
  const rev = b?.exitCode === 0 && /--if-revision/.test(text(await r([cfg.store.bin, 'update', '--help'])))
  rows.push(!b || b.exitCode || !bv ? ['crit', `${cfg.store.bin} not found`, '! npm install -g @beads/bd'] : !atLeast(bv, '1.3.0') ? ['crit', `bd ${bv} is older than 1.3.0`, '! npm install -g @beads/bd@latest'] : ['ok', `bd ${bv} (${rev ? 'if-revision supported' : 'no if-revision: read-check-write fallback'})`])
  if (mac) { facts.jail = 'none'; rows.push(['warn', 'no bwrap on macOS: throwaway-worktree mode, network unenforced']) }
  else {
    const w = await r(['bwrap', '--version']), wv = ver(text(w)); facts.bwrap = wv; facts.jail = await jailMode(h.run)
    rows.push(!w || w.exitCode ? ['crit', 'bwrap not found: checks run unjailed', `! ${pm} bubblewrap socat`] : facts.jail === 'none' ? ['warn', `bwrap ${wv} cannot create a user namespace`, '! sudo sysctl kernel.unprivileged_userns_clone=1  # see ADR 0001'] : facts.jail === 'copy' ? ['warn', `bwrap ${wv}: no overlay (needs >= 0.11), checks run in a throwaway copy`, `! ${pm} bubblewrap  # upgrade to >= 0.11`] : ['ok', `bwrap ${wv}: overlay jail`])
    const s = await r(['socat', '-V'])
    rows.push(!s || s.exitCode ? ['crit', 'socat not found (the Claude sandbox needs it)', `! ${pm} socat`] : ['ok', 'socat present'])
  }
  const root = await wtRootOf(h, cfg); let p = root   // read-only: the nearest existing ancestor must be writable
  while (p.length > 1 && !(await h.stat(p))) p = p.slice(0, p.lastIndexOf('/')) || '/'
  rows.push((await r(['test', '-w', p]))?.exitCode === 0 ? ['ok', `${mac ? 'macOS' : 'Linux'}; worktree root ${root} is writable`] : ['crit', `worktree root ${root} is not writable`, `set worktrees.root in ~/.claude/cadre.json, or fix the permissions of ${p}`])
  return { rows, facts }
}
const userPlan = async (h: Host) => mplan(h, await userPath(h), PATCH).catch((e: Error) => e)

// ---- report: one line to the model, the rows to the human ----
async function report(h: Host, name: string, rows: Row[]): Promise<string> {
  await h.ui.update(u => ({ ...u, 'doctor.rows': rows }))
  h.log([`cadre ${name}:`, ...rows.flatMap(([k, t, f]) => [`  [${k === 'crit' ? 'CRIT' : k === 'warn' ? 'WARN' : 'OK'}] ${t}`, ...(f ? [`        fix: ${f}`] : [])])].join('\n'))
  if (h.ops) await openPane(h, 'doctor')
  const bad = rows.filter(r => r[0] === 'crit').length, warn = rows.filter(r => r[0] === 'warn').length
  return bad || warn ? `${name}: ${bad} fail, ${warn} warn — report in the cadre pane` : `${name}: all ok`
}

// ---- setup ----
export async function setup(h: Host, args: string[]): Promise<string> {
  const cfg = await cfgOf(h), path = await userPath(h)
  if (args[0] === 'confirm') {
    const was = ((await h.ui.read())['setup.pending'] as string | undefined), good = await initConfirm(h, SETUP, args[1] ?? '')   // burns on every attempt
    if (!good) return 'setup: wrong code or nothing pending (burned); run /cadre setup again'
    const p = await userPlan(h); if (p instanceof Error) return `setup: ${p.message}`
    if (fnv1a64(p.lines.join('\n') + canon(p.old)) !== was) return 'setup: the settings file changed since the diff was shown; nothing written; run /cadre setup again'
    await mapply({ readText: h.readText, writeText: h.write }, path, PATCH)
  }
  const { rows, facts } = await machine(h, cfg), p = await userPlan(h)
  if (p instanceof Error) rows.push(['crit', p.message])
  else if (p.lines.length) {
    rows.push(['warn', `user settings need a change (${path}: ${p.lines.join('; ')}); nothing is written until you confirm with the code shown in the cadre band`, '/cadre setup confirm <code>'])
    await h.ui.update(u => ({ ...u, 'setup.pending': fnv1a64(p.lines.join('\n') + canon(p.old)) })); await initPropose(h, SETUP, p.lines.join('\n'))
  } else rows.push(['ok', 'user settings: env CLAUDE_CODE_ENABLE_TODO_TOOLS is set'])
  if (!rows.some(r => r[0] === 'crit') && !(p instanceof Error) && !p.lines.length) await h.store.set(STAMP, { cc: facts.cc, bd: facts.bd, bwrap: facts.bwrap ?? '', jail: facts.jail, at: await h.now() })
  return report(h, 'setup', rows)
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
