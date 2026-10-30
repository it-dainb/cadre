// GENERATED from v0.15.0 (98d15df) by running the shipped code: never regenerate to make tests/roles.test.ts pass
// 0.16.0 exception, edited by hand: the worker and tester prompts gain one rule each (ask for a missing package, with the install argv), the planner one (a package is not a task); nothing else differs from 0.15.0
// 0.17.0 exception, edited by hand: the specifier role (default off) adds its own entries (spec, allow, file, routes, ttl, roles, tools, reports, the resolved roles.specifier); no other entry differs
// A4 audit exception, edited by hand: the prompts of worker, tester, reviewer, explorer and planner lose what the tools enforce (prompt and file entries only); nothing else differs
// S1 exception, edited by hand: the worker, tester and planner prompts, the report schemas (no `request` outcome or field) and the resolved config (no `deps`, no `limits.helpers`) change with B5; nothing else differs
// S4 exception, edited by hand (B9): the resolved config loses review.deepLabels, review.coreTask, review.coreDiff and review.tiers (the planner declares the risk); nothing else differs
// S2 exception, edited by hand: the tester report's tests[] items are {path,name,ids} (B2: ids replace the scenario string; the schema now names the item fields) and the resolved config loses tdd.collectErrors (B14); nothing else differs
// S5 exception, edited by hand: the config keys the profile took over (types, tdd, review, lanes, roles.custom, limits.testerRounds) are gone from the resolved config; `profile` and `limits.specAccepts` are new (B16)
// S6 exception, edited by hand: the config keys the profile took over (changelog, suites, release, landing.mode/review/remote) are gone from the resolved config (B16)
export default {
 "spec": {
  "base/worker": {
   "name": "worker",
   "description": "implements one approved task in its own folder",
   "prompt": "You are a worker. You own one task, given in your brief.\n- The scenarios and the contract are the acceptance: conform to every name, param, return and error as written.\n- Locked spec tests are fixed. Make them pass; never edit, delete, skip or weaken them.\n- Make the smallest change that satisfies the scenarios: no unrelated refactors, no extras.\n- Run the checks with mcp__cadre__run_check before you finish; fix failures at their cause.\n- Do not commit, branch, merge or push; your changes are committed for you.\n- Blocked, or the spec cannot be met as written: report outcome \"blocked\" or \"spec_change\" and say why; do not guess around it. A review finding that needs a locked test or a scenario changed is \"spec_change\", not \"blocked\". For \"spec_change\", scenario is the changed scenario in full: the tester reads only that, never your reason.\n- If a package your task needs is not installed, install it in your shell (manifest and lockfile changes are part of the task). If you cannot, report \"blocked\" and say what you need.\n- Out-of-scope discoveries go in report followups, not in the diff.\nFinish with the report tool exactly once: outcome, a short summary, risks. A hand-back message does not replace it.",
   "tools": [
    "Read",
    "Edit",
    "Write",
    "NotebookEdit",
    "Bash",
    "PowerShell",
    "Monitor",
    "TodoWrite",
    "mcp__cadre__report",
    "mcp__cadre__run_check"
   ],
   "model": "haiku",
   "effort": "high"
  },
  "base/tester": {
   "name": "tester",
   "description": "writes black-box tests for one task from its scenarios",
   "prompt": "You are a tester. You write black-box tests for one task, in a folder that holds only docs, fixtures, SCENARIOS.md and INTERFACE.md.\n- Derive every test from the scenarios and the contract, never from implementation details. Each scenario gets at least one test, named after its id.\n- Assert behavior at the contract boundary only: no assertions on internals, no mocks of the unit under test.\n- Write only under the test paths named in your brief.\n- The tests must fail for the right reason before the work is done: a failing assertion, not a setup error.\nFinish with the report tool: your tests and run, the command that runs only them. A hand-back message does not replace it.",
   "tools": [
    "Read",
    "Write",
    "Edit",
    "mcp__cadre__report"
   ],
   "model": "sonnet",
   "effort": "medium"
  },
  "base/reviewer": {
   "name": "reviewer",
   "description": "reviews one task commit against its scenarios",
   "prompt": "You are a reviewer. You judge one commit against its scenarios and contract by trying to disprove each claim of correctness.\n- Start from the diff and the spec tests. For every scenario, find the test that covers it and say whether it truly checks the behavior.\n- Check the contract: each item marked new must not exist at the base, changed must differ, unchanged must not; every name and field must conform.\n- Reject weakened assertions, tests tied to implementation detail, and changes outside the task scope.\n- Flag needless abstraction, duplication and dead code.\n- Use mcp__cadre__inspect to read files and history, mcp__cadre__run_check to run checks. Cite file and line for every finding; a finding you cannot verify is not a finding.\nFinish with the report tool: verdict, findings, coverage for every scenario, contractStatus for every contract item. A hand-back message does not replace it.",
   "tools": [
    "Read",
    "mcp__cadre__inspect",
    "mcp__cadre__run_check",
    "mcp__cadre__report"
   ],
   "model": "sonnet",
   "effort": "high"
  },
  "base/explorer": {
   "name": "explorer",
   "description": "read-only recon, discovery and spikes",
   "prompt": "You are an explorer. You answer one question about the repository, read-only.\n- Use Read and mcp__cadre__inspect.\n- Prefer primary sources: code, CI config, manifests. When CI and prose disagree, CI wins.\n- Every claim cites path and line. If you cannot find it, say so.\nFinish with the report tool: a short answer and your citations.",
   "tools": [
    "Read",
    "mcp__cadre__inspect",
    "mcp__cadre__report"
   ],
   "model": "haiku",
   "effort": "low"
  },
  "base/planner": {
   "name": "planner",
   "description": "drafts the task plan of one epic, read-only",
   "prompt": "You are a planner. You draft the task plan of one epic, given in your brief, read-only.\n- Use Read and mcp__cadre__inspect to learn the code the epic touches.\n- Each task is a vertical slice: it works and can be shown on its own, fits one fresh context, and has its wiring and one smoke assertion.\n- Every task declares metadata.paths. Stay inside the epic's files; never plan a change to a locked file.\n- Build on what already landed. Code that 2+ tasks need goes into ONE thin core task first (metadata.core: true: interfaces, minimal code, contract tests); the others come after it. Two tasks on one path need an order.\n- Metadata: the fields under \"Task fields\" in your brief, and risk: light, standard, thorough or core (shared code others build on); it sets how closely the task is reviewed. Leave risk out for standard.\n- The description says what to build, never which tests to add: every behaviour to check is an acceptance item.\n- A package the epic needs is not a task of its own: the task that uses it installs it.\n- Aim for the size the brief names.\nFinish with the report tool: {\"schemaVersion\":1,\"role\":\"planner\",\"summary\":\"...\",\"tasks\":[{\"subject\",\"description\",\"metadata\":{...},\"after\":[1]}]}. after: the numbers (from 1) of the tasks in your list that must land first. If it is refused, fix what it names and report the whole list again.",
   "tools": [
    "Read",
    "mcp__cadre__inspect",
    "mcp__cadre__report"
   ],
   "model": "sonnet",
   "effort": "high"
  },
  "mod/worker": {
   "name": "worker",
   "description": "implements one approved task in its own folder",
   "prompt": "You are a worker. You own one task, given in your brief.\n- The scenarios and the contract are the acceptance: conform to every name, param, return and error as written.\n- Locked spec tests are fixed. Make them pass; never edit, delete, skip or weaken them.\n- Make the smallest change that satisfies the scenarios: no unrelated refactors, no extras.\n- Run the checks with mcp__cadre__run_check before you finish; fix failures at their cause.\n- Do not commit, branch, merge or push; your changes are committed for you.\n- Blocked, or the spec cannot be met as written: report outcome \"blocked\" or \"spec_change\" and say why; do not guess around it. A review finding that needs a locked test or a scenario changed is \"spec_change\", not \"blocked\". For \"spec_change\", scenario is the changed scenario in full: the tester reads only that, never your reason.\n- If a package your task needs is not installed, install it in your shell (manifest and lockfile changes are part of the task). If you cannot, report \"blocked\" and say what you need.\n- Out-of-scope discoveries go in report followups, not in the diff.\nFinish with the report tool exactly once: outcome, a short summary, risks. A hand-back message does not replace it.",
   "tools": [
    "Read",
    "Edit",
    "Write",
    "NotebookEdit",
    "Bash",
    "PowerShell",
    "Monitor",
    "TodoWrite",
    "mcp__cadre__report",
    "mcp__cadre__run_check",
    "mcp__a__b"
   ],
   "model": "opus",
   "effort": "xhigh"
  },
  "mod/tester": {
   "name": "tester",
   "description": "writes black-box tests for one task from its scenarios",
   "prompt": "You are a tester. You write black-box tests for one task, in a folder that holds only docs, fixtures, SCENARIOS.md and INTERFACE.md.\n- Derive every test from the scenarios and the contract, never from implementation details. Each scenario gets at least one test, named after its id.\n- Assert behavior at the contract boundary only: no assertions on internals, no mocks of the unit under test.\n- Write only under the test paths named in your brief.\n- The tests must fail for the right reason before the work is done: a failing assertion, not a setup error.\nFinish with the report tool: your tests and run, the command that runs only them. A hand-back message does not replace it.",
   "tools": [
    "Read",
    "Write",
    "Edit",
    "mcp__cadre__report"
   ],
   "model": "sonnet",
   "effort": "medium"
  },
  "mod/reviewer": {
   "name": "reviewer",
   "description": "reviews one task commit against its scenarios",
   "prompt": "You are a reviewer. You judge one commit against its scenarios and contract by trying to disprove each claim of correctness.\n- Start from the diff and the spec tests. For every scenario, find the test that covers it and say whether it truly checks the behavior.\n- Check the contract: each item marked new must not exist at the base, changed must differ, unchanged must not; every name and field must conform.\n- Reject weakened assertions, tests tied to implementation detail, and changes outside the task scope.\n- Flag needless abstraction, duplication and dead code.\n- Use mcp__cadre__inspect to read files and history, mcp__cadre__run_check to run checks. Cite file and line for every finding; a finding you cannot verify is not a finding.\nFinish with the report tool: verdict, findings, coverage for every scenario, contractStatus for every contract item. A hand-back message does not replace it.",
   "tools": [
    "Read",
    "mcp__cadre__inspect",
    "mcp__cadre__run_check",
    "mcp__cadre__report"
   ],
   "model": "sonnet",
   "effort": "high"
  },
  "mod/explorer": {
   "name": "explorer",
   "description": "read-only recon, discovery and spikes",
   "prompt": "You are an explorer. You answer one question about the repository, read-only.\n- Use Read and mcp__cadre__inspect.\n- Prefer primary sources: code, CI config, manifests. When CI and prose disagree, CI wins.\n- Every claim cites path and line. If you cannot find it, say so.\nFinish with the report tool: a short answer and your citations.",
   "tools": [
    "Read",
    "mcp__cadre__inspect",
    "mcp__cadre__report"
   ],
   "model": "sonnet"
  },
  "mod/planner": {
   "name": "planner",
   "description": "drafts the task plan of one epic, read-only",
   "prompt": "You are a planner. You draft the task plan of one epic, given in your brief, read-only.\n- Use Read and mcp__cadre__inspect to learn the code the epic touches.\n- Each task is a vertical slice: it works and can be shown on its own, fits one fresh context, and has its wiring and one smoke assertion.\n- Every task declares metadata.paths. Stay inside the epic's files; never plan a change to a locked file.\n- Build on what already landed. Code that 2+ tasks need goes into ONE thin core task first (metadata.core: true: interfaces, minimal code, contract tests); the others come after it. Two tasks on one path need an order.\n- Metadata: the fields under \"Task fields\" in your brief, and risk: light, standard, thorough or core (shared code others build on); it sets how closely the task is reviewed. Leave risk out for standard.\n- The description says what to build, never which tests to add: every behaviour to check is an acceptance item.\n- A package the epic needs is not a task of its own: the task that uses it installs it.\n- Aim for the size the brief names.\nFinish with the report tool: {\"schemaVersion\":1,\"role\":\"planner\",\"summary\":\"...\",\"tasks\":[{\"subject\",\"description\",\"metadata\":{...},\"after\":[1]}]}. after: the numbers (from 1) of the tasks in your list that must land first. If it is refused, fix what it names and report the whole list again.",
   "tools": [
    "Read",
    "mcp__cadre__inspect",
    "mcp__cadre__report"
   ],
   "model": "sonnet",
   "effort": "high"
  },
  "base/specifier": {
   "name": "specifier",
   "description": "writes how-to notes for one approved task, read-only",
   "prompt": "You are a specifier. You write how-to notes for one approved task, given in your brief, read-only.\n- Use Read and mcp__cadre__inspect to learn the code the task touches. Change nothing.\n- The scenarios and the contract are fixed: never change, add or drop one. Say what is wrong with them only through deviation.\n- notes: how to build it, in plain words: the files to change, the existing code to reuse, the order of the steps, the traps. Under 1.5 KB. No tests, no code blocks longer than a few lines.\n- deviation: \"none\" when the task can be built as written; \"wrong_path\" when a declared file or folder does not exist or is not where the work belongs; \"scenario_conflict\" when two scenarios, or a scenario and the contract, cannot both hold; \"missing_dep\" when the task needs code that no earlier task provides.\nFinish with the report tool exactly once: {\"schemaVersion\":1,\"role\":\"specifier\",\"notes\":\"...\",\"deviation\":\"none\"}. A hand-back message does not replace it.",
   "tools": [
    "Read",
    "mcp__cadre__inspect",
    "mcp__cadre__report"
   ],
   "model": "haiku",
   "effort": "low"
  },
  "mod/specifier": {
   "name": "specifier",
   "description": "writes how-to notes for one approved task, read-only",
   "prompt": "You are a specifier. You write how-to notes for one approved task, given in your brief, read-only.\n- Use Read and mcp__cadre__inspect to learn the code the task touches. Change nothing.\n- The scenarios and the contract are fixed: never change, add or drop one. Say what is wrong with them only through deviation.\n- notes: how to build it, in plain words: the files to change, the existing code to reuse, the order of the steps, the traps. Under 1.5 KB. No tests, no code blocks longer than a few lines.\n- deviation: \"none\" when the task can be built as written; \"wrong_path\" when a declared file or folder does not exist or is not where the work belongs; \"scenario_conflict\" when two scenarios, or a scenario and the contract, cannot both hold; \"missing_dep\" when the task needs code that no earlier task provides.\nFinish with the report tool exactly once: {\"schemaVersion\":1,\"role\":\"specifier\",\"notes\":\"...\",\"deviation\":\"none\"}. A hand-back message does not replace it.",
   "tools": [
    "Read",
    "mcp__cadre__inspect",
    "mcp__cadre__report"
   ],
   "model": "haiku",
   "effort": "low"
  }
 },
 "allow": {
  "worker": [
   "Read",
   "Edit",
   "Write",
   "NotebookEdit",
   "Bash",
   "PowerShell",
   "Monitor",
   "TodoWrite",
   "mcp__cadre__report",
   "mcp__cadre__run_check"
  ],
  "worker+mcp": [
   "Read",
   "Edit",
   "Write",
   "NotebookEdit",
   "Bash",
   "PowerShell",
   "Monitor",
   "TodoWrite",
   "mcp__cadre__report",
   "mcp__cadre__run_check",
   "mcp__a__b"
  ],
  "tester": [
   "Read",
   "Write",
   "Edit",
   "mcp__cadre__report"
  ],
  "tester+mcp": [
   "Read",
   "Write",
   "Edit",
   "mcp__cadre__report"
  ],
  "reviewer": [
   "Read",
   "mcp__cadre__inspect",
   "mcp__cadre__run_check",
   "mcp__cadre__report"
  ],
  "reviewer+mcp": [
   "Read",
   "mcp__cadre__inspect",
   "mcp__cadre__run_check",
   "mcp__cadre__report"
  ],
  "explorer": [
   "Read",
   "mcp__cadre__inspect",
   "mcp__cadre__report"
  ],
  "explorer+mcp": [
   "Read",
   "mcp__cadre__inspect",
   "mcp__cadre__report"
  ],
  "planner": [
   "Read",
   "mcp__cadre__inspect",
   "mcp__cadre__report"
  ],
  "planner+mcp": [
   "Read",
   "mcp__cadre__inspect",
   "mcp__cadre__report"
  ],
  "specifier": [
   "Read",
   "mcp__cadre__inspect",
   "mcp__cadre__report"
  ],
  "specifier+mcp": [
   "Read",
   "mcp__cadre__inspect",
   "mcp__cadre__report"
  ]
 },
 "file": {
  "worker": "---\nname: worker\ndescription: \"implements one approved task in its own folder\"\ntools: Read, Edit, Write, NotebookEdit, Bash, PowerShell, Monitor, TodoWrite, mcp__cadre__report, mcp__cadre__run_check\nexperimental:\n  cacheTtl: 1h\n---\nYou are a worker. You own one task, given in your brief.\n- The scenarios and the contract are the acceptance: conform to every name, param, return and error as written.\n- Locked spec tests are fixed. Make them pass; never edit, delete, skip or weaken them.\n- Make the smallest change that satisfies the scenarios: no unrelated refactors, no extras.\n- Run the checks with mcp__cadre__run_check before you finish; fix failures at their cause.\n- Do not commit, branch, merge or push; your changes are committed for you.\n- Blocked, or the spec cannot be met as written: report outcome \"blocked\" or \"spec_change\" and say why; do not guess around it. A review finding that needs a locked test or a scenario changed is \"spec_change\", not \"blocked\". For \"spec_change\", scenario is the changed scenario in full: the tester reads only that, never your reason.\n- If a package your task needs is not installed, install it in your shell (manifest and lockfile changes are part of the task). If you cannot, report \"blocked\" and say what you need.\n- Out-of-scope discoveries go in report followups, not in the diff.\nFinish with the report tool exactly once: outcome, a short summary, risks. A hand-back message does not replace it.\n",
  "tester": "---\nname: tester\ndescription: \"writes black-box tests for one task from its scenarios\"\ntools: Read, Write, Edit, mcp__cadre__report\nexperimental:\n  cacheTtl: 1h\n---\nYou are a tester. You write black-box tests for one task, in a folder that holds only docs, fixtures, SCENARIOS.md and INTERFACE.md.\n- Derive every test from the scenarios and the contract, never from implementation details. Each scenario gets at least one test, named after its id.\n- Assert behavior at the contract boundary only: no assertions on internals, no mocks of the unit under test.\n- Write only under the test paths named in your brief.\n- The tests must fail for the right reason before the work is done: a failing assertion, not a setup error.\nFinish with the report tool: your tests and run, the command that runs only them. A hand-back message does not replace it.\n",
  "reviewer": "---\nname: reviewer\ndescription: \"reviews one task commit against its scenarios\"\ntools: Read, mcp__cadre__inspect, mcp__cadre__run_check, mcp__cadre__report\nexperimental:\n  cacheTtl: 1h\n---\nYou are a reviewer. You judge one commit against its scenarios and contract by trying to disprove each claim of correctness.\n- Start from the diff and the spec tests. For every scenario, find the test that covers it and say whether it truly checks the behavior.\n- Check the contract: each item marked new must not exist at the base, changed must differ, unchanged must not; every name and field must conform.\n- Reject weakened assertions, tests tied to implementation detail, and changes outside the task scope.\n- Flag needless abstraction, duplication and dead code.\n- Use mcp__cadre__inspect to read files and history, mcp__cadre__run_check to run checks. Cite file and line for every finding; a finding you cannot verify is not a finding.\nFinish with the report tool: verdict, findings, coverage for every scenario, contractStatus for every contract item. A hand-back message does not replace it.\n",
  "explorer": "---\nname: explorer\ndescription: \"read-only recon, discovery and spikes\"\ntools: Read, mcp__cadre__inspect, mcp__cadre__report\neffort: low\nmaxTurns: 40\nexperimental:\n  cacheTtl: 5m\n---\nYou are an explorer. You answer one question about the repository, read-only.\n- Use Read and mcp__cadre__inspect.\n- Prefer primary sources: code, CI config, manifests. When CI and prose disagree, CI wins.\n- Every claim cites path and line. If you cannot find it, say so.\nFinish with the report tool: a short answer and your citations.\n",
  "planner": "---\nname: planner\ndescription: \"drafts the task plan of one epic, read-only\"\ntools: Read, mcp__cadre__inspect, mcp__cadre__report\neffort: high\nexperimental:\n  cacheTtl: 1h\n---\nYou are a planner. You draft the task plan of one epic, given in your brief, read-only.\n- Use Read and mcp__cadre__inspect to learn the code the epic touches.\n- Each task is a vertical slice: it works and can be shown on its own, fits one fresh context, and has its wiring and one smoke assertion.\n- Every task declares metadata.paths. Stay inside the epic's files; never plan a change to a locked file.\n- Build on what already landed. Code that 2+ tasks need goes into ONE thin core task first (metadata.core: true: interfaces, minimal code, contract tests); the others come after it. Two tasks on one path need an order.\n- Metadata: the fields under \"Task fields\" in your brief, and risk: light, standard, thorough or core (shared code others build on); it sets how closely the task is reviewed. Leave risk out for standard.\n- The description says what to build, never which tests to add: every behaviour to check is an acceptance item.\n- A package the epic needs is not a task of its own: the task that uses it installs it.\n- Aim for the size the brief names.\nFinish with the report tool: {\"schemaVersion\":1,\"role\":\"planner\",\"summary\":\"...\",\"tasks\":[{\"subject\",\"description\",\"metadata\":{...},\"after\":[1]}]}. after: the numbers (from 1) of the tasks in your list that must land first. If it is refused, fix what it names and report the whole list again.\n",
  "specifier": "---\nname: specifier\ndescription: \"writes how-to notes for one approved task, read-only\"\ntools: Read, mcp__cadre__inspect, mcp__cadre__report\neffort: low\nmaxTurns: 40\nexperimental:\n  cacheTtl: 5m\n---\nYou are a specifier. You write how-to notes for one approved task, given in your brief, read-only.\n- Use Read and mcp__cadre__inspect to learn the code the task touches. Change nothing.\n- The scenarios and the contract are fixed: never change, add or drop one. Say what is wrong with them only through deviation.\n- notes: how to build it, in plain words: the files to change, the existing code to reuse, the order of the steps, the traps. Under 1.5 KB. No tests, no code blocks longer than a few lines.\n- deviation: \"none\" when the task can be built as written; \"wrong_path\" when a declared file or folder does not exist or is not where the work belongs; \"scenario_conflict\" when two scenarios, or a scenario and the contract, cannot both hold; \"missing_dep\" when the task needs code that no earlier task provides.\nFinish with the report tool exactly once: {\"schemaVersion\":1,\"role\":\"specifier\",\"notes\":\"...\",\"deviation\":\"none\"}. A hand-back message does not replace it.\n"
 },
 "routes": {
  "worker/light/0/-": {
   "model": "haiku",
   "effort": "high",
   "setting": "roles.worker.byRisk.light"
  },
  "worker/light/0/unit": {
   "model": "opus",
   "effort": "high",
   "setting": "units u: routing.worker"
  },
  "worker/light/1/-": {
   "model": "sonnet",
   "effort": "high",
   "escalated": true,
   "setting": "roles.worker.byRisk.light.escalate"
  },
  "worker/light/1/unit": {
   "model": "sonnet",
   "effort": "high",
   "escalated": true,
   "setting": "roles.worker.byRisk.light.escalate"
  },
  "worker/light/2/-": {
   "model": "sonnet",
   "effort": "high",
   "escalated": true,
   "setting": "roles.worker.byRisk.light.escalate"
  },
  "worker/light/2/unit": {
   "model": "sonnet",
   "effort": "high",
   "escalated": true,
   "setting": "roles.worker.byRisk.light.escalate"
  },
  "worker/standard/0/-": {
   "model": "haiku",
   "effort": "high",
   "setting": "roles.worker.byRisk.standard"
  },
  "worker/standard/0/unit": {
   "model": "opus",
   "effort": "high",
   "setting": "units u: routing.worker"
  },
  "worker/standard/1/-": {
   "model": "sonnet",
   "effort": "high",
   "escalated": true,
   "setting": "roles.worker.byRisk.standard.escalate"
  },
  "worker/standard/1/unit": {
   "model": "sonnet",
   "effort": "high",
   "escalated": true,
   "setting": "roles.worker.byRisk.standard.escalate"
  },
  "worker/standard/2/-": {
   "model": "sonnet",
   "effort": "high",
   "escalated": true,
   "setting": "roles.worker.byRisk.standard.escalate"
  },
  "worker/standard/2/unit": {
   "model": "sonnet",
   "effort": "high",
   "escalated": true,
   "setting": "roles.worker.byRisk.standard.escalate"
  },
  "worker/thorough/0/-": {
   "model": "haiku",
   "effort": "high",
   "setting": "roles.worker.byRisk.thorough"
  },
  "worker/thorough/0/unit": {
   "model": "opus",
   "effort": "high",
   "setting": "units u: routing.worker"
  },
  "worker/thorough/1/-": {
   "model": "sonnet",
   "effort": "high",
   "escalated": true,
   "setting": "roles.worker.byRisk.thorough.escalate"
  },
  "worker/thorough/1/unit": {
   "model": "sonnet",
   "effort": "high",
   "escalated": true,
   "setting": "roles.worker.byRisk.thorough.escalate"
  },
  "worker/thorough/2/-": {
   "model": "sonnet",
   "effort": "high",
   "escalated": true,
   "setting": "roles.worker.byRisk.thorough.escalate"
  },
  "worker/thorough/2/unit": {
   "model": "sonnet",
   "effort": "high",
   "escalated": true,
   "setting": "roles.worker.byRisk.thorough.escalate"
  },
  "worker/core/0/-": {
   "model": "haiku",
   "effort": "high",
   "setting": "roles.worker.byRisk.core"
  },
  "worker/core/0/unit": {
   "model": "opus",
   "effort": "high",
   "setting": "units u: routing.worker"
  },
  "worker/core/1/-": {
   "model": "sonnet",
   "effort": "high",
   "escalated": true,
   "setting": "roles.worker.byRisk.core.escalate"
  },
  "worker/core/1/unit": {
   "model": "sonnet",
   "effort": "high",
   "escalated": true,
   "setting": "roles.worker.byRisk.core.escalate"
  },
  "worker/core/2/-": {
   "model": "sonnet",
   "effort": "high",
   "escalated": true,
   "setting": "roles.worker.byRisk.core.escalate"
  },
  "worker/core/2/unit": {
   "model": "sonnet",
   "effort": "high",
   "escalated": true,
   "setting": "roles.worker.byRisk.core.escalate"
  },
  "tester/light/0/-": {
   "model": "haiku",
   "effort": "high",
   "setting": "roles.tester.byRisk.light"
  },
  "tester/light/0/unit": {
   "model": "opus",
   "effort": "high",
   "setting": "units u: routing.tester"
  },
  "tester/light/1/-": {
   "model": "haiku",
   "effort": "high",
   "setting": "roles.tester.byRisk.light"
  },
  "tester/light/1/unit": {
   "model": "opus",
   "effort": "high",
   "setting": "units u: routing.tester"
  },
  "tester/light/2/-": {
   "model": "haiku",
   "effort": "high",
   "setting": "roles.tester.byRisk.light"
  },
  "tester/light/2/unit": {
   "model": "opus",
   "effort": "high",
   "setting": "units u: routing.tester"
  },
  "tester/standard/0/-": {
   "model": "sonnet",
   "effort": "medium",
   "setting": "roles.tester.byRisk.standard"
  },
  "tester/standard/0/unit": {
   "model": "opus",
   "effort": "medium",
   "setting": "units u: routing.tester"
  },
  "tester/standard/1/-": {
   "model": "sonnet",
   "effort": "medium",
   "setting": "roles.tester.byRisk.standard"
  },
  "tester/standard/1/unit": {
   "model": "opus",
   "effort": "medium",
   "setting": "units u: routing.tester"
  },
  "tester/standard/2/-": {
   "model": "sonnet",
   "effort": "medium",
   "setting": "roles.tester.byRisk.standard"
  },
  "tester/standard/2/unit": {
   "model": "opus",
   "effort": "medium",
   "setting": "units u: routing.tester"
  },
  "tester/thorough/0/-": {
   "model": "sonnet",
   "effort": "medium",
   "setting": "roles.tester.byRisk.thorough"
  },
  "tester/thorough/0/unit": {
   "model": "opus",
   "effort": "medium",
   "setting": "units u: routing.tester"
  },
  "tester/thorough/1/-": {
   "model": "sonnet",
   "effort": "medium",
   "setting": "roles.tester.byRisk.thorough"
  },
  "tester/thorough/1/unit": {
   "model": "opus",
   "effort": "medium",
   "setting": "units u: routing.tester"
  },
  "tester/thorough/2/-": {
   "model": "sonnet",
   "effort": "medium",
   "setting": "roles.tester.byRisk.thorough"
  },
  "tester/thorough/2/unit": {
   "model": "opus",
   "effort": "medium",
   "setting": "units u: routing.tester"
  },
  "tester/core/0/-": {
   "model": "sonnet",
   "effort": "medium",
   "setting": "roles.tester.byRisk.core"
  },
  "tester/core/0/unit": {
   "model": "opus",
   "effort": "medium",
   "setting": "units u: routing.tester"
  },
  "tester/core/1/-": {
   "model": "sonnet",
   "effort": "medium",
   "setting": "roles.tester.byRisk.core"
  },
  "tester/core/1/unit": {
   "model": "opus",
   "effort": "medium",
   "setting": "units u: routing.tester"
  },
  "tester/core/2/-": {
   "model": "sonnet",
   "effort": "medium",
   "setting": "roles.tester.byRisk.core"
  },
  "tester/core/2/unit": {
   "model": "opus",
   "effort": "medium",
   "setting": "units u: routing.tester"
  },
  "reviewer/light/0/-": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.reviewer.byRisk.light"
  },
  "reviewer/light/0/unit": {
   "model": "opus",
   "effort": "high",
   "setting": "units u: routing.reviewer"
  },
  "reviewer/light/1/-": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.reviewer.byRisk.light"
  },
  "reviewer/light/1/unit": {
   "model": "opus",
   "effort": "high",
   "setting": "units u: routing.reviewer"
  },
  "reviewer/light/2/-": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.reviewer.byRisk.light"
  },
  "reviewer/light/2/unit": {
   "model": "opus",
   "effort": "high",
   "setting": "units u: routing.reviewer"
  },
  "reviewer/standard/0/-": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.reviewer.byRisk.standard"
  },
  "reviewer/standard/0/unit": {
   "model": "opus",
   "effort": "high",
   "setting": "units u: routing.reviewer"
  },
  "reviewer/standard/1/-": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.reviewer.byRisk.standard"
  },
  "reviewer/standard/1/unit": {
   "model": "opus",
   "effort": "high",
   "setting": "units u: routing.reviewer"
  },
  "reviewer/standard/2/-": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.reviewer.byRisk.standard"
  },
  "reviewer/standard/2/unit": {
   "model": "opus",
   "effort": "high",
   "setting": "units u: routing.reviewer"
  },
  "reviewer/thorough/0/-": {
   "model": "opus",
   "effort": "high",
   "setting": "roles.reviewer.byRisk.thorough"
  },
  "reviewer/thorough/0/unit": {
   "model": "opus",
   "effort": "high",
   "setting": "units u: routing.reviewer"
  },
  "reviewer/thorough/1/-": {
   "model": "opus",
   "effort": "high",
   "setting": "roles.reviewer.byRisk.thorough"
  },
  "reviewer/thorough/1/unit": {
   "model": "opus",
   "effort": "high",
   "setting": "units u: routing.reviewer"
  },
  "reviewer/thorough/2/-": {
   "model": "opus",
   "effort": "high",
   "setting": "roles.reviewer.byRisk.thorough"
  },
  "reviewer/thorough/2/unit": {
   "model": "opus",
   "effort": "high",
   "setting": "units u: routing.reviewer"
  },
  "reviewer/core/0/-": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.reviewer.byRisk.core"
  },
  "reviewer/core/0/unit": {
   "model": "opus",
   "effort": "high",
   "setting": "units u: routing.reviewer"
  },
  "reviewer/core/1/-": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.reviewer.byRisk.core"
  },
  "reviewer/core/1/unit": {
   "model": "opus",
   "effort": "high",
   "setting": "units u: routing.reviewer"
  },
  "reviewer/core/2/-": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.reviewer.byRisk.core"
  },
  "reviewer/core/2/unit": {
   "model": "opus",
   "effort": "high",
   "setting": "units u: routing.reviewer"
  },
  "explorer/light/0/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "explorer/light/0/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "explorer/light/1/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "explorer/light/1/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "explorer/light/2/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "explorer/light/2/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "explorer/standard/0/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "explorer/standard/0/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "explorer/standard/1/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "explorer/standard/1/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "explorer/standard/2/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "explorer/standard/2/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "explorer/thorough/0/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "explorer/thorough/0/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "explorer/thorough/1/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "explorer/thorough/1/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "explorer/thorough/2/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "explorer/thorough/2/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "explorer/core/0/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "explorer/core/0/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "explorer/core/1/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "explorer/core/1/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "explorer/core/2/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "explorer/core/2/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.explorer"
  },
  "planner/light/0/-": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "planner/light/0/unit": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "planner/light/1/-": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "planner/light/1/unit": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "planner/light/2/-": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "planner/light/2/unit": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "planner/standard/0/-": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "planner/standard/0/unit": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "planner/standard/1/-": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "planner/standard/1/unit": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "planner/standard/2/-": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "planner/standard/2/unit": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "planner/thorough/0/-": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "planner/thorough/0/unit": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "planner/thorough/1/-": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "planner/thorough/1/unit": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "planner/thorough/2/-": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "planner/thorough/2/unit": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "planner/core/0/-": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "planner/core/0/unit": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "planner/core/1/-": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "planner/core/1/unit": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "planner/core/2/-": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "planner/core/2/unit": {
   "model": "sonnet",
   "effort": "high",
   "setting": "roles.planner"
  },
  "specifier/light/0/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  },
  "specifier/light/0/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  },
  "specifier/light/1/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  },
  "specifier/light/1/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  },
  "specifier/light/2/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  },
  "specifier/light/2/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  },
  "specifier/standard/0/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  },
  "specifier/standard/0/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  },
  "specifier/standard/1/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  },
  "specifier/standard/1/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  },
  "specifier/standard/2/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  },
  "specifier/standard/2/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  },
  "specifier/thorough/0/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  },
  "specifier/thorough/0/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  },
  "specifier/thorough/1/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  },
  "specifier/thorough/1/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  },
  "specifier/thorough/2/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  },
  "specifier/thorough/2/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  },
  "specifier/core/0/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  },
  "specifier/core/0/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  },
  "specifier/core/1/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  },
  "specifier/core/1/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  },
  "specifier/core/2/-": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  },
  "specifier/core/2/unit": {
   "model": "haiku",
   "effort": "low",
   "setting": "roles.specifier"
  }
 },
 "resolved": {
  "none": {
   "config": {
    "strictness": "strict",
    "mcpAllow": [],
    "jail": "auto",
    "jailWritable": [],
    "effectCheck": "auto",
    "roles": {
     "testerView": "view",
     "tdd": {
      "author": "separate"
     },
     "worker": {
      "byRisk": {
       "light": {
        "model": "haiku",
        "effort": "high",
        "escalate": {
         "after": 1,
         "model": "sonnet",
         "effort": "high"
        }
       },
       "standard": {
        "model": "haiku",
        "effort": "high",
        "escalate": {
         "after": 1,
         "model": "sonnet",
         "effort": "high"
        }
       },
       "thorough": {
        "model": "haiku",
        "effort": "high",
        "escalate": {
         "after": 1,
         "model": "sonnet",
         "effort": "high"
        }
       },
       "core": {
        "model": "haiku",
        "effort": "high",
        "escalate": {
         "after": 1,
         "model": "sonnet",
         "effort": "high"
        }
       }
      }
     },
     "tester": {
      "byRisk": {
       "light": {
        "model": "haiku",
        "effort": "high",
        "escalate": {
         "after": 0,
         "model": "haiku",
         "effort": "high"
        }
       },
       "standard": {
        "model": "sonnet",
        "effort": "medium",
        "escalate": {
         "after": 0,
         "model": "sonnet",
         "effort": "medium"
        }
       },
       "thorough": {
        "model": "sonnet",
        "effort": "medium",
        "escalate": {
         "after": 0,
         "model": "sonnet",
         "effort": "medium"
        }
       },
       "core": {
        "model": "sonnet",
        "effort": "medium",
        "escalate": {
         "after": 0,
         "model": "sonnet",
         "effort": "medium"
        }
       }
      }
     },
     "reviewer": {
      "byRisk": {
       "light": {
        "model": "sonnet",
        "effort": "high",
        "escalate": {
         "after": 0,
         "model": "sonnet",
         "effort": "high"
        }
       },
       "standard": {
        "model": "sonnet",
        "effort": "high",
        "escalate": {
         "after": 0,
         "model": "sonnet",
         "effort": "high"
        }
       },
       "thorough": {
        "model": "opus",
        "effort": "high",
        "escalate": {
         "after": 0,
         "model": "opus",
         "effort": "high"
        }
       },
       "core": {
        "model": "sonnet",
        "effort": "high",
        "escalate": {
         "after": 0,
         "model": "sonnet",
         "effort": "high"
        }
       }
      }
     },
     "explorer": {
      "model": "haiku",
      "effort": "low"
     },
     "planner": {
      "model": "sonnet",
      "effort": "high"
     },
     "specifier": {
      "enabled": false,
      "model": "haiku",
      "effort": "low"
     }
    },
    "adapters": {},
    "store": {
     "kind": "file"
    },
    "worktrees": {
     "root": ""
    },
    "drive": {
     "mode": "auto",
     "spawn": "mod",
     "maxTurns": 100,
     "maxCostUsd": 20,
     "maxWallMinutes": 240,
     "noProgressTurns": 3
    },
    "cost": {
     "prices": null,
     "clearHintPct": 40,
     "compactPct": 60
    },
    "sync": {},
    "units": [],
    "limits": {
     "reportRetries": 3,
     "shapeRetries": 6,
     "nudges": 1,
     "stagnantNudges": 3,
     "silentRuns": 3,
     "startFails": 3,
     "limitWaitMinutes": 15,
     "rebaseRounds": 2,
     "specAccepts": 2
    },
    "lifecycle": {
     "firstOutputSec": 240,
     "staleMin": 45,
     "goneSec": 60
    },
    "planning": {
     "clarify": {
      "enabled": true,
      "maxQuestions": 3,
      "threshold": 0.7
     },
     "deep": {
      "maxRounds": 8
     }
    },
    "branches": {
     "main": "",
     "dev": "dev",
     "epicPrefix": "epic/"
    },
    "ui": {
     "glyphs": "unicode",
     "flash": true,
     "density": "normal",
     "notify": "on",
     "escalateAfterMs": 120000
    },
    "concurrency": {
     "default": 3,
     "models": {},
     "providers": {}
    },
    "models": {
     "allow": []
    },
    "milestone": {
     "maxEpics": 2,
     "epicPlanner": "agent"
    },
    "planner": {
     "maxRounds": 3
    },
    "notes": {
     "slice": true
    },
    "reuse": {
     "maxContextPct": 60,
     "cacheTtlMs": 3600000
    },
    "disable": false,
    "profile": "default"
   },
   "diagnostics": []
  },
  "user": {
   "config": {
    "strictness": "strict",
    "mcpAllow": [
     "mcp__a__b"
    ],
    "jail": "auto",
    "jailWritable": [],
    "effectCheck": "auto",
    "roles": {
     "testerView": "view",
     "tdd": {
      "author": "separate"
     },
     "worker": {
      "byRisk": {
       "light": {
        "model": "sonnet",
        "effort": "high",
        "escalate": {
         "after": 1,
         "model": "sonnet",
         "effort": "high"
        }
       },
       "standard": {
        "model": "haiku",
        "effort": "high",
        "escalate": {
         "after": 1,
         "model": "sonnet",
         "effort": "high"
        }
       },
       "thorough": {
        "model": "haiku",
        "effort": "high",
        "escalate": {
         "after": 1,
         "model": "sonnet",
         "effort": "high"
        }
       },
       "core": {
        "model": "haiku",
        "effort": "high",
        "escalate": {
         "after": 1,
         "model": "sonnet",
         "effort": "high"
        }
       }
      }
     },
     "tester": {
      "byRisk": {
       "light": {
        "model": "haiku",
        "effort": "high",
        "escalate": {
         "after": 0,
         "model": "haiku",
         "effort": "high"
        }
       },
       "standard": {
        "model": "sonnet",
        "effort": "medium",
        "escalate": {
         "after": 0,
         "model": "sonnet",
         "effort": "medium"
        }
       },
       "thorough": {
        "model": "sonnet",
        "effort": "medium",
        "escalate": {
         "after": 0,
         "model": "sonnet",
         "effort": "medium"
        }
       },
       "core": {
        "model": "sonnet",
        "effort": "medium",
        "escalate": {
         "after": 0,
         "model": "sonnet",
         "effort": "medium"
        }
       }
      }
     },
     "reviewer": {
      "byRisk": {
       "light": {
        "model": "sonnet",
        "effort": "high",
        "escalate": {
         "after": 0,
         "model": "sonnet",
         "effort": "high"
        }
       },
       "standard": {
        "model": "sonnet",
        "effort": "high",
        "escalate": {
         "after": 0,
         "model": "sonnet",
         "effort": "high"
        }
       },
       "thorough": {
        "model": "opus",
        "effort": "high",
        "escalate": {
         "after": 0,
         "model": "opus",
         "effort": "high"
        }
       },
       "core": {
        "model": "sonnet",
        "effort": "high",
        "escalate": {
         "after": 0,
         "model": "sonnet",
         "effort": "high"
        }
       }
      }
     },
     "explorer": {
      "model": "haiku",
      "effort": "low"
     },
     "planner": {
      "model": "sonnet",
      "effort": "high"
     },
     "specifier": {
      "enabled": false,
      "model": "haiku",
      "effort": "low"
     }
    },
    "adapters": {},
    "store": {
     "kind": "file"
    },
    "worktrees": {
     "root": ""
    },
    "drive": {
     "mode": "auto",
     "spawn": "mod",
     "maxTurns": 100,
     "maxCostUsd": 20,
     "maxWallMinutes": 240,
     "noProgressTurns": 3
    },
    "cost": {
     "prices": null,
     "clearHintPct": 40,
     "compactPct": 60
    },
    "sync": {},
    "units": [],
    "limits": {
     "reportRetries": 3,
     "shapeRetries": 6,
     "nudges": 1,
     "stagnantNudges": 3,
     "silentRuns": 3,
     "startFails": 3,
     "limitWaitMinutes": 15,
     "rebaseRounds": 2,
     "specAccepts": 2
    },
    "lifecycle": {
     "firstOutputSec": 240,
     "staleMin": 45,
     "goneSec": 60
    },
    "planning": {
     "clarify": {
      "enabled": true,
      "maxQuestions": 3,
      "threshold": 0.7
     },
     "deep": {
      "maxRounds": 8
     }
    },
    "branches": {
     "main": "",
     "dev": "dev",
     "epicPrefix": "epic/"
    },
    "ui": {
     "glyphs": "unicode",
     "flash": true,
     "density": "normal",
     "notify": "on",
     "escalateAfterMs": 120000
    },
    "concurrency": {
     "default": 2,
     "models": {},
     "providers": {}
    },
    "models": {
     "allow": []
    },
    "milestone": {
     "maxEpics": 2,
     "epicPlanner": "agent"
    },
    "planner": {
     "maxRounds": 3
    },
    "notes": {
     "slice": true
    },
    "reuse": {
     "maxContextPct": 60,
     "cacheTtlMs": 3600000
    },
    "disable": false,
    "profile": "default"
   },
   "diagnostics": []
  },
  "both": {
   "config": {
    "strictness": "strict",
    "mcpAllow": [
     "mcp__a__b"
    ],
    "jail": "auto",
    "jailWritable": [],
    "effectCheck": "auto",
    "roles": {
     "testerView": "view",
     "tdd": {
      "author": "separate"
     },
     "worker": {
      "byRisk": {
       "light": {
        "model": "haiku",
        "effort": "high",
        "escalate": {
         "after": 1,
         "model": "sonnet",
         "effort": "high"
        }
       },
       "standard": {
        "model": "haiku",
        "effort": "high",
        "escalate": {
         "after": 1,
         "model": "sonnet",
         "effort": "high"
        }
       },
       "thorough": {
        "model": "haiku",
        "effort": "high",
        "escalate": {
         "after": 1,
         "model": "sonnet",
         "effort": "high"
        }
       },
       "core": {
        "model": "haiku",
        "effort": "high",
        "escalate": {
         "after": 1,
         "model": "sonnet",
         "effort": "high"
        }
       }
      }
     },
     "tester": {
      "byRisk": {
       "light": {
        "model": "haiku",
        "effort": "high",
        "escalate": {
         "after": 0,
         "model": "haiku",
         "effort": "high"
        }
       },
       "standard": {
        "model": "sonnet",
        "effort": "medium",
        "escalate": {
         "after": 0,
         "model": "sonnet",
         "effort": "medium"
        }
       },
       "thorough": {
        "model": "sonnet",
        "effort": "medium",
        "escalate": {
         "after": 0,
         "model": "sonnet",
         "effort": "medium"
        }
       },
       "core": {
        "model": "sonnet",
        "effort": "low",
        "escalate": {
         "after": 0,
         "model": "sonnet",
         "effort": "medium"
        }
       }
      }
     },
     "reviewer": {
      "byRisk": {
       "light": {
        "model": "sonnet",
        "effort": "high",
        "escalate": {
         "after": 0,
         "model": "sonnet",
         "effort": "high"
        }
       },
       "standard": {
        "model": "sonnet",
        "effort": "high",
        "escalate": {
         "after": 0,
         "model": "sonnet",
         "effort": "high"
        }
       },
       "thorough": {
        "model": "opus",
        "effort": "high",
        "escalate": {
         "after": 0,
         "model": "opus",
         "effort": "high"
        }
       },
       "core": {
        "model": "sonnet",
        "effort": "high",
        "escalate": {
         "after": 0,
         "model": "sonnet",
         "effort": "high"
        }
       }
      }
     },
     "explorer": {
      "model": "haiku",
      "effort": "low"
     },
     "planner": {
      "model": "sonnet",
      "effort": "high"
     },
     "specifier": {
      "enabled": false,
      "model": "haiku",
      "effort": "low"
     }
    },
    "adapters": {},
    "store": {
     "kind": "file"
    },
    "worktrees": {
     "root": ""
    },
    "drive": {
     "mode": "auto",
     "spawn": "mod",
     "maxTurns": 100,
     "maxCostUsd": 20,
     "maxWallMinutes": 240,
     "noProgressTurns": 3
    },
    "cost": {
     "prices": null,
     "clearHintPct": 40,
     "compactPct": 60
    },
    "sync": {},
    "units": [
     {
      "root": "a",
      "knownRed": [
       "x"
      ]
     }
    ],
    "limits": {
     "reportRetries": 3,
     "shapeRetries": 6,
     "nudges": 1,
     "stagnantNudges": 3,
     "silentRuns": 3,
     "startFails": 3,
     "limitWaitMinutes": 15,
     "rebaseRounds": 2,
     "specAccepts": 2
    },
    "lifecycle": {
     "firstOutputSec": 240,
     "staleMin": 45,
     "goneSec": 60
    },
    "planning": {
     "clarify": {
      "enabled": true,
      "maxQuestions": 3,
      "threshold": 0.7
     },
     "deep": {
      "maxRounds": 8
     }
    },
    "branches": {
     "main": "",
     "dev": "dev",
     "epicPrefix": "epic/"
    },
    "ui": {
     "glyphs": "unicode",
     "flash": true,
     "density": "normal",
     "notify": "on",
     "escalateAfterMs": 120000
    },
    "concurrency": {
     "default": 3,
     "models": {},
     "providers": {}
    },
    "models": {
     "allow": []
    },
    "milestone": {
     "maxEpics": 2,
     "epicPlanner": "agent"
    },
    "planner": {
     "maxRounds": 3
    },
    "notes": {
     "slice": true
    },
    "reuse": {
     "maxContextPct": 60,
     "cacheTtlMs": 3600000
    },
    "disable": false,
    "profile": "default"
   },
   "diagnostics": [
    "r: bogus: unknown key"
   ]
  }
 },
 "ttl": {
  "worker": "1h",
  "tester": "1h",
  "reviewer": "1h",
  "explorer": "5m",
  "planner": "1h",
  "specifier": "5m"
 },
 "roles": [
  "worker",
  "tester",
  "reviewer",
  "explorer",
  "planner",
  "specifier"
 ],
 "main": [
  "Read",
  "LSP",
  "WebFetch",
  "WebSearch",
  "ToolSearch",
  "Agent",
  "AskUserQuestion",
  "SendMessage",
  "Skill",
  "Edit",
  "Write",
  "NotebookEdit",
  "mcp__cadre__inspect",
  "mcp__cadre__plan",
  "mcp__cadre__task",
  "mcp__cadre__epic",
  "mcp__cadre__amend",
  "mcp__cadre__explore",
  "mcp__cadre__ask",
  "mcp__cadre__status",
  "mcp__cadre__preferences"
 ],
 "tools": {
  "worker": [
   "Read",
   "Edit",
   "Write",
   "NotebookEdit",
   "Bash",
   "PowerShell",
   "Monitor",
   "TodoWrite",
   "mcp__cadre__report",
   "mcp__cadre__run_check"
  ],
  "tester": [
   "Read",
   "Write",
   "Edit",
   "mcp__cadre__report"
  ],
  "reviewer": [
   "Read",
   "mcp__cadre__inspect",
   "mcp__cadre__run_check",
   "mcp__cadre__report"
  ],
  "explorer": [
   "Read",
   "mcp__cadre__inspect",
   "mcp__cadre__report"
  ],
  "planner": [
   "Read",
   "mcp__cadre__inspect",
   "mcp__cadre__report"
  ],
  "specifier": [
   "Read",
   "mcp__cadre__inspect",
   "mcp__cadre__report"
  ]
 },
 "reports": {
  "worker": {
   "type": "object",
   "required": [
    "outcome",
    "summary"
   ],
   "properties": {
    "schemaVersion": {},
    "role": {},
    "outcome": {
     "type": "string",
     "enum": [
      "done",
      "blocked",
      "spec_change"
     ]
    },
    "summary": {
     "type": "string",
     "maxLength": 800
    },
    "reason": {
     "type": "string",
     "maxLength": 400
    },
    "scenario": {
     "type": "string",
     "maxLength": 300
    },
    "risks": {
     "type": "array",
     "maxItems": 5,
     "items": {
      "type": "string",
      "maxLength": 120
     }
    },
    "questions": {
     "type": "array",
     "maxItems": 5,
     "items": {
      "type": "string",
      "maxLength": 120
     }
    },
    "followups": {
     "type": "array",
     "maxItems": 5,
     "items": {
      "type": "object"
     }
    }
   }
  },
  "tester": {
   "type": "object",
   "required": [
    "outcome",
    "summary"
   ],
   "properties": {
    "schemaVersion": {},
    "role": {},
    "outcome": {
     "type": "string",
     "enum": [
      "done"
     ]
    },
    "summary": {
     "type": "string",
     "maxLength": 800
    },
    "tests": {
     "type": "array",
     "maxItems": 50,
     "items": {
      "type": "object",
      "required": [
       "path",
       "name"
      ],
      "properties": {
       "path": {
        "type": "string",
        "maxLength": 200
       },
       "name": {
        "type": "string",
        "maxLength": 300
       },
       "ids": {
        "type": "array",
        "maxItems": 10,
        "items": {
         "type": "string",
         "maxLength": 20
        }
       }
      }
     }
    },
    "run": {
     "type": "object"
    }
   }
  },
  "reviewer": {
   "type": "object",
   "required": [
    "verdict",
    "summary",
    "findings",
    "coverage",
    "contractStatus"
   ],
   "properties": {
    "schemaVersion": {},
    "role": {},
    "verdict": {
     "type": "string",
     "enum": [
      "pass",
      "changes"
     ]
    },
    "summary": {
     "type": "string",
     "maxLength": 1500
    },
    "findings": {
     "type": "array",
     "maxItems": 50,
     "items": {
      "type": "object"
     }
    },
    "coverage": {
     "type": "array",
     "maxItems": 50,
     "items": {
      "type": "object"
     }
    },
    "contractStatus": {
     "type": "array",
     "maxItems": 100,
     "items": {
      "type": "object"
     }
    }
   }
  },
  "explorer": {
   "type": "object",
   "required": [
    "answer"
   ],
   "properties": {
    "schemaVersion": {},
    "role": {},
    "answer": {
     "type": "string",
     "maxLength": 2000
    },
    "citations": {
     "type": "array",
     "maxItems": 30,
     "items": {
      "type": "object"
     }
    }
   }
  },
  "planner": {
   "type": "object",
   "properties": {
    "schemaVersion": {},
    "role": {},
    "summary": {
     "type": "string",
     "maxLength": 1500
    },
    "tasks": {
     "type": "array",
     "maxItems": 20,
     "items": {
      "type": "object"
     }
    }
   }
  },
  "specifier": {
   "type": "object",
   "required": [
    "notes",
    "deviation"
   ],
   "properties": {
    "schemaVersion": {},
    "role": {},
    "notes": {
     "type": "string",
     "maxLength": 1500
    },
    "deviation": {
     "type": "string",
     "enum": [
      "none",
      "wrong_path",
      "scenario_conflict",
      "missing_dep"
     ]
    }
   }
  }
 }
}
