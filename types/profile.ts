// cadre 2.0 profile types (plan cadre-2.0 §2.2-2.5, 2.7, 2.8). Types only, no loader: the S0 contract the S2-S5 slices build against.
// Lines marked `S0 gap` extend the plan's text where the real-script dry run found a branch the plan's shape cannot express (ADR 0031, Slice 0 findings).

export type Profile = {
  schema: 2
  types: Record<string, TypeSpec>
  steps: Record<string, Step>
  roles: Record<string, RoleSpec>                 // work roles; planner/specifier are core planning roles, outside this table
  checks: Record<string, CheckSlot>               // slots only: how a named check is interpreted; argv come from units[].checks / the tester's run
  flags: Record<string, FlagSpec>
  hooks: Partial<Record<HookEvent, Hook[]>>
  landing: Landing
  protected: string[]                             // globs nobody but the human edits (beyond the fixed .git/ .cadre/ .claude/ .mcp.json)
  sandbox: { env: Record<string, string> }        // `${NAME}` over the closed set MODULES TMPDIR UID WT PATH id title version
  fields: Field[]                                 // task fields incl. planner-declared `lane` and `risk`
  limits: Limits
}

export type ProfileLayer = Partial<Profile> & { schema: 2 }   // a built-in profile other than the default, or a user/repo layer: the sections it names (flags are merged under the default's rows by kind)

export type Landing = {
  provider: string                                // 'direct' | a module path
  onEpicDone: 'propose' | 'auto' | 'off'
  prepare?: string                                // check slot run once per touched unit before the suites; default profile 'setup'
  suites?: string[]                               // check names per touched unit; absent = all of the unit's checks
  baseline: 'tolerate' | 'strict'
  args?: Record<string, string | boolean>
  envPass?: string[]                              // env names the provider module may inherit (D20)
}

// engine counters not tied to a step. Counter names an effect may use: docs/counters.md
export type Limits = {
  reportRetries: number; shapeRetries: number; nudges: number; stagnantNudges: number; silentRuns: number
  startFails: number; limitWaitMinutes: number; rebaseRounds: number
  specAccepts: number                             // S0 gap G4: today a literal `n >= 2` at close.ts:403, listed in plan 2.11 but missing from 2.2 and 2.5a
}

export type CheckSlot = {
  network?: boolean                               // true = writable, network-on jail (default profile: `setup` only); absent/false = offline overlay jail
  failExit?: number[]                             // exit codes meaning "the work fails" (default [1]); any other non-zero = the check is broken
  timeoutS?: number
}

export type TypeSpec = {
  pipeline: string[]                              // step ids
  lite?: string[]                                 // alternate pipeline when the task's lane is `lite`
  acceptance: { format: string; cover: 'results' | 'report' | 'none' }   // format = one prose line; items are {id, text}
  contract: 'required' | 'none' | { schema: 'text' | 'json' }
  rubric?: string
  branch?: string                                 // plain branch prefix, no type semantics
  commit?: string                                 // S0 gap G5: plain subject prefix of the landed task commit (today TypeSpec.commit: docs-task cell asserts a `docs` commit)
}

export type Section = 'description' | 'acceptance' | 'contract' | 'locked' | 'diff' | 'deps' | 'handoff' | 'notes' | 'findings' | 'decisions' | 'question'
export type OnFail = { retry: number; then: 'human' | 'cancel' | { back: string } }   // the retry count lives here; exhausting raises the step's flag

export type Step =
  | { role: string; workspace: 'none' | 'worktree' | 'view'; brief: Section[]; locks?: { acquire?: 'out'; enforce?: 'in' }; onFail?: OnFail }
  | { gate: string /* a profile.checks name, or a builtin: 'integrate' | 'report' */; expect: 'pass' | 'fail'; on: string; onFail?: OnFail }

