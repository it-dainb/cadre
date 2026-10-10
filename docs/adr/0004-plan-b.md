# ADR 0004: Tester confinement Plan B

Status: **not needed** · Date: 2026-10-10 · Design: `docs/design/DESIGN.md` v2.5 §3.5, §16.1 A22

## Context
Plan B (DESIGN §3.5) was the fallback if the normalized per-tool input fence could not confine the black-box tester to its spec view.

## Decision
Not adopted. Smoke **S45** passed ([ADR 0001](0001-m0-results.md)): with the §13.2 fence (per-tool input fields, `$.fs.stat` `realPath`, segment-aware root), Read of `../secret.txt`, an absolute outside path, a symlinked file, a symlinked dir and Write via `view/../w.txt` were all denied; in-view Read/Write were allowed.

`Grep` and `Glob` do not exist in Claude Code 2.1.295 here (`$.tool.list()`), so the absolute-pattern risk behind A22 does not arise. The tester allowlist is Read, Write, Edit.

## Re-open when
`$.tool.list()` ever lists `Grep` or `Glob`. First re-run S45 with Glob `../` and `{a,../b}` patterns and absolute patterns; adopt Plan B only if any escape works.
