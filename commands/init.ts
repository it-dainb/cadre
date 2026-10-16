// /cadre init (ADR 0010): Claude sets the project up itself, following guides/init.md with visible tool calls. This file holds only the CHECKS (one read-only
// predicate per phase, re-run at every main turn end by commands/agentrun) and the one write the human must confirm: the containment settings (a diff on a card).
import type { Host } from '../types'
import { canon, fnv1a64 } from '../core/board'
import { DRIVE, initConfirm, initPropose, missionOf } from '../core/dispatch'
import { op } from '../core/git'
import { settle } from '../core/decide'
import { cfgOf, repoFileDiag } from '../config/index'
import type { Config } from '../config'
import { diff as jdiff } from '../policy/settings'
import { assess } from '../policy/containment'
import { StoreError } from '../task-management/store'
import type { TaskStore } from '../task-management/store'
import { validate as kac } from '../core/changelog'
import { validate as regErrors } from '../task-management/registry'
import { spec } from '../agents'
import * as D from '../core/discover'
import { realRoot, setPolicy } from '../policy/guards'
import { wtRootOf } from '../core/branches'

// The TaskStore factory (register.ts wires it). The default refuses loudly.
export const wire: { store(h: Host, cfg: Config, root: string): Promise<TaskStore> } = {
  store: async () => { throw new StoreError('Unavailable', 'task store not wired') },
}

type J = Record<string, any>
export type Item = { name: string; st: 'ok' | 'fail' | 'wait' | 'todo' | 'warn'; why?: string }   // fail = Claude's to fix (a follow-up names it); wait = the human's card; todo = after the steps above
interface Ctx { h: Host; root: string; home: string; rk: string; cfg: Config }

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? 'repo'
export const repoKeyOf = (root: string) => `${base(root)}-${fnv1a64(root).slice(0, 6)}`
// an agent's cwd is <wtRoot>/<repoKey>/<task> or <repoKey>.views/<task>: map it back to the repo root recorded at session.start (the per-session secret is gone after /clear)
export const rootFor = (roots: Record<string, string> | undefined, cwd: string) => Object.entries(roots ?? {}).find(([k]) => cwd.includes(`/${k}/`) || cwd.includes(`/${k}.views/`))?.[1] ?? cwd
export const scoped = async (h: Host, name: string) => `cadre:${repoKeyOf(await h.cwd())}:${name}`   // $.store keys are per repo (13.5)
const git = (c: Ctx, ...a: string[]) => c.h.run(['git', ...a], { cwd: c.root })
const readJ = async (h: Host, p: string): Promise<J> => { const t = await h.readText(p); try { return t ? JSON.parse(t) : {} } catch { return {} } }
const union = (a: unknown, b: string[]) => [...new Set([...(Array.isArray(a) ? a : []), ...b])]
const EXCLUDE = ['.cadre/state/', '.claude/settings.local.json']   // the task store, Claude Code's local settings
// .git/info/exclude path and its lines
async function excludeFile(h: Host, root: string): Promise<{ path: string; have: string[] }> {
  const p = (await h.run(['git', 'rev-parse', '--git-path', 'info/exclude'], { cwd: root })).stdout.trim(), path = p.startsWith('/') ? p : `${root}/${p}`
  return { path, have: ((await h.readText(path)) ?? '').split('\n') }
}

