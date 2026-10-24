// ADR 0019: where each setting's behaviour is proved outside tests/settings-behaviour.test.ts (its probes cover the rest).
// key -> [test file, a fragment of the test that changes the key]. tests/protocol/settings-registry.test.mjs checks each fragment exists.
export const ELSEWHERE: Record<string, [string, string]> = {
  'drive.mode': ['tests/drive.test.ts', "c.drive.mode = 'yolo'"], 'drive.spawn': ['tests/git/spawn.test.mjs', "c.drive.spawn = 'mod'"],
  'limits.nudges': ['tests/git/close.test.mjs', 'settings: limits.nudges 0'], 'limits.silentRuns': ['tests/git/close.test.mjs', 'limits.silentRuns 1 blocks'], 'limits.startFails': ['tests/budget-task.test.ts', 'settings: limits.startFails 2'], 'limits.limitWaitMinutes': ['tests/stop.test.ts', 'settings: limits.limitWaitMinutes 1'],
  'limits.reportRetries': ['tests/git/close.test.mjs', 'settings: limits.reportRetries 1'], 'limits.rebaseRounds': ['tests/git/close.test.mjs', 'settings: limits.rebaseRounds 1'], 'limits.testerRounds': ['tests/git/tdd.test.mjs', 'settings: limits.testerRounds 2'],
  'review.maxRework': ['tests/git/close.test.mjs', 'settings: review.maxRework 1'], 'review.deepLabels': ['tests/admission.test.ts', 'settings: review.deepLabels'],
  'release.onEpicDone': ['tests/git/integrate.test.mjs', 'settings: release.onEpicDone off'], 'suites.integration': ['tests/git/integrate.test.mjs', 'c.suites.integration = ['],
  'concurrency.models': ['tests/concurrency.test.ts', 'settings: concurrency.models'], 'concurrency.providers': ['tests/concurrency.test.ts', 'settings: concurrency.providers'], 'models.allow': ['tests/config.test.ts', 'settings: models.allow'],
  'concurrency.default': ['tests/admission.test.ts', 'd.cfg.concurrency.default = 2'], 'milestone.maxEpics': ['tests/milestone.test.ts', 'cfg.milestone.maxEpics = maxEpics'],
  'roles.testerView': ['tests/admission.test.ts', "d.cfg.roles.testerView = 'full'"], 'roles.tdd.author': ['tests/admission.test.ts', "d.cfg.roles.tdd.author = 'same'"],
  'milestone.epicPlanner': ['tests/planner.test.ts', "cfg.milestone.epicPlanner = 'main'"], 'planner.maxRounds': ['tests/planner.test.ts', 'cfg.planner.maxRounds = 2'],
  'tdd.testerCommand.use': ['tests/git/tdd.test.mjs', 'settings: tdd.testerCommand.use off'], 'tdd.testerCommand.adopt': ['tests/git/tdd.test.mjs', 'settings: tdd.testerCommand.adopt off'],
  'tdd.collectErrors': ['tests/git/tdd.test.mjs', 'settings: tdd.collectErrors'],
  units: ['tests/admission.test.ts', "d.cfg = { ...d.cfg, units: [{ root: '.', kind: 'service'"],
  'landing.mode': ['tests/git/landing-pr.test.mjs', "cfg.landing = { mode: 'pr'"], 'landing.review': ['tests/git/landing-pr.test.mjs', "review: !!o.review"], 'landing.remote': ['tests/git/landing-pr.test.mjs', "remote: 'origin' }"],
  adapters: ['tests/protocol/protocol.test.mjs', 'const config = { ...cfgDefaults(), adapters, sync }'], sync: ['tests/protocol/protocol.test.mjs', 'const config = { ...cfgDefaults(), adapters, sync }'],
  'roles.custom': ['tests/roles.test.ts', 'refused at load: roles.custom'],
  'limits.helpers.perTask': ['tests/needs.test.ts', 'settings: limits.helpers.perTask'], 'limits.helpers.minutes': ['tests/needs.test.ts', 'settings: limits.helpers.minutes'],
}
