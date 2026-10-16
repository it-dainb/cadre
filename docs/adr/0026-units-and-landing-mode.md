# 0026: workspace units, submodule landing, landing.mode (0.15.0)

Status: accepted (release/0.15.0). Design source: `.omc/plans/cadre-0.15.0.md` slices 5a, 5b and 6 (H7, H6).

## Context

One repository can hold several things that build and test on their own: packages of a monorepo, services, apps, git submodules. `packages` described the first kind only, a task named its package by hand, and the parent repository's checks ran with every submodule left empty. Plans also landed on dev only by a local merge, with no way to put CI or a reviewer in front of it.

## Decision

**Units.** `.cadre/config.json` `units` (else `packages`, the same as units of kind `package`): `{root, kind, ownGit, checks, verify, tdd, routing}`, kind `package | service | submodule | app`. `parse` names `units[i].field` in every refusal; init refuses a git submodule root without `ownGit: true`. A tester's adopted test command is the unit's `checks.test`, written into `units` when the file uses them.

**Tasks map to units by their declared paths.** The task's unit is its named package, else the first unit its paths lie in (the longest root). A task whose paths lie in two or more units is cross-unit: its squash runs every one's verify checks, one integration check. The path overlap and core-first rules use repository-relative paths, so they hold within and across units. A unit's `routing.<role>` `{model, effort}` beats the role's risk cell (Activity names `units <root>: routing.<role>`).

**Submodule units (`ownGit`).** The task's epic branch (cut from the submodule's dev on first claim), worktree, squash and baseline live in the submodule's own repository. At integration each changed submodule lands first: its epic branch merges into its dev through its own checks; then the parent's integration commit carries the pointer bump, so the parent's gates see it. The parent's checks never re-run an `ownGit` unit.

**Submodules are checked out where checks run.** Task, integration, landing, release and baseline worktrees check every submodule out at the commit the parent records, cloned from the main checkout's own copy (no network). A recorded commit that copy lacks refuses with one dialog naming it and the fetch to run; nothing lands.

**landing.mode `direct | pr`** (default `direct`, unchanged). `pr`: the plan's integration commit is pushed to `<landing.remote>` `cadre/land/<plan>` and ONE pull request into dev is opened (`gh auth status` first: without gh nothing is pushed); the plan waits as integrating. It is polled from the 5 s tick at most every 30 s: a failed check takes the red path, pending or (with `landing.review`) not yet approved waits, otherwise cadre merges it, fetches dev and lands there. A gh error backs off from 30 s, doubling to 10 min. Doctor names gh missing or signed out.

## Consequences

- `packages` keeps working as is; `units` is opt-in.
- A cross-unit task is gated green by its first unit and checked across all of them only at its squash.
- Submodule worktrees cost one local clone per worktree.

## Known limits (after 1.0)

- **pr mode with submodule units opens only the parent's pull request**: the submodule's own landing still goes straight onto its dev, and no pull request is opened in the submodule's repository.
- A submodule unit's own runner, concurrency and setup flow, and a units editor, wait for 0.16.
