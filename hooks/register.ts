// The only file that calls on() or touches $. Registration ORDER is the chain order (DESIGN 2.2, outermost first).
// Each slot calls a function in its owner module with a per-hook Host (never a module-level Host, L3). Gating registrations carry a fail-closed .catch (13.3).
import { modelText } from '../core/say'
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { Host } from '../types'
import { UI, emptySnapshot, sessionOf } from '../core/board'
import { emptyRing, subscribe } from '../core/events'
import { drain, meter, compact, submit } from '../core/reuse'
import { goal, watchdog } from '../core/drive'
import { FRAMES, spawnStep, syncMode } from '../core/spawner'
import { quit, wake, warm } from '../core/session'
import '../config/route'   // registers ROUTES.config
import { observe } from '../core/close'
import '../core/integrate'   // registers ROUTES.release
import { admit, tick as heartbeat } from '../core/admission'
import { contain, heal } from '../policy/containment'
import { check, guard, send, judge, judgeSpawn, configSet, settingsOnly, EXIT, exitCall } from '../policy/guards'
import { backstop, exitStep } from '../core/lifecycle'
import { overdue, sweepProbes } from '../core/needs'
import { autoLand } from '../core/integrate'
import { TASK_TOOLS, mainAgent } from '../core/plantools'
import { agentSpec, exitIssue } from '../core/roles'
import { mainTurn } from '../core/dispatch'
import { wrap } from '../core/effect'
import { handle, MAIN_SPECS, PREFS_SPEC, SPECS } from '../tools/index'
import { context, attachment } from '../core/briefs'
import { decide, run } from '../commands/cadre'
import { nudge, oldLine, setupDue, tooOld } from '../commands/doctor'
import { pump, resume, turnEnd, seen, stopCheck, redNote, watch, halt } from '../commands/agentrun'
import { tick } from '../task-management/sync-engine/loop'
import { autoAsk, onEvent, renderBand, renderCard, renderPane, tickUi, ack, mapCard, resumeBanner } from '../ui/index'
import { load } from '../config/index'
import { wire, repoKeyOf, rootFor } from '../commands/init'
import { clarifyCall, clarifyCheck } from '../core/clarify'
import { FileStore } from '../task-management/adapters/file/store'
import { StoreError } from '../task-management/store'
import { MemoryStore } from '../task-management/adapters/memory/store'

const board = atom({ plugin: 'cadre', key: 'board' } as const, emptySnapshot())
const events = atom({ plugin: 'cadre', key: 'events' } as const, emptyRing())
const secret = atom({ plugin: 'cadre', key: 'secret' } as const, {})
const ui = atom({ plugin: 'cadre', key: 'ui' } as const, {})
const git = atom({ plugin: 'cadre', key: 'git' } as const, { busy: false, epoch: 0 })
const bind = atom({ plugin: 'cadre', key: 'bind' } as const, {})

// The one TaskStore factory (init and dispatch both use `wire.store`): memory for CADRE_STORE=memory (tests), else the file store in .cadre/state, made on first use.
// One FileStore per root+session in this process (FileStore.of: warm scans, op ids kept across a Timeout); each call's view runs on its own hook's Host (L3).
let mem: MemoryStore | undefined
const ready = new Set<string>()   // roots whose store answered the probe this load
wire.store = async (h, cfg, root) => {
  if (cfg.store.kind === 'memory') { if (!mem) { mem = new MemoryStore(); await mem.init({ types: cfg.types as any, journal: false }) } return mem }
  if (!(await h.store.get(`cadre:${repoKeyOf(root)}:actor`))) await h.store.set(`cadre:${repoKeyOf(root)}:actor`, `cadre/${h.rand(3)}`)
  const s = FileStore.of(h, `${root}/.cadre/state`, await sessionOf(h)); if (ready.has(root) && s.initialized) return s   // a wiped store re-probes and re-inits
  const p = await s.probe()
  if (!p.ok) { await h.secret.update(x => ({ ...x, active: false, storeOff: p.detail })); throw new StoreError('Unavailable', p.detail) }   // no activation (core/session.wake)
  if (p.detail !== 'initialized' || !p.journal) await s.init({ types: cfg.types as any, journal: true })
  ready.add(root); return s
}