// ---- the phases, in guide order; each answers null (done) or why not ----
async function repo(c: Ctx): Promise<string | null> {
  if ((await git(c, 'rev-parse', '--git-dir')).exitCode) return 'no git repository yet'
  if ((await git(c, 'rev-parse', '--verify', 'HEAD')).exitCode) return 'no first commit yet'
  const { main, dev } = c.cfg.branches
  if (!main) return 'branches.main is not set in .cadre/config.json'
  for (const b of [main, dev]) if ((await git(c, 'rev-parse', '--verify', b)).exitCode) return `branch ${b} is missing`
  const { have } = await excludeFile(c.h, c.root), miss = EXCLUDE.filter(w => !have.includes(w)); return miss.length ? `.git/info/exclude lacks ${miss.join(' and ')}` : null
}
async function store(c: Ctx): Promise<string | null> {
  try { const p = await (await wire.store(c.h, c.cfg, c.root)).probe(); return !p.ok ? `task store not ready: ${p.detail.slice(0, 120)}` : p.journal ? null : 'task store journal is off' }
  catch (e) { return `task store not ready: ${(e as Error).message.slice(0, 120)}` }
}
async function mission(c: Ctx): Promise<Item> {
  const b = await c.h.board.read()
  if (b.mission !== null) return { name: 'mission', st: 'ok' }
  const m = await wire.store(c.h, c.cfg, c.root).then(missionOf).catch(() => null)   // a new session: the board is cold, the recorded mission lives in the store
  if (m) { await c.h.board.update(x => ({ ...x, mission: m })); return { name: 'mission', st: 'ok' } }
  if ((await c.h.secret.read()).run?.goal) return { name: 'mission', st: 'ok', why: 'you approve it with the plan' }   // a goal run (ADR 0014): main drafts it into the plan, one dialog for both
  return b.plan?.slug === 'mission' ? { name: 'mission', st: 'wait', why: 'approve it on its card' } : { name: 'mission', st: 'fail', why: 'no mission yet' }
}
const packages = (c: Ctx): string | null => {
  if (!c.cfg.packages.length) return 'no packages in .cadre/config.json'
  const r = D.parse(c.cfg.packages); return typeof r === 'string' ? r : null
}
// the mod-run validation: every package's setup and checks in a clean offline copy at HEAD, once per package list (cached in $.store)
type Red = { root: string; n: string }
async function audit(c: Ctx): Promise<{ why: string | null; caches: string[]; red: Red[] }> {
  const pkgs = c.cfg.packages as unknown as (D.Pkg & { knownRed?: string[] })[], sig = fnv1a64(canon(pkgs)), key = `init.audit:${c.rk}`
  let a = (await c.h.store.get(key)) as { sig: string; runs: D.Run[] } | undefined
  if (a?.sig !== sig) { a = { sig, runs: [] }; for (const p of pkgs) a.runs.push(await D.exec(c.h, c.root, c.home, { ...p, setup: p.setup ?? [] }, { audit: true, knownRed: p.knownRed })); await c.h.store.set(key, a) }
  const goal = !!(await c.h.secret.read()).run?.goal, red: Red[] = []   // a goal run (ADR 0014): a check red before the goal is often the goal's own bug; it becomes known red on the safety card, never skipped or weakened
  const bad = pkgs.flatMap((p, i) => !a!.runs[i].setupOk ? [`${p.root}: setup ${(p.setup ?? []).join(' ')} fails in a clean copy`]
    : Object.entries(a!.runs[i].results).flatMap(([n, v]) => v === 'red' && goal ? (red.push({ root: p.root, n }), []) : v === 'red' ? [`${p.root}: ${n} fails on a clean checkout (fix the command or leave it out)`] : v === 'net' ? [`${p.root}: ${n} needs the network at test time (leave it out)`] : []))
  return { why: bad.length ? bad.join('; ') : null, caches: [...new Set(a.runs.flatMap(r => r.caches))], red }
}
function workflow(c: Ctx): string | null {
  const errs = regErrors(c.cfg.types as any)
  for (const r of ['worker', 'tester', 'reviewer', 'explorer'] as const) if (!spec(r, { roles: c.cfg.roles as any, mcpAllow: c.cfg.mcpAllow }).prompt) errs.push(`roles.${r} does not render`)
  return errs.length ? errs.join('; ') : null
}
async function changelog(c: Ctx): Promise<string | null> {
  const t = await c.h.readText(`${c.root}/${c.cfg.changelog.path}`); return t === null ? `${c.cfg.changelog.path} is missing` : kac(t) && `${c.cfg.changelog.path} ${kac(t)}`
}

