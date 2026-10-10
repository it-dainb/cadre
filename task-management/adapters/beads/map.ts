// bd JSON <-> Task (DESIGN 11.2). Category <-> native status; done/cancelled are `closed` + a reason prefix.
import type { Category, DepType, Task } from '../../store'

export const NATIVE: Record<Category, string> = { draft: 'draft', todo: 'open', active: 'in_progress', review: 'in_review', blocked: 'blocked', done: 'closed', cancelled: 'closed' }
// `failed` must appear in a cancelled reason: bd's conditional-blocks only fires on failure keywords (types.go FailureCloseKeywords)
export const closeReason = (outcome: 'done' | 'cancelled', note?: string) => (outcome === 'done' ? `done${note ? `: ${note}` : ''}` : `cancelled: ${note?.toLowerCase().includes('fail') ? note : `failed${note ? `: ${note}` : ''}`}`)
export const categoryOf = (status: string, reason?: string): Category =>
  status === 'closed' ? (reason?.startsWith('cancelled') ? 'cancelled' : 'done')
    : status === 'in_progress' ? 'active' : status === 'in_review' ? 'review' : status === 'blocked' ? 'blocked' : status === 'draft' ? 'draft' : 'todo'

const DEPS = new Set(['blocks', 'waits-for', 'conditional-blocks', 'discovered-from', 'related'])
// `show` lists {id, dependency_type}; `list` lists {depends_on_id, type}. parent-child is the parent field, not a dep.
export const depsOf = (xs: any[] = []): Task['deps'] =>
  xs.map(d => ({ id: (d.id ?? d.depends_on_id) as string, type: (d.dependency_type ?? d.type) as DepType })).filter(d => DEPS.has(d.type))

export function toTask(j: any): Task {
  const meta: Record<string, string> = {}
  for (const [k, v] of Object.entries(j.metadata ?? {})) meta[k] = typeof v === 'string' ? v : JSON.stringify(v)
  const t: Task = {
    id: j.id, title: j.title, description: (j.description ?? '').replace(/\n$/, ''), type: j.issue_type ?? 'task', category: categoryOf(j.status, j.close_reason), nativeStatus: j.status,
    priority: (j.priority ?? 2) as Task['priority'], deps: depsOf(j.dependencies), labels: j.labels ?? [], meta, updatedAt: j.updated_at ?? '',
  }
  if (j.acceptance_criteria) t.acceptance = j.acceptance_criteria
  if (j.design) t.design = j.design
  if (j.assignee) t.assignee = j.assignee
  if (j.lease_expires_at) t.leaseUntil = j.lease_expires_at
  if (j.parent) t.parent = j.parent
  if (j.external_ref) t.externalRef = j.external_ref
  if (j.revision !== undefined) t.revision = String(j.revision)
  return t
}
