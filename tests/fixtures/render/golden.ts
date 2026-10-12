// Goldens for the model-visible renders (DESIGN 4.5, 6.4, 6.5). A change here is a deliberate, reviewed edit.
export const GOLD = {
  context: 'plan p3 approved · epic/p3-auth · ready: a1 a4 · running: a2(w) a3(r) · a5 review✓ · a6 blocked · sync: pm offline (4)\nnext: complete TASK-a5; a6 waits for the user (go on with the rest); spawn TASK-a1',
  card: 'TASK bd-a1 "Add login" · worker → review · green ✓ (test 41s) · files 4 (+120 −30) · commit 1a2b3c4 · $0.41 (cache 91%) · flags: none · next: spawn TASK-bd-a1 (reviewer)',
  commit: 'feat(auth): add login\n\nAdds email login.\n\nRefs: bd-a1\nCadre-Review: pass@1a2b3c4\nCadre-Checks: test ✓, lint ✓',
  breaking: 'fix!: drop v1 api\n\nBREAKING CHANGE: v1 endpoints are gone\nRefs: bd-b2',
  comment: '[cadre:check v1] bd-a1 @1700 by mod\nname: test\nexit: 0\nsecs: 41\nclaimed:\n  note: ok',
  get: ['Email login.', 'Scenarios:', '- S1: Given a When b Then c', '- S2: Given d When e Then f', 'Contract:', '- [changed] login (function) (e: string) -> Session throws AuthError: logs in',
    'Changelog: none (internal)', 'type feature · package . · breaking · step reviewer · owner ag3 · flags edited:pm:title', '[check] lint ✓', '[green] green ✓ test 41s'].join('\n'),
}
