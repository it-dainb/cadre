// cadre contracts (schemaVersion 1): read model, events, state atoms, Host. Self-contained: the validator refuses imports here. Changes need an ADR note (6.7).

export type Category = 'draft' | 'todo' | 'active' | 'review' | 'blocked' | 'done' | 'cancelled'
export type Role = 'worker' | 'tester' | 'reviewer' | 'explorer'
export type Actor = 'human' | 'main' | Role | 'sync' | 'mod'
export type Severity = 'info' | 'warn' | 'crit'
export type Kind = 'code' | 'docs' | 'spike'
export type SnapDepType = 'blocks' | 'waits-for' | 'conditional-blocks'
export type PlanState = 'draft' | 'approved' | 'integrating' | 'done-on-dev' | 'released' | 'blocked'

export interface SnapTask {
  id: string; title: string; type: string; kind: Kind; merges: boolean
  state: Category; step: string; phaseSince: number; owner?: string
  deps: { id: string; type: SnapDepType }[]
  condition?: { on: string; state: 'pending' | 'met' | 'not-met' }
  flags: string[]; card?: string; ctx?: number   // ctx: the owner's context fill %
  lane?: string                                     // 'lite' | 'lite+tdd' (ADR 0011): the pipeline variant (registry.pipeOf)
  epic?: string                                     // milestone lane (ADR 0015): the epic this task belongs to
}
// one epic of a milestone's roadmap (ADR 0015, core/milestone.roadmap): derived from beads at every mirror
export interface MEpic { id: string; title: string; branch: string; state: 'draft' | 'waiting' | 'ready' | 'planning' | 'running' | 'landed' | 'stopped'; deps: string[]; size?: number; core?: boolean; why?: string }
export interface Plan {
  id: string; slug: string; state: PlanState; epicBranch: string; approvedAt?: number
  landed?: { dev: string; sha: string; at: number }; released?: { version: string; at: number }
  flags?: string[]   // plan-level flags (integration-failed)
  mode?: 'auto' | 'yolo'   // ADR 0013: how drive runs it after approval (core/lanes.relane)
  lane?: 'ask' | 'lite' | 'full' | 'milestone'; laneReason?: string; laneOverride?: string   // ADR 0011: the effective lane, main's (or the human's) reason, why the override moved it (core/lanes)
  epics?: MEpic[]   // milestone lane (ADR 0015): the roadmap; epicBranch is then the milestone branch
}
// A decision the human owes (ADR 0008, 0012): ONE record, answered ONLY in the native ask dialog (ui/index.answerDialog), bound to `hash`; the pane lists it read-only (ui/needs).
// `run` = a dispatcher command (`<sub> <args>`) run as origin dialog; an option without `run` closes the dialog and decides nothing ("Not now").
export interface DecisionOption { key: string; label: string; verb: string; run?: string }
export interface Decision {
  id: string; kind: string; title: string; short?: string; lines: string[]; hash: string; options: DecisionOption[]   // hash = content hash: a press bound to an older one is refused
  tab?: string; sel?: string; crit?: boolean                                                                             // pane tab with the full detail · task to select · [CRIT] tag
  fields?: DecisionField[]; error?: string   // asked one by one in the dialog before the options; an option's run gets them where it says {fields} (k=v argv). error: the last answer's refusal, shown in the re-ask
  change?: string; quiet?: true              // change: the prefix main gets with the dialog's free text (default `About "<title>": `) · quiet: never pops by itself (a progress card)
}
export interface DecisionField { key: string; label: string; value?: string }   // value = prefill
// The board snapshot = the read model.
export interface Snapshot {
  schemaVersion: 1; seq: number; repo: string; mission: string | null; epic: string | null
  plan: Plan | null; tasks: SnapTask[]
  approval: { planId: string | null; missing: string[] }
  drive: { on: boolean; level: 'epic'; epicId: string | null; turns: number; costUsd: number; startedAt: number | null; paused?: string; heldBy?: string
    mode?: 'auto' | 'yolo'; stopped?: string; maxTurns?: number; maxUsd?: number; maxMinutes?: number; costUnknown?: boolean }   // core/drive: paused = waiting on a gate (lifts by itself); stopped = needs `drive resume`
  sync: { target: string; state: 'ok' | 'offline' | 'conflict' | 'auth'; pending: number; at: number }[]
  cost: { tokens: number; usd?: number; cachePct?: number }
  containment: { state: 'contained' | 'degraded' | 'unknown'; unsandboxed: number }
  resumesQueued: number
  init: { stage: number; state: 'pending' | 'proposed' | 'done' }[]
  decisions?: Decision[]                              // pending human decisions, oldest first (core/decide); human view only, never in the model view
}

