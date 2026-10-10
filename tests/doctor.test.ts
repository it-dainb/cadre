import { describe, expect, test } from 'claude-code/testing'
import { afterFix, brief, turnStarted, doctor, machine, nudge, setup } from '../commands/doctor'
import { defaults } from '../config/index'
import { banned } from './fixtures/wording'
import { fakeHost } from './support'
import { contain } from '../policy/containment'
import type { Host } from '../types'
import { card as drawCard } from '../ui/card'
import { txt } from '../ui/model'
import { NOOP, view } from './fixtures/ui/epic'

type R = { exitCode: number; stdout: string; stderr: string }
const HOME = '/hm/u', USER = `${HOME}/.claude/settings.json`
// scripted machine: `tools` maps argv[0] to its output (absent = not installed); `jail` = overlay | copy | none
function mk(o: { shadow?: string; npmFails?: boolean; tools?: Record<string, string>; os?: string; repo?: boolean; jail?: 'overlay' | 'copy' | 'none'; cc?: string; files?: Record<string, string> } = {}) {
  let installed = false, moved = false; const files = { ...o.files }, calls: string[][] = [], writes: string[] = [], tools = o.tools ?? { git: 'git version 2.43.0', bd: 'bd version 1.3.1', bwrap: 'bubblewrap 0.11.0', socat: 'socat version 1.8' }
  const h = fakeHost({ files }) as Host & { toasts: string[] }
  const rand = (() => { let n = 0; return () => `n${++n}`.padEnd(16, '0') })()
  Object.assign(h, {
    rand, cwd: async () => '/repo', home: async () => HOME, version: async () => o.cc ?? '2.1.295', write: async (p: string, t: string) => { writes.push(p); files[p] = t },
    stat: async (p: string) => (p === '/hm' || p === '/' || p === '/hm/u' || p === '/hm/u/.cache' || p.startsWith('/hm/u/.cache/cadre') ? { kind: 'dir' } : undefined),
    run: async (argv: string[]): Promise<R> => {
      calls.push(argv); const j = argv.join(' '), out = (stdout: string, exitCode = 0): R => ({ exitCode, stdout, stderr: '' })
      if (argv[0] === 'mv') { if (argv[1] === o.shadow) moved = true; return out('') }
      if (argv[0] === 'npm') return argv[1] === 'install' ? (o.npmFails ? { exitCode: 1, stdout: '', stderr: 'npm ERR! EACCES\nnpm ERR! permission denied' } : (installed = true, out('added 1 package'))) : argv[1] === 'prefix' ? out('/hm/u/.npm') : out('10.0.0')
      if (argv[0] === 'sh') return out(argv[2] === 'command -v "$0"' ? (moved ? '/hm/u/.npm/bin/bd' : o.shadow ?? (tools.bd || installed ? '/hm/u/.npm/bin/bd' : '')) : argv[2] === 'command -v bwrap' ? '/usr/bin/bwrap' : '')
      if (argv[0] === '/hm/u/.npm/bin/bd' || (moved && argv[0] === 'bd')) return installed ? out('bd version 1.3.1') : out('', 127)
      if (argv[0] === 'bd' && argv[1] === 'version' && installed && (!o.shadow || moved)) return out('bd version 1.3.1')
      if (argv[0] === 'bd' && argv[1] === 'version' && o.shadow && !moved) return out('bd version 0.43.0')
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
    expect(lvl(rs, /git/)).toEqual(['crit', 'git not found', '! sudo sh ~/.cache/cadre/fix/git.sh'])
    expect(lvl(rs, /bd/)[2]).toBe('! npm install -g @beads/bd@latest')
    expect(lvl(rs, /bwrap/)[2]).toBe('! sudo sh ~/.cache/cadre/fix/bwrap.sh')
    expect(lvl(rs, /socat/)[2]).toBe('! sudo sh ~/.cache/cadre/fix/socat.sh')
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
    expect(lvl(ub.rows, /AppArmor/)![2]).toBe('! sudo sh ~/.cache/cadre/fix/bwrap-apparmor.sh'); expect(ub.scripts.find(x => x.path.endsWith('bwrap-apparmor.sh'))!.text).toContain('profile bwrap /usr/bin/bwrap'); expect(ub.human).toEqual(['! sudo sh ~/.cache/cadre/fix/bwrap-apparmor.sh', 'less safe options: ~/.cache/cadre/fix/README']); expect(ub.acts).toEqual([])
    expect(lvl((await machine(mk({ jail: 'none', files: { '/proc/sys/kernel/unprivileged_userns_clone': '0' } }), defaults() as any)).rows, /clone=0/)![2]).toBe('! sudo sh ~/.cache/cadre/fix/userns-clone.sh')
    expect(lvl(await rowsOf(mk({ jail: 'none' })), /user namespace/)![2]).toContain('sandboxing')
  })
  test('bd missing: an npm action; a stale bd that shadows the new one is a PATH fix, not an action', async () => {
    const m = await machine(mk({ tools: { git: 'git version 2.43.0', bwrap: 'bubblewrap 0.11.0', socat: 'x' } }), defaults() as any)
    expect(m.acts).toEqual([{ label: 'installing bd', argv: ['npm', 'install', '-g', '@beads/bd@latest'] }])
    const sh = mk({ shadow: '/usr/local/bin/bd' }); await sh.run(['npm', 'install']); const s2 = await machine(sh, defaults() as any)
    expect(s2.acts).toEqual([]); expect(lvl(s2.rows, /shadows/)).toEqual(['crit', 'bd 0.43.0 at /usr/local/bin/bd shadows bd 1.3.1 at /hm/u/.npm/bin/bd', '! sudo sh ~/.cache/cadre/fix/rm-bd.sh'])
    expect(s2.scripts[0].text).toContain('\nrm /usr/local/bin/bd\n')
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
    expect(h.logs).toHaveLength(1)
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
    expect(JSON.stringify((await h.ui.read())['doctor.rows'])).toContain('shadows bd 1.3.1'); expect(await h.store.get('cadre:setup')).toBeUndefined()
  })
  test('no stamp while a tool is missing; the toast asks for setup until a stamp for this build exists', async () => {
    const h = mk({ tools: {} }); expect(await setup(h, [])).toContain('actions ready'); expect(await h.store.get('cadre:setup')).toBeUndefined()
    await nudge(h); expect(h.toasts).toEqual(['cadre: run /cadre setup'])
    await h.store.set('cadre:setup', { cc: '2.1.295' }); await nudge(h); expect(h.toasts.length).toBe(1)
    await h.store.set('cadre:setup', { cc: '2.1.200' }); await nudge(h); expect(h.toasts.length).toBe(2)
  })
})

