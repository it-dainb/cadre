# Counters

The `counter` of a flag effect (`retry`, `reset`) is a runtime budget key of `core/lifecycle.ts` (`Budget`, line 131): `retry(h, task, name)` sets it back to 0 (or to a value, `more:1`). The config key is what caps it. Verified against `config/defaults.ts:36` and the call sites at v1.0.1 (d0f4cc0).

| Effect `counter` | Config key (default) | In profile `limits`? | Where it is charged and capped |
|---|---|---|---|
| `rebase` | `limits.rebaseRounds` (2) | yes | charged `rebase.ts:55`; cap `rebase.ts:42`, `close.ts:344`; `more:1` grants `rebaseRounds - 1` (`close.ts:465`) |
| `shapeRefusals` | `limits.shapeRetries` (6) | yes, as `shapeRetries` | charged and capped `tools/index.ts:81`; the runtime name differs from the config key |
| `silentRuns` | `limits.silentRuns` (3) | yes | charged and capped `close.ts:247-250` |
| `nudges` | `limits.nudges` (1) | yes | charged `close.ts:265`; the cap test reads the run's own nudge count (`close.ts:264`), the budget value is a task tally. `stagnantNudges` (3) is a separate key on the run's `stag` (`close.ts:263`), not a budget counter |
| `red` | runtime-only; cap `limits.testerRounds` (3) until S5, then the tester step's `onFail.retry` | no | charged `close.ts:218`; reset `tdd.ts:361` |
| `rework` | runtime-only; cap `review.maxRework` (3) until S5, then the reviewer step's `onFail.retry` | no | charged and capped `close.ts:174` |
| `startFails` | `limits.startFails` (3) | yes | charged and capped `spawner.ts:136`; not a flag-effect counter |
| `refusals` | none | no | charged `tools/index.ts:76` (a refused report); the per-run tries are on the run, not capped by config; not a flag-effect counter |
| `epoch` | none | no | charged `lifecycle.ts:94` (one per spawn, the wake key); never reset, not a flag-effect counter |

Keys that are not counters of any effect and stay engine limits: `limits.reportRetries` (3, `tools/index.ts:95`), `limits.limitWaitMinutes` (15, `drive.ts:212`).

`cadre.specAccepts` (task meta, `close.ts:402-405`) is not a budget counter. Its cap is the literal `2` at `close.ts:403`; the 2.0 profile makes it `limits.specAccepts` (default 2, `types/profile.ts`).

Effect counter names a profile may use: `rebase`, `shapeRefusals`, `silentRuns`, `nudges`, `red`, `rework`.