export type EventType =
  | 'task.transitioned' | 'task.phase_changed' | 'task.skipped' | 'agent.bound' | 'agent.unbound'
  | 'check.ran' | 'flag.raised' | 'flag.resolved' | 'approval.pending' | 'sync.state_changed'
  | 'drive.status' | 'drive.decided' | 'cost.updated' | 'init.stage' | 'plan.landed' | 'plan.released' | 'release.proposed'
export interface CadreEvent {
  schemaVersion: 1; seq: number; at: number; type: EventType; taskId?: string; agentId?: string
  actor: Actor; severity: Severity; needsHuman: boolean; data: Record<string, unknown>
}
export interface EventRing { seq: number; epics: Record<string, CadreEvent[]> }  // 500 per epic; '' = no epic

export interface Secret {
  adoptTried?: boolean; active?: boolean; root?: string   // root: the main session's cwd, set at session.start
  session?: string                                      // this session's id (core/admission.sessionOf; resume queue key)
  run?: { kind: 'setup' | 'init'; at: number; turns: number; follow: number; guide: string; brief?: string; snap?: Record<string, string | null>; goal?: { text: string; mode: 'auto' | 'yolo' }; gi?: { had: boolean; text: string }; tools?: number; seen?: number; busy?: boolean; stopSeen?: boolean; said?: string }   // tools: main's tool calls since the last stop refusal · seen: main's last activity · busy: a main turn is on · stopSeen: the stop check runs here · said: Claude's last words (commands/agentrun) · an agent-run setup/init (ADR 0010): started at, main turns since, follow-ups sent, the guide main follows (its folder is readable under the lease), a brief waiting to be sent (commands/agentrun.pump)
  hold?: { kind: 'setup' | 'init'; files: Record<string, string | null> }   // settings changed outside cadre during a run: the bytes from before, for [r] Restore (commands/agentrun)
  ctx?: { key: string; card?: string }                  // main context: last-sent diff key; a queued one-time resume card (core/briefs)
}
export interface Binding {
  taskId: string; role: Role; step: string; worktree: string; sessionId: string
  lastReviewedCommit?: string; ctxTokens: number; startedAt: number
  lastAt?: number; retired?: boolean                   // last turn.step (idle clock, core/reuse); retired = needs a fresh spawn (admission rebinds it)
}
export interface GitState {
  busy: boolean; epoch: number
  fp?: Record<string, string>                          // L3 baseline fingerprint (core/effect)
  win?: { loops: string[]; open: Record<string, string> }   // in-flight window since the baseline: loop ids ('' = main), open calls by tool_use_id
  flags?: Record<string, { ref?: string; old?: string; tip?: string }>   // open git:* flags (restore info for agent-window ref moves)
}

declare module 'claude-code' {
  interface PluginState {
    cadre: {
      board: Snapshot
      events: EventRing
      secret: Secret
      ui: Record<string, unknown>
      git: GitState
      bind: Record<string, Binding>
    }
  }
}

