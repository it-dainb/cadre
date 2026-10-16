// File TaskStore under .cadre/state. The journal is the truth: j/<seq> entries, each committed by `ln` (link(2) fails on a taken slot: the CAS; no lock).
// d/<id>.<seq> docs are a redo cache written only by compaction; j/snap.<n> = {n, ev} marks entries <= n folded into docs; head = max(entry, snap).
// Every op runs on a MemoryStore hydrated from docs + the journal tail above the snap (cached by head) and commits the after-images of the docs it
// changed as one entry. A failed, timed-out or killed run is "unknown": the head is scanned for the op id; absent -> Timeout, and the same call reuses the id.
import { MemoryStore } from '../memory/store'
import { StoreError } from '../../store'
import type { Task, TaskId, TaskStore } from '../../store'

export interface FileHost {
  run(argv: readonly string[], init?: { timeoutMs?: number }): Promise<{ exitCode: number; stdout: string; stderr: string }>
  write(path: string, text: string): Promise<void>; now(): Promise<number>; rand(bytes?: number): string
}
type Ev = NonNullable<Awaited<ReturnType<MemoryStore['events']>>>['events'][number]
type Entry = { s: number; op: string; ret?: unknown; e0: number; ev: Ev[]; docs: Record<string, unknown> }

// One `sh -c` per step, paths as positional args (no interpolation). s = sync FILE, or a full sync where `sync` takes no args (macOS).
export const SCRIPTS = {
  scan: `d=$1; [ -d "$d" ] || exit 0
if [ "$3" = 1 ]; then for f in "$d"/d/*; do [ -f "$f" ] && printf 'D %s %s\\n' "\${f##*/}" "$(cat "$f")"; done; fi
for f in "$d"/j/*; do [ -f "$f" ] || continue; n=\${f##*/}; case $n in snap.*) printf 'S %s\\n' "$(cat "$f")";; *[!0-9]*) ;; *) [ "$n" -gt "$2" ] && printf 'E %s %s\\n' "$n" "$(cat "$f")";; esac; done; exit 0`,
  commit: `mkdir -p "$3" && s "$1" || exit 2
if ln "$1" "$2" 2>/dev/null; then
  for f in "$3"/snap.*; do [ -f "$f" ] && [ "\${f##*.}" -ge "$4" ] && { [ "$1" -ef "$2" ] && rm -f "$2"; rm -f "$1"; exit 18; }; done
  rm -f "$1"; s "$3"; exit 0
fi
rm -f "$1"; [ -e "$2" ] && exit 17; exit 1`,
  compact: `d=$1; n=$2; t=$3; shift 3; mkdir -p "$d/d" || exit 1
while [ "$1" != -- ]; do s "$1" && mv -f "$1" "$2" || exit 1; shift 2; done; shift
s "$d/d"; s "$t" && mv -f "$t" "$d/j/snap.$n" && s "$d/j" || exit 1
for f in "$d"/j/*; do b=\${f##*/}; case $b in snap.*) [ "\${b#snap.}" -lt "$n" ] && rm -f "$f";; *[!0-9]*) ;; *) [ "$b" -le "$n" ] && rm -f "$f";; esac; done
for f in "$@"; do rm -f "$d/d/$f"; done; find "$d/tmp" -type f -mmin +30 -exec rm -f {} + 2>/dev/null; exit 0`,
  probe: `mkdir -p "$1/tmp" && t="$1/tmp/probe.$2" && : > "$t" && ln "$t" "$t.l" && s "$t.l"; r=$?; rm -f "$t" "$t.l"; exit $r`,
}
const sh = (k: keyof typeof SCRIPTS, ...a: string[]) => ['sh', '-c', `s() { sync "$@" 2>/dev/null || sync; }\n${SCRIPTS[k]}`, '--', ...a]
const TIMEOUT = 120_000, KEEP = 64, MAX_TAIL = 256   // compaction leaves the last KEEP entries (op-id lookups, event cursors) once the tail passes MAX_TAIL
const json = (s: string) => { try { return JSON.parse(s) } catch { return undefined } }

