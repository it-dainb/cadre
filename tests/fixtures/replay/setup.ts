// Replay world for an agent-run setup/init (commands/agentrun): an in-memory repo behind a scripted process.run, as tests/init.test.ts builds it. Synthetic paths.
import type { Host } from '../../../types'
import { fakeHost } from '../../support'
import { MemoryStore } from '../../../task-management/adapters/memory/store'
import { wire } from '../../../commands/init'
import { pump } from '../../../commands/agentrun'

type R = { exitCode: number; stdout?: string; stderr?: string }
export const ROOT = '/repo'
const CFG = `${ROOT}/.cadre/config.json`, PKG = { root: '.', checks: { setup: ['npm', 'ci'], test: ['npm', 'test'] }, tdd: { paths: ['test/**'] } }
export const READY = { [CFG]: JSON.stringify({ branches: { main: 'main', dev: 'dev' }, units: [PKG] }), [`${ROOT}/.git/info/exclude`]: '.cadre/store/\n.cadre/store.gate.lock\n.claude/settings.local.json\n' }   // no CHANGELOG.md: one init check stays red
// bwrap answers by inner argv (jail probes, `npm ci`, `npm test` pass); git answers a repo with main and dev
const jailed = (argv: string[]): R | undefined => {
  if (argv[0] === 'bwrap' && !argv.includes('--')) return { exitCode: 0, stdout: argv[1] === '--help' ? '--overlay-src --tmp-overlay' : '' }
  if (argv[0] === 'find') return { exitCode: 0, stdout: './.cache\n' }
  return argv[0] === 'bwrap' ? { exitCode: 0 } : undefined
}
export function setupWorld() {
  const files: Record<string, string> = { ...READY }, branches = new Set(['main', 'dev'])
  const h = fakeHost({ files }) as Host & { logs: string[] }
  void h.store.set('cadre:prefs', { at: 0 })
  let n = 0
  Object.assign(h, {
    rand: () => `n${++n}`.padEnd(16, '0'), cwd: async () => ROOT, home: async () => '/hm/u', root: async () => '/plug', submit: async () => {},
    settings: async () => JSON.parse(files[`${ROOT}/.claude/settings.local.json`] ?? '{}'),
    run: async (argv: string[]) => {
      const j = argv.join(' '), ok = (stdout = ''): R => ({ exitCode: 0, stdout, stderr: '' }), bad = (): R => ({ exitCode: 128, stdout: '', stderr: 'fatal: nope' })
      const x = jailed(argv); if (x) return { stdout: '', stderr: '', ...x }
      if (argv[0] !== 'git') return ok()
      if (j === 'git rev-parse --git-dir') return ok('.git')
      if (j === 'git rev-parse --git-path info/exclude') return ok('.git/info/exclude')
      if (argv[1] === 'rev-parse' && argv[2] === '--verify') return argv[3] === 'HEAD' || branches.has(argv[3]) ? ok('sha') : bad()
      return ok()
    },
  })
  const s = new MemoryStore(); wire.store = async () => s; void s.init({ journal: true } as any)
  return { h, tick: () => pump(h), card: async () => ((await h.board.read()).decisions ?? []).find(d => d.id === 'run:init') }
}
