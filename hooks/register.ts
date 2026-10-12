// The only file that calls on() or touches $. Registration ORDER is the chain order (DESIGN 2.2, outermost first).
// Each slot calls a function in its owner module with a per-hook Host (never a module-level Host, L3). Gating registrations carry a fail-closed .catch (13.3).
import { modelText } from '../core/say'
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { Host } from '../types'
import { UI, emptySnapshot } from '../core/board'
import { emptyRing, subscribe } from '../core/events'
import { drain, step, compact, submit } from '../core/reuse'
import { goal } from '../core/drive'
import { quit, wake, warm } from '../core/session'
import '../config/route'   // registers ROUTES.config
import { observe } from '../core/close'
import '../core/integrate'   // registers ROUTES.release
import { admit, tick as heartbeat } from '../core/admission'
import { contain, heal } from '../policy/containment'
import { check, guard, send, judge, judgeSpawn, configSet, settingsOnly } from '../policy/guards'
import { answer, describe } from '../native/tasks'
import { wrap } from '../core/effect'
import { handle, SPECS } from '../tools/index'
import { context, attachment } from '../core/briefs'
import { decide, run } from '../commands/cadre'
import { nudge } from '../commands/doctor'
import { pump, turnEnd, seen, stopCheck, redNote, watch, halt } from '../commands/agentrun'
import { tick } from '../task-management/sync-engine/loop'
import { autoAsk, onEvent, renderBand, renderCard, renderPane, tickUi, ack, mapCard, resumeBanner } from '../ui/index'
import { load } from '../config/index'
import { wire, repoKeyOf, rootFor } from '../commands/init'
import { prefsCall } from '../commands/prefs'
import { BdStore } from '../task-management/adapters/beads/store'
import { dirOf } from '../task-management/adapters/beads/layout'
import { MemoryStore } from '../task-management/adapters/memory/store'

const board = atom({ plugin: 'cadre', key: 'board' } as const, emptySnapshot())
const events = atom({ plugin: 'cadre', key: 'events' } as const, emptyRing())
const secret = atom({ plugin: 'cadre', key: 'secret' } as const, {})
const ui = atom({ plugin: 'cadre', key: 'ui' } as const, {})
const git = atom({ plugin: 'cadre', key: 'git' } as const, { busy: false, epoch: 0 })
const bind = atom({ plugin: 'cadre', key: 'bind' } as const, {})

// The one TaskStore factory (init stage 2 and dispatch both use `wire.store`): memory for CADRE_STORE=memory (tests), else bd. Config is the full layered load.
let mem: MemoryStore | undefined
wire.store = async (h, cfg, root) => {
  if (cfg.store.kind === 'memory') { if (!mem) { mem = new MemoryStore(); await mem.init({ types: cfg.types as any, journal: false }) } return mem }
  const actor = String((await h.store.get(`cadre:${repoKeyOf(root)}:actor`)) ?? '') || `cadre/${h.rand(3)}`
  await h.store.set(`cadre:${repoKeyOf(root)}:actor`, actor)
  return new BdStore({ run: h.run, cwd: root, actor, bin: cfg.store.bin, timeoutMs: cfg.store.timeoutMs, dir: await dirOf(h, root) })
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
      CADRE_DISABLE: await $.env.get('CADRE_DISABLE'),
      GIT_AUTHOR_NAME: await $.env.get('GIT_AUTHOR_NAME'), GIT_AUTHOR_EMAIL: await $.env.get('GIT_AUTHOR_EMAIL'),   // identity prefill (core/git.identity)
    }),
    readText: async path => { try { return String(await $.fs.read(path)) } catch { return null } },
    log: t => { void $.ui.log(t) },
    toast: t => { void $.ui.toast(t) },
    options,
    stat: async (p, o) => { try { return await $.fs.stat(p, { resolve: !!o?.resolve }) } catch { return undefined } },
    run: (argv, init) => $.process.run(argv, init),
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
  h.shell = async () => String(await $.session.cwd())
  return h
}

