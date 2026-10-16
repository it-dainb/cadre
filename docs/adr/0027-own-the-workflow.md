# 0027: cadre's own tools, a file task store, agent contracts, the task-tool gate (0.15.0)

Status: accepted (release/0.15.0). Design source: `.omc/plans/cadre-0.15.0.md` (slices P, 0–4; 5a, 5b and 6 are ADR 0026). Builds on ADR 0025.

## Context

Up to 0.14 main planned through Claude Code's built-in task tools (TaskCreate/Update/List/Get), which cadre answered in its hooks. Their shapes are not cadre's: a free-form `metadata` object, integer ids on newer builds, no revision, nothing that says which version of a plan the user approved. Tasks lived in beads (`bd`), an external binary with its own release cadence and its own locking, reached through a subprocess per call. An agent that stopped without a report was "auto-reported": its last words became its result.

## Decision

**Main's tools.** cadre registers its own tools at session start (`$.tool.register`, answered by one `tool.call` dispatcher): `plan`, `task`, `epic`, `amend`, `explore`, `ask`, `status`, and `preferences` while setup is due. The set is fixed for the session: main's planning tools are registered only in a repo where cadre is on, `preferences` also where the machine setup is missing or was made with another Claude Code build. A repo turned on mid-session gets a Doctor warning to restart; a refused registration is a Doctor crit row. An agent calling one of main's tools is refused; main calling `report` is refused.

**Strict input, checked in code.** Every tool's JSON schema is checked by cadre before anything is stored (`validate.checkInput`): unknown field, type, enum, minimum, length and item caps. A cap rejects, never truncates. Every refusal names the field and says how to retry (`error: after[0]: … ; fix it and call again`).

**Revision and receipt.** Every write runs the dependency graph check first (an `after` id must be a task of the plan; no self wait; no cycle), then bumps the plan's revision and clears its approval receipt. `amend` names the revision it read (`expectedRevision`); a stale one is refused with the current one. The human's approval writes the receipt `{plan, revision, at, by}`. Open questions recorded with `ask` block the approval until main records the user's answer.

**Explore through cadre.** `explore {question}` queues a read-only explorer that cadre's spawner starts when main's turn ends; the answer comes back to main as a message, and `explore {id}` reads it again. A goal run's first explore is its clarify explorer; the clarity record is `ask {clarity}`.

**The task-tool gate (probe results).** The probes showed: `CLAUDE_CODE_ENABLE_TASKS=false` in a project's `.claude/settings.local.json` hides the built-in task tools from that launch on (Claude Code 2.1.295 and 2.1.299; TaskStop stays), and `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` keeps the todo list; a settings `deny: ["Agent"]` also kills `$.agent.spawn` ("no tool named Agent"), so cadre could no longer start agents. Therefore:
- `/cadre init`'s safety card writes the two env keys into the project's settings and nothing else of this kind; never an Agent deny, and nothing into the user settings. It records a per-repo stamp `{rev, added}` (`added`: the keys cadre put there; an older cadre's todo flag counts as cadre's).
- In a repo whose stamp or file lags, session start toasts "run /cadre init" and Doctor shows a crit row; another crit row fires while the task tools still show in the session. One repo's re-init never clears another's.
- Main's built-in Agent is refused in `tool.call` when its prompt names no planned task (exploring or asking a critic goes through `explore`). A planned task's start goes on to admission, so a session where Claude starts the agents (headless) still works. Calls made by a plugin (cadre's own spawner) pass. The task tools are refused the same way if a repo still shows them.
- An older cadre's `CLAUDE_CODE_ENABLE_TODO_TOOLS` in the user settings is a Doctor warn row with a card that removes it.

**A file task store, no beads.** The `TaskStore` contract stays; its backend is plain files under `.cadre/state/` (excluded from git). The journal is the truth: each operation commits one entry `j/<seq>` holding the after-images of the docs it changed, by `ln` of a written temp file (link(2) fails on a taken slot: the compare-and-set; no lock). `d/<id>.<seq>` docs are a redo cache written only by compaction, which marks folded entries with `j/snap.<n>`. Every operation runs on a `MemoryStore` hydrated from docs + the journal tail; a timed-out or killed commit is resolved by scanning the head for the operation's id, so a retry with the same id never commits twice. One store operation at a time per directory and session. The probe (hard links work in `.cadre/state`) runs before a repo is turned on; without hard links cadre stays off there and Doctor says why.

**One control doc.** The repo-wide state that sessions share is one doc in the store, changed by compare-and-set on its revision: the drive record and its lease, the tracker sync leases and cursors (the sync engine and its adapters stay), and the run records, budgets, spawn intents, task owners and the board pointer of ADR 0025. `/cadre continue` reads everything from the store alone.

**Clean break.** No migration: a `.beads/` or `.cadre/store` folder and the earlier `$.store` run, budget, board and sync keys are not read; Doctor names them with a warn row (finish those plans with the older version). The `bd` dependency, its setup check and its gitignore handling are gone.

**Agent contracts.** Every report is checked against its role's contract before anything is stored (unknown field, type, caps that reject; an outcome needs its field: `blocked`/`spec_change` a reason, `needs` what is needed). A worker's `needs` is recorded and the task waits with one dialog. An agent that stops without a report is nudged (`limits.nudges`, default 1, was 2), then ends: its tree is checkpointed, nothing it did is accepted as a result, and the task waits with one dialog (`no-report`). Its stop is never refused (ADR 0025 rule 1). A reviewer that stops without a verdict is released for a fresh one: a verdict is never invented. An explorer asked by main (no task) still has its last words handed to main, marked as such.

**Handoff.** A fresh agent of a task starts from five fixed fields built by cadre from records, never from a model's summary: Decided, Rejected (the last review's findings), Risks, Files (diffstat + diff since the base), Remaining (the checkpoint, the last failing check).

**The amendment ledger.** Changing an approved task needs a reason and evidence. Each changed criterion (a scenario by its id, any other field by name) keeps its original verbatim and changes once; a second change to it is the user's. In auto mode the task goes back to the user's approval dialog; in yolo main's change stands and is recorded.

## Consequences

- Plans in flight on 0.14 finish on 0.14. Each older project shows one "run /cadre init" toast and one confirm; the gate applies after a restart.
- Non-cadre sessions in a set-up project also run without the built-in task tools, until the gate keys are removed from its settings by hand.
- The spawner claims what it picks before its next await, so two turn ends at once never exceed `maxParallel` (a race found while landing this release).
- Evaluations seed their approved plan with `evals/seed.mjs` (cadre's FileStore from node; a new session adopts the plan from the store) and write the task-tool gate as init would; their prompts no longer name a plan id (ids are minted). The `auto-report` evaluation is retired (its premise is gone) and the model × effort bench is retired until the quality benches after 1.0.

## Known limits

- The tool set is fixed per session: a repo turned on mid-session needs a restart for main's tools (Doctor says so).
- A filesystem without hard links (exFAT, some network or FUSE mounts) cannot hold the store; cadre stays off there.
- Removing the gate from a project is by hand (no `/cadre off`).
- A report-less end blocks the task until the user answers its dialog; waiting on a `needs` in place, and helpers that fetch what is needed, come with 0.16.