// ---- containment: cadre writes it, after the human confirms the diff on its card ----
const SANDBOX = (wt: string, repo: string, caches: string[]) => ({
  env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' },
  sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: true, filesystem: { allowWrite: [wt, ...caches], denyWrite: [repo] } },   // ref entries are redundant under the repo-level deny (ADR 0001 S24)
})
const wtOf = async (c: Ctx) => `${await realRoot(c.h, await wtRootOf(c.h, c.cfg))}/${c.rk}`   // realpath'd like contain()'s wtRoot (symlinked ~/.cache)
const realOf = async (c: Ctx) => (await c.h.stat(c.root, { resolve: true }))?.realPath ?? c.root
async function contained(c: Ctx): Promise<boolean> {   // $.settings.read() is this session's: it shows the new file only after a restart, so a confirm this session counts
  return (await c.h.board.read()).init.some(i => i.stage === 5 && i.state === 'done') || assess(await c.h.settings().catch(() => ({})), await realOf(c), await wtOf(c)).state === 'contained'
}
const redLine = (red: Red[]) => `known red before your goal: ${red.map(x => `${x.root}: ${x.n}`).join(', ')} · it must turn green`
const grant = (pk: any[] = [], red: Red[]) => red.reduce((l, x) => (l.some(p => p.root === x.root) ? l.map(p => (p.root === x.root ? { ...p, knownRed: union(p.knownRed, [x.n]) } : p)) : [...l, { root: x.root, knownRed: [x.n] }]), pk)   // packages[].knownRed is granted only by the user layer (config relockKnownRed)
async function plan5(c: Ctx, caches: string[], red: Red[] = []) {
  const real = await realOf(c), wt = await wtOf(c), setP = `${c.root}/.claude/settings.local.json`, usrP = `${c.home}/.claude/cadre.json`, abs = caches.map(x => `${c.home}/${x}`), p = SANDBOX(wt, real, abs)
  const cur = await readJ(c.h, setP), cu = await readJ(c.h, usrP)
  const next = { ...cur, env: { ...cur.env, ...p.env }, sandbox: { ...cur.sandbox, ...p.sandbox, filesystem: { ...cur.sandbox?.filesystem, allowWrite: union(cur.sandbox?.filesystem?.allowWrite, p.sandbox.filesystem.allowWrite), denyWrite: union(cur.sandbox?.filesystem?.denyWrite, p.sandbox.filesystem.denyWrite) } } }
  const mine = { ...cu.repos?.[c.rk], ...(abs.length ? { jailWritable: union(cu.repos?.[c.rk]?.jailWritable, abs) } : {}), ...(red.length ? { packages: grant(cu.repos?.[c.rk]?.packages, red) } : {}) }
  const user = abs.length || red.length ? { ...cu, repos: { ...cu.repos, [c.rk]: mine } } : cu
  const lines = [...(red.length ? [redLine(red)] : []), ...jdiff(cur, next).map(l => `.claude/settings.local.json: ${l}`), ...jdiff(cu, user).map(l => `~/.claude/cadre.json: ${l}`)]
  const writes: [string, string][] = [[setP, JSON.stringify(next, null, 2) + '\n'], ...(user !== cu ? [[usrP, JSON.stringify(user, null, 2) + '\n'] as [string, string]] : [])]
  return { lines, writes, real, wt, sig: fnv1a64(lines.join('\n') + canon(await Promise.all([setP, usrP].map(f => c.h.readText(f))))) }
}
async function propose5(c: Ctx, caches: string[], red: Red[]): Promise<void> {
  const p = await plan5(c, caches, red); if (((await c.h.ui.read())['init.pending'] as { sig?: string } | undefined)?.sig === p.sig && (await c.h.board.read()).decisions?.some(d => d.id === 'init:5')) return
  await c.h.ui.update(u => ({ ...u, 'init.pending': { sig: p.sig, caches, red } }))
  await initPropose(c.h, 5, `init 5 containment\n${p.sig}`, { title: 'init · safety settings · confirm', short: 'init safety settings', sub: 'init', lines: ['cadre writes these settings after you confirm:', ...p.lines.slice(0, 14).map(l => `  ${l}`), ...(p.lines.length > 14 ? [`  … ${p.lines.length - 14} more lines`] : [])] })
}
// `init confirm` (the card's Confirm): the files are re-read and must match what the card showed
export async function confirm(h: Host): Promise<string> {
  const c = await ctxOf(h), pend = (await h.ui.read())['init.pending'] as { sig: string; caches: string[]; red?: Red[] } | undefined, good = await initConfirm(h, 5)
  if (!good || !pend) return 'init: nothing pending; the card shows the current diff'
  const p = await plan5(c, pend.caches, pend.red); if (p.sig !== pend.sig) return 'init: the settings files changed since you saw them; nothing written'
  for (const [path, text] of p.writes) { const old = await h.readText(path); if (old !== null && old !== text) await h.write(`${path}.bak`, old); if (old !== text) await h.write(path, text) }
  await setPolicy(h, { repo: p.real, wtRoot: p.wt, home: c.home })   // the band follows on the tick (policy/containment.heal): the session reads the new file a moment later
  await h.ui.update(({ 'init.pending': _p, ...u }) => u); await settle(h, 'init:5')
  await h.board.update(b => ({ ...b, init: [...b.init.filter(i => i.stage !== 5), { stage: 5, state: 'done' }] }))
  const sha = await commitSetup(c).catch(() => null)
  return `init: safety settings written${sha ? ' · setup committed' : ''}`
}

