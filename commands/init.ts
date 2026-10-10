// /cadre init: the staged wizard (DESIGN 10.1). Each stage: propose -> diff -> human `confirm <code>` -> re-read -> .bak -> validate -> save.
// A stage is complete when its validated keys exist, so there is no progress state. Pending diff signature: ui['init.pending']; code: secret.initConfirm.
import type { Host } from '../types'
import { canon, fnv1a64 } from '../core/board'
import { emit } from '../core/events'
import { initConfirm, initPropose, missionOf } from '../core/dispatch'
import { load } from '../config'
import type { Config } from '../config'
import { diff as jdiff } from '../policy/settings'
import { assess, contain } from '../policy/containment'
import { StoreError } from '../task-management/store'
import type { TaskStore } from '../task-management/store'
import { KAC, skeleton, validate as kac } from '../core/changelog'
import { validate as regErrors, defaults as regDefaults } from '../task-management/registry'
import type { TypeRegistry } from '../task-management/registry'
import { spec } from '../agents'
import * as D from '../core/discover'
import { realRoot, setPolicy } from '../policy/guards'
import { wtRootOf } from '../core/branches'

// Wired by later waves: the beads TaskStore factory and sync add (11.3). Defaults refuse loudly.
export const wire: { store(h: Host, cfg: Config, root: string): Promise<TaskStore>; syncAdd(h: Host, adapter: string): Promise<string> } = {
  store: async () => { throw new StoreError('Unavailable', 'task store not wired') },
  syncAdd: async () => { throw new Error('sync setup not wired') },
}

type J = Record<string, any>
type Save = (path: string, text: string) => Promise<void>
interface Plan { lines: string[]; targets: string[]; apply(save: Save): Promise<{ ok: boolean; text: string }> }
interface Ctx { h: Host; root: string; home: string; rk: string; cfg: Config; args: string[] }
interface Stage { n: number; name: string; done(c: Ctx): Promise<boolean>; propose(c: Ctx): Promise<Plan | string> }

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? 'repo'
export const repoKeyOf = (root: string) => `${base(root)}-${fnv1a64(root).slice(0, 6)}`
// an agent's cwd is <wtRoot>/<repoKey>/<task> or <repoKey>.views/<task>: map it back to the repo root recorded at session.start (the per-session secret is gone after /clear)
export const rootFor = (roots: Record<string, string> | undefined, cwd: string) => Object.entries(roots ?? {}).find(([k]) => cwd.includes(`/${k}/`) || cwd.includes(`/${k}.views/`))?.[1] ?? cwd
export const scoped = async (h: Host, name: string) => `cadre:${repoKeyOf(await h.cwd())}:${name}`   // $.store keys are per repo (13.5)
const git = (c: Ctx, ...a: string[]) => c.h.run(['git', ...a], { cwd: c.root })
const ok = (text: string) => ({ ok: true, text }), no = (text: string) => ({ ok: false, text })
const readJ = async (h: Host, p: string): Promise<J> => { const t = await h.readText(p); try { return t ? JSON.parse(t) : {} } catch { return {} } }
const put = (v: unknown) => JSON.stringify(v, null, 2) + '\n'
// JSON file edit as a plan piece: lines for the diff + the text to save.
async function edit(h: Host, path: string, fn: (cur: J) => J): Promise<{ lines: string[]; text: string }> {
  const cur = await readJ(h, path), next = fn(JSON.parse(JSON.stringify(cur)))
  return { lines: jdiff(cur, next).map(l => `${path}: ${l}`), text: put(next) }
}
const byRoot = (a: J[] = [], b: J[]) => [...a.filter(x => !b.some(y => y.root === x.root)), ...b]
const union = (a: unknown, b: string[]) => [...new Set([...(Array.isArray(a) ? a : []), ...b])]