export class FileStore implements TaskStore {
  private mem: MemoryStore
  private t = 0                                         // the op's clock (Host.now is async, MemoryStore's is not)
  private seen = -1; private floor = 0; private fev = 0; private ev = 0   // cache head, snap n, events folded at the snap, event head
  private tail: Entry[] = []; private at = new Map<string, number>(); private stale: string[] = []   // entries above the snap · doc id -> seq · superseded doc files
  private pending = new Map<string, string>()          // call -> op id of a Timeout: the same call re-issues the same id
  private disk = new Map<string, number>()             // doc id -> seq of its newest file at the last full load
  private q: Promise<unknown> = Promise.resolve()      // one op or read at a time per instance: the tick fans out beside tool.call
  private serial<T>(f: () => Promise<T>): Promise<T> { const p = this.q.then(f, f); this.q = p.catch(() => {}); return p }
  constructor(private h: FileHost, private dir: string, private sid: string) { this.mem = new MemoryStore(() => this.t) }

  // bring the cache to the head: the tail above `seen`, or docs + tail when the cache is cold or the tail was folded
  private async sync(full = this.seen < 0, tries = 0): Promise<void> {
    const r = await this.h.run(sh('scan', this.dir, String(full ? 0 : this.seen), full ? '1' : '0'), { timeoutMs: TIMEOUT })
    if (r.exitCode) throw new StoreError('Unavailable', `store scan: ${r.stderr.slice(0, 200)}`)
    const docs: [string, number, unknown][] = [], es = new Map<number, any>(); let snap = { n: 0, ev: 0 }
    for (const l of r.stdout.split('\n')) {
      const [k, a, ...rest] = l.split(' ')
      if (k === 'S') { const v = json([a, ...rest].join(' ')); if (v?.n > snap.n) snap = v }
      else if (k === 'E') es.set(Number(a), json(rest.join(' ')))
      else if (k === 'D') { const i = a.lastIndexOf('.'); docs.push([a.slice(0, i), Number(a.slice(i + 1)), json(rest.join(' '))]) }
    }
    if (!full && snap.n > this.seen) return this.sync(true, tries)
    const base = Math.max(full ? 0 : this.seen, snap.n), top = Math.max(base, ...es.keys())
    for (let s = base + 1; s <= top; s++) if (!es.get(s)?.docs) { if (tries > 2) throw new StoreError('Unavailable', `journal entry ${s} unreadable`); return this.sync(true, tries + 1) }   // a gap = a compaction mid-scan
    if (full) {
      const m = this.mem = new MemoryStore(() => this.t), best = new Map<string, [number, unknown]>(); this.at = new Map(); this.stale = []
      for (const [id, s, v] of docs) { const b = best.get(id); if (b && b[0] >= s) this.stale.push(`${id}.${s}`); else { if (b) this.stale.push(`${id}.${b[0]}`); best.set(id, [s, v]) } }
      for (const [id, [s, v]] of best) { this.at.set(id, s); this.put(m, id, v) }
      this.disk = new Map(this.at)
      Object.assign(this, { tail: [], seen: snap.n, ev: snap.ev })
    }
    if (snap.n > this.floor) { this.tail = this.tail.filter(e => e.s > snap.n) }
    this.floor = Math.max(this.floor, snap.n); this.fev = Math.max(this.fev, snap.ev)
    for (let s = base + 1; s <= top; s++) this.apply({ ...es.get(s), s })
  }
  private put(m: MemoryStore, id: string, v: any) {
    if (id === '_init') { m.tasks ??= new Map(); m.journal = !!v?.journal } else if (id === '_control') m.ctl = v
    else if (v) (m.tasks ??= new Map()).set(id, v); else m.tasks?.delete(id)
  }
  private apply(e: Entry) {
    for (const id of Object.keys(e.docs).sort((a, b) => Number(b === '_init') - Number(a === '_init'))) if ((this.at.get(id) ?? 0) < e.s) { this.at.set(id, e.s); this.put(this.mem, id, e.docs[id]) }
    this.tail.push(e); this.seen = e.s; this.ev = e.e0 + e.ev.length
  }

