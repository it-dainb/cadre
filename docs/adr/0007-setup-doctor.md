# ADR 0007 — `/cadre setup` and `/cadre doctor`

Status: accepted (user request, post-v1). Adds two subcommands to DESIGN §5.3.

## Why separate from `/cadre init`
`init` is per project (repo, store, discovery, containment); it assumes the machine is fit. `setup` verifies the machine and user once: Claude Code build, `git`, `bd` >= 1.3.0, `bwrap` (overlay needs >= 0.11) with a working user namespace, `socat` (the Claude sandbox needs it on Linux), a writable worktree root, and the user-level env cadre relies on (`CLAUDE_CODE_ENABLE_TODO_TOOLS`). Results (ADR 0001): bd 1.3.1 lacks `--if-revision`, bwrap < 0.11 means copy-jail, macOS has no bwrap.
`doctor` is the read-only half: the same machine rows plus project rows (init stages, containment, beads and journal, branches, expired leases, flags, quarantined refs, queued resumes, sync ping with a 5 s timeout, drive). It is idempotent, makes no writes, and anyone may run it.

## Setup runs the user-level fixes after one confirm (changed from "never auto-install")
First version only printed commands. A real install showed that defeats the point: the human had to copy five fixes by hand. `/cadre setup` is now preflight, plan, one confirm, execute.
1. Preflight: the machine checks plus the user-settings diff.
2. Plan: every fix cadre can make with no password becomes an ordered action run through `h.run`, outside the Claude sandbox: `npm install -g @beads/bd@latest` (else the official beads install script via curl, which installs without sudo), the user-settings merge (`.bak`, re-read), `mkdir -p` of a missing worktree root. Anything needing root (`sudo apt install bubblewrap socat`, AppArmor, sysctl) is never run: it is listed under "you run once" with the fix for the detected cause. The plan is shown in the pane (Doctor tab, "Setup plan"); the command text is `setup: 2 actions ready · confirm with the code on the band`.
3. Confirm: `/cadre setup confirm <code>` (stage key 90, nonce-salted, burn-on-use) is bound to a hash of the exact plan (actions plus the settings diff and old bytes). A wrong code is burned; a plan that changed since it was shown is re-planned with a fresh code and nothing runs.
4. Execute in order (npm gets 300 s), one short toast per step (`setup: installing bd`), pane rows with state; the first failure stops the run and shows the last 8 lines of its output in the pane. Then the preflight runs again and the report is final. The stamp (`$.store cadre:setup {cc, bd, bwrap, jail, at}`) is written only when nothing is CRIT and no action is left. Nothing to do: `setup: all ok` and stamp.
Why not sudo: the mod has no password and must not ask for one; a one-line `! sudo …` typed by the human is the honest boundary.

Diagnostics shared with `doctor` (read-only):
- bd shadowing: a stale `bd` (say `/usr/local/bin/bd` 0.43.0) can sit before the npm one. When `bd` is missing or old, the npm global prefix is probed; if a good bd is there but another path answers first, the row names both paths and the fix (remove the old one, or put the npm bin first in PATH) instead of reinstalling. After an install the re-check catches the same case, so success is never claimed while the old bd still wins.
- bwrap user namespace, real cause: `kernel.apparmor_restrict_unprivileged_userns=1` (Ubuntu 24.04+) gets the AppArmor profile for bwrap from the Claude Code sandboxing docs (`sudo tee /etc/apparmor.d/bwrap`, `systemctl reload apparmor`), with `sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` plus `/etc/sysctl.d` as a quicker option that loosens it for every program, Claude Code's own sandbox included. `kernel.unprivileged_userns_clone` is suggested only when that file exists and reads 0 (Debian). Otherwise the row points at the docs.
- Claude Code build other than the pin: a WARN with no action. `newer than the tested 2.1.295; usually fine`. Never an npm reinstall: a second install would shadow the native one.

## Output rules (DESIGN D2, need-to-know)
The command `{text}` is model-visible, so it is one line (`setup: 1 fail, 2 warn — report in the cadre pane`, `doctor: all ok`) with no mechanism words (`tests/doctor.test.ts` runs the wording lint on it). The full report goes only to human surfaces: the pane tab `doctor` (`ui['doctor.rows']`, tags `[OK]/[WARN]/[CRIT]`, UI-DESIGN §6.0) and `$.ui.log`, one short line per row (never a multi-line string: the transcript shows newlines as U+FFFD).

## Known gap
The plugin's own version is not shown: a mod has no API for it, so the row is left out rather than guessed.

## Dormant until `/cadre init` (added after the first marketplace install)
A user-scoped install used to enforce in every repo: guards took Bash and Edit from main in unrelated projects. cadre is now per-repo opt-in: a repo is active only when `<repo>/.cadre/config.json` exists (init stage 1 writes it). `core/session.wake(h)` is the one check: active is cached in the session secret, dormant re-reads the file (one read), so `/cadre init` takes effect on the next hook without a restart. When the repo turns on, `wake` runs the session policy, the draw of the session token and the containment check once.
Dormant: every gating slot passes straight through (turn.complete, agent.spawn, tool.check, tool.call guard and wrap, tool.describe, session.send, prompt.submit, prompt.attachment, turn.step, session.compact, config.set, result-card render), the 5 s and 30 s timers do nothing, and no band or toast is drawn, and no setup nudge (the band only draws a pending init or setup code; the pane render stays on too, so `doctor` and `setup` can show their report). Still working: `/cadre setup|doctor|init|open`. Any other `/cadre` sub, `status` included, answers `cadre is off in this repo · run /cadre init`. Once active, the fail-closed handlers apply as before.

## Short toasts
A toast is one line of about 60 characters at most, detail in `/cadre doctor` or the pane: `cadre: containment degraded · /cadre doctor`, `cadre: N commands unsandboxed · /cadre doctor`; the drive/context/fresh-agent/spec-change/conflict toasts were shortened the same way.

## Live result (harness tui.sh, haiku, container without `bd` on PATH, `NPM_CONFIG_PREFIX` a user dir)
`/cadre setup` showed the plan (1 installing bd, 2 creating the worktree folder, 3 writing user settings) plus the `you run once: ! sudo apt install bubblewrap` line (bwrap 0.8.0 in the image); `/cadre setup confirm <band code>` ran the three steps (npm took about a minute), the pane marked each done, the re-check read `bd 1.3.1`, and the settings file gained the env. The userns-blocked case is not simulated live (the harness runs with seccomp and AppArmor unconfined so bwrap works); it is covered by kit tests only.
