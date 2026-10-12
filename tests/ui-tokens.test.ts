// v2 tokens + layout helpers (BRAND §3, §5, §6, §7).
import { describe, expect, test } from 'claude-code/testing'
import { ALLOWED, asciiOf, glyph, raster, readCfg, themeOf } from '../ui/tokens'
import { elapsed, plural, relTime, row, strange, width } from '../ui/layout'

describe('tokens', () => {
  test('ascii: setting, TERM=dumb, non-UTF-8 locale', () => {
    expect([asciiOf('ascii', {}), asciiOf(undefined, { TERM: 'dumb' }), asciiOf(undefined, { LANG: 'C' }), asciiOf(undefined, { LANG: 'en_US.UTF-8' }), asciiOf(undefined, {})]).toEqual([true, true, true, false, false])
    expect([glyph('run', false), glyph('run', true), glyph('done', false)]).toEqual(['›', '>', '✓'])
  })
  test('theme and raster palette', () => {
    expect([themeOf([{ key: 'theme', value: 'light-daltonized' }]), themeOf([{ key: 'theme', value: 'dark' }]), themeOf([])]).toEqual(['light', 'dark', 'unknown'])
    expect([raster('work', 'dark'), raster('work', 'light'), raster('work', 'unknown')]).toEqual([0xd77757, 0xb4532e, 0x01000000])
  })
  test('cfg readers default sanely', () => {
    expect(readCfg({})).toEqual({ ascii: false, flash: true, density: 'normal', theme: 'unknown', v2: false })
    expect(readCfg({ cfg: { flash: false, density: 'compact', v2: true, glyphs: 'ascii' } })).toMatchObject({ flash: false, density: 'compact', v2: true, ascii: true })
  })
  test('the glyph set is all width 1', () => { for (const g of ALLOWED) expect(width(g)).toBe(1); expect(strange('a ✓ ⏸ ⚠')).toEqual(['⏸', '⚠']) })
})

describe('layout', () => {
  test('times and plurals', () => {
    expect([relTime(10_000), relTime(9 * 60000), relTime(125 * 60000), elapsed(23 * 60000), elapsed(65 * 60000), plural(1, 'task'), plural(3, 'task')]).toEqual(['now', '9m ago', '2h ago', '23m', '1h05', '1 task', '3 tasks'])
  })
  test('row fits every width, facts drop right to left, id and glyph stay', () => {
    const r = { glyph: '✓', id: 'a1', title: 'Add login with a long title', facts: ['merged', 'extra'], time: '9m ago' }
    for (const w of [40, 60, 80, 120, 160]) { const s = row(r, w); expect(width(s) <= w).toBe(true); expect(s.startsWith('  ✓ a1 ')).toBe(true) }
    expect(row(r, 40)).not.toContain('extra')
    expect(row(r, 120)).toContain('merged · extra')
    expect(row(r, 120).endsWith('9m ago')).toBe(true)
  })
})
