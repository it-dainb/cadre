// /cadre init: the staged wizard (DESIGN 10.1, ADR 0009). Each stage: propose -> diff on the card -> confirm (press or `confirm <code>`) -> re-read -> .bak -> validate -> save,
// then the next incomplete stage is proposed. A stage is complete when its validated keys exist. Pending diff: ui['init.pending']; code: secret.initConfirm. Command text: one line.
import type { Host } from '../types'
import { canon, fnv1a64 } from '../core/board'
import { emit } from '../core/events'
import { initConfirm, initPropose, missionOf } from '../core/dispatch'
import { ask, handOff, settle } from '../core/decide'
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
interface Ctx { h: Host; root: string; home: string; rk: string; cfg: Config; args: string[]; seen: Set<number> }   // seen: stages finished in this run (auto-advance never loops)
// a stage answers a diff (Plan), a reason/question for the human (string), a brief for main (agentic: 3 mission, 4 discovery), or waits on another card
type Agentic = { brief: string; working: string[] }
interface Stage { n: number; name: string; done(c: Ctx): Promise<boolean>; propose(c: Ctx): Promise<Plan | string | Agentic | { wait: string }> }

const base = (p: string) => p.split('/').filter(Boolean).pop() ?? 'repo'
export const repoKeyOf = (root: string) => `${base(root)}-${fnv1a64(root).slice(0, 6)}`
// an agent's cwd is <wtRoot>/<repoKey>/<task> or <repoKey>.views/<task>: map it back to the repo root recorded at session.start (the per-session secret is gone after /clear)
export const rootFor = (roots: Record<string, string> | undefined, cwd: string) => Object.entries(roots ?? {}).find(([k]) => cwd.includes(`/${k}/`) || cwd.includes(`/${k}.views/`))?.[1] ?? cwd
export const scoped = async (h: Host, name: string) => `cadre:${repoKeyOf(await h.cwd())}:${name}`   // $.store keys are per repo (13.5)
const git = (c: Ctx, ...a: string[]) => c.h.run(['git', ...a], { cwd: c.root })
const ok = (text: string) => ({ ok: true, text }), no = (text: string) => ({ ok: false, text }), tail = (r: { stderr: string }) => r.stderr.trim().split('\n').pop()
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
    const unborn = isRepo && (await git(c, 'rev-parse', '--verify', 'HEAD')).exitCode !== 0   // git init ran but the first commit failed (no author identity, a commit hook, signing): finish it, else `git branch dev` can never resolve
    const lines = [...(isRepo ? unborn ? [`+ initial commit on ${def}`] : [] : [`+ git init -b ${def} + initial commit`]), ...(isRepo && (await git(c, 'rev-parse', '--verify', dev)).exitCode === 0 ? [] : [`+ git branch ${dev} ${def}`]),
      ...want.filter(w => !have.includes(w)).map(w => `+ ${exPath}: ${w}`), ...cfgEdit.lines]
    if (lines.length) lines.push('keys: branches -> committed .cadre/config.json; relaxations (jailWritable, knownRed) -> ~/.claude/cadre.json')
    return { lines, targets: [exPath, cfgPath], async apply(save) {
      if (!isRepo) { const r = await git(c, 'init', '-b', def); if (r.exitCode) return no(`git init failed: ${tail(r)}`) }
      if ((await git(c, 'rev-parse', '--verify', 'HEAD')).exitCode) for (const a of [['add', '-A'], ['commit', '--allow-empty', '-m', 'chore: initial commit']]) {
        const r = await git(c, ...a); if (r.exitCode) return no(/identity|auto-detect email|who you are/i.test(r.stderr) ? 'git commit failed: git has no author name/email; run git config --global user.name "…" and user.email "…", then confirm again' : `git ${a[0]} failed: ${tail(r)}`)
      }
      if ((await git(c, 'rev-parse', '--verify', dev)).exitCode) { const r = await git(c, 'branch', dev, def); if (r.exitCode) return no(`git branch ${dev} ${def} failed: ${tail(r)}`) }
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

// the ONE prompt main gets when an agentic stage is reached (task language only, ADR 0006 lint); sent like setup's hand-off (commands/doctor.handOff)
export const MISSION = [
  "Set this project's mission with the human.",
  '1. Ask the human (AskUserQuestion, one round) for the goal in one line, the constraints and the non-goals.',
  '2. Draft it: TaskCreate with subject = the goal, description = "Goal: …\nConstraints: …\nNon-goals: …", metadata {"kind":"mission"}.',
  '3. Stop. The human approves the mission on its card; the next step follows on its own.',
].join('\n')
export const DISCOVER = [
  'Find out how this project is built and tested.',
  'Spawn ONE Agent with the prompt "discover how this repo builds and tests" (no task id in it). It gets its full instructions on its own and reports back.',
  'Wait for it to finish, then stop. Do not read the files yourself; the next step follows on its own.',
].join('\n')

const S3: Stage = {
  n: 3, name: 'mission',
  done: async c => {
    if ((await c.h.board.read()).mission !== null) return true
    const m = await wire.store(c.h, c.cfg, c.root).then(missionOf).catch(() => null)   // a new session: the board is cold, the recorded mission lives in beads
    if (m) await c.h.board.update(b => ({ ...b, mission: m }))
    return !!m
  },
  propose: async c => ((await c.h.board.read()).plan?.slug === 'mission' ? { wait: 'the mission draft waits for your approval on its card' }
    : { brief: MISSION, working: ['Claude is working on the mission…', 'answer its questions in the transcript, then approve the mission on its card'] }),
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
    if (!pkgs) return { brief: DISCOVER, working: ['Claude is working on discovery…', 'an explorer reads CI config, manifests and test dirs; the diff follows when it reports'] }
    const sig = fnv1a64(canon(pkgs)); let audit = (await c.h.store.get(`init.audit:${c.rk}`)) as { sig: string; runs: D.Run[] } | undefined
    if (audit?.sig !== sig) { audit = { sig, runs: [] }; for (const p of pkgs) audit.runs.push(await D.exec(c.h, c.root, c.home, p, { audit: true })); await c.h.store.set(`init.audit:${c.rk}`, audit) }
    const bad = pkgs.findIndex((_, i) => !audit!.runs[i].setupOk); if (bad >= 0) return `init 4: setup ${JSON.stringify(pkgs[bad].setup)} failed in ${pkgs[bad].root}; fix it and have main re-run discovery`
    const caches = [...new Set(audit.runs.flatMap(r => r.caches))]
    const knownRed = pkgs.map((p, i) => ({ root: p.root, red: Object.keys(audit!.runs[i].results).filter(n => audit!.runs[i].results[n] === 'red') }))
    const lines = [...pkgs.flatMap((p, i) => [`+ packages[${p.root}]: setup ${p.setup.join(' ') || '(none)'}; checks ${Object.keys(p.checks).join(',')}`,
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
    if (a === 'skip') return { lines: [], targets: [], async apply() { await c.h.store.set(`init.skip8:${c.rk}`, true); return ok('sync skipped (/cadre init 8 <adapter> adds it later)') } }
    if (a) return wire.syncAdd(c.h, a)
    const names = Object.keys(c.cfg.adapters)
    return `init 8 (optional): sync this project with an external tracker?\n${names.length ? `configured adapters: ${names.join(', ')}\nrun /cadre init 8 <adapter>` : 'no adapters configured (add one under adapters in ~/.claude/cadre.json)'}, or /cadre init 8 skip`
  },
}
const STAGES = [S1, S2, S3, S4, S5, S6, S7, S8]
const tag = (st: Stage) => `${st.n}/${STAGES.length} ${st.name}`
const rel = (c: Ctx, l: string) => l.replaceAll(`${c.root}/`, '').replaceAll(`${c.home}/`, '~/')   // the card shows repo-relative and ~ paths
const strip = (l: string) => l.replace(/^init \d+( \(optional\))?: /, '')
const one = (t: string) => strip(t).split('\n').filter(Boolean).join(' ').slice(0, 140)   // the command text is ONE line (UI-DESIGN D2); the detail goes to the card

async function setState(c: Ctx, n: number, state: 'pending' | 'proposed' | 'done') {
  let same = false
  await c.h.board.update(b => (same = b.init.some(i => i.stage === n && i.state === state)) ? b : { ...b, init: [...b.init.filter(i => i.stage !== n), { stage: n, state }].sort((x, y) => x.stage - y.stage) })
  if (state === 'done' && (n === 3 || n === 4)) await c.h.ui.update(({ initRequest: _r, ...u }) => u)
  if (!same) await emit(c.h, 'init.stage', { stage: n, state, name: STAGES[n - 1]?.name })   // a re-proposal of the same state is not news
}
const saver = (c: Ctx): Save => async (path, text) => { const old = await c.h.readText(path); if (old === text) return; if (old !== null) await c.h.write(`${path}.bak`, old); await c.h.write(path, text) }
async function reread(c: Ctx, targets: string[]) { return Object.fromEntries(await Promise.all(targets.map(async t => [t, await c.h.readText(t)]))) }

// A stage that waits on main (mission, discovery: the consumers in briefs/admission/tools look for pending) is `pending`, else `proposed`.
const waiting = async (c: Ctx) => ((await c.h.ui.read()).initRequest ? 'pending' as const : 'proposed' as const)
// one init card at a time (setup's init:90 is its own)
const clear = async (c: Ctx) => settle(c.h, ...((await c.h.board.read()).decisions ?? []).filter(d => d.id.startsWith('init:') && d.id !== 'init:90').map(d => d.id))
// a card with no code: a reason, a question, or "Claude is working on it"
async function note(c: Ctx, st: Stage, lines: string[], working = false, retry = working): Promise<void> {
  await clear(c)
  await ask(c.h, { id: `init:${st.n}`, kind: 'init', title: `init ${tag(st)} · ${working ? 'Claude is on it' : 'needs you'}`, short: `init ${st.n}/${STAGES.length} ${st.name}`, lines: lines.map(l => rel(c, l)), hash: fnv1a64(lines.join('\n')), tab: 'epic', fallback: `/cadre init ${st.n}`,
    options: [...(st.n === 8 ? [{ key: 's', label: 'Skip', verb: 'reject', run: 'init 8 skip' }] : []), { key: 'r', label: retry ? 'Retry' : 'Re-check', verb: 'change', run: `init ${st.n}` }, { key: 'x', label: 'Cancel', verb: 'reject', run: 'init cancel' }] })
}

// Propose a stage: a diff goes on the card with a fresh nonce-salted code (never printed); a diff-less plan applies at once; `why` = the last attempt's failure, shown on top.
async function show(c: Ctx, st: Stage, why?: string): Promise<string> {
  const p = await st.propose(c), bang = why ? [`! last try: ${why}`] : []
  if (typeof p === 'string') { await setState(c, st.n, await waiting(c)); await note(c, st, [...bang, ...p.split('\n').map(strip)]); return `stage ${tag(st)}: ${one(p)} · see the card` }
  if ('wait' in p) { await setState(c, st.n, 'pending'); await settle(c.h, `init:${st.n}`); return `stage ${tag(st)}: ${p.wait}` }
  if ('brief' in p) return agentic(c, st, p)
  if (!p.lines.length) { if (!why) return finish(c, st, await p.apply(saver(c))); await note(c, st, bang); return `stage ${tag(st)}: ${one(why)} · see the card` }
  const text = `init ${st.n} ${st.name}: proposed changes\n${p.lines.join('\n')}`, shown = p.lines.map(l => `  ${rel(c, l)}`)
  const sig = fnv1a64(text + canon(await reread(c, p.targets)))
  await clear(c)
  await c.h.ui.update(u => ({ ...u, 'init.pending': { stage: st.n, sig, lines: p.lines } }))
  await initPropose(c.h, st.n, text, { title: `init ${tag(st)} · confirm`, short: `init ${st.n}/${STAGES.length} ${st.name}`, sub: 'init', change: `init ${st.n}`, lines: [...bang, ...shown.slice(0, 14), ...(shown.length > 14 ? [`  … ${shown.length - 14} more lines`] : [])] })
  await setState(c, st.n, 'proposed')
  return `stage ${tag(st)}${why ? ` failed: ${one(why)} ·` : ''} ready · confirm on the card`
}
// stages 3 and 4 need the model: ONE brief to main per stage run, the way setup hands off (commands/doctor.handOff: sent from a press, queued from a typed command)
async function agentic(c: Ctx, st: Stage, p: Agentic): Promise<string> {
  await c.h.ui.update(u => ({ ...u, initRequest: st.name }))
  await setState(c, st.n, 'pending')
  if (!(await c.h.secret.read()).setupFix?.sent) await handOff(c.h, p.brief, st.n, 'init')   // a refused (queued) one is sent again by Retry
  await note(c, st, p.working, true)
  return `stage ${tag(st)}: Claude is working on it`
}
// applied: mark done and propose the next incomplete stage (no retyping); failed: the reason stays on the card and the stage is proposed again
async function finish(c: Ctx, st: Stage, r: { ok: boolean; text: string }): Promise<string> {
  if (!r.ok) return show(c, st, r.text)
  await setState(c, st.n, 'done'); await settle(c.h, `init:${st.n}`); c.seen.add(st.n)
  return `stage ${tag(st)} done · ${await next(c)}`
}
async function next(c: Ctx): Promise<string> {
  c.cfg = (await load(c.h, { home: c.home, root: c.root, repoKey: c.rk })).config; c.args = []   // stage 1 just wrote the repo config
  const b = await c.h.board.read()
  for (const s of STAGES) {
    if (c.seen.has(s.n)) continue
    if (!(await s.done(c).catch(() => false))) return show(c, s)
    if (b.init.some(i => i.stage === s.n && i.state !== 'done')) await setState(c, s.n, 'done')   // done elsewhere (the mission approved on its card)
  }
  await clear(c); return 'all stages done'
}

async function confirm(c: Ctx, code: string | undefined): Promise<string> {
  const pend = (await c.h.secret.read()).initConfirm, good = !!pend && !!code && await initConfirm(c.h, pend.stage, code)   // burns on every attempt
  if (!pend || !code) await initConfirm(c.h, 0, '')
  if (!pend) return 'init: nothing pending; run /cadre init'
  const st = STAGES.find(s => s.n === pend.stage); if (!st) return 'init: nothing pending; run /cadre init'   // a pending setup code is burned by the attempt
  if (!good) return `init: wrong code (burned) · ${await show(c, st)}`
  const was = ((await c.h.ui.read())['init.pending'] as { sig: string } | undefined)?.sig
  const p = await st.propose(c); if (typeof p === 'string' || !('lines' in p)) return `init: ${await show(c, st)}`
  const text = `init ${st.n} ${st.name}: proposed changes\n${p.lines.join('\n')}`
  if (fnv1a64(text + canon(await reread(c, p.targets))) !== was) return `init: files changed since the diff; nothing written · ${await show(c, st, 'files changed since the diff was shown; nothing was written')}`
  return `init: ${await finish(c, st, await p.apply(saver(c)))}`
}

const ctxOf = async (h: Host, args: string[]): Promise<Ctx> => {
  const root = await h.cwd(), home = await h.home(), rk = repoKeyOf(root)
  return { h, root, home, rk, cfg: (await load(h, { home, root, repoKey: rk })).config, args, seen: new Set() }
}
// doctor: which stages are complete (read-only predicates)
export async function progress(h: Host): Promise<{ n: number; name: string; done: boolean }[]> {
  const c = await ctxOf(h, [])
  return Promise.all(STAGES.map(async s => ({ n: s.n, name: s.name, done: await s.done(c).catch(() => false) })))
}
// main's turn ended: `end` = the turn the hand-off started (commands/doctor.afterFix); else any main turn while discovery waits and its report is in.
// Moved on: the next card follows. Still owed at the end of the hand-off turn: the card says Claude stopped, Retry hands it over again.
export async function after(h: Host, end: boolean): Promise<void> {
  const b = await h.board.read(), p = b.init.find(i => (i.stage === 3 || i.stage === 4) && i.state === 'pending'); if (!p) return
  const moved = p.stage === 4 ? !!(await h.store.get(`init.discovery:${repoKeyOf(await h.cwd())}`)) : b.plan?.slug === 'mission' && !!b.decisions?.some(d => d.id === 'init:3')   // reported / drafted since
  if (!end && !moved) return
  const c = await ctxOf(h, []), st = STAGES[p.stage - 1], q = await st.propose(c)
  if (typeof q === 'object' && 'brief' in q) {
    if (p.stage === 4 && (await h.ui.read()).discoveryAgent) return   // the explorer runs in the background: its report moves init on at a later turn end
    return note(c, st, [`Claude stopped before finishing ${st.name}.`, 'Retry hands it the step again.'], false, true)
  }
  await next(c)
}

export async function run(h: Host, args: string[]): Promise<string> {
  const c = await ctxOf(h, [])
  if (args[0] === 'confirm') return confirm(c, args[1])
  const st = args[0] ? STAGES.find(s => String(s.n) === args[0] || s.name === args[0]) : undefined
  if (args[0] && !st) return `init: unknown stage "${args[0]}" (1 repo, 2 store, 3 mission, 4 discovery, 5 containment, 6 workflow, 7 changelog, 8 sync)`
  c.args = args.slice(1)
  return `init: ${st ? await show(c, st) : await next(c)}`
}