describe('setup: human-run fixes are scripts, the card shows one short line (0.5.1)', () => {
  const OK = { '/proc/sys/kernel/apparmor_restrict_unprivileged_userns': '1\n', [USER]: '{"env":{"CLAUDE_CODE_ENABLE_TODO_TOOLS":"1"}}' }, DIR = `${HOME}/.cache/cadre/fix`, LINE = 'sudo sh ~/.cache/cadre/fix/bwrap-apparmor.sh'
  const dormant = async (copied?: string[], o: any = { jail: 'none', files: OK }) => { const h = mk(o); await h.secret.update(x => ({ ...x, active: false })); if (copied) (h as any).ops = new Proxy({ copy: async (t: string) => (copied.push(t), { isCopied: true }) } as any, { get: (t, k) => (k in t ? t[k] : async () => ({ isPlaced: true })) }); return h }
  const card = async (h: Host) => (await h.board.read()).decisions!.find(d => d.id === 'init:90')!
  test('scripts: written without a confirm, 0700, set -eu, header, the exact command; alternatives only in the README', async () => {
    const h = await dormant(); await setup(h, [])
    const sh = h.files[`${DIR}/bwrap-apparmor.sh`]; expect(sh.startsWith('#!/bin/sh\n# cadre setup: ')).toBe(true); expect(sh).toContain(`# Run it once, yourself: ${LINE}\nset -eu\n`); expect(sh).toContain('tee /etc/apparmor.d/bwrap'); expect(sh).toContain('systemctl reload apparmor'); expect(sh).not.toContain('sysctl')
    expect(h.calls).toContainEqual(['chmod', '700', `${DIR}/bwrap-apparmor.sh`])
    expect(h.files[`${DIR}/README`]).toContain('sysctl -w kernel.apparmor_restrict_unprivileged_userns=0'); expect(h.files[`${DIR}/README`]).toContain('/etc/sysctl.d/60-userns.conf')
    const t = (await card(h)).lines.join('\n'); expect(t).toContain(`  ${LINE}`); expect(t).toContain('less safe options: ~/.cache/cadre/fix/README'); expect(t).not.toContain('sysctl'); expect(t).not.toContain('tee')
    expect((await h.ui.read())['setup.plan']).toMatchObject({ human: [`! ${LINE}`, 'less safe options: ~/.cache/cadre/fix/README'] })
  })
  test('every command line drawn in the card fits the body and holds no box character, at 56 and 116 columns', async () => {
    const h = await dormant(); await setup(h, []); const d = await card(h)
    for (const w of [56, 116]) {
      const v = view(62, { board: { decisions: [d] } }); v.sec = { dcode: {} }
      const rows = txt(drawCard(v, w, NOOP)).filter(r => /\bsh \S*\.sh|fix\//.test(r)).slice(0, 2)
      expect(rows.length).toBe(2); for (const r of rows) expect(r).toMatch(/^║ (sudo sh ~\/\S+\.sh|less safe options: ~\/\S+)\s*║$/)
    }
  })
  test('Copy command: copies the first sudo line and says copied; no clipboard, no button', async () => {
    const got: string[] = [], h = await dormant(got); await setup(h, [])
    const o = (await card(h)).options; expect(o.map(x => x.label)).toEqual(['Copy command', 'Re-check', 'Cancel']); expect(o[0]).toMatchObject({ key: 'y', run: 'setup copy' })
    expect(await setup(h, ['copy'])).toBe('copied'); expect(got).toEqual([LINE])
    const bare = await dormant(); await setup(bare, []); expect((await card(bare)).options.map(x => x.label)).toEqual(['Re-check', 'Cancel']); expect(await setup(bare, ['copy'])).toContain('not copied')
  })
  test('re-check after the human ran it: the row is green and the card is gone', async () => {
    const o: any = { jail: 'none', files: OK }, h = await dormant(undefined, o); await setup(h, []); expect(await card(h)).toBeDefined()
    o.jail = 'overlay'; await setup(h, []); expect((await h.board.read()).decisions ?? []).toEqual([])
  })
})
describe('setup: deterministic moves and the hand-off to main', () => {
  const sigOf = async (h: Host) => (await h.secret.read()).initConfirm!
  const NOBD = { git: 'git version 2.43.0', bwrap: 'bubblewrap 0.11.0', socat: 'x' }, OK = { files: { [USER]: '{"env":{"CLAUDE_CODE_ENABLE_TODO_TOOLS":"1"}}' } }
  const card = async (h: Host) => (await h.board.read()).decisions!.find(d => d.id === 'init:90')!
  const fixed = async (h: Host) => { const sent: string[] = []; (h as any).submit = async (t: string) => { sent.push(t) }; return sent }
  test('a stale bd in a folder the user owns: moved aside (never rm), then re-checked and stamped', async () => {
    const h = mk({ ...OK, shadow: '/hm/u/.local/bin/bd' }); await h.run(['npm', 'install'])
    expect(await setup(h, [])).toBe('setup: 1 action ready · confirm with the code on the band')
    expect(await card(h)).toMatchObject({ lines: ['cadre runs:', '  1. moving the old bd aside'] }); expect((await card(h)).options.map(o => o.label)).toEqual(['Fix all', 'Re-check', 'Cancel'])
    expect(await setup(h, ['confirm', (await sigOf(h)).code])).toBe('setup: all ok')
    expect(h.calls.filter(a => a[0] === 'mv')).toEqual([['mv', '/hm/u/.local/bin/bd', '/hm/u/.local/bin/bd.cadre-old']]); expect(h.calls.some(a => a[0] === 'rm')).toBe(false)
    expect(await h.store.get('cadre:setup')).toMatchObject({ bd: '1.3.1' }); expect((await h.board.read()).decisions ?? []).toEqual([]); expect(h.logs).toEqual(['setup: 1 fail · see the cadre pane', 'setup: 1 fixed · see the cadre pane'])   // one summary line per run
  })
  test('a stale bd in a system folder: no action, only the sudo line for the terminal', async () => {
    const h = mk({ ...OK, shadow: '/usr/local/bin/bd' }); await h.run(['npm', 'install']); await h.secret.update(x => ({ ...x, active: false })); const sent = await fixed(h)
    expect(await setup(h, [])).toContain('1 fail'); const c = await card(h)
    expect(c.lines.join('\n')).toContain('Run in a terminal (needs your password'); expect(c.lines.join('\n')).toContain('sudo sh ~/.cache/cadre/fix/rm-bd.sh'); expect(c.lines.join('\n')).not.toContain('sudo rm'); expect(c.options.map(o => o.label)).toEqual(['Re-check', 'Cancel']); expect(sent).toEqual([])
    expect(h.logs).toEqual(['setup: 1 needs sudo · 1 fail · see the cadre pane'])
  })
  test('a failed action in a dormant repo: ONE brief goes to main, the card says Claude is fixing, the turn end re-checks and stamps, no second hand-off', async () => {
    const o = { tools: NOBD, npmFails: true, files: { [USER]: '{}' } }, h = mk(o); await h.secret.update(x => ({ ...x, active: false })); const sent = await fixed(h)
    await setup(h, []); expect((await card(h)).options.map(x => x.label)).toEqual(['Fix all', 'Re-check', 'Cancel'])
    expect(await setup(h, ['confirm', (await sigOf(h)).code])).toBe('setup: Claude is fixing 1 issue; the checks run again when it stops')
    await new Promise(r => setTimeout(r, 0)); expect(sent).toHaveLength(1); expect(sent[0]).toBe(brief('/hm/u', (await machine(h, defaults() as any)).rows.filter(r => r[0] !== 'ok'), { label: 'installing bd', argv: ['npm', 'install', '-g', '@beads/bd@latest'], out: ['npm ERR! EACCES', 'npm ERR! permission denied'] }))
    expect(sent[0]).toContain('npm ERR! EACCES'); expect(sent[0]).toContain('no sudo'); expect(sent[0]).toContain('Move things aside instead of deleting'); expect(sent[0]).toContain('stop. The checks run again on their own'); expect(banned(sent[0])).toEqual([])
    expect((await card(h)).lines).toEqual(['Claude is fixing setup… (1 issue)']); expect(await h.store.get('cadre:setup')).toBeUndefined()
    o.npmFails = false; await h.run(['npm', 'install'])   // main fixed it
    await afterFix(h, { turnId: 'early' }); expect(await h.store.get('cadre:setup')).toBeUndefined()   // a turn that was already running when the brief was queued: no re-check
    await turnStarted(h, { text: 'something typed', turnId: 'other' }); await turnStarted(h, { text: sent[0], turnId: 't1' }); await afterFix(h, { turnId: 'other' }); expect(await h.store.get('cadre:setup')).toBeUndefined()
    await afterFix(h, { turnId: 't1' })   // the fix turn ended: the skipped scripted actions run, then the re-check
    expect(h.files[USER]).toContain('CLAUDE_CODE_ENABLE_TODO_TOOLS'); expect(await h.store.get('cadre:setup')).toMatchObject({ bd: '1.3.1' }); expect(sent).toHaveLength(1); expect((await h.board.read()).decisions ?? []).toEqual([])
    await afterFix(h, { turnId: 't1' }); expect(sent).toHaveLength(1)
  })
  test('typed in a command the submit is refused: the brief waits for the next turn end, still only once', async () => {
    const h = mk({ ...OK, tools: NOBD, npmFails: true }); await h.secret.update(x => ({ ...x, active: false })); let n = 0; const sent: string[] = [];
    (h as any).submit = async (t: string) => { if (!n++) throw new Error('held'); sent.push(t) }
    await setup(h, []); await setup(h, ['confirm', (await sigOf(h)).code]); await new Promise(r => setTimeout(r, 0))
    expect(sent).toEqual([]); await afterFix(h, { turnId: 'x' }); expect(sent).toHaveLength(1); await afterFix(h, { turnId: 'y' }); expect(sent).toHaveLength(1)
  })
  test('an active repo: the scripted fixes run, nothing goes to main, the card says to open Claude elsewhere', async () => {
    const h = mk({ ...OK, tools: NOBD, npmFails: true }), sent = await fixed(h); await setup(h, [])
    await setup(h, ['confirm', (await sigOf(h)).code]); await new Promise(r => setTimeout(r, 0))
    expect(sent).toEqual([]); expect((await card(h)).lines.join('\n')).toContain('Open Claude in another folder to let it fix the rest'); expect((await h.secret.read()).setupFix).toBeUndefined()
  })
})

describe('doctor', () => {
  test('is read-only: no file writes, no mutating commands, one line of text', async () => {
    const h = mk({ files: { [USER]: '{}' } }), t = await doctor(h)
    expect(t).toMatch(/^doctor: \d+ fail, \d+ warn — report in the cadre pane$/); expect(banned(t)).toEqual([]); expect(h.writes).toEqual([]); expect(h.files).toEqual({ [USER]: '{}' })
    expect(h.calls.filter(a => a[0] === 'git' && !/rev-parse|for-each-ref|--version/.test(a.join(' ')))).toEqual([])
    expect(JSON.stringify((await h.ui.read())['doctor.rows'])).toContain('not inside a git repo'); expect(h.logs).toHaveLength(1); expect(h.logs[0]).toMatch(/^doctor: .*see the cadre pane$/)
  })
  test('a dormant repo: one warn row for the project, no other project rows', async () => {
    const h = mk({ repo: true }); await h.secret.update(x => ({ ...x, active: false })); await doctor(h)
    const rows = JSON.stringify((await h.ui.read())['doctor.rows']); expect(rows).toContain('project: cadre off here'); expect(rows).not.toContain('init stages')
  })
  test('inside a repo: init stages, containment, beads and branch rows each carry their fix', async () => {
    const h = mk({ repo: true }); await doctor(h); const log = ((await h.ui.read())['doctor.rows'] as any[]).map(r => `${r[1]} fix: ${r[2] ?? ''}`).join('\n')
    for (const f of ['fix: /cadre init', 'fix: /cadre init containment', 'fix: /cadre init store', 'fix: /cadre init repo']) expect(log).toContain(f)
    expect(log).toContain('no open flags'); expect(h.writes).toEqual([])
  })
})

describe('toasts', () => {
  test('degraded containment is one short line that points to doctor', async () => {
    const h = mk(); await contain(h)
    expect(h.toasts).toEqual(['cadre: containment degraded · /cadre doctor']); expect(h.toasts[0].length).toBeLessThanOrEqual(60)
  })
})
