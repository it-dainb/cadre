# 0028: roles as data, needs, helpers, the model gate, lessons (0.16.0)

Status: accepted (release/0.16.0). Design source: `.omc/plans/cadre-0.16.0.md`. Builds on ADR 0027. This block is shared by every 0.16 slice; slice 7 (lessons) adds its own section.

- **Decision:** one `RoleSpec` (built-ins proven unchanged at 2fad888); `needs` is a lifecycle wait resumed by the same agent (handoff rebind only when it is lost); helpers explore, setup (cadre-run allowlisted argv, jailed, on the requester's branch), probe; one task-owned slot rule with per-model FIFO; static model gate; custom roles via whitelisted `$.agent.register` with a ledger; rule 6 at registration; units editor (scalar v1); lessons by a capped side-model pass with durable evidence; caps 7400 / 1100.
- **Drivers:** §1.
- **Alternatives considered:** B (fallback), C, D; a live model probe; warn-only write limits; run-owned slots with lending (new lifecycle edge); setup by agent Bash (decorative check); rebinding fresh on every `needs` (loses context, overrides the user); `helpers.usd` (no per-agent cost).
- **Why chosen:** the zero-change refactor lands first, under a differential test. Every helper is an ordinary run that must end. The slot rule cannot cycle. Lessons come last and can be cut.
- **Consequences:** `request` replaces `needs`; `maxParallel`/`packages` keys are ignored (clean break; Doctor names each as "renamed" until it is edited); per-model limits inexact while a helper runs on another model; FIFO order per process; setup needs a jail; side-model spend counted; `fixed.*` rows visible.
- **Follow-ups (0.17):** the specifier; lessons feed specs; full stall timers, the stagnation cap and revival (B2/B5/B6); `maxCalls`; pipelines as data; caps re-measured.

## Setup helper security (slice 4)

- **Jail:** bwrap with `--clearenv`, a tmpfs home, only `/usr /bin /lib* /etc` and the PATH tool dirs bound read-only, `--unshare-pid/ipc`, `--die-with-parent`, tmpfs `/run`.
- **What may run:** an argv allowlist per tool with strict flags and specs; archive, URL and oddly named specs refused; install scripts off through env; corepack/pnpm version switching off; pip/uv from an empty cwd with the system python, `--no-build --no-sync`. Only manifests and lockfiles of the unit roots may change.
- **Repo inputs:** refused when a file that runs code at install changed since the task base or is ignored on disk; registry config the repo committed unchanged is honoured as its own choice. Host git calls go through one runner (`fsmonitor` off, no `sshCommand`, `protocol.ext` never) and refuse a swapped `.git`; the user's own hooks still run.
- **Residual risk:** the install has network (it must reach the registry), so loopback services, abstract unix sockets and a cloud metadata endpoint are reachable from it (README, Requirements).
- **Helpers get no lessons:** a helper is short-lived and read-only, and its question carries the requester's context; lessons feed task briefs only.

## Lessons (slice 7, H10)

- **Inputs:** records and the human's feedback become `{kind, ref, at}` inputs (key `kind:ref:at`, never a ring seq) in the repo's lessons doc (the task store's control doc, CAS). Sources: `flag.raised`, failed `check.ran`, failed `help.done`, `drive.decided`, and the new events `decision.answered`, `config.changed`, `task.retried`, `task.cancelled`, `amend.recorded`. At most 200 inputs and 24 KB; the newest stay; secret-shaped strings are scrubbed first; a line that leaks machinery words is not kept.
- **Pass:** one `$.model.complete` on `lessons.model` (haiku, checked by `modelIssues`), `maxTokens` 800, 20 s timeout. It runs after each landed plan or when nothing runs (`core/reuse.drain`); a spawn never waits on it, a brief carries the lessons that exist then. The cap `lessons.passesPerDay` (4; 0 = off) counts in the store under CAS: the claim is taken before the call and given back when `isAnswered` is false, so a failed call leaves every record as it was. Tokens join the session cost; dollars (`cost.prices`) join the drive record unrounded (`side`, summed at the bound check), so `maxCostUsd` holds them.
- **Answer:** `{lessons:[{text≤300, paths?, evidence:[key…], reinforces?, critical?}]}`. Evidence outside the batch that was sent is dropped; a lesson left with none is dropped. A pruned lesson's evidence keys are remembered, so the same keys never make it again.
- **Promotion** (only for a lesson this answer made or reinforced): `lessons.repeats` (3) reinforcements in a repo, `lessons.repos` (2) repos with the same text, or `critical` once. The user scope (`~/.claude/cadre/lessons.json`, written through `.tmp` + `mv`) keeps no paths; a lesson with a path, a file name or a leak word stays in its repo.
- **Decay:** a use counts only when a task the lesson was fed to lands with no flag or failed check of its own; unused `lessons.decayDays` (30) → dropped; `lessons.maxAgeDays` (90) age cap; at most 50 lessons per repo, lowest-ranked first.
- **Feed (A2):** by path, at most `lessons.perBrief` (5) lessons and 1.5 KB in all (the lowest-ranked dropped until it fits; a limit, not a setting), under "Lessons from earlier work" in the task block, through `modelText('lesson')`.
- **Pane:** a Lessons tab (6) once any exist; `x` prunes the selected one for good.
- **Open points taken:** "repos 2" matches the same lesson text across repos (the model sees only its own repo's ids); user-scope lessons age by the age cap only (their uses are not tracked).
- **Known limits:** a crash between a pass's claim and its answer spends one pass of the day without a lesson (the claim is given back only on a clean `isAnswered:false`). `pathFree` is a text lint: it refuses paths and file names, not every repo-specific word, so a global lesson can still be repo-flavoured; the human prunes it (a pruned user lesson is remembered by its text and never promoted again).
- **Inputs to the pass are sanitised:** a lesson is one plain line (no heading, list or quote opener), `critical` counts only with a flag or failure record behind it, and a lesson gains a repeat at most once per pass.
