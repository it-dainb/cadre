// The only file that calls on() or touches $. Registration ORDER is the chain order (DESIGN 2.2, outermost first).
// Each slot calls a function in its owner module with a per-hook Host (never a module-level Host, L3). Gating registrations carry a fail-closed .catch (13.3).
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import type { Host } from '../types'
import { roster } from '../agents/index'
import { emptySnapshot } from '../core/board'
import { emptyRing } from '../core/events'
import { drain, step, compact } from '../core/reuse'
import { observe } from '../core/close'
import { admit } from '../core/admission'
import { contain } from '../policy/containment'
import { check, guard, send, judge, configSet } from '../policy/guards'
import { answer, describe } from '../native/tasks'
import { wrap } from '../core/effect'
import { handle } from '../tools/index'
import { context, attachment } from '../core/briefs'
import { run } from '../commands/cadre'
import { defaults } from '../config/index'
import { tick } from '../task-management/sync-engine/loop'
import { load } from '../config/index'
import { newToken } from '../core/dispatch'
import { wire, repoKeyOf } from '../commands/init'
import { BdStore } from '../task-management/adapters/beads/store'
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
  return new BdStore({ run: h.run, cwd: root, actor, bin: cfg.store.bin, timeoutMs: cfg.store.timeoutMs })
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
      CADRE_ALLOW_SDK_APPROVAL: await $.env.get('CADRE_ALLOW_SDK_APPROVAL'), CADRE_DISABLE: await $.env.get('CADRE_DISABLE'),
    }),
    readText: async path => { try { return String(await $.fs.read(path)) } catch { return null } },
    log: t => { void $.ui.log(t) },
    toast: t => { void $.ui.toast(t) },
    options,
    stat: async (p, o) => { try { return await $.fs.stat(p, { resolve: !!o?.resolve }) } catch { return undefined } },
    run: (argv, init) => $.process.run(argv, init),
    settings: () => $.settings.read(),
    write: async (p, t) => { await $.fs.write(p, t) },
    cwd: () => $.session.cwd(), home: async () => String((await $.env.get('HOME')) ?? ''),
  }
  h.config = async () => { const root = await h.cwd(); return (await load(h, { home: await h.home(), root, repoKey: repoKeyOf(root) })).config }
  h.taskStore = async () => wire.store(h, await h.config!(), await h.cwd())
  return h
}

// Fail-closed handlers (G1, G2). On re-entry every $ rejects, so decide from the event alone.
const FAIL = 'cadre: guard failed; refused'
function denyCall($, e, next) { return next.error?.kind === 're-entry' ? (judge(e) ? { deny: judge(e) } : next(e)) : next.called ? next(e) : { deny: FAIL } }
function denySpawn($, e, next) { return next.error?.kind === 're-entry' ? next(e) : next.called ? next(e) : { deny: FAIL } }
function denyCheck($, e, next) { return next.error?.kind === 're-entry' || !next.called ? { decision: 'deny', reason: FAIL } : next(e) }
// prompt.submit / session.compact only add context or a summary: on failure fall back to the engine's own (deliberate fail-open). /cadre never acts on failure.
function passOn($, e, next) { return next(e) }
function denyCmd($, e, next) { return next.called ? next(e) : { text: FAIL } }
function denySend($, e, next) { return next.error?.kind === 're-entry' ? next(e) : next.called ? next(e) : { isDelivered: false, reason: FAIL } }

export const register: Register = (on, opts) => {
  options = { strictness: opts?.strictness as string | undefined }

  // session.start: agents, command, tools env, the one tick. Awaited before turn one (L7).
  on('session.start', async ($, e, next) => {
    const cfg = defaults()
    for (const a of roster({ roles: cfg.roles, models: cfg.models, mcpAllow: cfg.mcpAllow })) await $.agent.register(a)
    await $.command.register({ name: 'cadre', description: 'cadre: plan, approve, status, resolve, release, drive, init', argumentHint: '<sub> [args]', immediate: true })
    await $.env.set('CLAUDE_CODE_ENABLE_TODO_TOOLS', '1')
    await newToken(host($))   // session token for adapter commands: toast only (DESIGN 2.5)
    await contain(host($)).catch(() => {})   // L2 check -> board.containment (13.1)
    $.clock.every(5000, () => { void tick(host($)).catch(() => {}) })   // timer calls skip all our hooks (G6): queue/heal only
    return next(e)
  })

  // 1. resume-drain: the only sender, after await next(e), never from a timer. 2. observe.
  on('turn.complete', { reason: /./ }, ($, e, next) => drain(host($), e, next))
  on('turn.complete', { reason: /^/ }, ($, e, next) => observe(host($), e, next))
  // 3. admission
  on('agent.spawn', ($, e, next) => admit(host($), e, next)).catch(denySpawn)
  // 4. tool.check allow
  on('tool.check', ($, e, next) => check(host($), e, next)).catch(denyCheck)
  // 5. guards (L1, fence, Task* answers, MCP pre-checks): guards judge first, then main's Task* answers
  on('tool.call', { tool: /./ }, ($, e, next) => guard(host($), e, e2 => answer(host($), e2, next))).catch(denyCall)
  // 6. wrap (L3 per-call fingerprint, delta drain, result card, tester log); then our own MCP tools answer innermost
  on('tool.call', { tool: /^/ }, ($, e, next) => wrap(host($), e, next)).catch(denyCall)
  on('tool.call', { tool: /^mcp__cadre__/ }, ($, e, next) => handle(host($), e, next)).catch(denyCall)
  on('tool.describe', ($, e, next) => describe(host($), e, next))
  // 7. session.send
  on('session.send', ($, e, next) => send(host($), e, next)).catch(denySend)
  // 8. prompt.submit, prompt.attachment, turn.step, session.compact, command.run, config.set
  on('prompt.submit', ($, e, next) => context(host($), e, next)).catch(passOn)
  on('prompt.attachment', ($, e, next) => attachment(host($), e, next))
  on('turn.step', async function* ($, e, next) { return yield* step(host($), e, next) })
  on('session.compact', ($, e, next) => compact(host($), e, next)).catch(passOn)
  on('command.run', { command: 'cadre' }, ($, e, next) => run(host($), e, next)).catch(denyCmd)
  on('config.set', ($, e, next) => configSet(host($), e, next)).catch(denySpawn)
}