// The repo root: the git top level above the session's project root (Claude Code started in a package folder still works on the repo), spelled from the
// session's own path (--show-cdup, not a realpath: the per-repo keys stay what they were). Not inside git yet (setup runs `git init`): the project root, asked again after 5 s.
const tops = new Map<string, { v: string; at: number }>()
async function top($): Promise<string> {
  const r = String(await $.session.root()), now = Date.now(), m = tops.get(r); if (m && (m.v !== r || now - m.at < 5000)) return m.v
  const o = await $.process.run(['git', 'rev-parse', '--show-cdup'], { cwd: r }).catch(() => ({ exitCode: 1, stdout: '' }))
  const up = o.exitCode ? 0 : String(o.stdout).trim().split('/').filter(x => x === '..').length, v = up ? r.split('/').slice(0, -up).join('/') || '/' : r
  tops.set(r, { v, at: now }); return v
}

let options: Host['options'] = {}   // set by register(); module vars reset on reload, which re-runs register

// Host per hook entry: literal closures over $. Additions are append-only (types/index.d.ts).
function host($): Host {
  const h: Host = {
    now: () => $.clock.now(),
    rand: (n = 16) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join(''),
    board: { read: () => read($, board), update: fn => update($, board, fn) },
    events: { read: () => read($, events), update: fn => update($, events, fn) },
    secret: { read: () => read($, secret), update: fn => update($, secret, fn) },
    ui: { read: () => read($, ui), update: fn => update($, ui, fn) },
    git: { read: () => read($, git), update: fn => update($, git, fn) },
    bind: { read: () => read($, bind), update: fn => update($, bind, fn) },
    store: { get: k => $.store.get(k), set: async (k, v) => { await $.store.set(k, v) }, del: async k => { await $.store.delete(k) } },
    env: async () => ({
      CADRE_STRICTNESS: await $.env.get('CADRE_STRICTNESS'), CADRE_STORE: await $.env.get('CADRE_STORE'),
      CADRE_DISABLE: await $.env.get('CADRE_DISABLE'), CADRE_SPAWN: await $.env.get('CADRE_SPAWN'), PATH: await $.env.get('PATH'), LANG: await $.env.get('LANG'),   // an install run's own environment (core/git.setupJail)
      GIT_AUTHOR_NAME: await $.env.get('GIT_AUTHOR_NAME'), GIT_AUTHOR_EMAIL: await $.env.get('GIT_AUTHOR_EMAIL'),   // identity prefill (core/git.identity)
    }),
    readText: async path => { try { return String(await $.fs.read(path)) } catch { return null } },
    log: t => { void $.ui.log(t) },
    toast: t => { void $.ui.toast(t) },
    options,
    stat: async (p, o) => { try { return await $.fs.stat(p, { resolve: !!o?.resolve }) } catch { return undefined } },
    run: async (argv, init) => $.process.run(argv, { cwd: await h.cwd(), ...init }),   // the repo root by default: in an agent's turn-end frame the session's cwd is the agent's worktree, which a close removes (ADR 0018)
    settings: () => $.settings.read(),
    spawn: async a => {   // adapter protocol (SA-09): one request, stdin closed after `input`; leaving the loop kills the child
      const it = $.process.spawn({ argv: [...a.argv], input: a.input })[Symbol.asyncIterator](), dead = new Promise<'t'>(r => { void $.clock.after(a.timeoutMs ?? 30_000, () => r('t')) })
      let stdout = '', stderr = ''
      try {
        for (;;) {
          const r: any = await Promise.race([it.next(), dead]); if (r === 't') throw new Error('timeout')
          if (r.done) return { exitCode: r.value?.code ?? null, stdout, stderr }
          if (r.value.stream === 'stderr') stderr += r.value.text; else stdout += r.value.text
        }
      } finally { void it.return?.(undefined) }
    },
    write: async (p, t) => { await $.fs.write(p, t) },
    cwd: async () => (await read($, secret)).root ?? rootFor(((await $.store.get('cadre:roots')) ?? undefined) as Record<string, string> | undefined, await top($)), home: async () => String((await $.env.get('HOME')) ?? ''),
    ops: {   // ui/ side effects; a press's own work and every timer run through after()
      els: e => $.ui.resolve(e), open: a => $.ui.open(a), focused: async () => (await $.ui.panes()).some(p => p.id === 'cadre' && p.isFocused),
      toast: (t, o) => { void $.ui.toast(t, o) }, status: t => { void $.ui.status(t) }, invalidate: () => { void $.ui.invalidate('ui.render') }, blit: a => $.ui.blit(a),
      notify: async (t, o) => { try { return { isSent: !!(await $.ui.notify(t, o)).isSent } } catch { return { isSent: false } } },
      peek: async () => (await $.prompt.read()).text, fill: async t => ({ isFilled: !!(await $.prompt.fill({ text: t, mode: 'replace' })).isFilled }), copy: async t => ({ isCopied: !!(await $.ui.copy({ text: t })).isCopied }),
      after: (ms, fn) => { void $.clock.after(ms, () => { void Promise.resolve(fn()).catch(() => {}) }) },
    },
  }
  h.config = async () => { const root = await h.cwd(); return (await load(h, { home: await h.home(), root, repoKey: repoKeyOf(root) })).config }
  h.taskStore = async () => wire.store(h, await h.config!(), await h.cwd())
  h.answer = (id, key, hash, vals) => decide(h, id, key, hash, vals)
  h.ask = async (q, o) => String(await $.ui.ask(q, o))
  h.sendTo = (agentId, text) => $.session.send({ to: { agentId }, text: modelText('nudge', text) })   // core/reuse.drain only
  h.submit = text => $.prompt.submit({ text: modelText('brief', text) })   // drive, from #1 after next only
  h.usage = () => $.session.usage()
  h.version = async () => String((await $.session.version()).version)
  h.theme = async () => { const v = String(((await $.config.list().catch(() => [])) as { key: string; value?: unknown }[]).find(r => r.key === 'theme')?.value ?? ''); return /^light/.test(v) ? 'light' : /^dark/.test(v) ? 'dark' : 'unknown' }
  h.root = async () => $.plugin.root
  h.model = { complete: a => $.model.complete(a) as any }
  h.shell = async () => String(await $.session.cwd())
  h.stopAgent = async agentId => { const r: any = await $.tool.call({ tool: 'TaskStop', task_id: agentId }); if (r?.deny || r?.isError) throw new Error(r.deny ?? r.text) }   // from a timer frame: no hook of ours sees it (G6), no dialog in auto or yolo; an agent not running here (S0: "is not running") is an error result
  return h
}

