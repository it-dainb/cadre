// Golden: the plan rules answer for the default type registry (DESIGN 3.1). A change here is a deliberate, reviewed edit (byte-stable, ≤1.5 KB).
export const RULES = [
  'cadre plan rules (v1)',
  '- Start a plan with TaskCreate metadata {"kind":"plan"}; every later TaskCreate is a task of that plan. Order tasks with TaskUpdate addBlockedBy.',
  '- Task metadata: type, scope?, breaking?, package, scenarios ["S1: Given <state> When <action> Then <outcome>"], changelog {"category":"Added","entry":"…"} or {"none":true,"reason":"…"}, interface {"symbols":[{"name","kind","params":[…],"returns","status":"new|changed|unchanged"}]} or {"none":true,"reason":"…"}.',
  '- Types and pipelines: feature tester>red>worker>green>reviewer>merge; bug tester>red>worker>green>reviewer>merge; refactor worker>green>reviewer>merge; docs worker>reviewer>merge; test tester>reviewer>merge; spike explorer>report.',
  '- A draft may be incomplete: the "missing:" line says what approval still needs.',
  '- Only the human approves (/cadre approve). Approved tasks are frozen: set metadata.amend:true to edit one. Never set owner, in_progress or cadre*.',
].join('\n')
