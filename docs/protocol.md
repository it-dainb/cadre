# cadre extension protocol v1 (`schemaVersion: 1`)

One contract for every external consumer (DESIGN §2.5, §11.3): **events**, the **snapshot** (read model), **commands**, and the **adapter protocol** that carries them to sync targets, notifiers and UIs. Goldens pin each shape; a bump needs an ADR migration note.

## 1. Events
`{schemaVersion:1, seq, at, type, taskId?, agentId?, actor, severity, needsHuman, data}`
- `actor` ∈ `human|main|tester|worker|reviewer|explorer|sync|mod` · `severity` ∈ `info|warn|crit` · `needsHuman`: boolean. The attention level (silent/band/toast/notify) is a client policy computed from these three.
- `type` and required `data` keys: `task.transitioned {taskId,from,to}` · `task.phase_changed {taskId,from,to}` (every pipeline step) · `task.skipped {taskId,on}` · `agent.bound {agentId,taskId,role}` · `agent.unbound {agentId,reason: answer|stopped|stale|rebind}` · `check.ran {taskId,name,ok}` · `flag.raised {taskId,flag}` · `flag.resolved {taskId,flag}` · `approval.pending {planId,missing}` · `sync.state_changed {target,state: ok|offline|conflict|auth,at}` · `drive.status {state}` · `cost.updated {tokens}` · `init.stage {stage,state}`.
- Ring: 500 events per epic, `seq` global and increasing. After a rebuild (`/clear` rehydrate) seqs are fresh; adapters then get `reset:true`. No event carries a code, nonce or token.
- Sync flags (`flag.raised`, actor `sync`): `edited` (a human field was pulled), `conflict` (both sides changed; beads won), `drift` (remote status moved), `external` (status or assignee changed by an actor other than this install, read from the bd journal's issue snapshot; strict mode refuses the task's next transition, like `drift`, until `/cadre resolve`).

