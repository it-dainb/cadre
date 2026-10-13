// ADR 0019: where each setting's behaviour is proved outside tests/settings-behaviour.test.ts (its probes cover the rest).
// key -> [test file, a fragment of the test that changes the key]. tests/protocol/settings-registry.test.mjs checks each fragment exists.
export const ELSEWHERE: Record<string, [string, string]> = {
  'drive.mode': ['tests/drive.test.ts', "c.drive.mode = 'yolo'"], 'drive.spawn': ['tests/git/spawn.test.mjs', "c.drive.spawn = 'mod'"],
  'limits.nudges': ['tests/git/close.test.mjs', 'settings: limits.nudges 0'], 'limits.attempts': ['tests/git/close.test.mjs', 'limits.attempts 1 blocks'],
  'limits.reportRetries': ['tests/git/close.test.mjs', 'settings: limits.reportRetries 1'], 'limits.rebaseRounds': ['tests/git/close.test.mjs', 'settings: limits.rebaseRounds 1'],
  'review.maxRework': ['tests/git/close.test.mjs', 'settings: review.maxRework 1'], 'review.deepLabels': ['tests/admission.test.ts', 'settings: review.deepLabels'],
  'release.onEpicDone': ['tests/git/integrate.test.mjs', 'settings: release.onEpicDone off'], 'suites.integration': ['tests/git/integrate.test.mjs', 'c.suites.integration = ['],
  maxParallel: ['tests/admission.test.ts', 'd.cfg.maxParallel = 2'], 'milestone.maxEpics': ['tests/milestone.test.ts', 'cfg.milestone.maxEpics = maxEpics'],
  'roles.testerView': ['tests/admission.test.ts', "d.cfg.roles.testerView = 'full'"], 'roles.tdd.author': ['tests/admission.test.ts', "d.cfg.roles.tdd.author = 'same'"],
  packages: ['tests/admission.test.ts', "d.cfg.packages = [{ root: '.', setup:"],
  adapters: ['tests/protocol/protocol.test.mjs', 'const config = { ...cfgDefaults(), adapters, sync }'], sync: ['tests/protocol/protocol.test.mjs', 'const config = { ...cfgDefaults(), adapters, sync }'],
}
