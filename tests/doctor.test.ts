import { describe, expect, test } from 'claude-code/testing'
import { doctor, machine, nudge, setup } from '../commands/doctor'
import { defaults } from '../config/index'
import { banned } from './fixtures/wording'
import { fakeHost } from './support'
import { contain } from '../policy/containment'
import type { Host } from '../types'

type R = { exitCode: number; stdout: string; stderr: string }
const HOME = '/hm/u', USER = `${HOME}/.claude/settings.json`
// scripted machine: `tools` maps argv[0] to its output (absent = not installed); `jail` = overlay | copy | none
function mk(o: { shadow?: string; npmFails?: boolean; tools?: Record<string, string>; os?: string; repo?: boolean; jail?: 'overlay' | 'copy' | 'none'; cc?: string; files?: Record<string, string> } = {}) {
  let installed = false; const files = { ...o.files }, calls: string[][] = [], writes: string[] = [], tools = o.tools ?? { git: 'git version 2.43.0', bd: 'bd version 1.3.1', bwrap: 'bubblewrap 0.11.0', socat: 'socat version 1.8' }
  const h = fakeHost({ files }) as Host & { toasts: string[] }
  const rand = (() => { let n = 0; return () => `n${++n}`.padEnd(16, '0') })()
  Object.assign(h, {
    rand, cwd: async () => '/repo', home: async () => HOME, version: async () => o.cc ?? '2.1.295', write: async (p: string, t: string) => { writes.push(p); files[p] = t },
    stat: async (p: string) => (p === '/hm' || p === '/' || p === '/hm/u' || p === '/hm/u/.cache' || p.startsWith('/hm/u/.cache/cadre') ? { kind: 'dir' } : undefined),
    run: async (argv: string[]): Promise<R> => {
      calls.push(argv); const j = argv.join(' '), out = (stdout: string, exitCode = 0): R => ({ exitCode, stdout, stderr: '' })
      if (argv[0] === 'npm') return argv[1] === 'install' ? (o.npmFails ? { exitCode: 1, stdout: '', stderr: 'npm ERR! EACCES\nnpm ERR! permission denied' } : (installed = true, out('added 1 package'))) : argv[1] === 'prefix' ? out('/hm/u/.npm') : out('10.0.0')
      if (argv[0] === 'sh') return out(argv[2] === 'command -v "$0"' ? (o.shadow ?? (tools.bd || installed ? '/hm/u/.npm/bin/bd' : '')) : argv[2] === 'command -v bwrap' ? '/usr/bin/bwrap' : '')
      if (argv[0] === '/hm/u/.npm/bin/bd') return installed ? out('bd version 1.3.1') : out('', 127)
      if (argv[0] === 'bd' && argv[1] === 'version' && installed && !o.shadow) return out('bd version 1.3.1')
      if (argv[0] === 'bd' && argv[1] === 'version' && o.shadow) return out('bd version 0.43.0')
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
    expect(lvl(rs, /bd/)[2]).toBe('! npm install -g @beads/bd@latest')
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
  test('another Claude Code build only warns: no fix, never an npm reinstall', async () => {
    expect(lvl(await rowsOf(mk({ cc: '2.1.296' })), /Claude Code/)).toEqual(['warn', 'Claude Code 2.1.296: newer than the tested 2.1.295; usually fine'])
    expect(lvl(await rowsOf(mk({ cc: '2.1.200' })), /Claude Code/)![1]).toContain('older than the tested'); expect((await machine(mk({ cc: '2.1.296' }), defaults() as any)).acts).toEqual([])
  })
  test('bwrap userns cause: AppArmor (Ubuntu), clone=0 (Debian), unknown', async () => {
    const ub = await machine(mk({ jail: 'none', files: { '/proc/sys/kernel/apparmor_restrict_unprivileged_userns': '1\n' } }), defaults() as any)
    expect(lvl(ub.rows, /AppArmor/)![2]).toContain('/etc/apparmor.d/bwrap'); expect(lvl(ub.rows, /AppArmor/)![2]).toContain('profile bwrap /usr/bin/bwrap'); expect(ub.human.join('\n')).toContain('apparmor_restrict_unprivileged_userns=0'); expect(ub.acts).toEqual([])
    expect(lvl((await machine(mk({ jail: 'none', files: { '/proc/sys/kernel/unprivileged_userns_clone': '0' } }), defaults() as any)).rows, /clone=0/)![2]).toBe('! sudo sysctl -w kernel.unprivileged_userns_clone=1')
    expect(lvl(await rowsOf(mk({ jail: 'none' })), /user namespace/)![2]).toContain('sandboxing')
  })
  test('bd missing: an npm action; a stale bd that shadows the new one is a PATH fix, not an action', async () => {
    const m = await machine(mk({ tools: { git: 'git version 2.43.0', bwrap: 'bubblewrap 0.11.0', socat: 'x' } }), defaults() as any)
    expect(m.acts).toEqual([{ label: 'installing bd', argv: ['npm', 'install', '-g', '@beads/bd@latest'] }])
    const sh = mk({ shadow: '/usr/local/bin/bd' }); await sh.run(['npm', 'install']); const s2 = await machine(sh, defaults() as any)
    expect(s2.acts).toEqual([]); expect(lvl(s2.rows, /shadows/)).toEqual(['crit', 'bd 0.43.0 at /usr/local/bin/bd shadows bd 1.3.1 at /hm/u/.npm/bin/bd', '! sudo rm /usr/local/bin/bd  # or put /hm/u/.npm/bin first in PATH'])
    expect(s2.human[0]).toContain('sudo rm /usr/local/bin/bd')
  })
})

describe('setup', () => {
  const sigOf = async (h: Host) => (await h.secret.read()).initConfirm!
  const NOBD = { git: 'git version 2.43.0', bwrap: 'bubblewrap 0.11.0', socat: 'x' }
  test('nothing to do: all ok and stamped', async () => {
    const h = mk({ files: { [USER]: '{"env":{"CLAUDE_CODE_ENABLE_TODO_TOOLS":"1"}}' } }); expect(await setup(h, [])).toBe('setup: all ok'); expect(await h.store.get('cadre:setup')).toMatchObject({ bd: '1.3.1' })
  })
  test('the plan lists the actions, runs nothing, and the command text is one line', async () => {
    const h = mk({ tools: NOBD }), t = await setup(h, [])
    expect(t).toBe('setup: 2 actions ready · confirm with the code on the band'); expect(banned(t)).toEqual([]); expect(t.includes('\n')).toBe(false)
    expect(h.calls.some(a => a[0] === 'npm' && a[1] === 'install')).toBe(false); expect(h.writes).toEqual([]); expect((await sigOf(h)).stage).toBe(90); expect(await h.store.get('cadre:setup')).toBeUndefined()
    expect((await h.ui.read())['setup.plan']).toMatchObject({ acts: [['installing bd', ''], ['writing user settings', '']] })
    expect(h.logs.every(l => !l.includes('\n'))).toBe(true)
  })
  test('confirm runs the actions in order, re-checks, stamps, and short toasts', async () => {
    const h = mk({ tools: NOBD, files: { [USER]: '{"theme":"dark"}\n' } }); await setup(h, []); const t = await setup(h, ['confirm', (await sigOf(h)).code])
    expect(t).toBe('setup: all ok'); expect(h.calls.filter(a => a[1] === 'install')).toEqual([['npm', 'install', '-g', '@beads/bd@latest']])
    expect(JSON.parse(h.files[USER])).toEqual({ theme: 'dark', env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' } }); expect(h.files[`${USER}.bak`]).toBe('{"theme":"dark"}\n')
    expect(h.toasts).toEqual(['setup: installing bd', 'setup: writing user settings']); expect(h.toasts.every(x => x.length <= 60)).toBe(true)
    expect(await h.store.get('cadre:setup')).toMatchObject({ bd: '1.3.1' }); expect((await h.secret.read()).initConfirm).toBeUndefined()
  })
  test('a failed action stops the run, shows its last output lines, and writes nothing after it', async () => {
    const h = mk({ tools: NOBD, npmFails: true }); await setup(h, []); const t = await setup(h, ['confirm', (await sigOf(h)).code])
    expect(t).toBe('setup: stopped at "installing bd"; output in the cadre pane'); expect(h.writes).toEqual([]); expect(await h.store.get('cadre:setup')).toBeUndefined()
    expect((await h.ui.read())['setup.plan']).toMatchObject({ acts: [['installing bd', 'fail'], ['writing user settings', '']], out: ['npm ERR! EACCES', 'npm ERR! permission denied'] })
  })
  test('a wrong code is refused and burned; the right code afterwards also fails until re-planned', async () => {
    const h = mk({ tools: NOBD }); await setup(h, []); const code = (await sigOf(h)).code
    expect(await setup(h, ['confirm', 'deadbeef'])).toContain('wrong code'); expect(await setup(h, ['confirm', code])).toContain('wrong code')
    expect(h.calls.some(a => a[1] === 'install')).toBe(false)
  })
  test('a preflight that changed since the plan was shown re-plans and runs nothing', async () => {
    const h = mk({ files: { [USER]: '{}' } }); await setup(h, []); const code = (await sigOf(h)).code; h.files[USER] = '{"x":1}'
    expect(await setup(h, ['confirm', code])).toContain('plan changed'); expect(h.files[USER]).toBe('{"x":1}'); expect(h.writes).toEqual([]); expect((await sigOf(h)).code).not.toBe(code)
  })
  test('after the install a shadowing bd is reported, not claimed as success, and there is no stamp', async () => {
    const h = mk({ files: { [USER]: '{"env":{"CLAUDE_CODE_ENABLE_TODO_TOOLS":"1"}}' }, shadow: '/usr/local/bin/bd' })
    expect(await setup(h, [])).toBe('setup: 1 action ready · confirm with the code on the band')   // the old bd 0.43.0 answers; npm has nothing installed yet
    expect(await setup(h, ['confirm', (await sigOf(h)).code])).toBe('setup: 1 fail, 0 warn — report in the cadre pane')
    expect(h.logs.join('\n')).toContain('shadows bd 1.3.1'); expect(await h.store.get('cadre:setup')).toBeUndefined()
  })
  test('no stamp while a tool is missing; the toast asks for setup until a stamp for this build exists', async () => {
    const h = mk({ tools: {} }); expect(await setup(h, [])).toContain('actions ready'); expect(await h.store.get('cadre:setup')).toBeUndefined()
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
    expect(h.logs.join('\n')).toContain('not inside a git repo'); expect(h.logs.every(l => !l.includes('\n'))).toBe(true)
  })
  test('a dormant repo: one warn row for the project, no other project rows', async () => {
    const h = mk({ repo: true }); await h.secret.update(x => ({ ...x, active: false })); await doctor(h)
    expect(h.logs.join('\n')).toContain('project: cadre off here'); expect(h.logs.join('\n')).not.toContain('init stages')
  })
  test('inside a repo: init stages, containment, beads and branch rows each carry their fix', async () => {
    const h = mk({ repo: true }); await doctor(h); const log = h.logs.join('\n')
    for (const f of ['fix: /cadre init', 'fix: /cadre init containment', 'fix: /cadre init store', 'fix: /cadre init repo']) expect(log).toContain(f)
    expect(log).toContain('[OK] no open flags'); expect(h.writes).toEqual([])
  })
})

describe('toasts', () => {
  test('degraded containment is one short line that points to doctor', async () => {
    const h = mk(); await contain(h)
    expect(h.toasts).toEqual(['cadre: containment degraded · /cadre doctor']); expect(h.toasts[0].length).toBeLessThanOrEqual(60)
  })
})
