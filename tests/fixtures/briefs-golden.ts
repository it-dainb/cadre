// The built-in briefs as 1.0.1 rendered them (recorded from the code before the S4 role-spec change; tests/briefs.test.ts compares byte for byte).
// Regenerate only on purpose: a changed byte here is a changed model-visible text.
export const CASES: { name: string; role: 'tester' | 'worker' | 'reviewer' | 'explorer' | 'specifier'; input: Record<string, unknown>; out: string }[] = [
 {
  "name": "tester/base",
  "role": "tester",
  "input": {
   "id": "bd-a1",
   "title": "Add login",
   "type": "feature",
   "description": "Users sign in with a password.",
   "scenarios": "S1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError",
   "contract": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "notes": "start with the happy path"
  },
  "out": "Tester brief. Write black-box tests for the task below, under the test paths named. Finish with report{role:\"tester\"}.\n\n# SPEC TASK-bd-a1\n\n## Scenarios\nS1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError\n\n## Contract\n- [new] function login(email: string, pw: string) -> Session throws AuthError\n\n## Folder\ntests only; read FILES.md first: it lists what you can see (you cannot list directories)\n\n## Notes\nstart with the happy path"
 },
 {
  "name": "tester/full",
  "role": "tester",
  "input": {
   "id": "bd-a1",
   "title": "Add login",
   "type": "feature",
   "description": "Users sign in with a password.",
   "scenarios": "S1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError",
   "contract": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "notes": "start with the happy path",
   "mission": "Goal: sign in",
   "protectedPaths": [
    ".git/",
    ".cadre/"
   ],
   "core": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "shared": "shared note",
   "slice": "slice note",
   "lessons": "lesson one",
   "paths": [
    "src/a.ts",
    "test/a.test.ts"
   ],
   "testPaths": [
    "tests/**"
   ],
   "locked": [
    "tests/login.test.ts"
   ],
   "redCard": "red ✓ 2 failing",
   "greenCard": "green ✓",
   "deps": [
    {
     "id": "bd-a0",
     "title": "Schema",
     "out": "users table"
    }
   ],
   "findings": [
    "lint: 1 warning"
   ],
   "decisions": [
    "use bcrypt"
   ],
   "handoff": "checkpoint 1a2b3c4",
   "others": [
    "- bd-a2: src/other/**"
   ],
   "how": "edit src/a.ts first",
   "holds": [
    "S2"
   ],
   "runAsk": true,
   "uncovered": [
    "S2"
   ],
   "sourceCommit": "1a2b3c4",
   "diffStat": " a.ts | 3 +",
   "diff": "diff --git a/a.ts b/a.ts",
   "audit": "tester audit text",
   "report": "done: login added",
   "changelog": "Added: login",
   "flags": [
    "edited:pm:title"
   ],
   "focus": "Check this closely.",
   "question": "where is auth?"
  },
  "out": "# PLAN\nContext shared by every task of this plan; your own task follows.\n\n## Mission\nGoal: sign in\n\n## Protected paths (never change them)\n.git/\n.cadre/\n\n## Shared core interface (landed; build on it, do not change it)\n- [new] function login(email: string, pw: string) -> Session throws AuthError\n\n## Shared notes\nshared note\n\nTester brief. Write black-box tests for the task below, under the test paths named. Finish with report{role:\"tester\"}.\n\n# SPEC TASK-bd-a1\nFiles: src/a.ts, test/a.test.ts (the code this task changes)\n\n## Scenarios\nS1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError\n\n## Contract\n- [new] function login(email: string, pw: string) -> Session throws AuthError\n\n## Decided (apply it to the tests)\nuse bcrypt\n\n## Already holding\nS2: this behaviour exists already: write its test so it PASSES now (named after the id). The other scenarios' tests must fail now.\n\n## Test paths\ntests/**\n\n## How your tests run\nIn your report, give run: the command that runs only your test files and writes JUnit XML to $CADRE_JUNIT, as an argument list with no shell, e.g. {\"command\":[\"node\",\"--test\",\"--test-reporter=junit\",\"--test-reporter-destination=$CADRE_JUNIT\",\"test/login.test.js\"]} (pytest: --junitxml=$CADRE_JUNIT; jest: jest-junit); add cwd (a folder relative to this one) only if the runner must start there. Without that file your tests cannot be checked. List every test in tests[{path,name,ids}] with the scenario ids it checks, each name exactly as the runner reports it. You do not run it: it is run for you, and every test you list must fail with an assertion now, not with an import or setup error.\n\n## Notes on your files\nslice note\n\n## Lessons from earlier work\nlesson one\n\n## Folder\ntests only; read FILES.md first: it lists what you can see (you cannot list directories)\n\n## Notes\nstart with the happy path"
 },
 {
  "name": "tester/minimal",
  "role": "tester",
  "input": {
   "id": "a",
   "title": "t",
   "type": "docs"
  },
  "out": "Tester brief. Write black-box tests for the task below, under the test paths named. Finish with report{role:\"tester\"}.\n\n# SPEC TASK-a\n\n## Folder\ntests only; read FILES.md first: it lists what you can see (you cannot list directories)"
 },
 {
  "name": "tester/plan-only",
  "role": "tester",
  "input": {
   "id": "a",
   "title": "t",
   "type": "docs",
   "mission": "Goal: sign in",
   "protectedPaths": [
    ".git/",
    ".cadre/"
   ],
   "core": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "shared": "shared note",
   "slice": "slice note",
   "lessons": "lesson one"
  },
  "out": "# PLAN\nContext shared by every task of this plan; your own task follows.\n\n## Mission\nGoal: sign in\n\n## Protected paths (never change them)\n.git/\n.cadre/\n\n## Shared core interface (landed; build on it, do not change it)\n- [new] function login(email: string, pw: string) -> Session throws AuthError\n\n## Shared notes\nshared note\n\nTester brief. Write black-box tests for the task below, under the test paths named. Finish with report{role:\"tester\"}.\n\n# SPEC TASK-a\n\n## Notes on your files\nslice note\n\n## Lessons from earlier work\nlesson one\n\n## Folder\ntests only; read FILES.md first: it lists what you can see (you cannot list directories)"
 },
 {
  "name": "tester/covered",
  "role": "tester",
  "input": {
   "id": "bd-a1",
   "title": "Add login",
   "type": "feature",
   "description": "Users sign in with a password.",
   "scenarios": "S1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError",
   "contract": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "notes": "start with the happy path",
   "uncovered": []
  },
  "out": "Tester brief. Write black-box tests for the task below, under the test paths named. Finish with report{role:\"tester\"}.\n\n# SPEC TASK-bd-a1\n\n## Scenarios\nS1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError\n\n## Contract\n- [new] function login(email: string, pw: string) -> Session throws AuthError\n\n## Folder\ntests only; read FILES.md first: it lists what you can see (you cannot list directories)\n\n## Notes\nstart with the happy path"
 },
 {
  "name": "tester/question",
  "role": "tester",
  "input": {
   "id": "a",
   "title": "t",
   "type": "docs",
   "question": "q?"
  },
  "out": "Tester brief. Write black-box tests for the task below, under the test paths named. Finish with report{role:\"tester\"}.\n\n# SPEC TASK-a\n\n## Folder\ntests only; read FILES.md first: it lists what you can see (you cannot list directories)"
 },
 {
  "name": "worker/base",
  "role": "worker",
  "input": {
   "id": "bd-a1",
   "title": "Add login",
   "type": "feature",
   "description": "Users sign in with a password.",
   "scenarios": "S1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError",
   "contract": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "notes": "start with the happy path"
  },
  "out": "Worker brief. Do exactly the task below in your working directory. Conform to the contract; locked tests stay as they are; your changes are committed for you. Do not edit CHANGELOG.md: its entry is written when the task merges. Finish with report{role:\"worker\"}.\n\n# TASK-bd-a1 Add login (feature)\n\n## Description\nUsers sign in with a password.\n\n## Scenarios\nS1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError\n\n## Contract\n- [new] function login(email: string, pw: string) -> Session throws AuthError\n\n## Notes\nstart with the happy path"
 },
 {
  "name": "worker/full",
  "role": "worker",
  "input": {
   "id": "bd-a1",
   "title": "Add login",
   "type": "feature",
   "description": "Users sign in with a password.",
   "scenarios": "S1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError",
   "contract": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "notes": "start with the happy path",
   "mission": "Goal: sign in",
   "protectedPaths": [
    ".git/",
    ".cadre/"
   ],
   "core": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "shared": "shared note",
   "slice": "slice note",
   "lessons": "lesson one",
   "paths": [
    "src/a.ts",
    "test/a.test.ts"
   ],
   "testPaths": [
    "tests/**"
   ],
   "locked": [
    "tests/login.test.ts"
   ],
   "redCard": "red ✓ 2 failing",
   "greenCard": "green ✓",
   "deps": [
    {
     "id": "bd-a0",
     "title": "Schema",
     "out": "users table"
    }
   ],
   "findings": [
    "lint: 1 warning"
   ],
   "decisions": [
    "use bcrypt"
   ],
   "handoff": "checkpoint 1a2b3c4",
   "others": [
    "- bd-a2: src/other/**"
   ],
   "how": "edit src/a.ts first",
   "holds": [
    "S2"
   ],
   "runAsk": true,
   "uncovered": [
    "S2"
   ],
   "sourceCommit": "1a2b3c4",
   "diffStat": " a.ts | 3 +",
   "diff": "diff --git a/a.ts b/a.ts",
   "audit": "tester audit text",
   "report": "done: login added",
   "changelog": "Added: login",
   "flags": [
    "edited:pm:title"
   ],
   "focus": "Check this closely.",
   "question": "where is auth?"
  },
  "out": "# PLAN\nContext shared by every task of this plan; your own task follows.\n\n## Mission\nGoal: sign in\n\n## Protected paths (never change them)\n.git/\n.cadre/\n\n## Shared core interface (landed; build on it, do not change it)\n- [new] function login(email: string, pw: string) -> Session throws AuthError\n\n## Shared notes\nshared note\n\nWorker brief. Do exactly the task below in your working directory. Conform to the contract; locked tests stay as they are; your changes are committed for you. Do not edit CHANGELOG.md: its entry is written when the task merges. Finish with report{role:\"worker\"}.\n\n# TASK-bd-a1 Add login (feature)\nFiles: src/a.ts, test/a.test.ts (make your changes there)\n\n## Description\nUsers sign in with a password.\n\n## Scenarios\nS1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError\n\n## Contract\n- [new] function login(email: string, pw: string) -> Session throws AuthError\n\n## Locked spec tests\ntests/login.test.ts\nred ✓ 2 failing\n\n## Direct dependencies\n- bd-a0 Schema: users table\n\n## How (the specifier's notes; the scenarios stay as written)\nedit src/a.ts first\n\n## Findings / checks\nlint: 1 warning\ngreen ✓\n\n## Decisions\nuse bcrypt\n\n## Handoff\ncheckpoint 1a2b3c4\n\n## Paths of other active tasks\n- bd-a2: src/other/**\n\n## Notes on your files\nslice note\n\n## Lessons from earlier work\nlesson one\n\n## Notes\nstart with the happy path"
 },
 {
  "name": "worker/minimal",
  "role": "worker",
  "input": {
   "id": "a",
   "title": "t",
   "type": "docs"
  },
  "out": "Worker brief. Do exactly the task below in your working directory. Conform to the contract; locked tests stay as they are; your changes are committed for you. Do not edit CHANGELOG.md: its entry is written when the task merges. Finish with report{role:\"worker\"}.\n\n# TASK-a t (docs)"
 },
 {
  "name": "worker/plan-only",
  "role": "worker",
  "input": {
   "id": "a",
   "title": "t",
   "type": "docs",
   "mission": "Goal: sign in",
   "protectedPaths": [
    ".git/",
    ".cadre/"
   ],
   "core": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "shared": "shared note",
   "slice": "slice note",
   "lessons": "lesson one"
  },
  "out": "# PLAN\nContext shared by every task of this plan; your own task follows.\n\n## Mission\nGoal: sign in\n\n## Protected paths (never change them)\n.git/\n.cadre/\n\n## Shared core interface (landed; build on it, do not change it)\n- [new] function login(email: string, pw: string) -> Session throws AuthError\n\n## Shared notes\nshared note\n\nWorker brief. Do exactly the task below in your working directory. Conform to the contract; locked tests stay as they are; your changes are committed for you. Do not edit CHANGELOG.md: its entry is written when the task merges. Finish with report{role:\"worker\"}.\n\n# TASK-a t (docs)\n\n## Notes on your files\nslice note\n\n## Lessons from earlier work\nlesson one"
 },
 {
  "name": "worker/covered",
  "role": "worker",
  "input": {
   "id": "bd-a1",
   "title": "Add login",
   "type": "feature",
   "description": "Users sign in with a password.",
   "scenarios": "S1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError",
   "contract": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "notes": "start with the happy path",
   "uncovered": []
  },
  "out": "Worker brief. Do exactly the task below in your working directory. Conform to the contract; locked tests stay as they are; your changes are committed for you. Do not edit CHANGELOG.md: its entry is written when the task merges. Finish with report{role:\"worker\"}.\n\n# TASK-bd-a1 Add login (feature)\n\n## Description\nUsers sign in with a password.\n\n## Scenarios\nS1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError\n\n## Contract\n- [new] function login(email: string, pw: string) -> Session throws AuthError\n\n## Notes\nstart with the happy path"
 },
 {
  "name": "worker/question",
  "role": "worker",
  "input": {
   "id": "a",
   "title": "t",
   "type": "docs",
   "question": "q?"
  },
  "out": "Worker brief. Do exactly the task below in your working directory. Conform to the contract; locked tests stay as they are; your changes are committed for you. Do not edit CHANGELOG.md: its entry is written when the task merges. Finish with report{role:\"worker\"}.\n\n# TASK-a t (docs)"
 },
 {
  "name": "reviewer/base",
  "role": "reviewer",
  "input": {
   "id": "bd-a1",
   "title": "Add login",
   "type": "feature",
   "description": "Users sign in with a password.",
   "scenarios": "S1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError",
   "contract": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "notes": "start with the happy path"
  },
  "out": "Reviewer brief. Disprove the claim that the commit below satisfies its scenarios and contract. Read-only. The changelog entry is written when the task merges; do not look for it in the diff. Finish with report{role:\"reviewer\"}.\n\n# REVIEW TASK-bd-a1\n\n## Scenarios\nS1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError\n\n## Contract\n- [new] function login(email: string, pw: string) -> Session throws AuthError\n\n## Notes\nstart with the happy path"
 },
 {
  "name": "reviewer/full",
  "role": "reviewer",
  "input": {
   "id": "bd-a1",
   "title": "Add login",
   "type": "feature",
   "description": "Users sign in with a password.",
   "scenarios": "S1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError",
   "contract": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "notes": "start with the happy path",
   "mission": "Goal: sign in",
   "protectedPaths": [
    ".git/",
    ".cadre/"
   ],
   "core": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "shared": "shared note",
   "slice": "slice note",
   "lessons": "lesson one",
   "paths": [
    "src/a.ts",
    "test/a.test.ts"
   ],
   "testPaths": [
    "tests/**"
   ],
   "locked": [
    "tests/login.test.ts"
   ],
   "redCard": "red ✓ 2 failing",
   "greenCard": "green ✓",
   "deps": [
    {
     "id": "bd-a0",
     "title": "Schema",
     "out": "users table"
    }
   ],
   "findings": [
    "lint: 1 warning"
   ],
   "decisions": [
    "use bcrypt"
   ],
   "handoff": "checkpoint 1a2b3c4",
   "others": [
    "- bd-a2: src/other/**"
   ],
   "how": "edit src/a.ts first",
   "holds": [
    "S2"
   ],
   "runAsk": true,
   "uncovered": [
    "S2"
   ],
   "sourceCommit": "1a2b3c4",
   "diffStat": " a.ts | 3 +",
   "diff": "diff --git a/a.ts b/a.ts",
   "audit": "tester audit text",
   "report": "done: login added",
   "changelog": "Added: login",
   "flags": [
    "edited:pm:title"
   ],
   "focus": "Check this closely.",
   "question": "where is auth?"
  },
  "out": "# PLAN\nContext shared by every task of this plan; your own task follows.\n\n## Mission\nGoal: sign in\n\n## Protected paths (never change them)\n.git/\n.cadre/\n\n## Shared core interface (landed; build on it, do not change it)\n- [new] function login(email: string, pw: string) -> Session throws AuthError\n\n## Shared notes\nshared note\n\nReviewer brief. Disprove the claim that the commit below satisfies its scenarios and contract. Read-only. The changelog entry is written when the task merges; do not look for it in the diff. Finish with report{role:\"reviewer\"}.\n\n# REVIEW TASK-bd-a1\nFiles: src/a.ts, test/a.test.ts (a change outside these files is a finding, not a fail on its own)\n\n## Source commit\n1a2b3c4\n\n## Diff\na.ts | 3 +\ndiff --git a/a.ts b/a.ts\n\n## Scenarios\nS1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError\n\n## Contract\n- [new] function login(email: string, pw: string) -> Session throws AuthError\n\n## Spec tests\ntests/login.test.ts\n\n## Scenario coverage\nEvery scenario needs a spec test named after its id that really checks it. In coverage, give each scenario its test and ok:true only when that test truly checks the behavior; a scenario with no test, or a weak one (ok:false), means verdict changes with a major finding for it.\nNo spec test is named after: S2. That alone means verdict changes.\n\n## Red/green cards\nred ✓ 2 failing\ngreen ✓\n\n## Tester audit\ntester audit text\n\n## Worker report\ndone: login added\n\n## Check\nCheck this closely.\n\n## Changelog entry (context, written at merge) and commit header\nAdded: login\n\n## Flags\nedited:pm:title\n\n## Notes on your files\nslice note\n\n## Lessons from earlier work\nlesson one\n\n## Notes\nstart with the happy path"
 },
 {
  "name": "reviewer/minimal",
  "role": "reviewer",
  "input": {
   "id": "a",
   "title": "t",
   "type": "docs"
  },
  "out": "Reviewer brief. Disprove the claim that the commit below satisfies its scenarios and contract. Read-only. The changelog entry is written when the task merges; do not look for it in the diff. Finish with report{role:\"reviewer\"}.\n\n# REVIEW TASK-a"
 },
 {
  "name": "reviewer/plan-only",
  "role": "reviewer",
  "input": {
   "id": "a",
   "title": "t",
   "type": "docs",
   "mission": "Goal: sign in",
   "protectedPaths": [
    ".git/",
    ".cadre/"
   ],
   "core": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "shared": "shared note",
   "slice": "slice note",
   "lessons": "lesson one"
  },
  "out": "# PLAN\nContext shared by every task of this plan; your own task follows.\n\n## Mission\nGoal: sign in\n\n## Protected paths (never change them)\n.git/\n.cadre/\n\n## Shared core interface (landed; build on it, do not change it)\n- [new] function login(email: string, pw: string) -> Session throws AuthError\n\n## Shared notes\nshared note\n\nReviewer brief. Disprove the claim that the commit below satisfies its scenarios and contract. Read-only. The changelog entry is written when the task merges; do not look for it in the diff. Finish with report{role:\"reviewer\"}.\n\n# REVIEW TASK-a\n\n## Notes on your files\nslice note\n\n## Lessons from earlier work\nlesson one"
 },
 {
  "name": "reviewer/covered",
  "role": "reviewer",
  "input": {
   "id": "bd-a1",
   "title": "Add login",
   "type": "feature",
   "description": "Users sign in with a password.",
   "scenarios": "S1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError",
   "contract": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "notes": "start with the happy path",
   "uncovered": []
  },
  "out": "Reviewer brief. Disprove the claim that the commit below satisfies its scenarios and contract. Read-only. The changelog entry is written when the task merges; do not look for it in the diff. Finish with report{role:\"reviewer\"}.\n\n# REVIEW TASK-bd-a1\n\n## Scenarios\nS1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError\n\n## Contract\n- [new] function login(email: string, pw: string) -> Session throws AuthError\n\n## Scenario coverage\nEvery scenario needs a spec test named after its id that really checks it. In coverage, give each scenario its test and ok:true only when that test truly checks the behavior; a scenario with no test, or a weak one (ok:false), means verdict changes with a major finding for it.\n\n## Notes\nstart with the happy path"
 },
 {
  "name": "reviewer/question",
  "role": "reviewer",
  "input": {
   "id": "a",
   "title": "t",
   "type": "docs",
   "question": "q?"
  },
  "out": "Reviewer brief. Disprove the claim that the commit below satisfies its scenarios and contract. Read-only. The changelog entry is written when the task merges; do not look for it in the diff. Finish with report{role:\"reviewer\"}.\n\n# REVIEW TASK-a"
 },
 {
  "name": "explorer/base",
  "role": "explorer",
  "input": {
   "id": "bd-a1",
   "title": "Add login",
   "type": "feature",
   "description": "Users sign in with a password.",
   "scenarios": "S1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError",
   "contract": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "notes": "start with the happy path"
  },
  "out": "Explorer brief. Read-only. Answer with citations. Finish with report{role:\"explorer\"}.\n\n# TASK-bd-a1\nAdd login\n\n## Scope\nread-only; no edits, no shell\n\n## Notes\nstart with the happy path"
 },
 {
  "name": "explorer/full",
  "role": "explorer",
  "input": {
   "id": "bd-a1",
   "title": "Add login",
   "type": "feature",
   "description": "Users sign in with a password.",
   "scenarios": "S1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError",
   "contract": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "notes": "start with the happy path",
   "mission": "Goal: sign in",
   "protectedPaths": [
    ".git/",
    ".cadre/"
   ],
   "core": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "shared": "shared note",
   "slice": "slice note",
   "lessons": "lesson one",
   "paths": [
    "src/a.ts",
    "test/a.test.ts"
   ],
   "testPaths": [
    "tests/**"
   ],
   "locked": [
    "tests/login.test.ts"
   ],
   "redCard": "red ✓ 2 failing",
   "greenCard": "green ✓",
   "deps": [
    {
     "id": "bd-a0",
     "title": "Schema",
     "out": "users table"
    }
   ],
   "findings": [
    "lint: 1 warning"
   ],
   "decisions": [
    "use bcrypt"
   ],
   "handoff": "checkpoint 1a2b3c4",
   "others": [
    "- bd-a2: src/other/**"
   ],
   "how": "edit src/a.ts first",
   "holds": [
    "S2"
   ],
   "runAsk": true,
   "uncovered": [
    "S2"
   ],
   "sourceCommit": "1a2b3c4",
   "diffStat": " a.ts | 3 +",
   "diff": "diff --git a/a.ts b/a.ts",
   "audit": "tester audit text",
   "report": "done: login added",
   "changelog": "Added: login",
   "flags": [
    "edited:pm:title"
   ],
   "focus": "Check this closely.",
   "question": "where is auth?"
  },
  "out": "# PLAN\nContext shared by every task of this plan; your own task follows.\n\n## Mission\nGoal: sign in\n\n## Protected paths (never change them)\n.git/\n.cadre/\n\n## Shared core interface (landed; build on it, do not change it)\n- [new] function login(email: string, pw: string) -> Session throws AuthError\n\n## Shared notes\nshared note\n\nExplorer brief. Read-only. Answer with citations. Finish with report{role:\"explorer\"}.\n\n# QUESTION\nwhere is auth?\n\n## Scope\nread-only; no edits, no shell\n\n## Notes on your files\nslice note\n\n## Lessons from earlier work\nlesson one\n\n## Notes\nstart with the happy path"
 },
 {
  "name": "explorer/minimal",
  "role": "explorer",
  "input": {
   "id": "a",
   "title": "t",
   "type": "docs"
  },
  "out": "Explorer brief. Read-only. Answer with citations. Finish with report{role:\"explorer\"}.\n\n# TASK-a\nt\n\n## Scope\nread-only; no edits, no shell"
 },
 {
  "name": "explorer/plan-only",
  "role": "explorer",
  "input": {
   "id": "a",
   "title": "t",
   "type": "docs",
   "mission": "Goal: sign in",
   "protectedPaths": [
    ".git/",
    ".cadre/"
   ],
   "core": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "shared": "shared note",
   "slice": "slice note",
   "lessons": "lesson one"
  },
  "out": "# PLAN\nContext shared by every task of this plan; your own task follows.\n\n## Mission\nGoal: sign in\n\n## Protected paths (never change them)\n.git/\n.cadre/\n\n## Shared core interface (landed; build on it, do not change it)\n- [new] function login(email: string, pw: string) -> Session throws AuthError\n\n## Shared notes\nshared note\n\nExplorer brief. Read-only. Answer with citations. Finish with report{role:\"explorer\"}.\n\n# TASK-a\nt\n\n## Scope\nread-only; no edits, no shell\n\n## Notes on your files\nslice note\n\n## Lessons from earlier work\nlesson one"
 },
 {
  "name": "explorer/covered",
  "role": "explorer",
  "input": {
   "id": "bd-a1",
   "title": "Add login",
   "type": "feature",
   "description": "Users sign in with a password.",
   "scenarios": "S1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError",
   "contract": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "notes": "start with the happy path",
   "uncovered": []
  },
  "out": "Explorer brief. Read-only. Answer with citations. Finish with report{role:\"explorer\"}.\n\n# TASK-bd-a1\nAdd login\n\n## Scope\nread-only; no edits, no shell\n\n## Notes\nstart with the happy path"
 },
 {
  "name": "explorer/question",
  "role": "explorer",
  "input": {
   "id": "a",
   "title": "t",
   "type": "docs",
   "question": "q?"
  },
  "out": "Explorer brief. Read-only. Answer with citations. Finish with report{role:\"explorer\"}.\n\n# QUESTION\nq?\n\n## Scope\nread-only; no edits, no shell"
 },
 {
  "name": "specifier/base",
  "role": "specifier",
  "input": {
   "id": "bd-a1",
   "title": "Add login",
   "type": "feature",
   "description": "Users sign in with a password.",
   "scenarios": "S1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError",
   "contract": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "notes": "start with the happy path"
  },
  "out": "Specifier brief. Read-only. Write how-to notes for the task below; the scenarios and the contract stay as they are. Finish with report{role:\"specifier\"}.\n\n# TASK-bd-a1 Add login (feature)\n\n## Description\nUsers sign in with a password.\n\n## Scenarios\nS1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError\n\n## Contract\n- [new] function login(email: string, pw: string) -> Session throws AuthError\n\n## Scope\nread-only; no edits, no shell\n\n## Notes\nstart with the happy path"
 },
 {
  "name": "specifier/full",
  "role": "specifier",
  "input": {
   "id": "bd-a1",
   "title": "Add login",
   "type": "feature",
   "description": "Users sign in with a password.",
   "scenarios": "S1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError",
   "contract": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "notes": "start with the happy path",
   "mission": "Goal: sign in",
   "protectedPaths": [
    ".git/",
    ".cadre/"
   ],
   "core": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "shared": "shared note",
   "slice": "slice note",
   "lessons": "lesson one",
   "paths": [
    "src/a.ts",
    "test/a.test.ts"
   ],
   "testPaths": [
    "tests/**"
   ],
   "locked": [
    "tests/login.test.ts"
   ],
   "redCard": "red ✓ 2 failing",
   "greenCard": "green ✓",
   "deps": [
    {
     "id": "bd-a0",
     "title": "Schema",
     "out": "users table"
    }
   ],
   "findings": [
    "lint: 1 warning"
   ],
   "decisions": [
    "use bcrypt"
   ],
   "handoff": "checkpoint 1a2b3c4",
   "others": [
    "- bd-a2: src/other/**"
   ],
   "how": "edit src/a.ts first",
   "holds": [
    "S2"
   ],
   "runAsk": true,
   "uncovered": [
    "S2"
   ],
   "sourceCommit": "1a2b3c4",
   "diffStat": " a.ts | 3 +",
   "diff": "diff --git a/a.ts b/a.ts",
   "audit": "tester audit text",
   "report": "done: login added",
   "changelog": "Added: login",
   "flags": [
    "edited:pm:title"
   ],
   "focus": "Check this closely.",
   "question": "where is auth?"
  },
  "out": "# PLAN\nContext shared by every task of this plan; your own task follows.\n\n## Mission\nGoal: sign in\n\n## Protected paths (never change them)\n.git/\n.cadre/\n\n## Shared core interface (landed; build on it, do not change it)\n- [new] function login(email: string, pw: string) -> Session throws AuthError\n\n## Shared notes\nshared note\n\nSpecifier brief. Read-only. Write how-to notes for the task below; the scenarios and the contract stay as they are. Finish with report{role:\"specifier\"}.\n\n# TASK-bd-a1 Add login (feature)\nFiles: src/a.ts, test/a.test.ts\n\n## Description\nUsers sign in with a password.\n\n## Scenarios\nS1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError\n\n## Contract\n- [new] function login(email: string, pw: string) -> Session throws AuthError\n\n## Scope\nread-only; no edits, no shell\n\n## Notes on your files\nslice note\n\n## Lessons from earlier work\nlesson one\n\n## Notes\nstart with the happy path"
 },
 {
  "name": "specifier/minimal",
  "role": "specifier",
  "input": {
   "id": "a",
   "title": "t",
   "type": "docs"
  },
  "out": "Specifier brief. Read-only. Write how-to notes for the task below; the scenarios and the contract stay as they are. Finish with report{role:\"specifier\"}.\n\n# TASK-a t (docs)\n\n## Scope\nread-only; no edits, no shell"
 },
 {
  "name": "specifier/plan-only",
  "role": "specifier",
  "input": {
   "id": "a",
   "title": "t",
   "type": "docs",
   "mission": "Goal: sign in",
   "protectedPaths": [
    ".git/",
    ".cadre/"
   ],
   "core": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "shared": "shared note",
   "slice": "slice note",
   "lessons": "lesson one"
  },
  "out": "# PLAN\nContext shared by every task of this plan; your own task follows.\n\n## Mission\nGoal: sign in\n\n## Protected paths (never change them)\n.git/\n.cadre/\n\n## Shared core interface (landed; build on it, do not change it)\n- [new] function login(email: string, pw: string) -> Session throws AuthError\n\n## Shared notes\nshared note\n\nSpecifier brief. Read-only. Write how-to notes for the task below; the scenarios and the contract stay as they are. Finish with report{role:\"specifier\"}.\n\n# TASK-a t (docs)\n\n## Scope\nread-only; no edits, no shell\n\n## Notes on your files\nslice note\n\n## Lessons from earlier work\nlesson one"
 },
 {
  "name": "specifier/covered",
  "role": "specifier",
  "input": {
   "id": "bd-a1",
   "title": "Add login",
   "type": "feature",
   "description": "Users sign in with a password.",
   "scenarios": "S1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError",
   "contract": "{\"symbols\":[{\"name\":\"login\",\"kind\":\"function\",\"params\":[\"email: string\",\"pw: string\"],\"returns\":\"Session\",\"errors\":[\"AuthError\"],\"status\":\"new\"}]}",
   "notes": "start with the happy path",
   "uncovered": []
  },
  "out": "Specifier brief. Read-only. Write how-to notes for the task below; the scenarios and the contract stay as they are. Finish with report{role:\"specifier\"}.\n\n# TASK-bd-a1 Add login (feature)\n\n## Description\nUsers sign in with a password.\n\n## Scenarios\nS1: Given a user When they log in Then a session exists\nS2: Given a bad pw When login Then AuthError\n\n## Contract\n- [new] function login(email: string, pw: string) -> Session throws AuthError\n\n## Scope\nread-only; no edits, no shell\n\n## Notes\nstart with the happy path"
 },
 {
  "name": "specifier/question",
  "role": "specifier",
  "input": {
   "id": "a",
   "title": "t",
   "type": "docs",
   "question": "q?"
  },
  "out": "Specifier brief. Read-only. Write how-to notes for the task below; the scenarios and the contract stay as they are. Finish with report{role:\"specifier\"}.\n\n# TASK-a t (docs)\n\n## Scope\nread-only; no edits, no shell"
 }
]