## 2. Snapshot (read model)
`{schemaVersion:1, seq, repo, mission, epic, plan{id,slug,state,epicBranch,approvedAt?,landed?,released?}, tasks[{id,title,type,kind: code|docs|spike,merges,state,step,phaseSince,owner?,deps[{id,type: blocks|waits-for|conditional-blocks}],condition?{on,state: pending|met|not-met},flags[],card?}], approval{planId,missing[]}, drive, sync[{target,state,pending,at}], cost, containment, resumesQueued, init[]}`
Two views of one schema: **human** (the band and pane only; has `seq`, `phaseSince`, `cost`, `decisions`, …) and **model** (every adapter, main's context: drops `seq`, `cost`, `phaseSince`, `sync.at`, drive counters). **Neither view carries any code** (there are none, ADR 0012).

## 3. Commands
`{schemaVersion:1, cmd, args[], origin{kind, name?}}`. The dispatcher (`core/dispatch`) is the only entry. **Adapters cannot send commands** (ADR 0012): there is no `commands` grant and no session token; a `commands` array in a `deliver` reply is refused with one line.
- **Human origin**: only `press` (a Button) and `dialog` (the `$.ui.ask` answer on a surface with no pane), each bound to the decision's content hash. Typed `composer` may only start `init`/`setup`/`doctor`/a goal.

## 4. Adapter protocol (`cadre-adapter` v1)
**Config.** Project (`.cadre/config.json`): `sync.<target> = {adapter, url?, project, mapping, direction: both|push|pull|off}`. User (`~/.claude/cadre.json`): `adapters.<name> = {command: argv[], credentialEnv?: "NAME", grants: ["sync"|"events"]}`. Only the env var **name** is stored; the adapter reads the value from its inherited environment and cadre checks it is set (else `Auth`).

**Transport.** One request → one response per spawn (`$.process.spawn({argv, input})`; stdin closed after `input`; any language; mod-spawned outside Claude's sandbox; timeout 30 s; nothing listens on a socket):
```
stdin : {"protocol":"cadre-adapter","v":1,"method":"…","params":{…}}
stdout: {"v":1,"ok":true,"result":…}
        {"v":1,"ok":false,"error":{"code":"Offline|Auth|RateLimited|Conflict|NotFound|Invalid|Unsupported","message":"…","retryAfterMs?":n}}
```
A reply with another `v`, a non-JSON stdout, or an unknown error code is `Invalid`; a non-zero exit with no reply, a spawn failure or a timeout is `Offline`. Calling a method the adapter lacks the grant for fails client-side as `Unsupported` before any process starts.

| Method | Grant | `params` → `result` |
|---|---|---|
| `ping` | – | `{}` → anything (liveness) |
| `describe` | – | `{}` → `{name, version, caps[], subscribe?[eventTypes]}` |
| `describeSchema` | sync | `{url, project}` → `{trackers[], statuses[], priorities[] (high→low), versions?[], customFields?[{name, required?, default?}]}` |
| `listProjects` | sync | `{url}` → `[{id, name}]` |
| `validateAccess` | sync | `{url, project?, mapping?, stage?}` → `{auth, perms{view,add,edit}, missing[]}`; **never writes** |
| `push` | sync | `{project, tasks[{localId, rid?, etag?, changed[], fields{title,description,acceptance,priority,status,type}, note?}]}` → `{results[{localId, rid, etag?, rUpdated}]}`; idempotent (upsert by `rid`, else by `localId`); `note` = a remote comment; a mission (bd type `milestone`) is pushed with `kind:"version"` (title, description), a decision with `kind:"comment", on:<rid of its linked task>` (deferred until that task has a `rid`) |
| `pull` | sync | `{project, since?}` → `{tasks[{rid, localId?, etag?, updatedAt, fields}], next}` |
| `deliver` | events | `{events[], snapshot, reset?}` → `{ack: seq}` |

**Sync engine.** Level-triggered, state-based, one instance per target: `{cursor, since, lastHeal, lease{session,until}}` live on the lazily created control issue `cadre-control` (metadata `cadre.sync.<target>`; read-check-write-reread under a revision guard). Per task, `cadre.sync.<target>` = `{rid, etag, l, r}` (fnv64 of each field as last pushed/seen). Pull first, 3-way merge per human field (`title description acceptance priority`): remote-only change is pulled (flag `edited`, and a delta line queued for every agent bound to the task), both changed → beads wins, a remote comment, flag `conflict`; `status` is push-only (remote change → flag `drift`, status pushed back). Then push the fields whose hash moved. The cursor moves last, so a crash replays idempotent pushes. Heal (full scan) every 15 min and on reconnect; backoff 30 s → 5 min (`RateLimited.retryAfterMs` wins); `sync.state_changed` on every state change.

**Deliver.** Adapters with the `events` grant get, from the same tick, the events since their last `ack` (filtered by `describe.subscribe`) and a snapshot (the model view); `reset:true` on first delivery, epic change, or a gap in the ring. Nothing is sent when neither events nor the snapshot changed.

**Guided setup** (`/cadre sync add <adapter> …`, init stage 8): five steps, each a confirmed diff (the card's Confirm button): (1) `url=` + credential env set, `ping` + `validateAccess{stage:"auth"}`; (2) `project=<id>` from `listProjects`: cadre never creates remote projects; (3) mapping proposed from `describeSchema` (type→tracker, status→allowed workflow, priority, mission→version, required custom fields need a default or setup blocks; override with `map.status.<cat>=…`); (4) `validateAccess` without writes: auth, view/add/edit, mapped entities; (5) `direction=push|import|empty` initialises the cursor on the control issue.

The bundled `adapters/fake/fake-adapter.mjs` implements all of the above against a JSON file (`$FAKE_ADAPTER_STATE`) and is the conformance reference (`node --test tests/protocol/*.test.mjs`).
