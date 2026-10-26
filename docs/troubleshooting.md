# Troubleshooting

Start with `/cadre doctor` (read-only, safe any time). Its rows are in the pane's Doctor tab; each failing or warning row ends in a fix. This page lists every fix, grouped by symptom, then the events you meet while a plan runs.

```text
symptom ──▶ /cadre doctor ──▶ row + fix ──▶ do the fix ──▶ /cadre doctor again
                                  │
                                  └─ a sudo fix is a script: read it, run the one line shown
```

cadre never runs root commands for you. `/cadre setup` writes each sudo fix to `~/.cache/cadre/fix/` (mode 0700, with a header saying what it does); Doctor shows the line once the script exists.

## The machine

| Row says | Do this |
|---|---|
| git not found, or git older than 2.17 | `sudo sh ~/.cache/cadre/fix/git.sh` |
| bwrap not found: checks run unjailed | `sudo sh ~/.cache/cadre/fix/bwrap.sh` |
| socat not found | `sudo sh ~/.cache/cadre/fix/socat.sh` |
| bwrap is blocked by AppArmor (Ubuntu 24.04+) | `sudo sh ~/.cache/cadre/fix/bwrap-apparmor.sh` lets only bwrap create user namespaces; the safest fix. Alternatives are in `~/.cache/cadre/fix/README` and are less safe. |
| bwrap cannot create a user namespace (`unprivileged_userns_clone=0`, Debian) | `sudo sh ~/.cache/cadre/fix/userns-clone.sh` |
| bwrap cannot create a user namespace (cause unknown) | `see https://code.claude.com/docs/en/sandboxing` |
| a sudo fix row says to prepare it | `run /cadre setup to prepare the fix` |
| git identity missing | `ask for them, then git config --global user.name and user.email` (Claude asks you; cadre never makes up an identity) |
| worktree root is not writable | `set worktrees.root in ~/.claude/cadre.json, or fix the permissions` of the folder shown |

## Claude Code version

| Row says | Do this |
|---|---|
| cadre needs Claude Code 2.1.295 or newer | `claude update` |
| Claude Code X: newer than the tested 2.1.295; usually fine | Nothing to do. cadre has no compatibility freeze: a newer build may break it, see [compat](compat.md). |
| an agent that is done is ended by cadre itself; that is tested up to Claude Code 2.1.299 | Nothing to do; an agent that stays stuck is a bug to report. |
| Claude Code refused cadre's tools | `cadre needs its tools: drop allowedMcpServers from managed settings, or start Claude Code without --bare` |
| the planning tools load at Claude's next turn | `send Claude any message; if they stay missing, restart Claude Code` |
| the built-in task tools are on in this session | `/cadre init, then restart Claude Code` |
| tools Claude Code gave the agents that cadre does not know | Information: each call is judged like any other. |
| custom role X is not available: | Information: the role was refused or rejected twice; fix its definition in the settings. |

## This project

| Row says | Do this |
|---|---|
| project: not set up here | `/cadre <goal> sets it up` |
| not inside a git repo | `/cadre init` |
| init incomplete · containment degraded · task store journal off · branch missing · settings.local lacks the task-tool gate | `/cadre init` (restart Claude Code after its confirm) |
| task store: ... · task store unreachable | `cadre stays off here: put the project on a disk with hard links` (not exFAT, some network mounts) |
| `.beads` (or `.cadre/store`): a task store from an older version | `finish its plans with that version, then delete .beads` |
| run and sync state from an older version is not read | `finish those plans with that version; sync starts over from a full compare` |
| finish or cancel plans from the previous version before upgrading | `its run state is not read: finish or cancel those plans with the previous version` |
| landing.mode is pr but gh is not installed | `install the GitHub CLI (gh), or set landing.mode direct` |
| landing.mode is pr but gh is not signed in | `gh auth login` |
| cadre is not set up here, but its task-tool settings remain | `press 1: remove them in the dialog` |
| user settings carry env CLAUDE_CODE_ENABLE_TODO_TOOLS from an older cadre | `press 1: remove it in the dialog` (Confirm writes a `.bak` first; Keep it if the flag is yours) |
| user settings unreadable | `fix ~/.claude/settings.json by hand` |
| cadre started only in part this session | `restart Claude Code; if it repeats, report it with /cadre doctor` |
| the cadre pane could not open | `run /cadre to open it; if it keeps failing, report the reason` |
| setting refused: file: key: expected ... | `fix it in Settings (9) or in that file` |
| an environment variable puts every agent on one model or effort | `unset the variable to use the Settings values` |
| drive.spawn: a non-interactive session ... | `run Claude Code interactively for cadre to start the agents` |

## While a plan runs

| Row says | Do this |
|---|---|
| open flags | `press 1: answer it in the dialog` |
| blocked by malformed reports (over limits.shapeRetries) | `press 1: Retry starts the agent again` |
| quarantined ref(s) | `press 1: keep or restore in the dialog` |
| expired leases | `main spawns them again; they rebind` |
| resume(s) queued | `they are sent at the next turn` |
| drive stopped | `press 0 on the band to resume` |
| drive paused | `it continues by itself after you answer` |
| sync X: ... | `/cadre sync now` |

## Events you will meet

- **Blocked flags.** A task flagged `conflict`, `drift`, `integration-failed`, `lost-*`, `git:*` or `quarantine` blocks merges until you answer its dialog (press `1`). Under yolo only these still ask.
- **Keep going / Cancel task.** An agent stopped for good (`attempts`, `no-report`, `stagnant`, `stale`, `loop`, `blocked`). **Keep going** starts the task again with a fresh agent from the last checkpoint; **Cancel task** ends it and the rest of the plan goes on.
- **Already holds.** The red dialog: the tester's test passed at red for named scenarios. **Already holds** records that they hold already (a plan amendment, ledger kept) and a new tester continues; **Retry** fixes the cause and tries red again; **Cancel task** ends it.
- **Usage limit.** The run stops with the reset time on the band (`usage limit until HH:MM UTC`), goes on by itself then, and charges nothing to the task. `0: resume` goes on at once.
- **`<plan> is running in another session`.** Another live session holds the plan. Continue it there, or quit that one, then `/cadre continue` here; a session that crashed frees it within 30 s.
- **Unfinished plan after a quit.** `/cadre continue` (or `0` on the band) respawns each task that was in flight from a checkpoint commit.
- **Your branch is checked out when work lands.** cadre leaves it alone and asks: **Land** brings the work in, keeping your commits and uncommitted edits.
- **Revert refused.** The code says why: `revert-of-revert`, `already-reverted`, `not-landed`, `busy`, `pr-mode`, `unknown`.

More known limits: [limitations](limitations.md).
