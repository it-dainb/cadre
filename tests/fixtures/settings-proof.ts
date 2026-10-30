// ADR 0019: where each setting's behaviour is proved outside tests/settings-behaviour.test.ts (its probes cover the rest).
// key -> [test file, a fragment of the test that changes the key]. tests/protocol/settings-registry.test.mjs checks each fragment exists.
export const ELSEWHERE: Record<string, [string, string]> = {
  'drive.mode': ['tests/drive.test.ts', "c.drive.mode = 'yolo'"], 'drive.spawn': ['tests/git/spawn.test.mjs', "c.drive.spawn = 'mod'"],
  'limits.nudges': ['tests/git/close.test.mjs', 'settings: limits.nudges 0'], 'limits.silentRuns': ['tests/git/close.test.mjs', 'limits.silentRuns 1 blocks'], 'limits.startFails': ['tests/budget-task.test.ts', 'settings: limits.startFails 2'], 'limits.limitWaitMinutes': ['tests/stop.test.ts', 'settings: limits.limitWaitMinutes 1'],
  'limits.reportRetries': ['tests/git/close.test.mjs', 'settings: limits.reportRetries 1'], 'limits.shapeRetries': ['tests/validate.test.ts', 'the 6th shape refusal blocks the task'], 'limits.rebaseRounds': ['tests/git/close.test.mjs', 'settings: limits.rebaseRounds 1'], 'limits.specAccepts': ['tests/drive.test.ts', 'settings: limits.specAccepts 1'],
  'concurrency.models': ['tests/concurrency.test.ts', 'settings: concurrency.models'], 'concurrency.providers': ['tests/concurrency.test.ts', 'settings: concurrency.providers'], 'models.allow': ['tests/config.test.ts', 'settings: models.allow'],
  'concurrency.default': ['tests/admission.test.ts', 'd.cfg.concurrency.default = 2'], 'milestone.maxEpics': ['tests/milestone.test.ts', 'cfg.milestone.maxEpics = maxEpics'],
  'roles.testerView': ['tests/admission.test.ts', "d.cfg.roles.testerView = 'full'"], 'roles.tdd.author': ['tests/admission.test.ts', "d.cfg.roles.tdd.author = 'same'"],
  'milestone.epicPlanner': ['tests/planner.test.ts', "cfg.milestone.epicPlanner = 'main'"], 'planner.maxRounds': ['tests/planner.test.ts', 'cfg.planner.maxRounds = 2'],
  units: ['tests/admission.test.ts', "d.cfg = { ...d.cfg, units: [{ root: '.', kind: 'service'"],
  adapters: ['tests/modules/sync.test.mjs', 'const config = { ...defaults(), adapters, sync }'], sync: ['tests/modules/sync.test.mjs', 'const config = { ...defaults(), adapters, sync }'],
  'lessons.model': ['tests/lessons.test.ts', 'settings: lessons.model'], 'lessons.passesPerDay': ['tests/lessons.test.ts', 'settings: lessons.passesPerDay'], 'lessons.repeats': ['tests/lessons.test.ts', 'settings: lessons.repeats'], 'lessons.repos': ['tests/lessons.test.ts', 'settings: lessons.repos'],
  'lessons.decayDays': ['tests/lessons.test.ts', 'settings: lessons.decayDays'], 'lessons.maxAgeDays': ['tests/lessons.test.ts', 'settings: lessons.maxAgeDays'], 'lessons.perBrief': ['tests/lessons.test.ts', 'settings: lessons.perBrief'],
  'roles.specifier.enabled': ['tests/specifier.test.ts', 'settings: roles.specifier.enabled'],
  'limits.stagnantNudges': ['tests/hygiene.test.ts', 'settings: limits.stagnantNudges'], 'lifecycle.firstOutputSec': ['tests/hygiene.test.ts', 'settings: lifecycle.firstOutputSec'], 'lifecycle.staleMin': ['tests/hygiene.test.ts', 'settings: lifecycle.staleMin'], 'lifecycle.goneSec': ['tests/hygiene.test.ts', 'settings: lifecycle.goneSec'],
}
