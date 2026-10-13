import { describe, expect, test } from 'claude-code/testing'
import { confirmUser, doctor, machine, nudge, setupItems } from '../commands/doctor'
import { defaults } from '../config/index'
import { BD_BLOCK, scoped } from '../commands/init'
import { settle } from '../core/decide'
import { banned } from './fixtures/wording'
import { fakeHost } from './support'
import { contain, heal } from '../policy/containment'
import { setPolicy } from '../policy/guards'
import type { Host } from '../types'

type R = { exitCode: number; stdout: string; stderr: string }
const HOME = '/hm/u', USER = `${HOME}/.claude/settings.json`
// scripted machine: `tools` maps argv[0] to its output (absent = not installed); `jail` = overlay | copy | none
function mk(o: { shadow?: string; foreign?: boolean; npmFails?: boolean; tools?: Record<string, string>; os?: string; repo?: boolean; jail?: 'overlay' | 'copy' | 'none'; cc?: string; files?: Record<string, string>; noIdent?: { on: boolean } } = {}) {
  let installed = false, moved = false; const files = { ...o.files }, calls: string[][] = [], writes: string[] = [], tools = o.tools ?? { git: 'git version 2.43.0', bd: 'bd version 1.3.1', bwrap: 'bubblewrap 0.11.0', socat: 'socat version 1.8' }
  const h = fakeHost({ files }) as Host & { toasts: string[] }
  void h.store.set('cadre:prefs', { at: 0 })   // preferences chosen (tests/prefs.test.ts covers that row)
  const rand = (() => { let n = 0; return () => `n${++n}`.padEnd(16, '0') })()
  Object.assign(h, {
    rand, cwd: async () => '/repo', home: async () => HOME, version: async () => o.cc ?? '2.1.295', write: async (p: string, t: string) => { writes.push(p); files[p] = t },
    stat: async (p: string) => (p === '/hm' || p === '/' || p === '/hm/u' || p === '/hm/u/.cache' || p.startsWith('/hm/u/.cache/cadre') ? { kind: 'dir' } : undefined),
    run: async (argv: string[]): Promise<R> => {
      calls.push(argv); const j = argv.join(' '), out = (stdout: string, exitCode = 0): R => ({ exitCode, stdout, stderr: '' })
      if (argv[0] === 'chmod') return out('')
      if (argv[0] === 'mv') { if (argv[1] === o.shadow) moved = true; return out('') }
      if (argv[0] === 'npm') return argv[1] === 'install' ? (o.npmFails ? { exitCode: 1, stdout: '', stderr: 'npm ERR! EACCES\nnpm ERR! permission denied' } : (installed = true, out('added 1 package'))) : argv[1] === 'prefix' ? out('/hm/u/.npm') : out('10.0.0')
      if (argv[0] === 'sh') return out(argv[2] === 'command -v "$0"' ? (moved ? '/hm/u/.npm/bin/bd' : o.shadow ?? (tools.bd || installed ? '/hm/u/.npm/bin/bd' : '')) : argv[2] === 'command -v bwrap' ? '/usr/bin/bwrap' : '')
      if (argv[0] === '/hm/u/.npm/bin/bd' || (moved && argv[0] === 'bd')) return installed ? out('bd version 1.3.1') : out('', 127)
      if (argv[0] === 'bd' && argv[1] === 'version' && installed && (!o.shadow || moved)) return out('bd version 1.3.1')
      if (argv[0] === 'bd' && argv[1] === 'version' && o.shadow && !moved) return out(o.foreign ? '' : 'bd version 0.43.0')   // foreign: another product's `bd` (Bitdefender's prints nothing, exit 0)
      if (argv[0] === 'uname') return out(o.os ?? 'Linux')
      if (argv[0] === 'test') return out('')
      if (argv[0] === 'bwrap') return !tools.bwrap || (o.jail === 'none' && argv[1] !== '--version') ? out('', 127) : argv[1] === '--help' ? out(o.jail === 'copy' ? 'usage' : '--overlay-src') : out(tools.bwrap)
      if (argv[0] === 'bd' && argv[1] === 'update') return out('--if-revision')
      if (argv[0] === 'git' && argv[1] === 'var') return o.noIdent?.on ? { exitCode: 128, stdout: '', stderr: 'fatal: unable to auto-detect email address' } : out('Ann <a@b> 1 +0000')
      if (argv[0] === 'git' && argv[1] === 'config') { if (argv[2] === '--global' && argv[3] === 'user.email' && o.noIdent) o.noIdent.on = false; return argv[2] === '--get' ? out(argv[3] === 'user.name' && o.noIdent ? 'Ann' : '', o.noIdent ? 0 : 1) : out('') }
      if (argv[0] === 'git') return argv[1] === '--version' ? (tools.git ? out(tools.git) : out('', 127)) : o.repo && j.includes('rev-parse --git-dir') ? out('.git') : out('', 1)
      if (tools[argv[0]]) return out(tools[argv[0]])
      return j.startsWith('git') ? out('', 1) : out('', 127)
    },
  })
  return Object.assign(h, { files, calls, writes })
}
const rowsOf = async (h: Host) => (await machine(h, defaults() as any)).rows, lvl = (rs: any[], re: RegExp) => rs.find(r => re.test(r[1]))