// The one place an agent is started (core/spawner, ADR 0018): a host that can spawn, built only in a frame no agent's own events are raised under; anywhere else it throws
function spawner($, next): Host {
  if (!FRAMES.includes(next.event)) throw new Error(`spawn refused in ${next.event}`)
  const h = host($); h.spawnAgent = a => $.agent.spawn(a) as Promise<{ agentId?: string; deny?: string }>; return h
}

// Fail-closed handlers (G1, G2). On re-entry every $ rejects, so decide from the event alone.
const FAIL = 'refused: temporary failure; retry once, then ask the human'
const why = ($, next) => { if (next.error && next.error.kind !== 're-entry') void $.ui.log(`hook failed: ${next.error.kind}: ${next.error.message}`); return FAIL }   // the engine redacts the error in its own log: keep the reason in ours
export function denyCall($, e, next) { return EXIT.includes(e.tool) ? next(exitCall(e)) : next.error?.kind === 're-entry' ? (judge(e) ? { deny: modelText('deny', judge(e)!) } : next(e)) : next.called ? next(e) : { deny: modelText('deny', why($, next)) } }
function denySpawn($, e, next) { return next.error?.kind === 're-entry' ? (judgeSpawn(e) ? { deny: modelText('deny', judgeSpawn(e)!) } : next(e)) : next.called ? next(e) : { deny: modelText('deny', why($, next)) } }
function denyCheck($, e, next) { return next.error?.kind === 're-entry' || !next.called ? { decision: 'deny', reason: modelText('deny', why($, next)) } : next(e) }
// prompt.submit / session.compact only add context or a summary: on failure fall back to the engine's own (deliberate fail-open). /cadre never acts on failure.
function passOn($, e, next) { return next(e) }
function denyCmd($, e, next) { return next.called ? next(e) : { text: FAIL } }
function denySend($, e, next) { return next.error?.kind === 're-entry' ? next(e) : next.called ? next(e) : { isDelivered: false, reason: modelText('deny', FAIL) } }