export type Outcome = 'done' | 'blocked' | 'spec_change' | 'pass' | 'fail'
// S0 gap G3: today's report schema caps every value (summary 800, reviewer summary 1500, lists 5..100); a shape refusal is "over its cap". Caps are data, per field.
// number = max length / max items; `of` = what each list item is (absent: an object); `command` = the tester's run {command:[argv], cwd?}, checked as a test command
export type FieldKind = 'text' | 'list' | 'bool' | 'object' | 'command' | { enum: string[] } | { text: number } | { list: number; of?: FieldKind } | { object: Record<string, FieldKind>; required?: string[] }
export type RoleSpec = {
  description: string; prompt: string             // built-in prompt text stays in agents/prompts.ts, referenced by profiles/default.ts
  tools: string[]; disallowedTools?: string[]; network: 'on' | 'off'; write: string[]; mcpAllow?: boolean   // mcpAllow: the user's mcpAllow tools are added to this role's list (worker)
  model?: string; effort?: string; maxTurns?: number; ttl: '5m' | '1h'
  // S0 gap G1: nudge = nudge, then block with a `no-report` flag (worker, tester); retry = nudge, then end released with no flag and no silentRuns charge (reviewer: a verdict is never invented);
  // block = no nudge, block at once
  onSilent: 'nudge' | 'block' | 'retry'; nudge?: string
  report: {
    outcomes: Outcome[]
    fields: Record<string, FieldKind>
    required: string[]                            // always required, besides the outcome (the field `outcome`, or `verdict` when the role has one; none when `outcomes` is empty)
    requiredWith?: Partial<Record<Outcome, string[]>>   // S0 gap G2: required only with that outcome (today WHY: reason with blocked/spec_change, scenario with spec_change); a text field must not be blank
    ask?: Record<string, string>                  // the refusal line after `<field>: ` for a missing or blank field (`{outcome}` = the report's outcome); default `required; add it and report again`
  }
  verdict?: { pass: string; fail: string; findings?: 'files' | 'text' | 'none' }
  rubric?: string
  routing?: Record<'light' | 'standard' | 'thorough' | 'core', { model: string; effort?: string }>
}

export type Field = {
  name: string; store: 'meta' | 'brief'; required: boolean | string[] /* type names */; want?: string
  kind?: 'text' | 'bool' | 'ids' | { enum: string[] }   // S0 gap G6: value type (breaking: bool, holds: ids of acceptance items, lane/risk: enum); absent = text
}

// flags (2.5): one table row per flag kind; effects are a closed set, run in order, no branching
export type FlagSpec = { why: string /* modelText */; options: Option[]; holds: boolean; blocks?: boolean /* stops a claim and a release until resolved (1.0.1's BLOCKING set); holds is drive's */; yolo: 'main' | 'human'; tab?: 'epic'; target?: 'task' | 'plan' | 'epic' | 'ref' }
export type Option = { key: string; label: string; effect: Eff[] /* 1-6 */; needs?: 'ids' /* offered only when the raised flag carries ids */ | 'keys' /* offered only when the raiser names it (a dialog that narrows the row: the rebase cap's Retry, a spec change that cannot be accepted) */ }
export type EffDo = 'wait' | 'clear' | 'retry' | 'reset' | 'unblock' | 'rewind' | 'amend' | 'resume' | 'cancel' | 'adopt' | 'spec' | 'restore' | 'recut' | 'dropNeed' | 'endAgent' | 'rework'
export type Eff = {
  do: EffDo
  to?: string                                     // rewind: a step id of the task's pipeline
  counter?: string                                // retry / reset: a name from docs/counters.md
  more?: 1                                        // retry: grant ONE more round (limit - 1) instead of starting the count over
  kinds?: string[]                                // clear: flag kinds to remove; absent = every flag of the target except `git:`
  kind?: string                                   // rework: the flag kind the rework is for
  note?: string                                   // unblock: modelText sent to the fresh agent
  how?: 'accept' | 'reject' | 'keep' | 'restore'  // spec: accept|reject; clear/restore on a ref: keep|restore
}

// delivery hooks (2.7) and the landing provider seam (2.8)
export type HookEvent = 'task.closed' | 'epic.landed' | 'release'
export type Hook = { run: string[]; commit?: string /* ${id} ${title} ${version} */; envPass?: string[] } | { role: string }
export type LandResult = { state: 'landed' | 'pending' | 'failed'; ref?: string; error?: { code: string; message: string } }
export interface Provider { submit(ctx: unknown): Promise<LandResult>; poll(ref: string): Promise<LandResult> }   // ctx = LandCtx, defined with the provider in S6
