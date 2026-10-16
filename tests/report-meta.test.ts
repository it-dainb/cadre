import { describe, expect, test } from 'claude-code/testing'
import { reportMeta, reportOf } from '../core/close'

describe('worker report kept in meta', () => {
  test('the report contract caps the fields, so the kept report is whole valid JSON', () => {
    const r = { summary: 'x'.repeat(790) + '"quoted"', risks: ['r'.repeat(120)], questions: Array(5).fill('q') }
    const m = reportMeta(r)
    expect(() => JSON.parse(m)).not.toThrow(); expect(JSON.parse(m)).toEqual(r)
  })
  test('a report cut mid-string by an older version still reads', () => {
    const cut = JSON.stringify({ summary: 'abc'.repeat(1000) }).slice(0, 1500)
    expect(() => JSON.parse(cut)).toThrow()
    expect(reportOf(cut).summary?.startsWith('{"summary":"abc')).toBe(true)
    expect(reportOf(undefined)).toEqual({})
  })
})