  // a write: run `fn` on the hydrated cache, restore the cache, commit the changed docs as entry seen+1, then apply it like anyone else's
  private op<T>(call: string, fn: (m: MemoryStore) => Promise<T>): Promise<T> { return this.serial(() => this.exec(call, fn)) }
  private async exec<T>(call: string, fn: (m: MemoryStore) => Promise<T>): Promise<T> {
    const id = this.pending.get(call) ?? this.h.rand(8); this.pending.delete(call)
    for (let i = 0; i < 4; i++) {
      await this.sync()
      const hit = this.tail.find(e => e.op === id); if (hit) return hit.ret as T
      this.t = await this.h.now()
      const m = this.mem, before = structuredClone(m.tasks), ctl = m.ctl, jr = m.journal, s = this.seen + 1, docs: Record<string, unknown> = {}
      let k = 0, ret: T, log: Ev[] = []; m.mint = () => `c-${s}-${++k}`; m.log.length = 0
      try {
        ret = JSON.parse(JSON.stringify((await fn(m)) ?? null)) ?? undefined
        if (!before !== !m.tasks || jr !== m.journal) docs._init = { journal: m.journal }
        if (m.ctl !== ctl) docs._control = m.ctl
        for (const [tid, t] of m.tasks ?? []) if (before?.get(tid)?.revision !== t.revision) docs[tid] = t
        for (const tid of before?.keys() ?? []) if (!m.tasks?.has(tid)) docs[tid] = null
      } finally { log = m.log.splice(0); Object.assign(m, { tasks: before, ctl, journal: jr }) }
      if (!Object.keys(docs).length) return ret
      const e: Entry = { s, op: id, ret, e0: this.ev, ev: log.map((x, j) => ({ ...x, seq: String(this.ev + j + 1) })), docs }
      const tmp = `${this.dir}/tmp/${this.sid}.${id}.${this.h.rand(4)}`
      await this.h.write(tmp, JSON.stringify({ ...e, s: undefined }))
      const code = await this.h.run(sh('commit', tmp, `${this.dir}/j/${s}`, `${this.dir}/j`, String(s)), { timeoutMs: TIMEOUT }).then(r => r.exitCode, () => -1)
      if (code === 0) { this.apply(e); if (this.tail.length > MAX_TAIL) await this.fold(KEEP).catch(() => {}); return ret }
      if (code === 17 || code === 18) continue                                   // slot taken / slot already folded: re-read the head, redo
      await this.sync(); const late = this.tail.find(x => x.op === id); if (late) return late.ret as T
      this.pending.set(call, id); throw new StoreError('Timeout', 'the store write did not finish: retry the same call')
    }
    throw new StoreError('Busy', 'the store is busy: retry')
  }
  private read<T>(fn: (m: MemoryStore) => Promise<T>): Promise<T> { return this.serial(() => this.sync().then(() => fn(this.mem))) }

  // fold entries <= head-KEEP: write every doc changed above the old snap (named by its last seq), then the snap marker, then unlink folded entries
  compact(keep = KEEP): Promise<number> { return this.serial(() => this.fold(keep)) }
  private async fold(keep: number): Promise<number> {
    await this.sync(true)
    const n = this.seen - keep, at = this.tail.find(e => e.s === n); if (!at) return this.floor
    const pairs: string[] = [], m = this.mem
    for (const [id, s] of this.at) if (s > this.floor) {
      const v = id === '_init' ? { journal: m.journal } : id === '_control' ? m.ctl : m.tasks?.get(id) ?? null, tmp = `${this.dir}/tmp/${this.sid}.${id}.${s}.${this.h.rand(4)}`
      await this.h.write(tmp, JSON.stringify(v)); pairs.push(tmp, `${this.dir}/d/${id}.${s}`)
      const old = this.disk.get(id); if (old !== undefined && old < s) this.stale.push(`${id}.${old}`)
    }
    const st = `${this.dir}/tmp/${this.sid}.snap.${this.h.rand(4)}`; await this.h.write(st, JSON.stringify({ n, ev: at.e0 + at.ev.length }))
    const r = await this.h.run(sh('compact', this.dir, String(n), st, ...pairs, '--', ...this.stale), { timeoutMs: TIMEOUT })
    if (r.exitCode) throw new StoreError('Unavailable', `store compaction: ${r.stderr.slice(0, 200)}`)
    await this.sync(true); return n
  }

