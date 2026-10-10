// TaskStore (DESIGN 11.1), verbatim. Core imports only this, registry.ts and protocol.ts; nothing else knows bd.
import type { TypeRegistry } from './registry'

export type Category = 'draft' | 'todo' | 'active' | 'review' | 'blocked' | 'done' | 'cancelled'
export type TaskId = string
export type DepType = 'blocks' | 'waits-for' | 'conditional-blocks' | 'parent-child' | 'discovered-from' | 'related'
export interface Task {
  id: TaskId; title: string; description: string; acceptance?: string; type: string
  category: Category; nativeStatus: string; priority: 0 | 1 | 2 | 3 | 4; assignee?: string; leaseUntil?: string
  parent?: TaskId; deps: { id: TaskId; type: DepType }[]; labels: string[]; externalRef?: string
  design?: string                         // interface contract (canonical JSON)
  meta: Record<string, string>            // "cadre.*": step, package, base, specCommit, sourceCommit, rec.*, cost, changelog, flag, sync.<target>
  revision?: string; updatedAt: string
}
export interface NewTask {
  title: string; description: string; acceptance?: string; design?: string; type: string; priority?: number; parent: TaskId
  deps?: { id: TaskId; type: DepType }[]; discoveredFrom?: TaskId; meta?: Record<string, string>
  gate?: { await: 'human' | 'timer' | 'gh:run' | 'gh:pr'; arg?: string }
}
export type ErrorCode = 'NotFound' | 'AlreadyClaimed' | 'NotClaimable' | 'GuardMismatch' | 'NotClosable' | 'Cycle' | 'Busy' | 'Timeout' | 'Unavailable' | 'NotInitialized' | 'Invalid' | 'TooOld'
export class StoreError extends Error {
  constructor(public code: ErrorCode, message = code) { super(message) }
}
export interface TaskStore {
  probe(): Promise<{ ok: boolean; journal: boolean; version: string; detail: string }>
  init(o: { types: TypeRegistry; journal: boolean }): Promise<void>                      // idempotent, consented
  createEpic(title: string, goal: string): Promise<TaskId>
  createDraft(t: NewTask): Promise<Task>; dropDrafts(ids: TaskId[]): Promise<void>; link(id: TaskId, dep: { id: TaskId; type: DepType }): Promise<void>
  approve(ids: TaskId[]): Promise<void>; amend(id: TaskId): Promise<void>
  get(id: TaskId): Promise<Task>; list(f: { parent?: TaskId; updatedAfter?: string }): Promise<Task[]>; ready(parent: TaskId): Promise<TaskId[]>
  claim(id: TaskId, actor: string): Promise<Task>; resume(id: TaskId, actor: string): Promise<Task>
  release(id: TaskId, actor: string, why: string): Promise<void>; move(id: TaskId, to: 'review' | 'blocked', actor: string): Promise<Task>
  heartbeat(id: TaskId): Promise<void>
  update(id: TaskId, patch: Partial<Pick<Task, 'title' | 'description' | 'acceptance' | 'design' | 'priority' | 'labels'>>, actor: string): Promise<Task>
  comment(id: TaskId, text: string, actor: string): Promise<void>
  setMeta(id: TaskId, kv: Record<string, string>, actor: string, ifRevision?: string): Promise<Task>   // ifRevision -> GuardMismatch: the lease CAS
  setExternalRef(id: TaskId, ref: string, actor: string): Promise<void>; resolveGate(gateId: TaskId, reason: string): Promise<void>
  record(kind: 'mission' | 'decision', title: string, body: string, link?: TaskId): Promise<TaskId>
  close(id: TaskId, o: { outcome: 'done' | 'cancelled'; note?: string; session?: string; ifRevision?: string }): Promise<Task>
  events(since?: string, limit?: number): Promise<{ head: string; events: { seq: string; op: string; id: TaskId; actor: string; status?: string; assignee?: string }[] } | null>
}
