// every scenario, for tests/ui-dev.test.ts (the kit has no fs). Add new scenario files here; scripts/ui-dev.mjs --all lists the directory and warns about any missing.
import type { Scenario } from './base'
import epic from './epic-p3'
import plan from './plan-approval'
import setup from './setup-sudo-and-fields'
import init from './init-stages'
import flags from './flags'
import drive from './drive-paused'
import landed from './landed-release'
import narrow from './narrow-60'
import empty from './empty-dormant'
import settings from './settings'
export const SCENARIOS: Record<string, Scenario> = { 'epic-p3': epic, 'plan-approval': plan, 'setup-sudo-and-fields': setup, 'init-stages': init, flags, 'drive-paused': drive, 'landed-release': landed, 'narrow-60': narrow, 'empty-dormant': empty, settings }