// Host = what modules may do. Built per hook by host($) in hooks/register.ts (the only file touching $). Additions are append-only.
export interface Cell<T> { read(): Promise<T>; update(fn: (v: T) => T): Promise<T> }   // update = CAS with retry
export interface Host {
  now(): Promise<number>
  rand(bytes?: number): string                       // hex
  board: Cell<Snapshot>; events: Cell<EventRing>; secret: Cell<Secret>
  ui: Cell<Record<string, unknown>>; git: Cell<GitState>; bind: Cell<Record<string, Binding>>
  store: { get(k: string): Promise<unknown>; set(k: string, v: unknown): Promise<void>; del(k: string): Promise<void> }   // $.store: per-user keys only
  env(): Promise<Record<string, string | undefined>>  // CADRE_STRICTNESS, CADRE_STORE, CADRE_DISABLE, GIT_AUTHOR_NAME, GIT_AUTHOR_EMAIL
  readText(path: string): Promise<string | null>      // null if missing
  log(text: string): void; toast(text: string): void  // local display only
  options: { strictness?: string }                    // plugin.json userConfig
  stat(path: string, o?: { resolve?: boolean }): Promise<{ kind: string; realPath?: string } | undefined>   // $.fs.stat; undefined when missing
  run(argv: readonly string[], init?: { cwd?: string; env?: Record<string, string>; stdin?: string; timeoutMs?: number }): Promise<{ exitCode: number; stdout: string; stderr: string }>   // $.process.run, no shell
  settings(): Promise<Record<string, any>>             // $.settings.read(): effective merged settings
  write(path: string, text: string): Promise<void>     // $.fs.write (creates dirs); mod-owned files only, after human confirmation (CC-16)
  cwd(): Promise<string>; home(): Promise<string>      // session cwd (repo root) · $HOME
  ops?: UiOps                                          // ui/ side effects (render, toast, notify, prefill, timers); built by host($), absent in plain test hosts
  spawn?(a: { argv: readonly string[]; input: string; timeoutMs?: number }): Promise<{ exitCode: number | null; stdout: string; stderr: string }>   // $.process.spawn one-shot: stdin = input then closed, output collected (task-management/protocol)
  theme?(): Promise<'light' | 'dark' | 'unknown'>         // $.config.list() row `theme` (the Raster palette); unknown when absent
  version?(): Promise<string>                           // $.session.version().version: the running Claude Code build (commands/doctor)
  taskStore?(): Promise<any>; config?(): Promise<any>   // the TaskStore (a core/dispatch storeOf) and resolved Config; register.ts wires them (config falls back to env layer + defaults)
  sendTo?(agentId: string, text: string): Promise<{ isDelivered: boolean; reason?: string }>   // $.session.send({to:{agentId}}): core/reuse.drain only (the one sender)
  answer?(id: string, key: string, hash: string, vals?: Record<string, string>): Promise<{ text: string }>   // the dialog's answer to decision `id`, option `key`, asked with `hash` (+ field values): stale = refused; else the option's command runs as origin dialog (core/dispatch.answer, ADR 0012)
  ask?(question: string, options: string[]): Promise<string>   // $.ui.ask (AskUserQuestion dialog): the chosen label or the free text; rejects in -p / on dismiss. The only way a decision is answered (ADR 0012)
  submit?(text: string): Promise<unknown>; usage?(): Promise<{ context?: { percent?: number }; cost?: { usd: number } }>   // $.prompt.submit (drive, #1 only) · $.session.usage
  root?(): Promise<string>                              // $.plugin.root: the plugin's folder (guides/ for agent-run setup/init, ADR 0010)
}
// UI side effects (ui/ only). Built per hook by host($); optional so test hosts may omit it.
export interface UiOps {
  els(e: any): any                                   // $.ui.resolve(e): element constructors for a render event
  open(a: { id: string; title?: string; focus?: true; columns?: number; rows?: number }): Promise<{ isPlaced: boolean; reason?: string }>
  focused(): Promise<boolean>                        // the cadre pane holds the keyboard
  toast(t: string, o?: { timeoutMs?: number }): void
  notify(t: string, o?: { title?: string }): Promise<{ isSent: boolean }>
  status(t: string | undefined): void
  peek(): Promise<string>                            // composer draft ($.prompt.read)
  fill(text: string): Promise<{ isFilled: boolean }> // $.prompt.fill replace
  copy?(text: string): Promise<{ isCopied: boolean }> // $.ui.copy (the session's first surface)
  after(ms: number, fn: () => unknown): void         // $.clock.after
  invalidate(): void                                 // $.ui.invalidate('ui.render')
  blit(a: { requestId: string; key: string; cells: string }): Promise<unknown>
}
// Every hook slot has this shape; a slot returns next(e) to pass through.
export type Hook = (h: Host, e: any, next: (e: any) => any) => any
