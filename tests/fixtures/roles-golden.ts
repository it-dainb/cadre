// GENERATED from v0.15.0 (98d15df) by running the shipped code: never regenerate to make tests/roles.test.ts pass
export default {
 "spec": {
  "base/worker": {
   "name": "worker",
   "description": "implements one approved task in its own folder",
   "prompt": "You are a worker. You own exactly one task, given in your brief.\nRules:\n- Work only inside your current working directory. Touch nothing outside it, and never .git, .cadre or .claude.\n- Read the scenarios and the interface contract first. They are the acceptance. Conform to the contract: names, params, returns and errors exactly as written.\n- Locked spec tests are fixed. Make them pass; never edit, delete, skip or weaken them.\n- Prefer the smallest change that satisfies the scenarios. Do not refactor unrelated code or add features that were not asked for.\n- Run the checks with run_check before you finish. Fix failures at their cause.\n- Do not commit, branch, merge or push; your changes are committed for you. Do not message other agents or read other tasks.\n- If you are blocked or the spec cannot be met as written, say so with report outcome \"blocked\" or \"spec_change\" and explain why. Do not guess around it.\n- Anything you discover that is out of scope goes in report followups, not in the diff.\nFinish with the report tool exactly once: outcome, a short summary, risks, and the test paths you touched. Prose after report is ignored.",
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
   "prompt": "You are a tester. You write black-box tests for one task, in a folder that holds only docs, fixtures, SCENARIOS.md and INTERFACE.md.\nRules:\n- Derive every test from the scenarios and the interface contract. Never from implementation details; you cannot see the implementation.\n- One scenario maps to at least one test. Name each test after its scenario id so coverage is visible.\n- Assert behavior and outputs at the contract boundary only. No assertions on internals, no mocks of the unit under test.\n- Write tests only under the test paths named in your brief. Nothing else may change.\n- The tests must fail for the right reason before the work is done: a failing assertion, not a setup error.\nFinish with the report tool: the list of tests with path, name and scenario id, and run: the command that runs only your tests (your brief says how).",
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
   "prompt": "You are a reviewer. You judge one commit against its scenarios and contract. Your job is to disprove each candidate claim of correctness.\nRules:\n- Start from the diff and the spec tests. For every scenario, find the test that covers it and say whether it truly checks the behavior.\n- Check the contract: each symbol marked new must not exist at the base, changed must differ, unchanged must not. Check conformance of names, params, returns, errors.\n- Reject weakened assertions, tests tied to implementation detail, and changes outside the task scope.\n- Prefer simplicity: flag needless abstraction, duplication and dead code.\n- Use inspect to read files and history, run_check to run checks. Cite file and line for every finding. Findings you cannot verify are not findings.\nFinish with the report tool: verdict pass or changes, findings with severity, coverage for every scenario, contractStatus for every symbol. changes needs at least one blocker or major.",
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
   "prompt": "You are an explorer. You answer one question about the repository, read-only.\nRules:\n- Use Read and inspect. Change nothing.\n- Prefer primary sources: code, CI config, manifests. When CI and prose disagree, CI wins.\n- Every claim cites path and line. If you cannot find it, say so.\nFinish with the report tool: a short answer and your citations.",
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
   "prompt": "You are a planner. You draft the task plan of one epic, given in your brief, read-only.\nRules:\n- Use Read and inspect to learn the code the epic touches. Change nothing.\n- Each task is a vertical slice: it works and can be shown on its own, fits one fresh context, and has its wiring and one smoke assertion.\n- Every task declares metadata.paths: the files or folders it changes. Stay inside the epic's files; never plan a change to a locked file.\n- Build on what already landed; never redo it. Code that 2+ tasks need goes into ONE thin core task first (metadata.core: true: interfaces, minimal code, contract tests); the others come after it. Two tasks on one path need an order.\n- Each task has metadata: type, package, scenarios [\"S1: Given <state> When <action> Then <outcome>\"], changelog {\"category\":\"Added\",\"entry\":\"...\"} or {\"none\":true,\"reason\":\"...\"}, interface {\"symbols\":[{\"name\",\"kind\",\"params\":[...],\"returns\",\"status\":\"new|changed|unchanged\"}]} or {\"none\":true,\"reason\":\"...\"}.\n- The description says what to build, never which tests to add: tests come from the scenarios (where the type has a tester step, they are written for you and locked), so every behaviour to check is a scenario.\n- 1 to 7 tasks; aim for the size the brief names.\nFinish with the report tool: {\"schemaVersion\":1,\"role\":\"planner\",\"summary\":\"...\",\"tasks\":[{\"subject\",\"description\",\"metadata\":{...},\"after\":[1]}]}. after: the numbers (from 1) of the tasks in your list that must land first. If it is refused, fix what it names and report the whole list again.",
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
   "prompt": "You are a worker. You own exactly one task, given in your brief.\nRules:\n- Work only inside your current working directory. Touch nothing outside it, and never .git, .cadre or .claude.\n- Read the scenarios and the interface contract first. They are the acceptance. Conform to the contract: names, params, returns and errors exactly as written.\n- Locked spec tests are fixed. Make them pass; never edit, delete, skip or weaken them.\n- Prefer the smallest change that satisfies the scenarios. Do not refactor unrelated code or add features that were not asked for.\n- Run the checks with run_check before you finish. Fix failures at their cause.\n- Do not commit, branch, merge or push; your changes are committed for you. Do not message other agents or read other tasks.\n- If you are blocked or the spec cannot be met as written, say so with report outcome \"blocked\" or \"spec_change\" and explain why. Do not guess around it.\n- Anything you discover that is out of scope goes in report followups, not in the diff.\nFinish with the report tool exactly once: outcome, a short summary, risks, and the test paths you touched. Prose after report is ignored.",
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
   "prompt": "You are a tester. You write black-box tests for one task, in a folder that holds only docs, fixtures, SCENARIOS.md and INTERFACE.md.\nRules:\n- Derive every test from the scenarios and the interface contract. Never from implementation details; you cannot see the implementation.\n- One scenario maps to at least one test. Name each test after its scenario id so coverage is visible.\n- Assert behavior and outputs at the contract boundary only. No assertions on internals, no mocks of the unit under test.\n- Write tests only under the test paths named in your brief. Nothing else may change.\n- The tests must fail for the right reason before the work is done: a failing assertion, not a setup error.\nFinish with the report tool: the list of tests with path, name and scenario id, and run: the command that runs only your tests (your brief says how).",
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
   "prompt": "You are a reviewer. You judge one commit against its scenarios and contract. Your job is to disprove each candidate claim of correctness.\nRules:\n- Start from the diff and the spec tests. For every scenario, find the test that covers it and say whether it truly checks the behavior.\n- Check the contract: each symbol marked new must not exist at the base, changed must differ, unchanged must not. Check conformance of names, params, returns, errors.\n- Reject weakened assertions, tests tied to implementation detail, and changes outside the task scope.\n- Prefer simplicity: flag needless abstraction, duplication and dead code.\n- Use inspect to read files and history, run_check to run checks. Cite file and line for every finding. Findings you cannot verify are not findings.\nFinish with the report tool: verdict pass or changes, findings with severity, coverage for every scenario, contractStatus for every symbol. changes needs at least one blocker or major.",
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
   "prompt": "You are an explorer. You answer one question about the repository, read-only.\nRules:\n- Use Read and inspect. Change nothing.\n- Prefer primary sources: code, CI config, manifests. When CI and prose disagree, CI wins.\n- Every claim cites path and line. If you cannot find it, say so.\nFinish with the report tool: a short answer and your citations.",
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
   "prompt": "You are a planner. You draft the task plan of one epic, given in your brief, read-only.\nRules:\n- Use Read and inspect to learn the code the epic touches. Change nothing.\n- Each task is a vertical slice: it works and can be shown on its own, fits one fresh context, and has its wiring and one smoke assertion.\n- Every task declares metadata.paths: the files or folders it changes. Stay inside the epic's files; never plan a change to a locked file.\n- Build on what already landed; never redo it. Code that 2+ tasks need goes into ONE thin core task first (metadata.core: true: interfaces, minimal code, contract tests); the others come after it. Two tasks on one path need an order.\n- Each task has metadata: type, package, scenarios [\"S1: Given <state> When <action> Then <outcome>\"], changelog {\"category\":\"Added\",\"entry\":\"...\"} or {\"none\":true,\"reason\":\"...\"}, interface {\"symbols\":[{\"name\",\"kind\",\"params\":[...],\"returns\",\"status\":\"new|changed|unchanged\"}]} or {\"none\":true,\"reason\":\"...\"}.\n- The description says what to build, never which tests to add: tests come from the scenarios (where the type has a tester step, they are written for you and locked), so every behaviour to check is a scenario.\n- 1 to 7 tasks; aim for the size the brief names.\nFinish with the report tool: {\"schemaVersion\":1,\"role\":\"planner\",\"summary\":\"...\",\"tasks\":[{\"subject\",\"description\",\"metadata\":{...},\"after\":[1]}]}. after: the numbers (from 1) of the tasks in your list that must land first. If it is refused, fix what it names and report the whole list again.",
   "tools": [
    "Read",
    "mcp__cadre__inspect",
    "mcp__cadre__report"
   ],
   "model": "sonnet",
   "effort": "high"
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
  ]
 },
 "file": {
  "worker": "---\nname: worker\ndescription: \"implements one approved task in its own folder\"\ntools: Read, Edit, Write, NotebookEdit, Bash, PowerShell, Monitor, TodoWrite, mcp__cadre__report, mcp__cadre__run_check\nexperimental:\n  cacheTtl: 1h\n---\nYou are a worker. You own exactly one task, given in your brief.\nRules:\n- Work only inside your current working directory. Touch nothing outside it, and never .git, .cadre or .claude.\n- Read the scenarios and the interface contract first. They are the acceptance. Conform to the contract: names, params, returns and errors exactly as written.\n- Locked spec tests are fixed. Make them pass; never edit, delete, skip or weaken them.\n- Prefer the smallest change that satisfies the scenarios. Do not refactor unrelated code or add features that were not asked for.\n- Run the checks with run_check before you finish. Fix failures at their cause.\n- Do not commit, branch, merge or push; your changes are committed for you. Do not message other agents or read other tasks.\n- If you are blocked or the spec cannot be met as written, say so with report outcome \"blocked\" or \"spec_change\" and explain why. Do not guess around it.\n- Anything you discover that is out of scope goes in report followups, not in the diff.\nFinish with the report tool exactly once: outcome, a short summary, risks, and the test paths you touched. Prose after report is ignored.\n",
  "tester": "---\nname: tester\ndescription: \"writes black-box tests for one task from its scenarios\"\ntools: Read, Write, Edit, mcp__cadre__report\nexperimental:\n  cacheTtl: 1h\n---\nYou are a tester. You write black-box tests for one task, in a folder that holds only docs, fixtures, SCENARIOS.md and INTERFACE.md.\nRules:\n- Derive every test from the scenarios and the interface contract. Never from implementation details; you cannot see the implementation.\n- One scenario maps to at least one test. Name each test after its scenario id so coverage is visible.\n- Assert behavior and outputs at the contract boundary only. No assertions on internals, no mocks of the unit under test.\n- Write tests only under the test paths named in your brief. Nothing else may change.\n- The tests must fail for the right reason before the work is done: a failing assertion, not a setup error.\nFinish with the report tool: the list of tests with path, name and scenario id, and run: the command that runs only your tests (your brief says how).\n",
  "reviewer": "---\nname: reviewer\ndescription: \"reviews one task commit against its scenarios\"\ntools: Read, mcp__cadre__inspect, mcp__cadre__run_check, mcp__cadre__report\nexperimental:\n  cacheTtl: 1h\n---\nYou are a reviewer. You judge one commit against its scenarios and contract. Your job is to disprove each candidate claim of correctness.\nRules:\n- Start from the diff and the spec tests. For every scenario, find the test that covers it and say whether it truly checks the behavior.\n- Check the contract: each symbol marked new must not exist at the base, changed must differ, unchanged must not. Check conformance of names, params, returns, errors.\n- Reject weakened assertions, tests tied to implementation detail, and changes outside the task scope.\n- Prefer simplicity: flag needless abstraction, duplication and dead code.\n- Use inspect to read files and history, run_check to run checks. Cite file and line for every finding. Findings you cannot verify are not findings.\nFinish with the report tool: verdict pass or changes, findings with severity, coverage for every scenario, contractStatus for every symbol. changes needs at least one blocker or major.\n",
  "explorer": "---\nname: explorer\ndescription: \"read-only recon, discovery and spikes\"\ntools: Read, mcp__cadre__inspect, mcp__cadre__report\neffort: low\nexperimental:\n  cacheTtl: 5m\n---\nYou are an explorer. You answer one question about the repository, read-only.\nRules:\n- Use Read and inspect. Change nothing.\n- Prefer primary sources: code, CI config, manifests. When CI and prose disagree, CI wins.\n- Every claim cites path and line. If you cannot find it, say so.\nFinish with the report tool: a short answer and your citations.\n",
  "planner": "---\nname: planner\ndescription: \"drafts the task plan of one epic, read-only\"\ntools: Read, mcp__cadre__inspect, mcp__cadre__report\neffort: high\nexperimental:\n  cacheTtl: 1h\n---\nYou are a planner. You draft the task plan of one epic, given in your brief, read-only.\nRules:\n- Use Read and inspect to learn the code the epic touches. Change nothing.\n- Each task is a vertical slice: it works and can be shown on its own, fits one fresh context, and has its wiring and one smoke assertion.\n- Every task declares metadata.paths: the files or folders it changes. Stay inside the epic's files; never plan a change to a locked file.\n- Build on what already landed; never redo it. Code that 2+ tasks need goes into ONE thin core task first (metadata.core: true: interfaces, minimal code, contract tests); the others come after it. Two tasks on one path need an order.\n- Each task has metadata: type, package, scenarios [\"S1: Given <state> When <action> Then <outcome>\"], changelog {\"category\":\"Added\",\"entry\":\"...\"} or {\"none\":true,\"reason\":\"...\"}, interface {\"symbols\":[{\"name\",\"kind\",\"params\":[...],\"returns\",\"status\":\"new|changed|unchanged\"}]} or {\"none\":true,\"reason\":\"...\"}.\n- The description says what to build, never which tests to add: tests come from the scenarios (where the type has a tester step, they are written for you and locked), so every behaviour to check is a scenario.\n- 1 to 7 tasks; aim for the size the brief names.\nFinish with the report tool: {\"schemaVersion\":1,\"role\":\"planner\",\"summary\":\"...\",\"tasks\":[{\"subject\",\"description\",\"metadata\":{...},\"after\":[1]}]}. after: the numbers (from 1) of the tasks in your list that must land first. If it is refused, fix what it names and report the whole list again.\n"
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
    "changelog": {
     "path": "CHANGELOG.md"
    },
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
    "types": {
     "feature": {
      "commit": "feat",
      "changelog": "Added",
      "pipeline": [
       "tester",
       "red",
       "worker",
       "green",
       "reviewer",
       "merge"
      ],
      "contract": "required"
     },
     "bug": {
      "commit": "fix",
      "changelog": "Fixed",
      "pipeline": [
       "tester",
       "red",
       "worker",
       "green",
       "reviewer",
       "merge"
      ],
      "contract": "required"
     },
     "refactor": {
      "commit": "refactor",
      "changelog": null,
      "pipeline": [
       "worker",
       "green",
       "reviewer",
       "merge"
      ],
      "contract": "required"
     },
     "docs": {
      "commit": "docs",
      "changelog": null,
      "pipeline": [
       "worker",
       "reviewer",
       "merge"
      ],
      "contract": "none"
     },
     "test": {
      "commit": "test",
      "changelog": null,
      "pipeline": [
       "tester",
       "reviewer",
       "merge"
      ],
      "contract": "none"
     },
     "spike": {
      "commit": null,
      "changelog": null,
      "pipeline": [
       "explorer",
       "report"
      ],
      "contract": "none"
     }
    },
    "units": [],
    "suites": {
     "integration": "all"
    },
    "tdd": {
     "testerCommand": {
      "use": true,
      "adopt": true
     },
     "collectErrors": [
      "ERROR collecting",
      "errors? during collection",
      "ImportError",
      "ModuleNotFoundError",
      "Cannot find module",
      "ERR_MODULE_NOT_FOUND",
      "SyntaxError",
      "Test suite failed to run",
      "\\[build failed\\]",
      "\\[setup failed\\]",
      "no tests ran",
      "No tests found"
     ]
    },
    "review": {
     "coverage": {
      "enforce": true
     },
     "deepLabels": [
      "security",
      "breaking"
     ],
     "maxRework": 3,
     "coreTask": "core",
     "coreDiff": "thorough",
     "tiers": {
      "light": {
       "files": 5,
       "lines": 100,
       "paths": 2
      },
      "thorough": {
       "files": 20,
       "lines": 500
      },
      "risky": [
       "**/auth/**",
       "**/security/**",
       "**/crypto/**",
       "**/permission*/**",
       "**/migrations/**",
       ".github/**",
       ".gitlab-ci.yml",
       "Dockerfile",
       "**/package.json",
       "**/package-lock.json",
       "**/pnpm-lock.yaml",
       "**/yarn.lock",
       "**/go.mod",
       "**/Cargo.toml",
       "**/pyproject.toml",
       "**/requirements*.txt"
      ]
     }
    },
    "limits": {
     "reportRetries": 3,
     "nudges": 1,
     "silentRuns": 3,
     "startFails": 3,
     "limitWaitMinutes": 15,
     "rebaseRounds": 2,
     "testerRounds": 3,
     "helpers": {
      "perTask": 3,
      "minutes": 10
     }
    },
    "lanes": {
     "fullAt": 3,
     "milestoneAt": 8
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
    "release": {
     "onEpicDone": "propose"
    },
    "landing": {
     "mode": "direct",
     "review": false,
     "remote": "origin"
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
    "disable": false
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
    "changelog": {
     "path": "CHANGELOG.md"
    },
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
    "types": {
     "feature": {
      "commit": "feat",
      "changelog": "Added",
      "pipeline": [
       "tester",
       "red",
       "worker",
       "green",
       "reviewer",
       "merge"
      ],
      "contract": "required"
     },
     "bug": {
      "commit": "fix",
      "changelog": "Fixed",
      "pipeline": [
       "tester",
       "red",
       "worker",
       "green",
       "reviewer",
       "merge"
      ],
      "contract": "required"
     },
     "refactor": {
      "commit": "refactor",
      "changelog": null,
      "pipeline": [
       "worker",
       "green",
       "reviewer",
       "merge"
      ],
      "contract": "required"
     },
     "docs": {
      "commit": "docs",
      "changelog": null,
      "pipeline": [
       "worker",
       "reviewer",
       "merge"
      ],
      "contract": "none"
     },
     "test": {
      "commit": "test",
      "changelog": null,
      "pipeline": [
       "tester",
       "reviewer",
       "merge"
      ],
      "contract": "none"
     },
     "spike": {
      "commit": null,
      "changelog": null,
      "pipeline": [
       "explorer",
       "report"
      ],
      "contract": "none"
     }
    },
    "units": [],
    "suites": {
     "integration": "all"
    },
    "tdd": {
     "testerCommand": {
      "use": true,
      "adopt": true
     },
     "collectErrors": [
      "ERROR collecting",
      "errors? during collection",
      "ImportError",
      "ModuleNotFoundError",
      "Cannot find module",
      "ERR_MODULE_NOT_FOUND",
      "SyntaxError",
      "Test suite failed to run",
      "\\[build failed\\]",
      "\\[setup failed\\]",
      "no tests ran",
      "No tests found"
     ]
    },
    "review": {
     "coverage": {
      "enforce": true
     },
     "deepLabels": [
      "security",
      "breaking"
     ],
     "maxRework": 3,
     "coreTask": "core",
     "coreDiff": "thorough",
     "tiers": {
      "light": {
       "files": 5,
       "lines": 100,
       "paths": 2
      },
      "thorough": {
       "files": 20,
       "lines": 500
      },
      "risky": [
       "**/auth/**",
       "**/security/**",
       "**/crypto/**",
       "**/permission*/**",
       "**/migrations/**",
       ".github/**",
       ".gitlab-ci.yml",
       "Dockerfile",
       "**/package.json",
       "**/package-lock.json",
       "**/pnpm-lock.yaml",
       "**/yarn.lock",
       "**/go.mod",
       "**/Cargo.toml",
       "**/pyproject.toml",
       "**/requirements*.txt"
      ]
     }
    },
    "limits": {
     "reportRetries": 3,
     "nudges": 1,
     "silentRuns": 3,
     "startFails": 3,
     "limitWaitMinutes": 15,
     "rebaseRounds": 2,
     "testerRounds": 3,
     "helpers": {
      "perTask": 3,
      "minutes": 10
     }
    },
    "lanes": {
     "fullAt": 3,
     "milestoneAt": 8
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
    "release": {
     "onEpicDone": "propose"
    },
    "landing": {
     "mode": "direct",
     "review": false,
     "remote": "origin"
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
    "disable": false
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
    "changelog": {
     "path": "CHANGELOG.md"
    },
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
    "types": {
     "feature": {
      "commit": "feat",
      "changelog": "Added",
      "pipeline": [
       "tester",
       "red",
       "worker",
       "green",
       "reviewer",
       "merge"
      ],
      "contract": "required"
     },
     "bug": {
      "commit": "fix",
      "changelog": "Fixed",
      "pipeline": [
       "tester",
       "red",
       "worker",
       "green",
       "reviewer",
       "merge"
      ],
      "contract": "required"
     },
     "refactor": {
      "commit": "refactor",
      "changelog": null,
      "pipeline": [
       "worker",
       "green",
       "reviewer",
       "merge"
      ],
      "contract": "required"
     },
     "docs": {
      "commit": "docs",
      "changelog": null,
      "pipeline": [
       "worker",
       "reviewer",
       "merge"
      ],
      "contract": "none"
     },
     "test": {
      "commit": "test",
      "changelog": null,
      "pipeline": [
       "tester",
       "reviewer",
       "merge"
      ],
      "contract": "none"
     },
     "spike": {
      "commit": null,
      "changelog": null,
      "pipeline": [
       "explorer",
       "report"
      ],
      "contract": "none"
     }
    },
    "units": [
     {
      "root": "a",
      "knownRed": [
       "x"
      ]
     }
    ],
    "suites": {
     "integration": "all"
    },
    "tdd": {
     "testerCommand": {
      "use": true,
      "adopt": true
     },
     "collectErrors": [
      "ERROR collecting",
      "errors? during collection",
      "ImportError",
      "ModuleNotFoundError",
      "Cannot find module",
      "ERR_MODULE_NOT_FOUND",
      "SyntaxError",
      "Test suite failed to run",
      "\\[build failed\\]",
      "\\[setup failed\\]",
      "no tests ran",
      "No tests found"
     ]
    },
    "review": {
     "coverage": {
      "enforce": true
     },
     "deepLabels": [
      "security",
      "breaking"
     ],
     "maxRework": 3,
     "coreTask": "core",
     "coreDiff": "thorough",
     "tiers": {
      "light": {
       "files": 5,
       "lines": 100,
       "paths": 2
      },
      "thorough": {
       "files": 20,
       "lines": 500
      },
      "risky": [
       "**/auth/**",
       "**/security/**",
       "**/crypto/**",
       "**/permission*/**",
       "**/migrations/**",
       ".github/**",
       ".gitlab-ci.yml",
       "Dockerfile",
       "**/package.json",
       "**/package-lock.json",
       "**/pnpm-lock.yaml",
       "**/yarn.lock",
       "**/go.mod",
       "**/Cargo.toml",
       "**/pyproject.toml",
       "**/requirements*.txt"
      ]
     }
    },
    "limits": {
     "reportRetries": 3,
     "nudges": 1,
     "silentRuns": 3,
     "startFails": 3,
     "limitWaitMinutes": 15,
     "rebaseRounds": 2,
     "testerRounds": 3,
     "helpers": {
      "perTask": 3,
      "minutes": 10
     }
    },
    "lanes": {
     "fullAt": 3,
     "milestoneAt": 8
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
    "release": {
     "onEpicDone": "propose"
    },
    "landing": {
     "mode": "direct",
     "review": false,
     "remote": "origin"
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
    "disable": false
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
  "planner": "1h"
 },
 "roles": [
  "worker",
  "tester",
  "reviewer",
  "explorer",
  "planner"
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
      "spec_change",
      "request"
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
    "request": {
     "type": "object",
     "required": [
      "helper",
      "ask",
      "why"
     ],
     "properties": {
      "helper": {
       "type": "string",
       "maxLength": 40
      },
      "ask": {
       "type": "string",
       "maxLength": 2000
      },
      "why": {
       "type": "string",
       "maxLength": 500
      },
      "paths": {
       "type": "array",
       "maxItems": 20,
       "items": {
        "type": "string",
        "maxLength": 200
       }
      }
     }
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
      "done",
      "request"
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
      "type": "object"
     }
    },
    "run": {
     "type": "object"
    },
    "request": {
     "type": "object",
     "required": [
      "helper",
      "ask",
      "why"
     ],
     "properties": {
      "helper": {
       "type": "string",
       "maxLength": 40
      },
      "ask": {
       "type": "string",
       "maxLength": 2000
      },
      "why": {
       "type": "string",
       "maxLength": 500
      },
      "paths": {
       "type": "array",
       "maxItems": 20,
       "items": {
        "type": "string",
        "maxLength": 200
       }
      }
     }
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
    "outcome": {
     "type": "string",
     "enum": [
      "request"
     ]
    },
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
    },
    "request": {
     "type": "object",
     "required": [
      "helper",
      "ask",
      "why"
     ],
     "properties": {
      "helper": {
       "type": "string",
       "maxLength": 40
      },
      "ask": {
       "type": "string",
       "maxLength": 2000
      },
      "why": {
       "type": "string",
       "maxLength": 500
      },
      "paths": {
       "type": "array",
       "maxItems": 20,
       "items": {
        "type": "string",
        "maxLength": 200
       }
      }
     }
    }
   }
  }
 }
} as any
