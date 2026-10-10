# ADR 0007 — `/cadre setup` and `/cadre doctor`

Status: accepted (user request, post-v1). Adds two subcommands to DESIGN §5.3.

## Why separate from `/cadre init`
`init` is per project (repo, store, discovery, containment); it assumes the machine is fit. `setup` verifies the machine and user once: Claude Code build, `git`, `bd` >= 1.3.0, `bwrap` (overlay needs >= 0.11) with a working user namespace, `socat` (the Claude sandbox needs it on Linux), a writable worktree root, and the user-level env cadre relies on (`CLAUDE_CODE_ENABLE_TODO_TOOLS`). Results (ADR 0001): bd 1.3.1 lacks `--if-revision`, bwrap < 0.11 means copy-jail, macOS has no bwrap.
`doctor` is the read-only half: the same machine rows plus project rows (init stages, containment, beads and journal, branches, expired leases, flags, quarantined refs, queued resumes, sync ping with a 5 s timeout, drive). It is idempotent, makes no writes, and anyone may run it.

## Never auto-install
A missing tool is reported with the exact command for the human to run with `!` (`! npm install -g @beads/bd`, `! sudo apt install bubblewrap socat`; `brew` on macOS). cadre does not run a package manager or `sudo`.
The one write `setup` can make is the user settings file. It is proposed as a diff and applied only by `/cadre setup confirm <code>`: a nonce-salted, burn-on-use code (`initPropose/initConfirm`, stage key 90, so an `init` code cannot confirm it), shown only on the band, the bytes re-read and compared with the diff the human saw, `.bak` of the old file, then `policy/settings.apply` (merge, re-read). A wrong code is burned.
On success (no failing row, nothing pending) it stamps `$.store cadre:setup {cc, bd, bwrap, jail, at}`. At `session.start`, no stamp or a different Claude Code build gives one toast: `cadre: run /cadre setup`.

## Output rules (DESIGN D2, need-to-know)
The command `{text}` is model-visible, so it is one line (`setup: 1 fail, 2 warn — report in the cadre pane`, `doctor: all ok`) with no mechanism words (`tests/doctor.test.ts` runs the wording lint on it). The full report goes only to human surfaces: the pane tab `doctor` (`ui['doctor.rows']`, tags `[OK]/[WARN]/[CRIT]`, UI-DESIGN §6.0) and `$.ui.log`.

## Known gap
The plugin's own version is not shown: a mod has no API for it, so the row is left out rather than guessed.
