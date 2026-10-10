# ADR 0006 — Deliberate deviations from DESIGN found in review round 1

Status: accepted (lead decision, fix round 1). Governs `policy/guards.ts`, `core/effect.ts`.

## 1. Fence rule 5 is a positive jail for bound subagents (DESIGN §13.2)
DESIGN: rule 5 "elsewhere: allow"; §13.2 says `tool.check`'s allow only mirrors rules 2–3.
Deviation: for any bound subagent, Edit/Write/NotebookEdit are denied unless the realpath is under the **owner's own worktree** (or `$TMPDIR`, default `/tmp`). Main keeps rule 5 (it has no write tools in its allowlist). `tool.check` auto-allows only inside the owner worktree / tester view; `$TMPDIR` writes get the engine's own decision.
Why: file tools are not covered by the OS sandbox (`official/permissions.md`), so "allow the rest" let a drifted worker write `~/.gitconfig`/`~/.bashrc` (privileged code via the mod's unsandboxed `git`). P10: default-deny. Findings: review-code H4, review-sec H1.

## 2. The human's main checkout is never stashed (§13.1 rule 2, §13.7)
DESIGN: a main-checkout change during an agent window is quarantined by `stash`.
Deviation: audit only **flags** (`git:main-dirty:agent`, blocks merges until `resolve git keep`); a human edit only toasts (no `git:` flag, so it never blocks merges/drive). Worktree-owner quarantine (rule 1) is unchanged. Why: the main checkout is the human's tree; §13.7 "flagged, never reset". Findings: review-code M3/M4, review-sec M1.

## 3. Re-entry `judge` over-denies for agents
Bindings are unreadable on re-entry (all `$` reject), so `judge` refuses any agent shell/foreign-MCP call. Rare path; fail-closed preferred over fail-open. Finding: review-sec L1.

## 4. Strictness is read from the resolved config
`config/index.strictOf` (userConfig, `~/.claude/cadre.json`, repo, env) replaces direct `CADRE_STRICTNESS`/userConfig reads. Finding: review-code M10.

## 5. Need-to-know wording (round 2)
Every model-visible text (agent prompts/files, briefs, plan rules, cards incl. the wait card, deny/refusal reasons, Task* answers, tool results, the drive prompt) uses task language and ends in a next action. No "mod", "hook", "harness", "fence", "sandbox", "L1-L3", "quarantine", "cadre:" prefix or view/worktree paths; internal flag `quarantine*` is shown as `stray-edit*` (`render.flagName`). "/cadre <sub>" stays only where main tells the human a command. Human surfaces (toast, band, log, status line, `/cadre` output) are unchanged. `tests/wording.test.ts` + `tests/fixtures/wording.ts` lint renders and deny sites.

## Removed config keys `tdd.enforce`, `changelog.enforce`
DESIGN §12 lists them as S keys, but nothing read them: the TDD and changelog gates are pipeline steps (type registry, §3.1) and `strictness: advisory` already turns their denies into warnings. Keeping a second off-switch would be a dead flag. Removed (review round 2); re-add only with a concrete use.

## 6. Accepted deviations from the verification round (G6, G7, G9)
- **Degraded containment (review-sec L3):** no spawn refusal while degraded. Degraded means L3 audits every call (DESIGN §13.1) plus a `[CRIT]` band item. The `$HOME` audit is not done: file tools are jailed by the positive fence (§1) and Bash escapes are the sandbox's.
- **Re-entry spawn:** `judgeSpawn` judges from the event alone: a prompt carrying a `TASK-`/`bd-` marker is denied, a marker-less one passes (the board is unreadable on re-entry, so a bare known id cannot be matched).
- **Send isolation:** cadre's own queued resumes are exempt (`ui.drainTo`, set around `sendTo` in the drain); a model SendMessage naming another task is still refused.
- **Conflict `accept`:** the pulled remote value is kept in the task's meta (`cadre.remote.<field>`, `cadre.remote.status`) and `/cadre resolve <id> accept` re-applies it with `store.update`. Drift `accept` adopts the remote status through the machine for `cancelled`, `blocked`, `done`; an illegal move or any other status is refused with the reason and the flag stays.
- **Drive USD bound** is accumulated in the control-issue record as deltas of `$.session.usage()` against a per-session baseline (`cost`, `last`, `sess`): a usage reset or `/clear` neither loses nor double counts it.
- **Config-derived protection:** epic refs use `branches.epicPrefix`; `changelog.path` is mod-owned and protected alongside `CHANGELOG.md` (policy keys `epicPrefix`, `changelog`).