// The setup files (config, changelog) must be committed: a clone and dev need them (a release refuses without the changelog on dev). cadre commits them after the
// safety confirm, under git.op (its own ref move is not a flag); the other branch of main/dev follows when it is an ancestor (a fresh repo), else it is left alone.
export async function commitSetup(c: Pick<Ctx, 'h' | 'root' | 'cfg'>): Promise<string | null> {
  const ex = await excludeFile(c.h, c.root); if (!ex.have.includes('.cadre/tmp/')) await c.h.write(ex.path, `${ex.have.join('\n').replace(/\n*$/, '\n')}.cadre/tmp/\n`.replace(/^\n/, ''))   // cadre's logs and scratch (core/close): never a change to commit
  const files = (await git(c as Ctx, 'status', '--porcelain', '--', '.cadre/config.json', c.cfg.changelog.path)).stdout.split('\n').filter(Boolean).map(l => l.slice(3))
  if (!files.length) return null
  const cur = (await git(c as Ctx, 'symbolic-ref', '--short', '-q', 'HEAD')).stdout.trim(), { main, dev } = c.cfg.branches, other = cur === main ? dev : cur === dev ? main : ''
  if (!other) return null
  const g = (...a: string[]) => git(c as Ctx, ...a)
  return op(c.h, async () => {
    const old = (await g('rev-parse', other)).stdout.trim()
    if ((await g('add', '--', ...files)).exitCode || (await g('commit', '--no-verify', '-m', 'chore: set up cadre', '--', ...files)).exitCode) return null
    const head = (await g('rev-parse', 'HEAD')).stdout.trim()
    if (!(await g('merge-base', '--is-ancestor', old, head)).exitCode) await g('update-ref', `refs/heads/${other}`, head, old)
    return head
  })
}
// integration green (core/integrate): a known-red check that passes now loses its mark (the user-layer grant), recorded
export async function clearKnownRed(h: Host, green: Red[], planId: string): Promise<void> {
  if (!green.length) return
  const c = await ctxOf(h), path = `${c.home}/.claude/cadre.json`, old = await h.readText(path), cu = await readJ(h, path), pk = (cu.repos?.[c.rk]?.packages ?? []) as { root: string; knownRed?: string[] }[]
  const next = pk.map(p => ({ ...p, knownRed: (p.knownRed ?? []).filter(n => !green.some(g => g.root === p.root && g.n === n)) }))
  if (JSON.stringify(next) === JSON.stringify(pk)) return
  const text = JSON.stringify({ ...cu, repos: { ...cu.repos, [c.rk]: { ...cu.repos[c.rk], packages: next } } }, null, 2) + '\n'
  const write = async () => { if (old !== null) await h.write(`${path}.bak`, old); await h.write(path, text) }
  await (DRIVE.humanWrite ? DRIVE.humanWrite(h, write) : write())   // a narrowed grant is not a change a running drive stops for
  await (await wire.store(h, c.cfg, c.root)).record('decision', `known red is green now: ${green.map(g => `${g.root}: ${g.n}`).join(', ')}`, `plan ${planId} landed with these checks passing; they gate integration again.`, planId).catch(() => {})
}

