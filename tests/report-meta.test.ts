import { describe, expect, test } from 'claude-code/testing'
import { reportMeta, reportOf } from '../core/close'

describe('worker report kept in meta', () => {
  test('a long report stays valid JSON and keeps its summary start', () => {
    const r = { summary: 'x'.repeat(5000) + '"quoted"', risks: ['r'.repeat(500)], questions: Array(20).fill('q') }
    const m = reportMeta(r)
    expect(() => JSON.parse(m)).not.toThrow()
    expect(reportOf(m).summary?.length).toBe(800)
  })
  test('a report cut mid-string by an older version still reads', () => {
    const cut = JSON.stringify({ summary: 'abc'.repeat(1000) }).slice(0, 1500)
    expect(() => JSON.parse(cut)).toThrow()
    expect(reportOf(cut).summary?.startsWith('{"summary":"abc')).toBe(true)
    expect(reportOf(undefined)).toEqual({})
  })
})
