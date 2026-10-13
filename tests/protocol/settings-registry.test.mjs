// Dev-only (ADR 0019): the settings registry is complete and is the only way config is read. Static scans over the source (the kit has no fs).
// node --experimental-transform-types --test tests/protocol/*.test.mjs
import '../dev/register.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const { REG, keysOf } = await import('../../config/index.ts')
const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? (n === 'node_modules' || n === 'adapters' && d.endsWith('task-management') ? [] : walk(p)) : /\.ts$/.test(n) && !/\.d\.ts$/.test(n) ? [p] : [] })
const SRC = ['hooks', 'core', 'native', 'policy', 'commands', 'task-management', 'agents', 'tools', 'ui'].flatMap(d => walk(join(root, d))).map(f => [relative(root, f), readFileSync(f, 'utf8').split('\n').map(l => l.replace(/\/\/ .*$/, ''))])
const keys = Object.keys(REG), nodes = new Set(keys.flatMap(k => k.split('.').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('.'))))
const METHOD = new Set(['length', 'includes', 'some', 'every', 'map', 'filter', 'find', 'indexOf', 'slice', 'join', 'concat'])

test('registry = the leaves of defaults(), 1:1', () => { assert.deepEqual([...keysOf()].sort(), [...keys].sort()) })

// every config chain the code reads (cfg.x.y, d.cfg.x.y, (await cfgOf(h)).x.y) names a registered key, a section of keys, or a method on a key's value
test('every config key read in the code is registered', () => {
  const bad = []
  for (const [f, lines] of SRC) {
    if (f === 'task-management/protocol.ts' || f.startsWith('ui/')) continue   // an adapter's `cfg`; the ui reads the ui.cfg mirror core/session.start writes
    lines.forEach((l, i) => {
      for (const m of l.matchAll(/(?:\bd\.cfg|(?<![.\w])cfg|cfgOf\(h\)\))\.([A-Za-z][\w.]*)/g)) {
        let p = ''
        for (const s of m[1].split('.')) {
          const q = p ? `${p}.${s}` : s
          if (REG[q]) break
          if (nodes.has(q)) { p = q; continue }
          if (!(p && METHOD.has(s))) bad.push(`${f}:${i + 1}: ${m[0]}`)
          break
        }
      }
    })
  }
  assert.deepEqual(bad, [])
})

// every registered key is read somewhere: its last segment appears as a property in the code outside config/.
// ponytail: a name match, not a data-flow proof; the kit's behaviour table (tests/settings-registry.test.ts) is the proof per key.
test('every registered key is read somewhere', () => {
  const text = SRC.map(([, l]) => l.join('\n')).join('\n')
  // sections read through a computed name or handed over whole (cfg.roles[role].byRisk[risk] in core/admission -> core/risk.route; review -> core/risk.riskOf(c); drive -> core/drive.boundOf(dc);
  // review.tiers -> core/risk.reviewTier(c); lanes -> core/lanes.laneOf(lim)): the leaf is enough there; elsewhere `.parent.leaf`
  const DYN = /^(roles\.(worker|tester|reviewer|explorer)|drive|review|lanes)\./
  const unread = keys.filter(k => { const s = k.split('.'), leaf = s.pop(), par = s.pop(); return !new RegExp(par && !DYN.test(k) ? `\\.${par}\\.${leaf}\\b|\\.${par}\\?\\.${leaf}\\b` : `[.'"]${leaf}\\b|\\b${leaf}[,:} ]`).test(text) })
  assert.deepEqual(unread, [])
})

// one read path: config comes from cfgOf(h) (config/index). Nothing else loads layers, calls the Host's config, or parses a settings file it does not write.
const ALLOW = {
  'hooks/register.ts': /h\.config = |\bload\(/,   // defines h.config (the effective config, loaded once per call)
  'commands/prefs.ts': /cadre\.json|defaults\(\)/,   // cadre writes the user file after the confirm card; defaults() decides which keys to drop
  'commands/init.ts': /cadre\.json|config\.json/,   // init writes .cadre/config.json and the user file's repo section after confirm cards
  'commands/cadre.ts': /defaults\(\)/,   // `/cadre config show` lists what differs from the defaults
  'core/lanes.ts': /cfgDefaults\(\)\.lanes/,   // the pure laneOf's fallback; every caller with a Host passes cfgOf(h).lanes
  'task-management/sync-engine/loop.ts': /config\.json|cadre\.json/,   // `sync add` writes .cadre/config.json after its confirm card
  'core/session.ts': /readText\(`\$\{await h\.cwd\(\)\}\/\.cadre\/config\.json`\)/,   // existence only: the repo opted in
  'commands/doctor.ts': /readText\(`\$\{root\}\/\.cadre\/config\.json`\)|cadre\.json/,   // existence only; a fix line names the file
  'core/drive.ts': /cadre\.json/,   // hashes the file's bytes: a settings change nobody approved stops a drive
  'core/discover.ts': /config\.json/, 'policy/guards.ts': /cadre\.json|config\.json/,   // the guard refuses Claude's writes to the settings files (init alone may write the repo file)
    // comments/refusal text naming the file
}
test('no config read bypasses cfgOf', () => {
  const bad = []
  for (const [f, lines] of SRC) lines.forEach((l, i) => {
    if (!/\.config\?*\.?\(|\(h as any\)\.config|\b(load|layersOf|resolve)\(|defaults\(\)|cfgDefaults\(|cadre\.json|config\.json/.test(l)) return
    if (/\bresolve\(\)|new Promise|Promise\.resolve|\.resolve\(/.test(l) && !/\b(load|layersOf)\(|\.config|defaults\(\)|cadre\.json|config\.json/.test(l)) return   // Promise resolve, not config
    if (/from '\.\.\/task-management\/registry'|typeDefaults\(\)|registry'?\)?\.defaults|\bdefaults\(\) as unknown/.test(l) && !/cfgDefaults|cadre\.json|config\.json/.test(l)) return   // the type registry's defaults
    if (/\bdefaults\(\)/.test(l) && /(reg|TypeRegistry)\b/.test(l) && !/cfgDefaults/.test(l)) return
    if (ALLOW[f]?.test(l)) return
    bad.push(`${f}:${i + 1}: ${l.trim().slice(0, 120)}`)
  })
  assert.deepEqual(bad, [])
})

// the behaviour proofs the kit table points to exist (tests/settings-behaviour.test.ts lists the rest)
test('every ELSEWHERE proof names a real test', async () => {
  const { ELSEWHERE } = await import('../fixtures/settings-proof.ts')
  const miss = Object.entries(ELSEWHERE).filter(([, [f, frag]]) => !readFileSync(join(root, f), 'utf8').includes(frag)).map(([k]) => k)
  assert.deepEqual(miss, [])
})
