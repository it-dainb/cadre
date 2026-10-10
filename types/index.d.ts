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
  flags: string[]; card?: string
}
export interface Plan {
  id: string; slug: string; state: PlanState; epicBranch: string; approvedAt?: number
  landed?: { dev: string; sha: string; at: number }; released?: { version: string; at: number }
}
// The board snapshot = the read model. Carries NO code8/init code (those live in Secret).
export interface Snapshot {
  schemaVersion: 1; seq: number; repo: string; mission: string | null; epic: string | null
  plan: Plan | null; tasks: SnapTask[]
  approval: { planId: string | null; missing: string[] }
  drive: { on: boolean; level: 'epic'; epicId: string | null; turns: number; costUsd: number; startedAt: number | null; paused?: string; heldBy?: string }
  sync: { target: string; state: 'ok' | 'offline' | 'conflict' | 'auth'; pending: number; at: number }[]
  cost: { tokens: number; usd?: number; cachePct?: number }
  containment: { state: 'contained' | 'degraded' | 'unknown'; unsandboxed: number }
  resumesQueued: number
  init: { stage: number; state: 'pending' | 'proposed' | 'done' }[]
}

export type EventType =
  | 'task.transitioned' | 'task.phase_changed' | 'task.skipped' | 'agent.bound' | 'agent.unbound'
  | 'check.ran' | 'flag.raised' | 'flag.resolved' | 'approval.pending' | 'sync.state_changed'
  | 'drive.status' | 'cost.updated' | 'init.stage'
export interface CadreEvent {
  schemaVersion: 1; seq: number; at: number; type: EventType; taskId?: string; agentId?: string
  actor: Actor; severity: Severity; needsHuman: boolean; data: Record<string, unknown>
}
export interface EventRing { seq: number; epics: Record<string, CadreEvent[]> }  // 500 per epic; '' = no epic

export interface Secret {
  approval?: { planId: string; code8: string }; initConfirm?: { stage: number; code: string }
  nonce?: string; initNonce?: string; token?: string
  session?: string                                      // this session's id (core/admission.sessionOf; resume queue key)
  ctx?: { key: string; card?: string }                  // main context: last-sent diff key; a queued one-time resume card (core/briefs)
}
export interface Binding {
  taskId: string; role: Role; step: string; worktree: string; sessionId: string
  lastReviewedCommit?: string; ctxTokens: number; startedAt: number
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
  env(): Promise<Record<string, string | undefined>>  // CADRE_STRICTNESS, CADRE_STORE, CADRE_ALLOW_SDK_APPROVAL, CADRE_DISABLE
  readText(path: string): Promise<string | null>      // null if missing
  log(text: string): void; toast(text: string): void  // local display only
  options: { strictness?: string }                    // plugin.json userConfig
  stat(path: string, o?: { resolve?: boolean }): Promise<{ kind: string; realPath?: string } | undefined>   // $.fs.stat; undefined when missing
  run(argv: readonly string[], init?: { cwd?: string; env?: Record<string, string>; stdin?: string; timeoutMs?: number }): Promise<{ exitCode: number; stdout: string; stderr: string }>   // $.process.run, no shell
  settings(): Promise<Record<string, any>>             // $.settings.read(): effective merged settings
  write(path: string, text: string): Promise<void>     // $.fs.write (creates dirs); mod-owned files only, after human confirmation (CC-16)
  cwd(): Promise<string>; home(): Promise<string>      // session cwd (repo root) · $HOME
  taskStore?(): Promise<any>; config?(): Promise<any>   // the TaskStore (a core/dispatch storeOf) and resolved Config; register.ts wires them (config falls back to env layer + defaults)
}
// Every hook slot has this shape; a slot returns next(e) to pass through.
export type Hook = (h: Host, e: any, next: (e: any) => any) => any