describe('machine checks', () => {
  test('a healthy machine is all ok', async () => { expect((await rowsOf(mk())).map(r => r[0])).toEqual(Array(7).fill('ok')) })
  test('missing tools fail with the exact command for the human', async () => {
    const rs = await rowsOf(mk({ tools: {} }))
    expect(lvl(rs, /git/)).toEqual(['crit', 'git not found', '! sudo sh ~/.cache/cadre/fix/git.sh'])
    expect(lvl(rs, /bd/)[2]).toBe('npm install -g @beads/bd@latest')
    expect(lvl(rs, /bwrap/)[2]).toBe('! sudo sh ~/.cache/cadre/fix/bwrap.sh')
    expect(lvl(rs, /socat/)[2]).toBe('! sudo sh ~/.cache/cadre/fix/socat.sh')
  })
  test('old bd fails, old bwrap is ok in copy-jail mode with no sudo step, no namespaces warns', async () => {
    expect(lvl(await rowsOf(mk({ tools: { git: 'git version 2.43.0', bd: 'bd version 1.2.9', bwrap: 'bubblewrap 0.8.0', socat: 'x' }, jail: 'copy' })), /bd/)[0]).toBe('crit')
    { const r = await rowsOf(mk({ jail: 'copy' })); expect(lvl(r, /copy jail/)[0]).toBe('ok'); expect(JSON.stringify(r)).not.toContain('bwrap-upgrade') }
    expect(lvl(await rowsOf(mk({ jail: 'none' })), /user namespace/)[0]).toBe('warn')
  })
  test('macOS: no bwrap, no socat check, throwaway-worktree mode', async () => {
    const rs = await rowsOf(mk({ os: 'Darwin', tools: { git: 'git version 2.43.0', bd: 'bd version 1.3.1' } }))
    expect(lvl(rs, /macOS: throwaway/)![0]).toBe('warn'); expect(lvl(rs, /socat/)).toBeUndefined()
  })
  test('a newer Claude Code build only warns; an older one than cadre needs is a fail that says claude update', async () => {
    expect(lvl(await rowsOf(mk({ cc: '2.1.296' })), /Claude Code/)).toEqual(['warn', 'Claude Code 2.1.296: newer than the tested 2.1.295; usually fine'])
    expect(lvl(await rowsOf(mk({ cc: '2.1.287' })), /Claude Code/)).toEqual(['crit', 'cadre needs Claude Code ≥ 2.1.295; you have 2.1.287 · update with: claude update', 'claude update'])   // live 0.12.0 on 2.1.287: no band, no pane (Button children came in 2.1.295)
  })
  test('bwrap userns cause: AppArmor (Ubuntu), clone=0 (Debian), unknown', async () => {
    const ub = await machine(mk({ jail: 'none', files: { '/proc/sys/kernel/apparmor_restrict_unprivileged_userns': '1\n' } }), defaults() as any)
    expect(lvl(ub.rows, /AppArmor/)![2]).toBe('! sudo sh ~/.cache/cadre/fix/bwrap-apparmor.sh'); expect(ub.scripts.find(x => x.path.endsWith('bwrap-apparmor.sh'))!.text).toContain('profile bwrap /usr/bin/bwrap'); expect(ub.scripts.find(x => x.path.endsWith('README'))!.text).toContain('less safe')
    expect(lvl((await machine(mk({ jail: 'none', files: { '/proc/sys/kernel/unprivileged_userns_clone': '0' } }), defaults() as any)).rows, /clone=0/)![2]).toBe('! sudo sh ~/.cache/cadre/fix/userns-clone.sh')
    expect(lvl(await rowsOf(mk({ jail: 'none' })), /user namespace/)![2]).toContain('sandboxing')
  })
  test('bd missing: the npm line; a stale bd in a system folder is a sudo script, one in the home folder is moved aside', async () => {
    const m = await machine(mk({ tools: { git: 'git version 2.43.0', bwrap: 'bubblewrap 0.11.0', socat: 'x' } }), defaults() as any)
    expect(lvl(m.rows, /bd/)).toEqual(['crit', 'bd not found', 'npm install -g @beads/bd@latest'])
    const sh = mk({ shadow: '/usr/local/bin/bd' }); await sh.run(['npm', 'install']); const s2 = await machine(sh, defaults() as any)
    expect(lvl(s2.rows, /shadows/)).toEqual(['crit', 'bd 0.43.0 at /usr/local/bin/bd shadows bd 1.3.1 at /hm/u/.npm/bin/bd', '! sudo sh ~/.cache/cadre/fix/rm-bd.sh'])
    expect(s2.scripts[0].text).toContain('\nrm /usr/local/bin/bd\n')
  })
  test('a bd that is not beads (another product\'s tool) is never removed: the fix puts the real one first in PATH', async () => {
    const sh = mk({ shadow: '/usr/bin/bd', foreign: true }); await sh.run(['npm', 'install']); const m = await machine(sh, defaults() as any)   // live 0.12.0: the fix was `sudo rm /usr/bin/bd`, Bitdefender's command
    expect(lvl(m.rows, /shadows/)).toEqual(['crit', 'bd at /usr/bin/bd (not beads) shadows bd 1.3.1 at /hm/u/.npm/bin/bd', 'restart Claude Code from a shell whose PATH has /hm/u/.npm/bin before /usr/bin'])
    expect(m.scripts.some(x => x.text.includes('rm '))).toBe(false)
  })
})

