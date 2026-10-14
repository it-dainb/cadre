# 0023: the tester proposes the test command, cadre verifies it

Status: accepted (feat/test-command). User decision: "Tester proposes, cadre verifies".

## Context

Red ran only the package's configured check. A package with no test check (only `compile`, say) could never prove red: 0.12.1 looped the tester on "the tests pass" though they never ran, and 0.12.2 (fix/red) turned that into a setup block with one dialog. That still needs the human to write a test command into the config before any TDD task can start. The tester, who just wrote the tests, knows how they run; it has no shell and should not get one.

## Decision

**The report carries `run`.** A tester report may add `run: {command: string[], junit?: string, cwd?: string}`: the argv (no shell) that runs only its test files, `cwd` relative to its test folder. `validate.runShape` refuses a non-list, a shell or file/git/network tool as `argv[0]`, and a `cwd` that is absolute or climbs out. The tester brief asks for it in task language (`briefs.RUN_ASK`, only when `tdd.testerCommand.use`), including the JUnit hint: write the report to `$CADRE_JUNIT`.

**cadre runs it.** `tdd.runTests` runs the argv exactly like a check (`G.checkRun`: overlay or copy sandbox, writes discarded, no network, 600 s timeout) in the task worktree at the spec commit (tests in, no implementation). `$CADRE_JUNIT` is set in the environment and substituted in the argv (there is no shell to expand it); it points into the run's scratch (`/tmp/cadre/junit.xml` inside the sandbox). Output is scrubbed of absolute directories before any of it reaches the tester. Only what the argv policy refuses is refused; the sandbox is the protection, as for checks (the tests themselves are code the checks run anyway).

**Red** (`tdd.redRun`): exit ≠ 0, and
- with a JUnit report: every reported test is present and a `failure` (an `error` only under the existing `errorOk` rule: it names a `status:new` contract symbol and there is no skeleton);
- without one: some output line names each test and says it failed (`not ok`, `FAIL`, `failed`, `✕`, …). A runner that prints neither should write JUnit;
- a line matching `tdd.collectErrors` (pattern order is priority) means the tests did not run: the report is refused with "the tests did not run: <line>". This is a normal refusal, bounded by `limits.testerRounds`, then the red dialog. An import error that names a new contract symbol is the right red (as an `<error>` is).
The test type keeps its rule: the command must pass.

**Adoption.** When the package has no `test` check (and no `tdd.check`) and `tdd.testerCommand.adopt` is on, a verified red makes the command the package's `test` check: the task's own test files are dropped from the argv when they are separate arguments (pytest `file::test` ids too), `$CADRE_JUNIT` becomes the package's `tdd.report` (default `/tmp/cadre/junit.xml`, set when JUnit is used), `verify` gains `test` when it is set and lacks it, and the package gets `testBy: "tester"`. cadre writes it to `.cadre/config.json` itself (never Claude; the settings guard still refuses Claude's writes), records a beads decision "test check set from the tester: <cmd>" and emits `drive.decided {kind: setting}` (Activity, Doctor). Settings shows the `packages` row's source as `tester`. It happens once: the next task finds the check. A command with `cwd` is not adopted (a check has no cwd and no shell to change it).

**When a test check exists** cadre still runs the tester's command for red; green and integration use the configured checks.

**Green.** The worker's gate runs the tester's command first (meta `cadre.testRun`), now expected to exit 0 with every spec test passed in its JUnit, then the package checks as before. With the tester's command the spec-test check reads its JUnit, not the configured check's (the names are its runner's).

**No command and no test check** stays the setup block with one dialog (fix/red).

## Settings (registered, ADR 0019)

`tdd.testerCommand.use` (on), `tdd.testerCommand.adopt` (on), `tdd.collectErrors` (pytest, node, jest, go setup-failure patterns; must be valid regular expressions). Proved in `tests/git/tdd.test.mjs`.

## Tests

Kit: `tests/testcmd.test.ts` (schema, envelope refusals, brief section, collect lines, Settings source). Real git + real sandbox, node:test fixture: `tests/git/tdd.test.mjs` (JUnit red + adoption once + decision + green; red without JUnit; collection error named, no host path, through `report`; passing tests refused; the three settings). The test file unsets `NODE_TEST_CONTEXT`: under `node --test` a nested `node --test` reports to the parent and exits 0.

## Owed (live)

Not run (quota): a live tester actually producing `run` for a node and a python project; the adopted check visible in Settings/Activity in the pane; pytest/jest/go output against the default collect patterns on a real failure.
