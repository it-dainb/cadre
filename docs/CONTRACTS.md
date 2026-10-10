# cadre: module contracts (wave 1)

Read this before touching a module. Governing docs: `design/DESIGN.md` (v2.5), `design/UI-DESIGN.md`. Section refs `§n` are DESIGN's.
**Rules.** Static relative imports only; no npm/Node/zod. `$` exists only in `hooks/register.ts`; every other module gets a per-hook `Host` (below). Never keep a Host in a module variable. Slots are filled **in place**: keep the exported name and signature, replace the body. Do not edit `register.ts` except to add a Host member (append-only) or a new slot; a new `on()` needs a distinct matcher if its event is already registered (same event twice without a matcher is a load error).
**Gates before commit:** `node scripts/budget.mjs` (regenerates `tests/fixtures/budget.generated.ts`; the kit has no fs) → `claude plugin validate --strict .` → `claude plugin test .` (pin: `~/.local/share/claude/versions/2.1.295`).
**Placeholder rule:** a slot not yet owned is a pass-through (`return next(e)`); its file starts with `// OWNER: wave-N <area>`. Remove the header line when you fill it.

## Contract types: `types/index.d.ts` (self-contained: the validator refuses imports there)
`Category` · `Role` · `Actor` · `Severity` · `Kind` · `SnapDepType` · `PlanState` · `SnapTask` · `Plan` · `Snapshot` · `EventType` · `CadreEvent` · `EventRing` · `Secret` · `Binding` · `GitState` · `Cell<T>` · `Host` · `Hook`.
- `PluginState.cadre = { board: Snapshot, events: EventRing, secret: Secret, ui: Record<string,unknown>, git: GitState, bind: Record<agentId, Binding> }`. `bind` is an addition to the brief's list (binding table, §4.4.4); nonce, init nonce and session token live in `secret` (UI-private, never in a view or event).
- `Host` (built by `host($)` in register.ts, one per hook entry): `now()` · `rand(bytes=16)` hex · cells `board|events|secret|ui|git|bind` each `{read(), update(fn)}` (`update` = CAS with retry: **fn must be pure**) · `store {get,set,del}` ($.store, per-user keys) · `env()` (the four `CADRE_*`) · `readText(path)` (null if missing) · `log(text)` · `toast(text)` (local, zero tokens) · `options {strictness?}`.
- `Hook = (h: Host, e: any, next: (e:any)=>any) => any`.