  probe() { return this.serial(() => this.probeNow()) }
  private async probeNow() {
    const r = await this.h.run(sh('probe', this.dir, this.h.rand(4)), { timeoutMs: TIMEOUT }).catch(e => ({ exitCode: 1, stderr: String(e) }))
    if (r.exitCode) return { ok: false, journal: false, version: 'file', detail: `hard links or sync fail in ${this.dir}: ${r.stderr.slice(0, 120)}` }
    await this.sync(); return { ok: true, journal: this.mem.journal, version: 'file', detail: this.mem.tasks ? 'initialized' : 'not initialized' }
  }
  events(since?: string, limit = 500) { return this.serial(() => this.eventsNow(since, limit)) }
  private async eventsNow(since?: string, limit = 500) {
    await this.sync(); if (!this.mem.journal) return null
    const n = Number(since ?? this.fev); if (n < this.fev) throw new StoreError('TooOld', `events up to ${this.fev} were folded`)
    return { head: String(this.ev), events: this.tail.flatMap(e => e.ev).filter(e => Number(e.seq) > n).slice(0, limit) }
  }
  init(o: Parameters<TaskStore['init']>[0]) { return this.op(`init:${o.journal}`, m => m.init(o)) }
  createEpic(title: string, goal: string) { return this.op(JSON.stringify(['epic', title, goal]), m => m.createEpic(title, goal)) }
  createDraft(t: Parameters<TaskStore['createDraft']>[0]) { return this.op(JSON.stringify(['draft', t]), m => m.createDraft(t)) }
  dropDrafts(ids: TaskId[]) { return this.op(JSON.stringify(['drop', ids]), m => m.dropDrafts(ids)) }
  link(id: TaskId, dep: Task['deps'][number]) { return this.op(JSON.stringify(['link', id, dep]), m => m.link(id, dep)) }
  approve(ids: TaskId[]) { return this.op(JSON.stringify(['approve', ids]), m => m.approve(ids)) }
  amend(id: TaskId) { return this.op(JSON.stringify(['amend', id]), m => m.amend(id)) }
  get(id: TaskId) { return this.read(m => m.get(id)) }
  list(f: { parent?: TaskId; updatedAfter?: string }) { return this.read(m => m.list(f)) }
  ready(parent: TaskId) { return this.read(m => m.ready(parent)) }
  control() { return this.read(m => m.control()) }
  claim(id: TaskId, actor: string) { return this.op(JSON.stringify(['claim', id, actor]), m => m.claim(id, actor)) }
  resume(id: TaskId, actor: string) { return this.op(JSON.stringify(['resume', id, actor]), m => m.resume(id, actor)) }
  release(id: TaskId, actor: string, why: string) { return this.op(JSON.stringify(['release', id, actor, why]), m => m.release(id, actor, why)) }
  move(id: TaskId, to: 'review' | 'blocked', actor: string) { return this.op(JSON.stringify(['move', id, to, actor]), m => m.move(id, to, actor)) }
  heartbeat(id: TaskId) { return this.op(JSON.stringify(['hb', id]), m => m.heartbeat(id)) }
  update(id: TaskId, patch: Parameters<TaskStore['update']>[1], actor: string) { return this.op(JSON.stringify(['update', id, patch, actor]), m => m.update(id, patch, actor)) }
  setMeta(id: TaskId, kv: Record<string, string>, actor: string, ifRevision?: string) { return this.op(JSON.stringify(['meta', id, kv, actor, ifRevision]), m => m.setMeta(id, kv, actor, ifRevision)) }
  setControl(patch: Record<string, unknown>, ifRevision?: string) { return this.op(JSON.stringify(['control', patch, ifRevision]), m => m.setControl(patch, ifRevision)) }
  setExternalRef(id: TaskId, ref: string, actor: string) { return this.op(JSON.stringify(['ref', id, ref, actor]), m => m.setExternalRef(id, ref, actor)) }
  resolveGate(gateId: TaskId, reason: string) { return this.op(JSON.stringify(['gate', gateId, reason]), m => m.resolveGate(gateId, reason)) }
  record(kind: 'mission' | 'decision', title: string, body: string, link?: TaskId) { return this.op(JSON.stringify(['record', kind, title, body, link]), m => m.record(kind, title, body, link)) }
  close(id: TaskId, o: Parameters<TaskStore['close']>[1]) { return this.op(JSON.stringify(['close', id, o]), m => m.close(id, o)) }
}
