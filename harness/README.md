# cadre live-smoke harness

Runs Claude Code **2.1.295** (installed by the official installer, build arg `CLAUDE_VERSION`) in Docker as a non-root user, with `bd`, `git`, `bwrap`.

Build: `docker build -t cadre-harness harness` (fast path: put a local binary at `harness/claude-2.1.295` first; it must match the image arch)
Run:   `harness/run.sh -p "prompt" --plugin-dir /work/spike --debug-file /out/x.log --model haiku --permission-mode bypassPermissions`
Shell: `SHELL_MODE=1 harness/run.sh -c 'bwrap --version; bd version'`

Mounted (nothing else from the host; credentials are never baked into the image):
- `~/.claude/.credentials.json` -> `/cchome/.claude/.credentials.json` (that one file only; read-write so token refresh works)
- `harness/state/projects` -> `/cchome/.claude/projects` (session transcripts, so `--resume` works across runs)
- `$SPIKE` (default: the repo root) -> `/work/spike`; `$WORK` (default `$TMPDIR/cadre-harness/work`) -> `/work/run` (cwd); `$OUT` (default `harness/out`) -> `/out`

Flags: `--user <hostuid>` (so the creds file is readable), `--security-opt seccomp=unconfined apparmor=unconfined systempaths=unconfined` (bubblewrap needs user namespaces and a fresh /proc under --unshare-pid; Docker masks /proc otherwise; see ADR 0001).

Install from the marketplace instead of the checkout: `CADRE_SOURCE=marketplace [CADRE_REF=<branch|tag>] harness/run.sh -p "..." --model haiku` (no `--plugin-dir`; runs `claude plugin marketplace add it-dainb/cadre[#ref]` + `claude plugin install cadre@cadre` in the container first; needs network). Same env for `tui.sh start`.

## Interactive TUI (tmux): `tui.sh`

For long-lived behaviour and composer/pane smokes (typed `/cadre …`, `/clear`, `--resume`, pane keys) that `claude -p` cannot reach. The image has `tmux`; `tui.sh` starts a detached container (same mounts as `run.sh`, but per-instance `projects` so transcripts never mix with other runs), starts `claude --plugin-dir /work/spike --debug-file /out/debug.log` inside a tmux session of a fixed size, and drives it with `docker exec … tmux`.

```
SCAFFOLD=<script run in the empty scratch dir> COLS=120 ROWS=40 MODEL=haiku harness/tui.sh start <name>   # prints "ready"
harness/tui.sh send <name> '/cadre status'            # types the text, then Enter  (type = no Enter; keys = tmux keys: Up Enter C-u Escape)
harness/tui.sh wait-for <name> '<regex>' [secs] [pane|jsonl|debug]   # exit 0 + the match, 1 on timeout
harness/tui.sh capture <name> [file]                   # pane text;   jsonl <name> / debug <name>: transcript / debug-log paths
harness/tui.sh resize <name> 60 40                     # re-run the layout at another width
harness/tui.sh stop <name>                             # evidence stays in /tmp/cadre-tui/<name> (TUI_DIR)
```
Layout of `$TUI_DIR/<name>/`: `plug/` (the plugin = `git archive HEAD` of `cadre/`), `work/` (cwd, the scaffolded repo), `projects/` (session transcripts, subagents under `<session>/subagents/`), `out/debug.log`.

First-run dialogs: `~/.claude.json` is pre-seeded (onboarding done, dark theme, `/work/run` trusted) so none appear with `--permission-mode bypassPermissions`; `start` still answers any trust/theme/accept prompt with Enter (the bypass-mode warning gets Down+Enter) until the composer shows, and fails with the pane text if it never does.

Notes: the pane (`/cadre open`) docks beside the transcript at 120 cols and sits inline at 60; hotkeys (`a`, `x`, arrows) work only while the pane is focused, which `/cadre open` requests when the composer is empty. A bare digit `1` in an empty composer presses the band. `wait-for … jsonl` greps the concatenated transcripts (all sessions of that instance). Graders/drivers used for ADR 0005: `docs/evidence/live/tui/` (local-only, gitignored).