describe('setup checklist (ADR 0010): checks only, Claude fixes', () => {
  const NOBD = { git: 'git version 2.43.0', bwrap: 'bubblewrap 0.11.0', socat: 'x' }, DIR = `${HOME}/.cache/cadre/fix`, LINE = 'sudo sh ~/.cache/cadre/fix/bwrap-apparmor.sh'
  const SET = { [USER]: '{"env":{"CLAUDE_CODE_ENABLE_TODO_TOOLS":"1"}}' }
  test('nothing open: every item ok and the stamp is written', async () => {
    const h = mk({ files: SET }), its = await setupItems(h)
    expect(its.every(i => i.st === 'ok')).toBe(true); expect(await h.store.get('cadre:setup')).toMatchObject({ bd: '1.3.1' })
  })
  test('runs nothing that changes the machine: no install, no settings write; the fails name the command Claude runs', async () => {
    const h = mk({ tools: NOBD }), its = await setupItems(h)
    expect(h.calls.some(a => a[0] === 'npm' && a[1] === 'install')).toBe(false); expect(h.writes).toEqual([]); expect(await h.store.get('cadre:setup')).toBeUndefined()
    expect(its.filter(i => i.st === 'fail')).toEqual([{ name: 'bd not found', st: 'fail', why: 'npm install -g @beads/bd@latest' }])
    expect(its.find(i => i.st === 'wait')).toEqual({ name: 'user settings lack env CLAUDE_CODE_ENABLE_TODO_TOOLS="1"', st: 'wait', why: 'confirm the user settings: press 1' })   // never Claude's to edit
    expect(banned(its.filter(i => i.st === 'fail').map(i => `${i.name}: ${i.why}`))).toEqual([])
    expect(h.logs).toHaveLength(1); await setupItems(h); expect(h.logs).toHaveLength(1)   // same result again: no new transcript row
  })
  test('user settings: cadre shows the merge on a card and writes it only after Confirm (.bak, re-read); with nothing pending it writes nothing; changed bytes are refused', async () => {
    const h = mk({ files: { [USER]: '{"theme":"dark"}\n' } }); await setupItems(h)
    const d = (await h.board.read()).decisions!.find(x => x.id === 'init:91')!; expect(d.title).toBe('setup · user settings · confirm'); expect(d.lines.join('\n')).toContain('env.CLAUDE_CODE_ENABLE_TODO_TOOLS')
    expect(h.files[USER]).toBe('{"theme":"dark"}\n'); await settle(h, 'init:91'); expect(await confirmUser(h)).toContain('nothing pending'); expect(h.files[USER]).toBe('{"theme":"dark"}\n')
    await setupItems(h); h.files[USER] = '{"theme":"light"}\n'
    expect(await confirmUser(h)).toContain('changed since you saw it'); expect(h.files[USER]).toBe('{"theme":"light"}\n')
    await setupItems(h); expect(await confirmUser(h)).toBe('setup: user settings written')
    expect(JSON.parse(h.files[USER])).toEqual({ theme: 'light', env: { CLAUDE_CODE_ENABLE_TODO_TOOLS: '1' } }); expect(h.files[`${USER}.bak`]).toBe('{"theme":"light"}\n')
    expect((await setupItems(h)).every(i => i.st === 'ok')).toBe(true)
  })
  test('git identity missing: a fail that says to ask, never a made-up identity', async () => {
    const its = await setupItems(mk({ files: SET, noIdent: { on: true } }))
    expect(its.find(i => i.st === 'fail')).toEqual({ name: 'git identity missing: commits need your name and email', st: 'fail', why: 'ask for them, then git config --global user.name and user.email' })
  })
  test('warn rows never block; no stamp while a fail is open; the toast asks for setup until a stamp for this build exists', async () => {
    const h = mk({ files: SET, cc: '2.1.296' }); expect((await setupItems(h)).filter(i => i.st === 'warn')).toHaveLength(1); expect(await h.store.get('cadre:setup')).toMatchObject({ cc: '2.1.296' })
    const n = mk({ tools: NOBD }); await setupItems(n); expect(await n.store.get('cadre:setup')).toBeUndefined(); await nudge(n); expect(n.toasts).toEqual(['cadre: run /cadre setup'])
  })
  test('sudo fixes: a script (0700, set -eu, header, the exact command), the item names the ONE short line; alternatives only in the README', async () => {
    const h = mk({ jail: 'none', files: { ...SET, '/proc/sys/kernel/apparmor_restrict_unprivileged_userns': '1\n' } }), its = await setupItems(h)
    const sh = h.files[`${DIR}/bwrap-apparmor.sh`]; expect(sh.startsWith('#!/bin/sh\n# cadre setup: ')).toBe(true); expect(sh).toContain(`# Run it once, yourself: ${LINE}\nset -eu\n`); expect(sh).toContain('tee /etc/apparmor.d/bwrap'); expect(sh).not.toContain('sysctl')
    expect(h.calls).toContainEqual(['chmod', '700', `${DIR}/bwrap-apparmor.sh`]); expect(h.files[`${DIR}/README`]).toContain('sysctl -w kernel.apparmor_restrict_unprivileged_userns=0')
    expect(its.find(i => /AppArmor/.test(i.name))).toMatchObject({ st: 'warn', why: LINE })
    const s = mk({ files: SET, tools: { git: 'git version 2.43.0', bd: 'bd version 1.3.1', bwrap: 'bubblewrap 0.11.0' } }); expect((await setupItems(s)).find(i => /socat/.test(i.name))).toEqual({ name: 'socat not found (Claude Code needs it on Linux)', st: 'fail', why: 'sudo sh ~/.cache/cadre/fix/socat.sh' })
  })
  test('a script that cannot be written: no path to a missing file, the whole command in ONE log line', async () => {
    const h = mk({ jail: 'none', files: { ...SET, '/proc/sys/kernel/apparmor_restrict_unprivileged_userns': '1\n' } }); (h as any).write = async (p: string) => { if (p.endsWith('.sh')) throw new Error('EROFS: read-only file system') }
    const it = (await setupItems(h)).find(i => /AppArmor/.test(i.name))!; expect(it.why).toBe("couldn't write the fix script (EROFS: read-only file system); the exact command is in the cadre log")
    const l = h.logs.filter(x => x.startsWith('fix command: ')); expect(l).toHaveLength(1); expect(l[0]).toContain("sudo sh -c 'printf "); expect(l[0]).not.toContain('\n')
  })
})