const ctxOf = async (h: Host): Promise<Ctx> => {
  const root = await h.cwd(), home = await h.home(), rk = repoKeyOf(root)
  return { h, root, home, rk, cfg: await cfgOf(h) }
}
const it = (name: string, why: string | null, blocked = false): Item => (blocked ? { name, st: 'todo', why: 'after the steps above' } : why ? { name, st: 'fail', why } : { name, st: 'ok' })
// The checklist (also doctor's project rows). Later phases that need an earlier one wait as `todo`; containment is proposed on its card once the rest passes.
// quick: what a tool result shows mid-run; no clean-checkout run, no safety card, no containment read
export async function initItems(h: Host, o: { quick?: boolean } = {}): Promise<Item[]> {
  const c = await ctxOf(h), r = await repo(c), s = r ? 'needs the repository first' : await store(c), m = await mission(c), p = packages(c)
  const a = !r && !s && !p && !o.quick ? await audit(c) : undefined, w = workflow(c), l = await changelog(c)
  const audited: Item = a && !a.why && a.red.length ? { name: 'commands pass on a clean checkout', st: 'ok', why: redLine(a.red) } : it('commands pass on a clean checkout', a?.why ?? null, !a)
  const sd = r ? [] : (await repoFileDiag(h)).map(d => d.replace(/\bjail\w*/g, 'a safety key'))   // red only: then the follow-up, the stop refusal and the tool-result line name it
  const out = [it('repository', r), ...(sd.length ? [it('settings file', `.cadre/config.json: ${sd.join('; ')}; fix or remove these keys (the user sets the rest in the cadre pane)`)] : []), it('task store', s, !!r), m, it('build and test commands', p), audited, it('workflow', w), it('changelog', l)]
  const st = (await c.h.run(['find', c.root, '-maxdepth', '4', '(', '-name', '.git', '-o', '-name', 'node_modules', ')', '-prune', '-o', '-type', 'd', '-name', '.cadre', '-print', '-prune'])).stdout.split('\n').filter(p => p.endsWith('/.cadre') && p !== `${c.root}/.cadre`).map(p => p.replace(`${c.root}/`, ''))   // made from a shell left in a package folder (live 0.10.0). ponytail: 4 levels deep
  if (st.length) out.splice(1, 0, it('no setup folder outside the root', `${st.join(', ')} is not the project root's: delete ${st.length > 1 ? 'them' : 'it'} (rm -rf ${st.map(p => `${c.root}/${p}`).join(' ')})`))
  if (o.quick) return out
  if (await contained(c)) out.push({ name: 'safety settings', st: 'ok' })
  else if (out.every(i => i.st === 'ok' || (i === m && i.st === 'wait'))) { await propose5(c, a!.caches, a!.red); out.push({ name: 'safety settings', st: 'wait', why: 'confirm them on their card' }) }
  else out.push({ name: 'safety settings', st: 'todo', why: 'after the steps above' })
  return out
}
// doctor: which phases are complete (read-only: no containment card is proposed from here)
export async function progress(h: Host): Promise<{ name: string; done: boolean }[]> {
  const c = await ctxOf(h), r = await repo(c), s = r ?? await store(c), m = await mission(c)
  return [{ name: 'repository', done: !r }, { name: 'task store', done: !s }, { name: 'mission', done: m.st === 'ok' }, { name: 'build and test commands', done: !packages(c) }, { name: 'workflow', done: !workflow(c) }, { name: 'changelog', done: !(await changelog(c)) }, { name: 'safety settings', done: await contained(c) }]
}
