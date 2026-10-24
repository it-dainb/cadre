// FROZEN: policy/guards.ts fence() exactly as shipped in v0.15.0 (98d15df). tests/roles.test.ts runs it against the live fence(); never edit it to match.
import type { Host } from '../../types'
const PROTECTED = ['.git/', '.cadre/', '.claude/', '.mcp.json', 'CHANGELOG.md']   // frozen copy of core/git.PROTECTED at v0.15.0
type Policy = any
const FILE = ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'NotebookEdit'], FENCED = ['Edit', 'Write', 'NotebookEdit']
const MOD_DIRS = PROTECTED.filter(p => p.endsWith('/')).map(p => p.slice(0, -1)), MOD_FILES = PROTECTED.filter(p => !p.endsWith('/'))
const under = (p: string, root?: string) => !!root && (p === root || p.startsWith(root.replace(/\/$/, '') + '/'))
const join = (cwd: string, p: string) => (p.startsWith('/') ? p : `${cwd.replace(/\/$/, '')}/${p}`)
const modOwned = (real: string, home?: string, changelog?: string) => {
  const seg = real.split('/')
  return (!!changelog && (real === changelog || real.endsWith(`/${changelog}`))) || seg.some(s => MOD_DIRS.includes(s)) || MOD_FILES.includes(seg[seg.length - 1]) || (!!home && /^cadre\.json$|^settings.*\.json$/.test(seg[seg.length - 1]) && under(real, home + '/.claude')) || (!!home && real === `${home}/.claude.json`)   // the engine's own file: its project mcpServers/allowedTools widen what runs
}

// Step 0 of the fence: the path a file tool will touch, per tool (input fields). Glob with an absolute pattern: its non-glob base dir.
export function inputPath(tool: string, i: any, cwd: string): string | undefined {
  const v = (x: unknown) => (typeof x === 'string' && x ? x : undefined)
  if (tool === 'Read' || tool === 'Write' || tool === 'Edit') return v(i?.file_path)
  if (tool === 'NotebookEdit') return v(i?.notebook_path)
  if (tool === 'Grep') return v(i?.path) ?? cwd
  if (tool === 'Glob') {
    const pat = v(i?.pattern)
    if (pat?.startsWith('/')) { const seg = pat.split('/'), k = seg.findIndex(s => /[*?[{]/.test(s)); const base = (k < 0 ? seg.slice(0, -1) : seg.slice(0, k)).join('/'); return base || '/' }
    return v(i?.path) ?? cwd
  }
}

// Step 1: where the path lands; a new file resolves its folder (SA-04). undefined = cannot place it.
async function placed(h: Host, p: string): Promise<string | undefined> {
  const name = p.slice(p.lastIndexOf('/') + 1)
  if (!name || name === '.' || name === '..') return (await h.stat(p, { resolve: true }))?.realPath
  const own = await h.stat(p, { resolve: true })
  if (own) return own.realPath
  // a new file (Write creates its folders): the deepest existing ancestor's real path + the rest; a '..' in the rest cannot be placed
  const rest: string[] = []
  for (let q = p; q.includes('/'); ) {
    rest.unshift(q.slice(q.lastIndexOf('/') + 1)); q = q.slice(0, q.lastIndexOf('/')) || '/'
    const dir = await h.stat(q, { resolve: true })
    if (dir?.realPath !== undefined) return rest.some(x => x === '..' || x === '.') ? undefined : `${dir.realPath.replace(/\/$/, '')}/${rest.join('/')}`
    if (q === '/') break
  }
  return undefined
}

const leased = (real: string, pol: Policy, kind?: string) => !!pol.repo && ((under(real, `${pol.repo}/.cadre`) && (kind === 'init' || real !== `${pol.repo}/.cadre/config.json`)) || ['.git/info/exclude', pol.changelog || 'CHANGELOG.md'].some(f => real === `${pol.repo}/${f}`))
const SETTINGS = /(^|\/)\.claude\/settings[^/]*\.json$/, SETTINGS_DENY = 'these settings are applied for you after the human confirms them in the dialog'

// Fence verdict for one file-tool call: undefined = allow-by-fence (continue), 'allow' = tester rule 2, else a deny reason.
export async function fence(h: Host, w: any, tool: string, input: unknown, pol: Policy, guide?: string, kind?: string): Promise<string | 'allow' | 'tmp' | undefined> {
  const tester = w.role === 'tester' && !w.main
  const fenced = FENCED.includes(tool) || (tool === 'Read' && !!pol.home && typeof (input as any)?.file_path === 'string' && (input as any).file_path.includes('/.claude/plugins/store/'))
  if (!tester && !fenced) return
  if (!FILE.includes(tool)) return tester && !tool.startsWith('mcp__cadre__') ? `${tool} is not available to you; use Read, Write or Edit inside your working directory` : undefined   // the role's own report tool passed the allowlist
  const cwd = w.b?.worktree ?? pol.repo ?? '/'
  const p = inputPath(tool, input, cwd)
  const real = p === undefined ? undefined : await placed(h, join(cwd, p))
  if (FENCED.includes(tool) && (SETTINGS.test(p ?? '') || SETTINGS.test(real ?? ''))) return SETTINGS_DENY
  if (real === undefined) return 'that path cannot be used; give a plain path inside your working directory'
  if (tester) return under(real, w.b!.worktree) ? 'allow' : 'write only inside your working directory'
  if (w.main && guide !== undefined && (tool === 'Read' ? under(real, guide.slice(0, guide.lastIndexOf('/'))) : leased(real, pol, kind))) return 'allow'
  if (w.main && FENCED.includes(tool) && pol.repo && real === `${pol.repo}/.cadre/config.json`) return 'the project settings are changed by the user in the cadre pane (Settings, key 9); do not edit that file'
  const own = w.owner && under(real, w.b!.worktree)
  if (!w.main && w.b && w.task?.state === 'blocked' && FENCED.includes(tool) && under(real, w.b.worktree)) return 'your task waits for a decision; stop now: you are resumed with the answer'   // live 0.9.0: "write only inside your working directory" sent a worker that had just reported spec_change looking for another place to write
  if (!w.main && !own) return under(real, (await h.env()).TMPDIR || '/tmp') ? 'tmp' : 'write only inside your working directory (or $TMPDIR)'   // positive jail: file tools are not OS-sandboxed (ADR 0006)
  if (!own && (under(real, pol.repo) || under(real, pol.wtRoot))) return 'project files are edited by a task agent only; plan the change with plan and task, or spawn the agent of a planned task'
  if (modOwned(real, pol.home, pol.changelog)) return 'that path is managed for you and cannot be edited; leave it alone'
  if (w.owner && (pol.core?.[w.b!.taskId] ?? []).some(l => real === l)) return 'this file belongs to the shared core that already landed: do not edit it; report outcome "blocked" with the change you need in it'   // ADR 0014 G
  if (w.owner && w.task?.step === 'worker' && (pol.locks?.[w.b!.taskId] ?? []).some(l => real === l || under(real, l))) return 'locked spec test: do not edit it; if it is wrong, report outcome "spec_change"'
}