describe('doctor', () => {
  test('is read-only: no file writes, no mutating commands, one line of text', async () => {
    const h = mk({ files: { [USER]: '{}' } }), t = await doctor(h)
    expect(t).toMatch(/^doctor: \d+ fail, \d+ warn — report in the cadre pane$/); expect(banned(t)).toEqual([]); expect(h.writes).toEqual([]); expect(h.files).toEqual({ [USER]: '{}' })
    expect(h.calls.filter(a => a[0] === 'git' && !/rev-parse|for-each-ref|--version|^git var|^git config --get/.test(a.join(' ')))).toEqual([])
    expect(JSON.stringify((await h.ui.read())['doctor.rows'])).toContain('not inside a git repo'); expect(h.logs).toHaveLength(1); expect(h.logs[0]).toMatch(/^doctor: .*see the cadre pane$/)
  })
  test('read-only even with a sudo fix: no scripts written; the line shows only once setup wrote the script', async () => {
    const o = { jail: 'none' as const, files: { [USER]: '{}', '/proc/sys/kernel/apparmor_restrict_unprivileged_userns': '1\n' } }, h = mk(o), line = 'sudo sh ~/.cache/cadre/fix/bwrap-apparmor.sh'
    await doctor(h); expect(h.writes).toEqual([]); let rows = JSON.stringify((await h.ui.read())['doctor.rows']); expect(rows).toContain('run /cadre setup to prepare the fix'); expect(rows).not.toContain(line)
    await setupItems(h); await doctor(h); rows = JSON.stringify((await h.ui.read())['doctor.rows']); expect(rows).toContain(line)
  })
  test('a dormant repo: one warn row for the project, no other project rows', async () => {
    const h = mk({ repo: true }); await h.secret.update(x => ({ ...x, active: false })); await doctor(h)
    const rows = JSON.stringify((await h.ui.read())['doctor.rows']); expect(rows).toContain('project: not set up here'); expect(rows).toContain('your preferences: the defaults (mode auto, limits 100/$20/240m, parallel 3 tasks/2 epics)'); expect(rows).not.toContain('init incomplete')
  })
  test('inside a repo: init, containment, beads and branch rows each point at /cadre init', async () => {
    const h = mk({ repo: true }); await doctor(h); const log = ((await h.ui.read())['doctor.rows'] as any[]).map(r => `${r[1]} fix: ${r[2] ?? ''}`).join('\n')
    expect(log).toContain('init incomplete: '); expect(log).toContain('fix: /cadre init'); expect(log).not.toMatch(/\/cadre init \w/)
    expect(log).toContain('no open flags'); expect(h.writes).toEqual([])
    expect(log).not.toContain('.gitignore')
  })
  test('bd lines left in .gitignore because it changed during setup: one review note while the block is there', async () => {
    const h = mk({ repo: true, files: { '/repo/.gitignore': `mine\n\n${BD_BLOCK}` } }); await h.store.set(await scoped(h, 'gitignore.review'), true); await doctor(h)
    const rows = (await h.ui.read())['doctor.rows'] as any[]; expect(rows).toContainEqual(['warn', 'bd added ignore lines to .gitignore; review them', 'keep or remove the "# Beads / Dolt files" block'])
  })
})