## Core
| Module | Owner | Exports |
|---|---|---|
| `core/events.ts` | wave-1 (done) | `CAP=500` · `TABLE: Record<EventType,[actor,severity,needsHuman,dataKeys]>` · `emit(h, type, data, {taskId?,agentId?,actor?,severity?,needsHuman?}) => Promise<CadreEvent>` (validates required data keys, refuses `code8/code/nonce/token/initConfirm` keys, appends to the ring of `board.epic`, runs subscribers) · `subscribe(fn:(h,ev)=>unknown)` · `emptyRing()` · `ofEpic(ring, epic)` · `rebuild(h, epic, evs[{at,type,data,taskId?,agentId?}]) => Promise<firstSeq>` (sorted by `at`, fresh seqs, last 500; the caller sends adapters `reset:true`) |
| `core/board.ts` | wave-1 | `emptySnapshot(repo)` · `isCold(s)` (seq===0 → lazy rehydrate, §13.4) · `canon(v)` canonical JSON · `fnv1a64(s)` · `humanView(s)` · `modelView(s)` (drops seq, cost, phaseSince, sync.at, drive turns/costUsd/startedAt) · `viewHash(s)` (diff gate for main's context line) · `conditionOf(t, all)` / `withConditions(s)` · `commit(h, fn)` (CAS) · `stamp(h, seq)` (board.seq = last applied event) · `bindAgent(h,id,b)` / `unbindAgent(h,id)` / `bindingOf(table,id?)` / `agentsOf(table,taskId)` |
| `core/machine.ts` | wave-1 | `STEP_CAT` (step → category; reviewer/merge = `review`) · `transition(s, m: MEvent, pipe) => Result` (pure) · `apply(h, m, pipe) => Promise<Result>` (**the only write path for task state**: commit → emit `task.transitioned` [+ `task.phase_changed` when the step moves, `task.skipped`] → `stamp`) · `pendingSkips(s)` · `epicNext(planState, ev)`. `MEvent = {kind: approve\|amend\|claim\|advance\|verdict\|close\|block\|unblock\|release\|cancel\|skip, id, at, actor?, owner?, verdict?, on?}`; `pipe = pipeOf(registry)` |
| `core/reuse.ts` | wave-3 | slots: `drain` (#1) · `step` (async generator, `turn.step`) · `compact` |
| `core/close.ts` · `core/admission.ts` · `core/effect.ts` · `core/briefs.ts` | wave-3 · wave-2 · wave-4 · wave-2 | `observe` (#2) · `admit` (#3, `agent.spawn`) · `wrap` (#6, `tool.call` wrap) · `context` (`prompt.submit`), `attachment` (`prompt.attachment`) |
| other §2.4 core modules (`dispatch tdd specview discover render validate git branches changelog`) | later waves | **not created yet**; the owner creates the file and wires a slot (or a call from an existing owner module) |

**Machine semantics (decided here).** A task's `step` is the current pipeline step; its category follows the step (`tester red worker green explorer report` → `active`; `reviewer merge` → `review`). `claim`: `todo→active`, `step = t.step || pipeline[0]` (a released task resumes at its step). `advance`: `active` only, to the next pipeline step (so `red`/`green` are real, mod-run phases). `verdict pass` (`review·reviewer`) → step `merge` (= review✓); `changes` → `active` at the last `worker`/`tester` before `reviewer`. `close`: `review·merge` or spike `active·report` → `done`. `block`: from `active|review`; `unblock` returns to the category of the kept step. `release`: `active|review|blocked → todo`, owner cleared, step kept. `skip` (todo, conditional-blocks upstream closed `done`): `→ cancelled` + `task.skipped`. Illegal moves return `{ok:false, error}` (a deny reason); nothing is committed or emitted.

## Task management
| Module | Owner | Exports |
|---|---|---|
| `task-management/store.ts` | wave-1 | `TaskStore` (§11.1 verbatim) · `Task` `NewTask` `Category` `DepType` `TaskId` `ErrorCode` · `StoreError(code, message?)` (what every adapter throws; `e.code` is an `ErrorCode`) |
| `task-management/registry.ts` | wave-1 | `TypeSpec {commit, changelog, pipeline, contract, kind?}` · `TypeRegistry` · `STEPS` · `defaults()` (the §3.1 table) · `validatePipeline(steps) => string\|null` · `validate(reg) => string[]` · `kindOf(spec)` · `merges(spec)` · `pipeOf(reg) => (type)=>steps` |
| `task-management/adapters/memory/store.ts` | wave-1 (TEST ONLY, ≤150 LOC) | `new MemoryStore(now?)`; also `.comments[id]`. Semantics pinned by the contract test: ids `m-N`; epic starts `draft`; `ready` = children in `todo` whose blocking deps are satisfied (`blocks` closed; `waits-for` closed + all its children closed; `conditional-blocks` upstream `cancelled`); gates are `todo` tasks of type `gate`, never ready; `claim` sets a 5-min lease; `revision` is a counter string bumped on every write; `close` of a failed task passes `note:"failed: …"` |
| `task-management/protocol.ts` · `sync-engine/{loop,reconcile,merge}.ts` · `adapters/beads/*` | wave-5/6 | `loop.ts` exists as slot: `tick(h) => Promise<void>` (called every 5 s from the one `$.clock.every`; timer calls skip our hooks, so queue/heal only). **Every adapter must pass `tests/store-contract.ts`: `contract(name, () => new YourStore())`** |

## Config: `config/`
`defaults()` → `Config` (§12 defaults, fresh object) · `classOf(path) => 'S'|'U'|'O'` (longest dotted prefix) · `tighten(path, base, val)` · `merge(base, layer, trust, diag)` · `resolve(layers: {name, trust:'user'|'repo', value}[]) => {config, diagnostics}` (pure; layers lowest first) · `envLayer(env)` · `load(h, {home, root, repoKey}) => Promise<{config, diagnostics}>` (userConfig → `~/.claude/cadre.json` → its `repos[repoKey]` section → repo `.cadre/config.json` → env).
Repo layer: S keys tighten only (bool → strict value, enum → stricter, list → intersection; `packages[].knownRed` kept only if the user layer granted it for that root); U keys ignored; O keys set. Bad key/type/layer → dropped + diagnostic. Added keys beyond §12's table: `store.kind` (`beads`|`memory`, env `CADRE_STORE`, U) and `disable` (env `CADRE_DISABLE`, U); `jail` `off<auto<on` and `effectCheck` `off<auto<always` are my reading of "enums by order". `/cadre config set` is not a layer: it writes the home file and re-resolves.

## Agents: `agents/`
`PROMPTS.{worker,tester,reviewer,explorer}` (byte-stable; caps 2500/1500/1500/1000 B; tested) · `TOOLS: Record<Role, string[]>` (= the L1 allowlist per role) · `MAIN_TOOLS` · `allowlist(role, mcpAllow)` · `spec(role, {roles, models, mcpAllow}) => AgentSpec` · `roster(cfg)`. Registered in `session.start` as `cadre:<name>`.

## Slots in `hooks/register.ts` (outermost first, §2.2)
| # | Event (matcher) | Calls | Owner | Fail-closed `.catch` |
|---|---|---|---|---|
| s | `session.start` | inline: `$.agent.register`×4, `$.command.register('cadre', immediate)`, `$.env.set(CLAUDE_CODE_ENABLE_TODO_TOOLS)`, `$.clock.every(5000)` → `tick` | wave-1 | — |
| 1 | `turn.complete` `{reason:/./}` | `core/reuse.drain` | wave-3 | — (the only sender; `const r = await next(e)` … `return r`) |
| 2 | `turn.complete` `{reason:/^/}` | `core/close.observe` | wave-3 | — |
| 3 | `agent.spawn` | `core/admission.admit` | wave-2 | `denySpawn` (re-entry → pass) |
| 4 | `tool.check` | `policy/guards.check` | wave-2 | `denyCheck` → `{decision:'deny'}` |
| 5 | `tool.call` `{tool:/./}` | `policy/guards.guard`, then `native/tasks.answer` (chained) | wave-2 | `denyCall` (re-entry → `guards.judge(e)` from the event alone) |
| 6 | `tool.call` `{tool:/^/}` | `core/effect.wrap` | wave-4 | `denyCall` |
| 6b | `tool.call` `{tool:/^mcp__cadre__/}` | `tools/index.handle` (answers `{result}`) | wave-3 | `denyCall` |
| – | `tool.describe` | `native/tasks.describe` | wave-2 | — |
| 7 | `session.send` | `policy/guards.send` | wave-2 | `denySend` → `{isDelivered:false}` |
| 8 | `prompt.submit` · `prompt.attachment` | `core/briefs.context` · `attachment` | wave-2 | `passOn` (adds context only: deliberate fail-open) |
| 8 | `turn.step` (async gen) · `session.compact` | `core/reuse.step` · `compact` | wave-3 | `passOn` for compact |
| 8 | `command.run` `{command:'cadre'}` | `commands/cadre.run` | wave-2 | `denyCmd` → `{text}` |
| 8 | `config.set` | `policy/guards.configSet` | wave-2 | `denySpawn` |
`policy/guards.judge(e) => string|undefined` is the event-only judge the re-entry `.catch` uses (must not use `$`). `tools/index.TOOLS = ['report','inspect','run_check']` (budget test pins 3).
Two registrations of one event need distinct matchers; the always-true regexes above are how #1/#2 and #5/#6 coexist (S31 confirms chain order).

## Tests and tooling
`tests/support.ts`: `fakeHost({t0?, files?, env?, options?})` (in-memory Host; `now()` advances 10 per call) · `task(id, overrides)` (a `SnapTask`). `tests/store-contract.ts`: `contract(name, make)`. `tests/fixtures/events/golden.ts` (envelope table + sample data per type: **update when you add an event type**), `tests/fixtures/readmodel/snapshot.golden.ts`. The kit has no fs, `$.state` or timers: measure with `scripts/budget.mjs`, use `fakeHost` for state, `mock.clock` for time.
**LOC rule** (`budget.mjs`): non-blank, non-comment lines of `.ts` under `hooks core native policy commands task-management agents config tools`, excluding `adapters/memory`, `adapters/fake`, `ui/`, `tests/`, `scripts/`, `*.d.ts`. Only the total (≤ 5000) and `ui/` (≤ 750) are enforced.

## Policy (wave 2, w2-policy)
| Module | Exports |
|---|---|
| `policy/guards.ts` | slots `guard` `check` `send` `configSet` `judge(e)` · `policyOf(h)` reads `$.store 'policy'` = `{repo, wtRoot (= <wtRoot>/<repoKey>), home, mcpAllow, locks: {taskId: paths}, protect: branches, effectCheck}` (**init/session.start must write it**; absent keys disable the rule they feed) · `inputPath(tool, input, cwd)` · `idsIn(text, knownIds)` (§4.6 matcher). Tester root = its binding's `worktree` (view path); an agent's cwd = its binding `worktree`, main's = `policy.repo`. |
| `policy/settings.ts` | `deepMerge` `diff` `plan(fs,path,patch)` `apply(fs,path,patch)` (.bak, re-read; fs = `{readText, writeText}` = `h.readText`/`h.write`) |
| `policy/containment.ts` | `assess(settings, repo, wtRepo)` · `contain(h)` (called in `session.start`; writes `board.containment`) |
| `core/effect.ts` | `wrap` (#6) · `audit(h, caller\|null)` · `sweep(h)` (**core/close.observe must call it at every turn.complete, and before merges**) · `resolveGit(h, flag, 'keep'\|'restore')` · `writes(tool)` · `parse`. State lives in `GitState` optional fields `fp/win/flags`; open git flags = `git.flags` keys (merges refuse while any `git:*`). Git goes through `h.run`. Host additions: `stat`, `run`, `settings`. |
