import { describe, expect, test } from 'claude-code/testing'
import { doctor, machine, nudge, setup } from '../commands/doctor'
import { defaults } from '../config/index'
import { banned } from './fixtures/wording'
import { fakeHost } from './support'
import type { Host } from '../types'

type R = { exitCode: number; stdout: string; stderr: string }
const HOME = '/hm/u', USER = `${HOME}/.claude/settings.json`
// scripted machine: `tools` maps argv[0] to its output (absent = not installed); `jail` = overlay | copy | none
function mk(o: { tools?: Record<string, string>; os?: string; repo?: boolean; jail?: 'overlay' | 'copy' | 'none'; cc?: string; files?: Record<string, string> } = {}) {
  const files = { ...o.files }, calls: string[][] = [], writes: string[] = [], tools = o.tools ?? { git: 'git version 2.43.0', bd: 'bd version 1.3.1', bwrap: 'bubblewrap 0.11.0', socat: 'socat version 1.8' }
  const h = fakeHost({ files }) as Host & { toasts: string[] }
  const rand = (() => { let n = 0; return () => `n${++n}`.padEnd(16, '0') })()
  Object.assign(h, {
    rand, cwd: async () => '/repo', home: async () => HOME, version: async () => o.cc ?? '2.1.295', write: async (p: string, t: string) => { writes.push(p); files[p] = t },
    stat: async (p: string) => (p === '/hm' || p === '/' ? { kind: 'dir' } : undefined),
    run: async (argv: string[]): Promise<R> => {
      calls.push(argv); const j = argv.join(' '), out = (stdout: string, exitCode = 0): R => ({ exitCode, stdout, stderr: '' })
      if (argv[0] === 'uname') return out(o.os ?? 'Linux')
      if (argv[0] === 'test') return out('')
      if (argv[0] === 'bwrap') return !tools.bwrap || (o.jail === 'none' && argv[1] !== '--version') ? out('', 127) : argv[1] === '--help' ? out(o.jail === 'copy' ? 'usage' : '--overlay-src') : out(tools.bwrap)
      if (argv[0] === 'bd' && argv[1] === 'update') return out('--if-revision')
      if (argv[0] === 'git') return argv[1] === '--version' ? (tools.git ? out(tools.git) : out('', 127)) : o.repo && j.includes('rev-parse --git-dir') ? out('.git') : out('', 1)
      if (tools[argv[0]]) return out(tools[argv[0]])
      return j.startsWith('git') ? out('', 1) : out('', 127)
    },
  })
  return Object.assign(h, { files, calls, writes })
}
const rowsOf = async (h: Host) => (await machine(h, defaults() as any)).rows, lvl = (rs: any[], re: RegExp) => rs.find(r => re.test(r[1]))

describe('machine checks', () => {
  test('a healthy machine is all ok', async () => { expect((await rowsOf(mk())).map(r => r[0])).toEqual(Array(6).fill('ok')) })
  test('missing tools fail with the exact command for the human', async () => {
    const rs = await rowsOf(mk({ tools: {} }))
    expect(lvl(rs, /git/)).toEqual(['crit', 'git not found', '! sudo apt install git'])
    expect(lvl(rs, /bd/)[2]).toBe('! npm install -g @beads/bd')
    expect(lvl(rs, /bwrap/)[2]).toBe('! sudo apt install bubblewrap socat')
    expect(lvl(rs, /socat/)[2]).toBe('! sudo apt install socat')
  })
  test('old bd fails, old bwrap warns (copy-jail), no namespaces warns', async () => {
    expect(lvl(await rowsOf(mk({ tools: { git: 'git version 2.43.0', bd: 'bd version 1.2.9', bwrap: 'bubblewrap 0.8.0', socat: 'x' }, jail: 'copy' })), /bd/)[0]).toBe('crit')
    expect(lvl(await rowsOf(mk({ jail: 'copy' })), /overlay/)[0]).toBe('warn')
    expect(lvl(await rowsOf(mk({ jail: 'none' })), /user namespace/)[0]).toBe('warn')
  })
  test('macOS: no bwrap, no socat check, throwaway-worktree mode', async () => {
    const rs = await rowsOf(mk({ os: 'Darwin', tools: { git: 'git version 2.43.0', bd: 'bd version 1.3.1' } }))
    expect(lvl(rs, /macOS: throwaway/)![0]).toBe('warn'); expect(lvl(rs, /socat/)).toBeUndefined()
  })
  test('another Claude Code build is an untested-build warning', async () => { expect(lvl(await rowsOf(mk({ cc: '2.1.300' })), /Claude Code/)).toEqual(['warn', expect.stringContaining('untested build'), expect.stringContaining('2.1.295')]) })
})