const S1: Stage = {
  n: 1, name: 'repo',
  async done(c) { const m = c.cfg.branches.main; return !!m && (await git(c, 'rev-parse', '--verify', m)).exitCode === 0 && (await git(c, 'rev-parse', '--verify', c.cfg.branches.dev)).exitCode === 0 },
  async propose(c) {
    const isRepo = (await git(c, 'rev-parse', '--git-dir')).exitCode === 0, dev = c.cfg.branches.dev
    let def = c.args[0] ?? ''
    if (!def && isRepo) {
      const o = (await git(c, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')).stdout.trim().replace(/^origin\//, '')
      def = o || (await git(c, 'branch', '--show-current')).stdout.trim()
      if (!def) return 'init 1: cannot tell the default branch (no origin/HEAD, detached HEAD); run /cadre init 1 <branch>'
    }
    def ||= 'main'
    const ex = isRepo ? (await git(c, 'rev-parse', '--git-path', 'info/exclude')).stdout.trim() : '.git/info/exclude', exPath = ex.startsWith('/') ? ex : `${c.root}/${ex}`
    const want = ['.beads/', '.claude/settings.local.json'], cfgPath = `${c.root}/.cadre/config.json`
    const cfgEdit = await edit(c.h, cfgPath, j => ({ ...j, branches: { ...j.branches, main: def, dev } }))
    const have = ((await c.h.readText(exPath)) ?? '').split('\n')
    const lines = [...(isRepo ? [] : [`+ git init -b ${def} + initial commit`]), ...(isRepo && (await git(c, 'rev-parse', '--verify', dev)).exitCode === 0 ? [] : [`+ git branch ${dev} ${def}`]),
      ...want.filter(w => !have.includes(w)).map(w => `+ ${exPath}: ${w}`), ...cfgEdit.lines]
    if (lines.length) lines.push('keys: branches -> committed .cadre/config.json; relaxations (jailWritable, knownRed) -> ~/.claude/cadre.json')
    return { lines, targets: [exPath, cfgPath], async apply(save) {
      if (!isRepo) {
        for (const a of [['init', '-b', def], ['add', '-A'], ['commit', '--allow-empty', '-m', 'chore: initial commit']]) { const r = await git(c, ...a); if (r.exitCode) return no(`git ${a[0]} failed: ${r.stderr.trim().split('\n').pop()}`) }
      }
      if ((await git(c, 'rev-parse', '--verify', dev)).exitCode) { const r = await git(c, 'branch', dev, def); if (r.exitCode) return no(`git branch ${dev} ${def} failed: ${r.stderr.trim().split('\n').pop()}`) }
      for (const b of [def, dev]) if ((await git(c, 'rev-parse', '--verify', b)).exitCode) return no(`branch "${b}" does not resolve`)
      const cur = (await c.h.readText(exPath)) ?? ''
      await save(exPath, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + want.filter(w => !cur.split('\n').includes(w)).map(w => w + '\n').join(''))
      await save(cfgPath, cfgEdit.text); return ok(`repo ready: main=${def}, dev=${dev}`)
    } }
  },
}

const S2: Stage = {
  n: 2, name: 'store',
  async done(c) { try { const p = await (await wire.store(c.h, c.cfg, c.root)).probe(); return p.ok && p.journal } catch { return false } },
  async propose(c) {
    let s: TaskStore
    try { s = await wire.store(c.h, c.cfg, c.root); const p = await s.probe(); if (!p.ok) return `init 2: store unavailable: ${p.detail} (needs bd >= 1.3.0)` } catch (e: any) { return `init 2: ${e.code ?? 'error'}: ${e.message} (needs bd >= 1.3.0)` }
    return { lines: await S2.done(c) ? [] : ['+ bd init --non-interactive --skip-agents --skip-hooks', '+ statuses draft:frozen,in_review:wip', `+ types ${Object.keys(c.cfg.types as object).join(',')}`, '+ events-journal true  (journal consent: REQUIRED for sync; the journal records task events)'], targets: [],
      async apply() {
        try {
          await s.init({ types: c.cfg.types as TypeRegistry, journal: true })
          const epic = await s.createEpic('cadre init probe', 'round trip'), d = await s.createDraft({ title: 'probe', description: 'probe', type: 'feature', parent: epic })
          const back = await s.get(d.id); await s.dropDrafts([d.id]); await s.close(epic, { outcome: 'cancelled', note: 'init round trip' })
          return back.title === 'probe' ? ok('store ready (round trip ok)') : no('store round trip: draft read back differently')
        } catch (e: any) { return no(`store round trip failed: ${e.code ?? 'error'}: ${e.message}`) }
      } }
  },
}

const S3: Stage = {
  n: 3, name: 'mission',
  done: async c => {
    if ((await c.h.board.read()).mission !== null) return true
    const m = await wire.store(c.h, c.cfg, c.root).then(missionOf).catch(() => null)   // a new session: the board is cold, the recorded mission lives in beads
    if (m) await c.h.board.update(b => ({ ...b, mission: m }))
    return !!m
  },
  propose: async c => ({ lines: [], targets: [], async apply() {
    await c.h.ui.update(u => ({ ...u, initRequest: 'mission' }))
    return no('mission request queued: main will ask you for goal, constraints and non-goals and draft the mission; approve it with /cadre approve <id>@<code>')
  } }),
}

const known = async (c: Ctx) => ((await c.h.store.get(`init.discovery:${c.rk}`)) as D.Pkg[] | undefined)
// Discovery state lives in $.store (per user): the parsed report (set by `discovered`) and the audit of it (reused while the report is unchanged).
export async function discovered(h: Host, report: unknown): Promise<string | null> {
  const ps = D.parse(report); if (typeof ps === 'string') return ps
  const rk = repoKeyOf(await h.cwd()); await h.store.set(`init.discovery:${rk}`, ps); await h.store.del(`init.audit:${rk}`)
  await h.ui.update(u => ({ ...u, initRequest: undefined })); return null
}
const S4: Stage = {
  n: 4, name: 'discovery',
  done: async c => c.cfg.packages.length > 0,
  async propose(c) {
    if (!(await S1.done(c)) || !(await S2.done(c))) return 'init 4: run stages 1 and 2 first (discovery needs the repo and the store)'
    const pkgs = await known(c)
    if (!pkgs) { await c.h.ui.update(u => ({ ...u, initRequest: 'discovery' })); return 'init 4: discovery requested; main will spawn the discovery explorer. When it reports, run /cadre init again.' }
    const sig = fnv1a64(canon(pkgs)); let audit = (await c.h.store.get(`init.audit:${c.rk}`)) as { sig: string; runs: D.Run[] } | undefined
    if (audit?.sig !== sig) { audit = { sig, runs: [] }; for (const p of pkgs) audit.runs.push(await D.exec(c.h, c.root, c.home, p, { audit: true })); await c.h.store.set(`init.audit:${c.rk}`, audit) }
    const bad = pkgs.findIndex((_, i) => !audit!.runs[i].setupOk); if (bad >= 0) return `init 4: setup ${JSON.stringify(pkgs[bad].setup)} failed in ${pkgs[bad].root}; fix it and have main re-run discovery`
    const caches = [...new Set(audit.runs.flatMap(r => r.caches))]
    const knownRed = pkgs.map((p, i) => ({ root: p.root, red: Object.keys(audit!.runs[i].results).filter(n => audit!.runs[i].results[n] === 'red') }))
    const lines = [...pkgs.flatMap((p, i) => [`+ packages[${p.root}]: setup ${p.setup.join(' ')}; checks ${Object.keys(p.checks).join(',')}`,
      ...Object.entries(audit!.runs[i].results).flatMap(([n, v]) => v === 'net' ? [`! ${n}: fetches at test time; fails offline, NOT saved`] : v === 'red' ? [`? ${n}: red at the clean base -> knownRed (user-level) + backlog task "fix known-red ${n}"`] : [])]),
      ...caches.map(x => `+ jailWritable + sandbox allowWrite: ~/${x}`)]
    const cfgP = `${c.root}/.cadre/config.json`, usrP = `${c.home}/.claude/cadre.json`, setP = `${c.root}/.claude/settings.local.json`
    return { lines, targets: [cfgP, usrP, setP], async apply(save) {
      const saved: J[] = [], reds: J[] = []; const warn: string[] = []
      for (const [i, p] of pkgs.entries()) {
        const kr = knownRed[i].red, r = await D.exec(c.h, c.root, c.home, p, { audit: false, caches, knownRed: kr })
        if (!r.setupOk) return no(`validation: setup failed for ${p.root} in the writable jail`)
        const pass = Object.keys(r.results).filter(n => r.results[n] === 'pass'), redNow = Object.keys(r.results).filter(n => r.results[n] === 'red')
        if (redNow.length) return no(`validation: ${redNow.join(', ')} red at base; re-run init 4 to propose knownRed`)
        for (const n of Object.keys(r.results)) if (r.results[n] === 'net') warn.push(`${p.root}:${n} needs the network; not saved`)
        const keep = Object.fromEntries(Object.entries(p.checks).filter(([n]) => r.results[n] === 'pass' || r.results[n] === 'knownRed'))
        if (!pass.length) return no(`validation: no check of ${p.root} passes offline at base`)
        saved.push({ root: p.root, setup: p.setup, checks: keep, verify: pass, tdd: p.tdd && (p.tdd.report && !r.junit ? { ...p.tdd, report: undefined } : p.tdd), viewInclude: p.viewInclude })
        if (kr.length) reds.push({ root: p.root, knownRed: kr })
        if (p.tdd?.report && !r.junit) warn.push(`${p.root}: JUnit report not produced/parsed; dropped`)
      }
      const abs = caches.map(x => `${c.home}/${x}`)
      const e1 = await edit(c.h, cfgP, j => ({ ...j, packages: byRoot(j.packages, JSON.parse(JSON.stringify(saved))) }))
      const e2 = await edit(c.h, usrP, j => ({ ...j, repos: { ...j.repos, [c.rk]: { ...j.repos?.[c.rk], jailWritable: union(j.repos?.[c.rk]?.jailWritable, abs), packages: byRoot(j.repos?.[c.rk]?.packages, reds) } } }))
      const e3 = await edit(c.h, setP, j => ({ ...j, sandbox: { ...j.sandbox, filesystem: { ...j.sandbox?.filesystem, allowWrite: union(j.sandbox?.filesystem?.allowWrite, abs) } } }))
      await save(cfgP, e1.text); await save(usrP, e2.text); await save(setP, e3.text)
      if (reds.length) {
        const s = await wire.store(c.h, c.cfg, c.root), b = await c.h.board.read(), parent = b.mission ?? b.epic ?? await s.createEpic('backlog', 'known-red follow-ups')
        for (const r of reds) for (const n of r.knownRed) await s.createDraft({ title: `fix known-red ${n}`, description: `${n} is red at the clean base in ${r.root}; marked knownRed by /cadre init.`, type: 'bug', parent })
      }
      await c.h.store.del(`init.discovery:${c.rk}`); await c.h.store.del(`init.audit:${c.rk}`)
      return ok(`discovery saved: ${saved.map(p => p.root).join(', ')}${warn.length ? `\n! ${warn.join('\n! ')}` : ''}`)
    } }
  },
}

const SANDBOX = (wt: string, repo: string) => ({
  env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' },
  sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: true,
    filesystem: { allowWrite: [wt], denyWrite: [repo] } },   // ref entries are redundant under the repo-level deny (ADR 0001 S24)
})
const wtOf = async (c: Ctx) => `${await realRoot(c.h, await wtRootOf(c.h, c.cfg))}/${c.rk}`   // realpath'd like contain()'s wtRoot (symlinked ~/.cache)
const S5: Stage = {
  n: 5, name: 'containment',
  async done(c) { if ((await c.h.board.read()).init.some(i => i.stage === 5 && i.state === 'done')) return true   // $.settings.read() is this session's: it shows the new file only after a restart
    const real = (await c.h.stat(c.root, { resolve: true }))?.realPath ?? c.root; return assess(await c.h.settings().catch(() => ({})), real, await wtOf(c)).state === 'contained' },
  async propose(c) {
    const real = (await c.h.stat(c.root, { resolve: true }))?.realPath ?? c.root, wt = await wtOf(c), setP = `${c.root}/.claude/settings.local.json`, usrP = `${c.home}/.claude/settings.json`
    const patch = SANDBOX(wt, real), strict = c.args[0] === 'allowlist'
    const merge = (j: J, p: J): J => ({ ...j, env: { ...j.env, ...p.env }, sandbox: { ...j.sandbox, ...p.sandbox, filesystem: { ...j.sandbox?.filesystem, allowWrite: union(j.sandbox?.filesystem?.allowWrite, p.sandbox.filesystem.allowWrite), denyWrite: union(j.sandbox?.filesystem?.denyWrite, p.sandbox.filesystem.denyWrite) } } })
    const e1 = await edit(c.h, setP, j => merge(j, patch))
    const e2 = strict ? await edit(c.h, usrP, j => ({ ...j, sandbox: { ...j.sandbox, network: { ...j.sandbox?.network, strictAllowlist: true } } })) : undefined
    return { lines: [...e1.lines, ...(e2?.lines ?? []), ...(strict || !e1.lines.length ? [] : ['optional: /cadre init 5 allowlist adds sandbox.network.strictAllowlist to user settings'])], targets: [setP, ...(e2 ? [usrP] : [])],
      async apply(save) {
        const after = JSON.parse(e1.text), st = assess(after, real, wt)
        if (st.state !== 'contained') return no(`containment check failed: ${st.why.join('; ')}`)
        await save(setP, e1.text); if (e2) await save(usrP, e2.text)
        await setPolicy(c.h, { repo: real, wtRoot: wt, home: c.home })
        await contain(c.h).catch(() => {}); return ok('containment written: contained (re-checked at session.start)')
      } }
  },
}

const S6: Stage = {
  n: 6, name: 'workflow',
  async done(c) { const j = await readJ(c.h, `${c.root}/.cadre/config.json`); return !!j.types && !!j.roles && regErrors(j.types).length === 0 },
  async propose(c) {
    const cfgP = `${c.root}/.cadre/config.json`, raw = await readJ(c.h, cfgP), reg = (raw.types ?? regDefaults()) as TypeRegistry
    const errs = [...regErrors(reg), ...Object.entries(reg).flatMap(([t, s]) => s.changelog && !KAC.includes(s.changelog) ? [`types.${t}: changelog "${s.changelog}" is not a KAC category`] : [])]
    const roles = { ...c.cfg.roles, ...raw.roles } as Config['roles']
    for (const r of ['worker', 'tester', 'reviewer', 'explorer'] as const) {
      const s = spec(r, { roles: roles as any, models: c.cfg.models, mcpAllow: c.cfg.mcpAllow })
      if (roles[r].tier && !(roles[r].tier! in c.cfg.models) && s.model === roles[r].tier) errs.push(`roles.${r}.tier: "${roles[r].tier}" is not one of ${Object.keys(c.cfg.models).join('|')}`)
      if (!s.prompt || !s.tools.length) errs.push(`roles.${r}: sample brief did not render`)
    }
    if (errs.length) return `init 6: refused:\n${errs.join('\n')}`
    const e = await edit(c.h, cfgP, j => ({ ...j, types: reg, roles, maxParallel: raw.maxParallel ?? c.cfg.maxParallel, drive: raw.drive ?? c.cfg.drive, strictness: raw.strictness ?? c.cfg.strictness }))
    return { lines: e.lines, targets: [cfgP], async apply(save) { await save(cfgP, e.text); return ok('workflow profile saved (4 sample briefs rendered, pipelines valid)') } }
  },
}

const S7: Stage = {
  n: 7, name: 'changelog',
  async done(c) { const t = await c.h.readText(`${c.root}/${c.cfg.changelog.path}`); return t !== null && kac(t) === null },
  async propose(c) {
    const p = `${c.root}/${c.cfg.changelog.path}`, t = await c.h.readText(p), why = t === null ? null : kac(t)
    if (why) return `init 7: ${c.cfg.changelog.path}: ${why} (not overwritten; fix it and re-run)`
    return { lines: t === null ? [`+ ${p}: KAC 1.1.0 skeleton`] : [], targets: [p], async apply(save) { if (t === null) await save(p, skeleton()); return ok('changelog ok (KAC 1.1.0)') } }
  },
}

const S8: Stage = {
  n: 8, name: 'sync',
  done: async c => Object.keys(c.cfg.sync).length > 0 || !!(await c.h.store.get(`init.skip8:${c.rk}`)),
  async propose(c) {
    const a = c.args[0]
    if (a === 'skip') { await c.h.store.set(`init.skip8:${c.rk}`, true); return 'init 8: sync skipped (re-run /cadre init 8 <adapter> any time)' }
    if (a) return wire.syncAdd(c.h, a)
    const names = Object.keys(c.cfg.adapters)
    return `init 8 (optional): sync this project with an external tracker?\n${names.length ? `configured adapters: ${names.join(', ')}\nrun /cadre init 8 <adapter>` : 'no adapters configured (add one under adapters in ~/.claude/cadre.json)'}, or /cadre init 8 skip`
  },
}
const STAGES = [S1, S2, S3, S4, S5, S6, S7, S8]

async function setState(c: Ctx, n: number, state: 'pending' | 'proposed' | 'done') {
  await c.h.board.update(b => ({ ...b, init: [...b.init.filter(i => i.stage !== n), { stage: n, state }].sort((x, y) => x.stage - y.stage) }))
  await emit(c.h, 'init.stage', { stage: n, state })
}
const saver = (c: Ctx): Save => async (path, text) => { const old = await c.h.readText(path); if (old === text) return; if (old !== null) await c.h.write(`${path}.bak`, old); await c.h.write(path, text) }
async function reread(c: Ctx, targets: string[]) { return Object.fromEntries(await Promise.all(targets.map(async t => [t, await c.h.readText(t)]))) }

// A stage that returns text instead of a diff, or fails, is `pending` while main owes it a request (mission, discovery: the consumers in briefs/admission/tools look for pending), else `proposed`.
const waiting = async (c: Ctx) => ((await c.h.ui.read()).initRequest ? 'pending' as const : 'proposed' as const)

// Show the diff and arm a fresh nonce-salted code (never printed: the human reads it from the band). A diff-less plan applies at once.
async function show(c: Ctx, st: Stage): Promise<string> {
  const p = await st.propose(c); if (typeof p === 'string') { await setState(c, st.n, await waiting(c)); return p }
  const save = saver(c)
  if (!p.lines.length) return finish(c, st, await p.apply(save))
  const text = `init ${st.n} ${st.name}: proposed changes\n${p.lines.join('\n')}`
  const sig = fnv1a64(text + canon(await reread(c, p.targets)))
  await c.h.ui.update(u => ({ ...u, 'init.pending': { stage: st.n, sig, name: st.name, lines: p.lines.slice(0, 14) } }))
  await initPropose(c.h, st.n, text)
  await setState(c, st.n, 'proposed')
  return `${text}\n\nConfirm with the code shown in the cadre band: /cadre init confirm <code>`
}
async function finish(c: Ctx, st: Stage, r: { ok: boolean; text: string }): Promise<string> {
  await setState(c, st.n, r.ok ? 'done' : await waiting(c))
  const next = r.ok ? STAGES.find(s => s.n > st.n) : undefined
  return `init ${st.n} ${st.name}: ${r.text}${next ? `\nnext: /cadre init (stage ${next.n} ${next.name})` : ''}`
}

async function confirm(c: Ctx, code: string | undefined): Promise<string> {
  const pend = (await c.h.secret.read()).initConfirm, good = !!pend && !!code && await initConfirm(c.h, pend.stage, code)   // burns on every attempt
  if (!pend || !code) await initConfirm(c.h, 0, '')
  if (!pend) return 'init: nothing pending; run /cadre init'
  const st = STAGES.find(s => s.n === pend.stage); if (!st) return 'init: nothing pending; run /cadre init'   // a pending setup code is burned by the attempt
  if (!good) return `init: wrong code (burned); a new diff and code follow\n${await show(c, st)}`
  const was = ((await c.h.ui.read())['init.pending'] as { sig: string } | undefined)?.sig
  const p = await st.propose(c); if (typeof p === 'string') return p
  const text = `init ${st.n} ${st.name}: proposed changes\n${p.lines.join('\n')}`
  if (fnv1a64(text + canon(await reread(c, p.targets))) !== was) return `init: files changed since the diff was shown; nothing written; re-shown\n${await show(c, st)}`
  const save = saver(c)
  return finish(c, st, await p.apply(save))
}

// doctor: which stages are complete (read-only predicates)
export async function progress(h: Host): Promise<{ n: number; name: string; done: boolean }[]> {
  const root = await h.cwd(), home = await h.home(), rk = repoKeyOf(root), cfg = (await load(h, { home, root, repoKey: rk })).config, c: Ctx = { h, root, home, rk, cfg, args: [] }
  return Promise.all(STAGES.map(async s => ({ n: s.n, name: s.name, done: await s.done(c).catch(() => false) })))
}

export async function run(h: Host, args: string[]): Promise<string> {
  const root = await h.cwd(), home = await h.home(), rk = repoKeyOf(root)
  const cfg = (await load(h, { home, root, repoKey: rk })).config, c: Ctx = { h, root, home, rk, cfg, args: [] }
  if (args[0] === 'confirm') return confirm(c, args[1])
  const st = args[0] ? STAGES.find(s => String(s.n) === args[0] || s.name === args[0]) : undefined
  if (args[0] && !st) return `init: unknown stage "${args[0]}" (1 repo, 2 store, 3 mission, 4 discovery, 5 containment, 6 workflow, 7 changelog, 8 sync)`
  c.args = args.slice(1)
  if (st) return show(c, st)
  for (const s of STAGES) if (!(await s.done(c))) return show(c, s)
  return 'init: all stages complete'
}