// Fail-closed handlers (G1, G2). On re-entry every $ rejects, so decide from the event alone.
const FAIL = 'refused: temporary failure; retry once, then ask the human'
const why = ($, next) => { if (next.error && next.error.kind !== 're-entry') void $.ui.log(`hook failed: ${next.error.kind}: ${next.error.message}`); return FAIL }   // the engine redacts the error in its own log: keep the reason in ours
function denyCall($, e, next) { return next.error?.kind === 're-entry' ? (judge(e) ? { deny: modelText('deny', judge(e)!) } : next(e)) : next.called ? next(e) : { deny: modelText('deny', why($, next)) } }
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

export const register: Register = (on, opts) => {
  options = { strictness: opts?.strictness as string | undefined }
  subscribe(onEvent)   // ui/notify: toasts, notify, status line from the event stream
  UI.mapCard = mapCard; UI.banner = resumeBanner   // core -> ui hooks (core never imports ui/)

  // session.start: agents, command, tools env, the one tick. Awaited before turn one (L7).
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cadre', description: 'cadre: plan, approve, status, resolve, release, drive, init, setup, doctor', argumentHint: '<sub> [args]', immediate: true })
    const root = await top($); await update($, secret, x => ({ ...x, root })); await $.store.set('cadre:roots', { ...(((await $.store.get('cadre:roots')) ?? {}) as object), [repoKeyOf(root)]: root })   // the repo root for every hook. Never $.session.cwd(): it follows a Bash `cd` (main in a package folder read its checks and store there after a /clear, live 0.9.1) and in a subagent hook it is the agent's view/worktree
    await seed($).catch(x => $.ui.log(`dev scenario not seeded: ${x}`))   // dev only: CADRE_DEV=1 + CADRE_DEV_SCENARIO (harness/tui.sh --scenario)
    await $.env.set('CLAUDE_CODE_ENABLE_TODO_TOOLS', '1')
    await $.env.set('ENABLE_TOOL_SEARCH', 'false')   // S13: isDeferred:false alone does not stop deferral
    await wake(host($)).catch(e => $.ui.log(`session start: ${e}`)); await halt(host($)).catch(() => {})   // a setup cut short in an earlier session: the band says so   // active repos only: $.store 'policy' + cadre.ui.cfg + containment band (agents ship as agents/*.md files, A28)
    for (const t of SPECS) await $.tool.register(t)   // report, inspect, run_check: isDeferred:false (5.2)
    { const h = host($); if (await wake(h).catch(() => false)) await nudge(h).catch(() => {}) }   // active repos only: no setup stamp for this Claude Code build -> one toast
    $.clock.every(5000, () => { const h = host($); void pump(h).catch(() => {}); void watch(h).catch(() => {}); void autoAsk(h).catch(() => {}); void wake(h).then(act => { if (act) { void tick(h).catch(() => {}); void heartbeat(h).catch(() => {}); void heal(h).catch(() => {}) } }).catch(() => {}) })   // timer calls skip all our hooks (G6): queue/heal only
    $.clock.every(30_000, () => { const h = host($); void wake(h).then(act => act && tickUi(h)).catch(() => {}) })   // live timeline cursor (blit, no re-render)
    return next(e)
  })

  on('session.end', async ($, e, next) => { if (e.reason !== 'clear' && e.reason !== 'resume') await quit(host($)).catch(() => {}); return next(e) })   // a quit: another session may continue this one's plan at once (core/session.held)

  // 1. resume-drain: the only sender, after await next(e), never from a timer. 2. observe.
  on('turn.complete', { reason: /./ }, async ($, e, next) => { if (!(await wake(host($)))) return next(e); return drain(host($), e, next) })
  on('turn.complete', { reason: /^/ }, async ($, e, next) => { if (!(await wake(host($)))) return next(e); return observe(host($), e, next) })
  on('turn.complete', { reason: /./ }, async ($, e, next) => { const r = await next(e); await turnEnd(host($), e).catch(() => {}); return r })   // agent-run setup/init (ADR 0010): re-check when main stops; works in dormant repos too
  // 3. admission
  on('agent.spawn', async ($, e, next) => { if (!(await wake(host($)))) return next(e); return admit(host($), e, next) }).catch(denySpawn)
  // 4. tool.check allow
  on('tool.check', async ($, e, next) => { if (!(await wake(host($)))) return next(e); await warm(host($)); return check(host($), e, next) }).catch(denyCheck)
  // 5. guards (L1, fence, Task* answers, MCP pre-checks): guards judge first, then main's Task* answers
  on('tool.call', { tool: /./ }, async ($, e, next) => { const h = host($); const pr = await prefsCall(h, e); if (pr) return pr; if (!(await wake(h))) return (await h.secret.read()).run ? settingsOnly(h, e, next) : next(e); await warm(h); return guard(h, e, e2 => answer(host($), e2, next)) }).catch(denyCall)
  // 6. wrap (L3 per-call fingerprint, delta drain, result card, tester log); then our own MCP tools answer innermost
  on('tool.call', { tool: /^/ }, async ($, e, next) => { if (!(await wake(host($)))) return next(e); return wrap(host($), e, next) }).catch(denyCall)
  on('tool.call', { tool: /^mcp__cadre__/ }, ($, e, next) => handle(host($), e, next)).catch(denyCall)
  // agent-run setup/init: main's tool results carry what is still red; its stop is refused while a check it owns is red; turn.start feeds the watchdog (commands/agentrun)
  on('tool.call', { tool: /./ }, async ($, e, next) => { const h = host($); if (!e.agentId) await seen(h, { name: e.tool }).catch(() => {}); const r = await next(e); if (e.agentId) return r; await seen(h, { tool: true }).catch(() => {}); const t = r?.result !== undefined ? await redNote(h).catch(() => null) : null; return t ? { ...r, context: [...(r.context ?? []), modelText('context', t)] } : r }).catch(passOn)   // a note only: on failure the result goes through as it is
  on('classic.Stop', async ($, e, next) => { const r = await next(e); const t = await stopCheck(host($), e).catch(() => null); return t ? { ...r, block: modelText('nudge', t) } : r }).catch(passOn)
  on('turn.start', async ($, e, next) => { const r = await next(e); await seen(host($), { start: true }).catch(() => {}); return r })
  on('tool.describe', async ($, e, next) => { if (!(await wake(host($)))) return next(e); return describe(host($), e, next) })
  // 7. session.send
  on('session.send', async ($, e, next) => { if (!(await wake(host($)))) return next(e); return send(host($), e, next) }).catch(denySend)
  // 8. prompt.submit, prompt.attachment, turn.step, session.compact, command.run, config.set
  on('prompt.submit', async ($, e, next) => { if (!(await wake(host($)))) return next(e); const h = host($); if (!e.agentId && e.origin?.kind === 'composer') await ack(h).catch(() => {}); return submit(h, e, e2 => context(h, e2, next)) }).catch(passOn)
  on('prompt.attachment', async ($, e, next) => { if (!(await wake(host($)))) return next(e); return attachment(host($), e, next) })
  on('turn.step', async function* ($, e, next) { const h = host($); if (!(await wake(h))) return yield* next(e); return yield* step(h, e, next) })
  on('session.compact', async ($, e, next) => { if (!(await wake(host($)))) return next(e); return compact(host($), e, next) }).catch(passOn)
  on('command.run', { command: 'cadre' }, async ($, e, next) => { const h = host($); await ack(h).catch(() => {}); return run(h, e, next) }).catch(denyCmd)
  on('command.run', { command: 'goal' }, ($, e, next) => goal(host($), e, next)).catch(passOn)   // observer only: pass-through, never rewritten (9)
  on('config.set', async ($, e, next) => { if (!(await wake(host($)))) return next(e); return configSet(host($), e, next) }).catch(denySpawn)
  // ui (UI-DESIGN): every ui.render hook names its component (U7); render is pure, state is written from handlers only
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => renderBand(host($), e, next))   // not gated: a pending init/setup code draws here even while the repo is dormant; with nothing pending the band draws nothing
  on('ui.render', { component: 'Pane', requestId: 'cadre' }, ($, e) => renderPane(host($), e))
  on('ui.render', { component: 'ToolUse', props: { tool: 'Agent' } }, async ($, e, next) => { if (!(await wake(host($)))) return next(e); return renderCard(host($), e, next) })
}