describe('toasts', () => {
  test('degraded containment is one short line that points to doctor', async () => {
    const h = mk(); await contain(h)
    expect(h.toasts).toEqual(['cadre: containment degraded · /cadre doctor']); expect(h.toasts[0].length).toBeLessThanOrEqual(60)
  })
  test('a pane that could not open is a Doctor row with the reason', async () => {
    const h = mk(); await h.ui.update(u => ({ ...u, paneErr: { at: 1, reason: 'no pane surface' } }))
    await doctor(h); expect(JSON.stringify((await h.ui.read())['doctor.rows'])).toContain('the cadre pane could not open: no pane surface')
  })
  // live 0.9.1: right after the safety confirm the session still read the old settings; the band said degraded until a restart
  test('the tick moves a degraded band to contained once the session reads the new settings; quietly, and never down', async () => {
    let s: Record<string, any> = {}; const h = mk(); Object.assign(h, { settings: async () => s }); await setPolicy(h, { repo: '/repo', wtRoot: '/wt/repo', home: HOME })
    await contain(h); h.toasts.length = 0; await heal(h); expect((await h.board.read()).containment.state).toBe('degraded')
    s = { sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, filesystem: { allowWrite: ['/wt/repo'], denyWrite: ['/repo'] } } }
    await heal(h); expect((await h.board.read()).containment.state).toBe('contained'); expect(h.toasts).toEqual([])
    s = {}; await heal(h); expect((await h.board.read()).containment.state).toBe('contained')   // a real break shows at the next session start and in Doctor
  })
})