// Dev only (docs/dev/ui-dev.md): seed the atoms from a scenario dump (`scripts/ui-dev.mjs --dump`) so the pane shows it in real Claude Code. Inert unless CADRE_DEV is 1.
async function seed($) {
  const path = (await $.env.get('CADRE_DEV')) === '1' ? await $.env.get('CADRE_DEV_SCENARIO') : undefined; if (!path) return
  const text = String(await $.fs.read(String(path))), d = (await $.clock.now()) - (JSON.parse(text).now ?? 0)   // scenario times are relative to its own `now`: move them to this clock
  const s = JSON.parse(text, (k, v) => (['at', 'approvedAt', 'phaseSince', 'startedAt'].includes(k) && typeof v === 'number' && v > 0 ? v + d : v)) as { b: any; ring: any[]; sec?: object; ui?: object; c?: object }
  await update($, board, () => s.b); await update($, events, () => ({ seq: s.ring.length, epics: { [s.b.epic ?? '']: s.ring } }))
  await update($, secret, x => ({ ...s.sec, root: (x as any).root })); await update($, ui, () => ({ ...s.ui, cfg: { ...(s.ui as any)?.cfg, ...s.c } }))
}

// custom roles (roles.custom): one $.agent.register each at session.start in an active repo; the engine rejects until the session binds, so a rejection is retried once on the
// first main turn.start or /cadre, then it is a Doctor line. Rule 6 (exit tools) holds at every register. A fulfilled register is recorded with main's turn: the role is spawned from a later turn
async function roles($, retry = false): Promise<void> {
  const s = (await read($, secret)).roles ?? { done: [], failed: {} }, todo = (n: string) => !s.done.some(x => x.name === n) && (retry ? s.failed[n]?.n === 1 : !s.failed[n])
  if (retry && !Object.keys(s.failed).some(n => s.failed[n].n === 1)) return
  const h = host($), cfg = await h.config!(), turn = (await read($, secret)).turn ?? 0
  for (const [name, sp] of Object.entries(cfg.roles.custom).filter(([n]) => todo(n)) as [string, any][]) {
    const spec = agentSpec(name, sp), bad = exitIssue(spec)
    const why = bad ?? await $.agent.register(spec).then(() => null, (x: any) => String(x?.message ?? x))
    await update($, secret, x => ({ ...x, roles: { done: why ? x.roles?.done ?? [] : [...(x.roles?.done ?? []), { name, turn }], failed: why ? { ...x.roles?.failed, [name]: { why, n: bad ? 2 : (x.roles?.failed[name]?.n ?? 0) + 1 } } : x.roles?.failed ?? {} } }))
  }
}

// main's tools for a repo that turned on in this session (/cadre init after start): registered at main's next turn start; Agent and the task tools are refused
// only once they are listed (the model sees a registered tool from its next prompt on), so main always has a way to plan
async function arm($): Promise<void> {
  const s = await read($, secret), t = s.tools; if (!t || s.old) return
  if (t.due?.length) { await update($, secret, x => ({ ...x, tools: { ...x.tools!, on: [...x.tools!.on, ...t.due!], due: undefined } })); return }
  if (t.on.includes('plan') || t.refused.includes('plan') || !(await wake(host($)).catch(() => false))) return
  const due: string[] = [], refused: string[] = []
  for (const sp of [...MAIN_SPECS, PREFS_SPEC]) if (!t.on.includes(sp.name)) await $.tool.register(sp).then(() => { due.push(sp.name) }, () => { refused.push(sp.name) })
  await update($, secret, x => ({ ...x, tools: { ...x.tools!, refused: [...x.tools!.refused, ...refused], due } }))
}

