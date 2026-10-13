# 0019: settings registry: every behaviour a setting, by category, transparent and enforced

Status: accepted (0.11.0). User requirement 2026-10-13: every behaviour cadre has is a setting, grouped by category, transparent (the effective value and where it came from) and enforced (the running code uses it, proven by tests).

## Decision

**One registry.** `config/defaults.ts` holds `defaults()` (every default value, and the `Config` type) and `REG` (every key's metadata): category, layer class (S safety: a repo file may only tighten it · U user-level only · O ordinary), one-line description, allowed values (`opts`, `min`/`max`, or a check `ok`), the repo tighten rule (`bool|enum|list|min|grow`), and `open` for free-form objects (`types`, `packages`, `adapters`, `sync`, `cost.prices`). `safety` = class S or a tighten rule. REG replaces the old `CLASS`/`TIGHTEN`/`ENUM` tables. A test pins REG to the leaves of `defaults()` 1:1, so nothing has a default without metadata or the reverse. Default values live only in `defaults()` (a flat table cannot carry the inferred `Config` type the code relies on).

**Categories.** Drive and autonomy · Parallelism · Models and effort · Review · Planning · Git and branches · Checks and TDD · Safety and containment · Cache and context · Task store and sync · UI.

**Layers** (unchanged order): defaults → `userConfig` → `~/.claude/cadre.json` (+ `repos[<repoKey>]`) → repo `.cadre/config.json` → env (`CADRE_STRICTNESS`, `CADRE_STORE`, `CADRE_DISABLE`). **Validation:** an unknown key, a wrong type or a value outside the key's allowed values is refused per key with a diagnostic that names the file, the key and what is expected; the rest of the file still applies. Doctor lists every refusal.

**One read path.** `config/index.cfgOf(h)` is the only way code reads config (`core/dispatch` re-exports it; `h.config` in `hooks/register` is the same load; hosts without it load the layers in `cfgOf`). `tests/protocol/settings-registry.test.mjs` fails on (a) a read of a key that is not registered (`cfg.x.y`, `d.cfg.x.y`, `(await cfgOf(h)).x.y`), (b) a registered key that nothing reads, (c) a bypass: `h.config()`, `load`/`layersOf`/`resolve`, config `defaults()` or a settings-file parse outside an allow-list of writers with the reason for each (prefs and init and sync write the files after a confirm card; `/cadre config show` diffs against the defaults; the drive hashes the file bytes to notice an unapproved change).

**Provenance.** `rows(layers, env)` gives each key its effective value and source: `default · user · repo · env · forced · fixed`. `forced` = a Claude Code variable beats cadre (`forcedOf(env)`): `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` puts every agent on `CLAUDE_CODE_SUBAGENT_MODEL` (or main's model) and marks every routing `…model` key; `CLAUDE_CODE_EFFORT_LEVEL` marks every routing `…effort` key. `CLAUDE_CODE_SUBAGENT_MODEL` alone is only a default that cadre's spawn model beats (Claude Code docs, sub-agents "Choose a model"), so it is not forced; admission recorded it as forced before, now fixed. `fixed` rows show invariants (below) with their value, not editable.

**Surfaces.** Settings tab (9): rows in category order; the selected row shows its default, a `!` warning when an env var overrides it, the layer rule and the description. Doctor: refused values and env overrides (warn), then every key with value and source, non-default first, then the fixed rows. UI cost: 897/900 lines (the old hand-written group mapping and per-key notes went away), no cap change.

**Changing settings.** Unchanged channels, now validated by the registry: the Settings edit card (a decision: Save for me → `~/.claude/cadre.json`; Save to repo → `.cadre/config.json`, O keys only), setup's preferences card. cadre writes the files after the human's press (`.bak`, write, re-read); Claude never edits `~/.claude/cadre.json` (guarded). One exception is kept (user decision): during a human-started `/cadre init` run (the maintenance lease) Claude may write `.cadre/config.json`, which is how init's package list gets there. After every write cadre re-validates the file against the registry (`config/index.repoFileDiag`: unknown keys, bad values or types, a safety key loosened, a user-level key) and fails loud through the setup mechanisms: a red "settings file" check naming each key and why, the "setup still open" line on the next tool result, the follow-up, and the stop refused while it is red. Outside an init run (a setup run included) the guard refuses Claude's writes to it and says the user changes settings in the Settings tab.

**Save to repo** (the edit card): O keys, and S keys tighten-only (user decision). Any key with a tighten rule (S keys and `review.tiers.*`) may be saved to the repo only with a value stricter than, or equal to, its value from the layers below the repo file (defaults and the user's file): the card names that value and, for an enum, the stricter options; a looser value is refused with the reason. U keys never go to the repo file. Confirm (the card's press) is required as for O keys.

## Routing is explicit (team lead, 2026-10-13: no implicit routing)

Every routing decision is a registered key; `core/risk.route` reads only the one cell it is given.
- **Cells.** `roles.<worker|tester|reviewer>.byRisk.<light|standard|thorough|core>.{model, effort, escalate.{after, model, effort}}` (60 keys) and `roles.explorer.{model, effort}`. Models are aliases (`haiku|sonnet|opus|fable`), so the Settings tab shows the model itself. The tier names and the `models` map (`fast/standard/deep`) are gone, and so is the rule "a thorough review goes to the deep tier". ADR 0016's floor ("the reviewer is never below sonnet") is now the reviewer cells' allowed values (no haiku), refused at load.
- **Defaults** are ADR 0017's locked table, written out: worker haiku/high escalating to sonnet/high after 1 failed round at every risk; tester light haiku/high, else sonnet/medium; reviewer light/standard/core sonnet/high, thorough opus/high; explorer haiku/low.
- **Risk classification** (`core/risk.riskOf`, settings `review.*`), first match wins: a task of the core epic (`review.coreTask`, default `core`) · a `review.deepLabels` label (thorough) · a diff that touches the landed core's paths (`review.coreDiff`, default `thorough`, ADR 0017's "opus/high when a dependent touches the core") · a `review.tiers.risky` glob (thorough) · size: at claim the declared paths (at most `review.tiers.light.paths` = light, else standard), at review the diff (`review.tiers.light.files/lines`, `review.tiers.thorough.files/lines`). The worker and tester take their risk at claim, the reviewer at review. The unregistered `cadre.risk` task meta override is removed.
- **Visible.** Every spawn records `setting` (e.g. `roles.reviewer.byRisk.thorough`, or `….escalate`) on `cadre.runs` and `agent.bound`; the Activity line reads "<task> reviewer on claude-opus-5-5/high · roles.reviewer.byRisk.thorough": the id Claude Code resolved the alias to (its agent.spawn result, recorded as `ran`), else the alias; or "forced by your environment". The Settings tab shows a cell as `<role>.<risk>.<field>` in the Models and effort section; the edit card names the full key. turn.step applies only the effort admission recorded on the binding (no fallback read).
- **Proof.** `tests/admission.test.ts` "routing cell roles.<role>.byRisk.<risk>": for all 12 cells, a task of that risk spawns its agent on exactly the cell's model and effort, then on the escalation's after a failed round, and the bound event names the key. `tests/settings-behaviour.test.ts` probes all 5 fields of every cell. The harness `routing` invariant checks every live agent request against the cells (harness/expect-routing.mjs).

## Enforcement proof

- `tests/settings-behaviour.test.ts`: one probe per key runs the real code path (route, riskOf, laneOf, boundOf, stale, session.start's policy and ui mirror, wake, modeOf, doctor's probes, …) with the defaults and with that key changed; the results must differ.
- Keys whose effect needs a full flow are proved by named scenario tests (`tests/fixtures/settings-proof.ts`; the static test checks each named test exists): `limits.*`, `review.maxRework` (git close tests), `release.onEpicDone`, `suites.integration` (git integrate tests), `review.deepLabels` and the FORCE recording (admission), `drive.mode`, `maxParallel`, `milestone.maxEpics`, `roles.testerView`, `roles.tdd.author`, `packages`, `adapters`, `sync`.
- Plumbing only (one read with no smaller entry point, listed in the test): `cost.clearHintPct`, `cost.compactPct` (core/reuse.drain toasts), `store.kind`, `store.timeoutMs` (hooks/register `wire.store`, which tests replace).
- Harness: `PROXY=1` cells log each request's model and effort (`bench/effort-proxy.mjs`); oracle invariant `routing` fails when a worker/tester/reviewer/explorer request runs on a model or effort outside what `harness/expect-routing.mjs` computes from the cell's settings with cadre's own code. Quick tier: `continue-after-quit` (the cell that runs a whole plan). Ceiling: per role, not per task (a request carries no task id).

## Made settings (were hard-coded)

`limits.nudges` (2), `limits.attempts` (3), `limits.rebaseRounds` (2; task reworks onto a moved tip and epic resolve rounds), `lanes.fullAt` (3), `lanes.milestoneAt` (8), `ui.notify` (on), `ui.escalateAfterMs` (120000). `limits.reportRetries` was silently capped at 3; its range is now 1..3. ADR 0017's locked routing is the default, every cell written out (see Routing is explicit).

## Fixed in their effect (were registered but did nothing)

`disable` / `CADRE_DISABLE` was never read: now a repo stays dormant from the next session. `jail: on` behaved like `auto`: now checks refuse to run without the isolated runner.

## Removed

Dead keys: `store.pollMs`, `store.dir` (the store folder is found by the store layout), `maxRows`, `drive.level` (only `epic` exists). Replaced by explicit cells: `models.*`, `roles.<role>.{tier, effort, byRisk (free-form), escalate.{after, to}}`. A file that still sets one gets an "unknown key" diagnostic.

## Fixed invariants (not settings) and why

| what | value | why fixed |
|---|---|---|
| setup/init lease (`policy/guards.LIMIT`) | 20 turns / 30 min, 3 follow-ups | bounds the only window where Claude may edit setup files; a knob would widen Claude's write access (shown as `fixed.setupLease`) |
| protected paths (`core/git.PROTECTED`) | `.git/ .cadre/ .beads/ .claude/ .mcp.json CHANGELOG.md` + `changelog.path` | no task agent may change cadre's state, settings or the changelog cadre writes (`fixed.protected`) |
| settings-file guard | Edit/Write on `.claude/settings*.json` and `~/.claude/cadre.json` denied | cadre writes those after a confirm card; Claude never does |
| per-role tool allowlists (`agents/index`) | fixed per role | capability boundary; `mcpAllow` is the one knob (S, tighten-only) |
| draft field refusals (`core/validate.RETRIES`) | 3 | the TaskCreate protocol with main (`fixed.draftRetries`) |
| drive lease (`core/drive.LEASE`) | 10 min | when a silent session's drive may be taken over (`fixed.driveLease`); correctness, not tuning |
| model-visible text lint (`core/say`) | — | the boundary rule for what models read |
| liveness and housekeeping timers | session alive 30 s, event ring 500, sync heal 15 min / lease 90 s / tick 30 s / backoff 5 min, yolo goal hand-off 1 h, setup checklist quiet 1 / 10 min | protocol timing between sessions and the tracker; no user-visible trade-off |
| epic size in a roadmap (`core/validate`) | 1..7 tasks | the roadmap contract main plans against; `lanes.milestoneAt` decides when one plan should become a milestone |
| branch slug (`core/branches.slug`) | 24 chars | existing branches are found by name; a change would orphan them |
| check / setup process timeouts | 10 min, view 2 min | hang guards on jailed processes; raise on evidence |
| notification rate limits (`ui/notify`) | 1 toast / 8 s, 3 desktop / 15 min | anti-spam; `ui.notify` turns desktop notifications off |
| agent prompt-cache TTL (`agents/*.md` `experimental.cacheTtl`) | 1h | shipped agent files are pinned per plugin build; `reuse.cacheTtlMs` (when an idle agent is no longer reused) is the matching knob |
| UI layout tokens (`ui/tokens`, column widths) | — | design system, not behaviour; `ui.glyphs`, `ui.density`, `ui.flash` are the knobs |
| pinned Claude Code build in doctor | 2.1.295 | what cadre is tested against |
