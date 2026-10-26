import { expect, test } from 'claude-code/testing'
import { BUDGET } from './fixtures/budget.generated'   // the kit has no fs: scripts/budget.mjs freezes the LICENSE text there

test('LICENSE exists, contains it-dainb and the MIT grant', () => {
  expect(BUDGET.license).toContain('it-dainb'); expect(BUDGET.license).toContain('MIT License'); expect(BUDGET.license).toContain('Permission is hereby granted, free of charge')
})