export const register: Register = (on, opts) => {
  options = { strictness: opts?.strictness as string | undefined }
  subscribe(onEvent)   // ui/notify: toasts, notify, status line from the event stream
  UI.mapCard = mapCard; UI.banner = resumeBanner   // core -> ui hooks (core never imports ui/)

  // session.start: agents, command, tools env, the one tick. Awaited before turn one (L7).
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cadre', description: 'cadre: plan, approve, status, resolve, release, drive, init, setup, doctor', argumentHint: '<sub> [args]', immediate: true })
    const v = String((await $.session.version().catch(() => ({ version: '' }))).version ?? ''), old = tooOld(v) ? v : undefined
    await update($, secret, x => ({ ...x, old }))
    if (old) { void $.ui.log(oldLine(old)); void $.ui.toast(oldLine(old)); return next(e) }   // too old: one loud line, /cadre repeats it, no tools, no tick; wake() keeps every other hook a pass-through
    const root = await top($); await update($, secret, x => ({ ...x, root })); await $.store.set('cadre:roots', { ...(((await $.store.get('cadre:roots')) ?? {}) as object), [repoKeyOf(root)]: root })   // the repo root for every hook. Never $.session.cwd(): it follows a Bash `cd` (main in a package folder read its checks and store there after a /clear, live 0.9.1) and in a subagent hook it is the agent's view/worktree
    await seed($).catch(x => $.ui.log(`dev scenario not seeded: ${x}`))   // dev only: CADRE_DEV=1 + CADRE_DEV_SCENARIO (harness/tui.sh --scenario)
    await $.env.set('ENABLE_TOOL_SEARCH', 'false')   // S13: isDeferred:false alone does not stop deferral
    await update($, ui, x => ({ ...x, headless: !e.isInteractive || undefined }))   // core/spawner.spawnMode: a one-shot -p run ends before an agent's turn end
    await wake(host($)).catch(e => $.ui.log(`session start: ${e}`)); await halt(host($)).catch(() => {}); await syncMode(host($)).catch(() => {})   // a setup cut short in an earlier session: the band says so   // active repos only: $.store 'policy' + cadre.ui.cfg + containment band (agents ship as agents/*.md files, A28)
    { const h = host($), act = await wake(h).catch(() => false), set = [...SPECS, ...(act ? MAIN_SPECS : []), ...(act || (await setupDue(h).catch(() => true)) ? [PREFS_SPEC] : [])], refused: string[] = []   // report, inspect, run_check: isDeferred:false (5.2); main's tools only where the work is due (a repo that turns on later gets them at main's next turn: arm)
      for (const t of set) await $.tool.register(t).catch(() => { refused.push(t.name) }); const listed = ((await $.tool.list().catch(() => [])) as { name: string }[]).map(t => t.name)
      await update($, secret, x => ({ ...x, tools: { on: set.map(t => t.name), refused, task: TASK_TOOLS.filter(n => listed.includes(n)) } })) }   // task: the task tools this session still shows (Doctor: the repo's settings lack the gate)   // refused (managed allowedMcpServers, --bare): Doctor says so
    { const h = host($); if (await wake(h).catch(() => false)) { await nudge(h).catch(() => {}); await sweepProbes(h).catch(() => {}); await autoLand(h).catch(x => $.ui.log(`land: ${x}`)) } }   // a landing that waited for the user's checkout   // active repos only: no setup stamp for this Claude Code build -> one toast
    await update($, secret, x => ({ ...x, roles: undefined, turn: 0 }))   // a secret that survived a resume holds registers of an earlier engine: register again
    if (await wake(host($)).catch(() => false)) await roles($).catch(x => $.ui.log(`roles: ${x}`))   // active repos only; a repo turned on later gets them next session
    $.clock.every(5000, () => { const h = host($); void pump(h).catch(() => {}); void watch(h).catch(() => {}); void autoAsk(h).catch(() => {}); void wake(h).then(act => { if (act) { void tick(h).catch(() => {}); void heartbeat(h).catch(() => {}); void heal(h).catch(() => {}); void watchdog(h).catch(() => {}); void h.secret.read().then(s => Promise.all([backstop(h, s.session ?? ''), overdue(h, s.session ?? '')])).catch(() => {}); void autoLand(h).catch(() => {}) } }).catch(() => {}) })   // timer calls skip all our hooks (G6): queue/heal only
    $.clock.every(30_000, () => { const h = host($); void wake(h).then(act => act && tickUi(h)).catch(() => {}) })   // live timeline cursor (blit, no re-render)
    return next(e)
  })

  on('session.end', async ($, e, next) => { if (e.reason !== 'clear' && e.reason !== 'resume') await quit(host($)).catch(() => {}); return next(e) })   // a quit: another session may continue this one's plan at once (core/session.held)

  // 0. the spawner: outermost, so it runs after every other turn-end hook (close, drain); the only registration that starts agents (core/spawner)
  on('turn.complete', { reason: /(?:)/ }, async ($, e, next) => { const r = await next(e); if (await wake(host($)).catch(() => false)) await spawnStep(spawner($, next), next.event).catch(x => $.ui.log(`spawner: ${x}`)); return r })
  // 1. resume-drain: the only sender, after await next(e), never from a timer. 2. observe.
  on('turn.complete', { reason: /./ }, async ($, e, next) => { if (!(await wake(host($)))) return next(e); return drain(host($), e, next) })
  on('turn.complete', { reason: /^/ }, async ($, e, next) => { if (!(await wake(host($)))) return next(e); return observe(host($), e, next) })
  on('turn.complete', { reason: /./ }, async ($, e, next) => { const r = await next(e); await turnEnd(host($), e).catch(() => {}); if (!e.agentId) await mainTurn(host($), false).catch(x => $.ui.log(`plan card: ${x}`)); return r })   // agent-run setup/init (ADR 0010): re-check when main stops; works in dormant repos too
  // 3. admission
  on('agent.spawn', async ($, e, next) => { if (!(await wake(host($)))) return next(e); return admit(host($), e, next) }).catch(denySpawn)
  // 4. tool.check allow
  on('tool.check', async ($, e, next) => { if (!(await wake(host($)))) return next(e); await warm(host($)); const cl = await clarifyCheck(host($), e, next.origin); if (cl) return cl; return check(host($), e, next) }).catch(denyCheck)
  // 5. guards (main's Agent and task tools, L1, fence, MCP pre-checks)
  on('tool.call', { tool: /./ }, async ($, e, next) => { const h = host($); if (!(await wake(h))) return (await h.secret.read()).run ? settingsOnly(h, e, next) : next(e); await warm(h); const ag = (await h.secret.read()).tools?.on.includes('plan') && mainAgent(e, (await h.board.read()).tasks.map(t => t.id), next.origin); if (ag) return ag; const cl = await clarifyCall(h, e, next.origin); if (cl) return cl; return guard(h, e, next) }).catch(denyCall)
  // 6. wrap (L3 per-call fingerprint, delta drain, result card, tester log); then our own MCP tools answer innermost
  on('tool.call', { tool: /^/ }, async ($, e, next) => { if (!(await wake(host($)))) return next(e); return wrap(host($), e, next) }).catch(denyCall)
  // agent-run setup/init: main's tool results carry what is still red; its stop is refused while a check it owns is red; turn.start feeds the watchdog (commands/agentrun). Outside cadre's own tools, which answer without next: main's explore must reach seen (a goal's clarify step)
  on('tool.call', { tool: /./ }, async ($, e, next) => { const h = host($); if (!e.agentId) await seen(h, { name: e.tool, ask: e.question !== undefined }).catch(() => {}); const r = await next(e); if (e.agentId) return r; await seen(h, { tool: true }).catch(() => {}); const t = r?.result !== undefined ? await redNote(h).catch(() => null) : null; return t ? { ...r, context: [...(r.context ?? []), modelText('context', t)] } : r }).catch(passOn)   // a note only: on failure the result goes through as it is
  on('tool.call', { tool: /^mcp__cadre__/ }, ($, e, next) => handle(host($), e, next)).catch(denyCall)
  on('classic.Stop', async ($, e, next) => { const r = await next(e); const t = await stopCheck(host($), e).catch(() => null); return t ? { ...r, block: modelText('nudge', t) } : r }).catch(passOn)
  on('turn.start', async ($, e, next) => { await update($, secret, x => ({ ...x, turn: (x.turn ?? 0) + 1 })); await roles($, true).catch(() => {}); await arm($).catch(() => {}); const r = await next(e); await seen(host($), { start: true }).catch(() => {}); await mainTurn(host($), true).catch(() => {}); return r })   // only main raises turn.start: its plan card waits for its turn end (core/dispatch.mainTurn)
  // 7. session.send
  on('session.send', async ($, e, next) => { if (!(await wake(host($)))) return next(e); return send(host($), e, next) }).catch(denySend)
  // 8. prompt.submit, prompt.attachment, turn.step, session.compact, command.run, config.set
  on('prompt.submit', async ($, e, next) => { if (!e.agentId && e.origin?.kind === 'composer') await resume(host($)).catch(() => {}); if (!(await wake(host($)))) return next(e); const h = host($); if (!e.agentId && e.origin?.kind === 'composer') await ack(h).catch(() => {}); return submit(h, e, e2 => context(h, e2, next)) }).catch(passOn)
  on('prompt.attachment', async ($, e, next) => { if (!(await wake(host($)))) return next(e); return attachment(host($), e, next) })
  on('turn.step', async function* ($, e, next) { const h = host($); if (!(await wake(h))) return yield* next(e); return yield* meter(h, e, e2 => exitStep(h, e2, next)) })   // the cost meter sees cadre's own zero-token answers too
  on('session.compact', async ($, e, next) => { if (!(await wake(host($)))) return next(e); return compact(host($), e, next) }).catch(passOn)
  on('command.run', { command: 'cadre' }, async ($, e, next) => { await roles($, true).catch(() => {}); const old = (await read($, secret)).old; if (old) return { text: oldLine(old) }; const h = spawner($, next); await ack(h).catch(() => {}); const r = await run(h, e, next); if (await wake(h).catch(() => false)) await spawnStep(h, next.event).catch(x => $.ui.log(`spawner: ${x}`)); return r }).catch(denyCmd)   // a typed /cadre (continue) is a frame to start agents from (core/spawner)
  on('command.run', { command: 'goal' }, ($, e, next) => goal(host($), e, next)).catch(passOn)   // observer only: pass-through, never rewritten (9)
  on('config.set', async ($, e, next) => { if (!(await wake(host($)))) return next(e); return configSet(host($), e, next) }).catch(denySpawn)
  // ui (UI-DESIGN): every ui.render hook names its component (U7); render is pure, state is written from handlers only
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => { const old = (await read($, secret)).old; if (!old) return renderBand(host($), e, next); const E = $.ui.resolve(e); return E.Box({ flexDirection: 'column', children: [E.Text({ bold: true, children: oldLine(old) }), await next(e)] }) })   // too old: the line, in elements every build draws   // not gated: a pending init/setup code draws here even while the repo is dormant; with nothing pending the band draws nothing
  on('ui.render', { component: 'Pane', requestId: 'cadre' }, async ($, e) => { const old = (await read($, secret)).old; if (!old) return renderPane(host($), e); return $.ui.resolve(e).Text({ bold: true, children: oldLine(old) }) })
  on('ui.render', { component: 'ToolUse', props: { tool: 'Agent' } }, async ($, e, next) => { if (!(await wake(host($)))) return next(e); return renderCard(host($), e, next) })
}
