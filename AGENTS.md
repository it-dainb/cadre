# Rules for working on cadre

## Need-to-know: what a model reads
cadre runs Claude (main) and task agents (tester, worker, reviewer, explorer). They see only text about **their task**: ids, files, scenarios, checks, what to do next. They never see how cadre itself works or how it was built.

**Model-visible text** = anything a model reads: briefs and prompts, context lines, tool results, Task* answers, result cards, nudges, deny and refusal reasons, the guides in `guides/`, agent files in `agents/`, and every file written into an agent's view or worktree (`SCENARIOS.md`, `INTERFACE.md`, `FILES.md`).

### One exit
Every model-visible string goes through `core/say.ts`: `modelText(kind, text)` for a string, `modelData(kind, value)` for a structured answer. Do not hand text to a model any other way.
- `node scripts/budget.mjs` scans the product code. Any `submit`, `sendTo`, `{ deny: … }`, `reason:`, `{ result: … }`, `context: [`, `messages: [`, `prompt:`, `h.write(\`${view}…` or rewritten `text:` line without `modelText(`/`modelData(` fails the gate, and `tests/model-text.test.ts` fails with it.
- In tests, `tests/support.ts` makes every `modelText()` call a lint check, so a test that produces a leak fails. You don't list new strings anywhere.

### Banned in model-visible text
- The machinery: mod, hook, harness, sandbox, fence, quarantine, jail, L1/L2/L3, `cadre:`.
- cadre's development: ADR, version numbers (`0.8.0`), "live 0.x", kit, M0, smoke ids (`S13`), catalog, d.ts, paths into cadre's source (`core/…ts`, `docs/adr`).
- Typed commands that no longer exist: `/cadre resolve|approve|release|…`. The human answers decisions in the cadre dialog.
- Absolute host paths (`/home/…`, `/tmp/…`).
- Lane words (lite, full lane, lanes) in anything a **task agent** reads. Main may see them: they are its planning API (`TaskCreate` metadata `lane`).

The list is `LEAK`/`LANE` in `core/say.ts`; the tests use the same list.

### Where the reasoning goes
Why a text says what it says (an ADR, a live finding, a version) goes in a **code comment** or an ADR, never in the string. Write the string in task language: what to do, in plain words.

### Before a push
Run `node --experimental-transform-types scripts/model-text-diff.mjs [range]` and read every text it lists. A `!` line is rejected by the lint.

## Releases
- A release needs the quick tier green: `harness/matrix.sh quick` against the release commit (it prints the cost and time first). Paste its table into the release ADR.
- The live tester is not the builder: whoever built a feature does not judge its live run. The oracle (`harness/oracle.mjs`) judges each cell from the logs; a person reads the table, not the panes.
- A user report that the matrix did not catch becomes a fixture, a scenario step or an invariant in `harness/` first (see `harness/README.md`), then the fix.