describe('setup', () => {
  const sigOf = async (h: Host) => (await h.secret.read()).initConfirm!
  test('proposes the user-settings diff, writes nothing, and the command text is one line', async () => {
    const h = mk(), t = await setup(h, [])
    expect(t).toBe('setup: 0 fail, 1 warn — report in the cadre pane'); expect(t.includes('\n')).toBe(false); expect(banned(t)).toEqual([])
    expect(h.writes).toEqual([]); expect((await sigOf(h)).stage).toBe(90); expect(await h.store.get('cadre:setup')).toBeUndefined()
    expect(h.logs.join('\n')).toContain('CLAUDE_CODE_ENABLE_TODO_TOOLS')
  })
  test('a wrong code is refused and burned; the right code afterwards also fails until re-proposed', async () => {
    const h = mk(); await setup(h, []); const code = (await sigOf(h)).code
    expect(await setup(h, ['confirm', 'deadbeef'])).toContain('wrong code'); expect(await setup(h, ['confirm', code])).toContain('wrong code')
    expect(h.writes).toEqual([])
  })
  test('the right code writes the merged settings with a .bak, stamps once, then reports all ok', async () => {
    const h = mk({ files: { [USER]: '{"theme":"dark"}\n' } }); await setup(h, []); const t = await setup(h, ['confirm', (await sigOf(h)).code])
    expect(t).toBe('setup: all ok'); expect(JSON.parse(h.files[USER])).toEqual({ theme: 'dark', env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' } }); expect(h.files[`${USER}.bak`]).toBe('{"theme":"dark"}\n')
    expect(await h.store.get('cadre:setup')).toMatchObject({ cc: '2.1.295', bd: '1.3.1', bwrap: '0.11.0', jail: 'overlay' })
    expect((await h.secret.read()).initConfirm).toBeUndefined()
  })
  test('a settings file that changed after the diff was shown is not overwritten', async () => {
    const h = mk({ files: { [USER]: '{}' } }); await setup(h, []); const code = (await sigOf(h)).code; h.files[USER] = '{"x":1}'
    expect(await setup(h, ['confirm', code])).toContain('changed since'); expect(h.files[USER]).toBe('{"x":1}'); expect(h.writes).toEqual([])
  })
  test('no stamp while a tool is missing; the toast asks for setup until a stamp for this build exists', async () => {
    const h = mk({ tools: {} }); expect(await setup(h, [])).toContain('fail'); expect(await h.store.get('cadre:setup')).toBeUndefined()
    await nudge(h); expect(h.toasts).toEqual(['cadre: run /cadre setup'])
    await h.store.set('cadre:setup', { cc: '2.1.295' }); await nudge(h); expect(h.toasts.length).toBe(1)
    await h.store.set('cadre:setup', { cc: '2.1.200' }); await nudge(h); expect(h.toasts.length).toBe(2)
  })
})

describe('doctor', () => {
  test('is read-only: no file writes, no mutating commands, one line of text', async () => {
    const h = mk({ files: { [USER]: '{}' } }), t = await doctor(h)
    expect(t).toMatch(/^doctor: \d+ fail, \d+ warn — report in the cadre pane$/); expect(banned(t)).toEqual([]); expect(h.writes).toEqual([]); expect(h.files).toEqual({ [USER]: '{}' })
    expect(h.calls.filter(a => a[0] === 'git' && !/rev-parse|for-each-ref|--version/.test(a.join(' ')))).toEqual([])
    expect(h.logs.join('\n')).toContain('not inside a git repo')
  })
  test('inside a repo: init stages, containment, beads and branch rows each carry their fix', async () => {
    const h = mk({ repo: true }); await doctor(h); const log = h.logs.join('\n')
    for (const f of ['fix: /cadre init\n', 'fix: /cadre init containment', 'fix: /cadre init store', 'fix: /cadre init repo']) expect(log).toContain(f)
    expect(log).toContain('[OK] no open flags'); expect(h.writes).toEqual([])
  })
})
