// Dev-only UI loop (docs/dev/ui-dev.md): draws the REAL ui/ renderers (band + pane + card + timeline) for a scenario in your terminal, hot-reloads on save.
//   node --experimental-transform-types scripts/ui-dev.mjs [scenario] [--width N] [--tab epic|plan|doctor|card] [--once] [--all] | --dump <scenario> (JSON for harness/tui.sh --scenario)
// Each frame renders in a fresh child process (clean module cache = hot reload for free; a broken file draws a red frame instead of killing the loop).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, watch, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const ME = fileURLToPath(import.meta.url), ROOT = join(dirname(ME), '..')
const WIDTHS = [60, 120, 160], TABS = { 1: 'epic', 7: 'plan', 8: 'doctor', 0: 'card' }
const FLAGS = ['--experimental-transform-types', '--no-warnings']

// ---------- child: render one frame, print JSON ----------
const ANSI = { warning: 33, error: 31, success: 32, suggestion: 36, inactive: 90, subtle: 90 }
const RASTER = { '█': 34, '▒': 35, '░': 33, '╌': 90, '┃': 33, '▼': 33, '.': 90, o: 32, '*': 33, '!': 31 }
const sgr = (codes, s) => (codes.length ? `\x1b[${codes.join(';')}m${s}\x1b[0m` : s)

async function child(req) {
  await import(pathToFileURL(join(ROOT, 'tests/dev/register.mjs')))
  const I = f => import(pathToFileURL(join(ROOT, f)))
  const [{ band }, { pane }, { defaultTab, decisions }, M] = await Promise.all([I('ui/band.ts'), I('ui/pane.ts'), I('ui/card.ts'), I('ui/model.ts')])
  const s = (await I(`scenarios/${req.name}.ts`)).default
  const ring = [...(s.ring ?? s.events ?? [])].sort((a, b) => a.at - b.at), n = ring.length
  const v = { b: s.b ?? s.snapshot, ring, sec: s.sec ?? s.secret ?? {}, ui: { ...s.ui }, c: { ...M.CFG, ...(s.c ?? s.cfg) }, now: s.now, sx: s.sx ?? 'strict', t: s.t ?? null }
  if (req.dump) return { b: v.b, ring, sec: v.sec, ui: { ...v.ui, tab: v.ui.tab ?? s.tab ?? defaultTab(v) }, c: s.c ?? s.cfg ?? {}, now: v.now }   // harness/tui.sh --scenario: seeded into the real engine's atoms
  // event cursor: idx = events applied; n = live. Undefined: the scenario's own t (live unless it asks for a replay)
  let idx = req.idx ?? (v.t === null ? n : ring.filter(e => e.at <= v.t).length)
  idx = Math.max(0, Math.min(n, idx))
  v.t = idx >= n ? null : idx === 0 ? (ring[0]?.at ?? v.now) - 1 : ring[idx - 1].at
  v.ui = { ...v.ui, ...req.ui }
  v.ui.tab = req.tab ?? v.ui.tab ?? s.tab ?? defaultTab(v)
  if (req.skipEmpty && (v.ui.tab === 'epic' || v.ui.tab === 'card' && !decisions(v).length) && !v.b.tasks.length) return { ansi: [], plain: [], status: '', patch: {}, idx, n, w: 0, tab: 'epic', buttons: [] }   // known: ui/epic.ts dag() throws on a task-less epic tab (RangeError); --all skips it
  const w = req.w ?? s.width ?? 120, rows = [], patch = {}
  const said = []
  const dc = (id, key) => { const d = (v.b.decisions ?? []).find(x => x.id === id), o = d?.options.find(x => x.key === key); return o ? (o.fill ? `prefill composer: ${o.fill}` : `/cadre ${(o.run ?? '').replace('{code}', v.sec.dcode?.[id] ?? '<code>')}`) : `press ${id} ${key}` }
  const acts = {
    go: t => { patch.tab = t; said.push(`go tab ${t}`) }, pick: id => { patch.sel = id; said.push(`select ${id}`) }, fill: c => said.push(`prefill composer: ${c}`),
    press: (id, k) => said.push(dc(id, k)), input: (id, k, x) => said.push(`field ${id}.${k} = ${x}`),
    step: (what, d) => { said.push(`step ${what} ${d}`); if (what === 'dec') patch.di = Math.max(0, Math.min(decisions(v).length - 1, Number(v.ui.di ?? 0) + d)); if (what === 'tl') patch.tl = v.ui.tl === false },
  }
  const bandLines = band(v, w, acts), p = pane(v, w, req.rows ?? 40, acts, true)
  const flat = [...bandLines, ...p.before, ...p.after]
  // text projection: a Button draws `[k] label`, an Input `label: value▏`
  const body = seg => (seg.inp ? `${seg.il ?? 'task id'}: ${seg.iv ?? ''}▏` : seg.hk ? `[${seg.hk}] ${seg.t}` : seg.t)
  const paint = l => l.map(seg => sgr([...(seg.b ? [1] : []), ...(seg.d ? [2] : []), ...(seg.i ? [7] : []), ...(ANSI[seg.c] ? [ANSI[seg.c]] : [])], body(seg))).join('')
  const plainOf = l => l.map(body).join('').trimEnd()
  const tlRows = (p.tl?.rows ?? []).map(r => ({ a: [...r].map(ch => sgr(RASTER[ch] ? [RASTER[ch]] : [], M.T(v.c, ch))).join(''), p: M.T(v.c, r).trimEnd() }))
  const ev = idx === 0 ? 'before the first event' : `${ring[idx - 1].type}${ring[idx - 1].taskId ? ` ${ring[idx - 1].taskId}` : ''}`
  const head = `▌ ${req.name} · w${w} · tab ${v.ui.tab} · event ${idx}/${n} ${idx >= n ? '[LIVE]' : `[${ev}]`}`
  const frame = [{ a: sgr([2], head), p: head }, ...bandLines.map(l => ({ a: paint(l), p: plainOf(l) })), { a: sgr([2], '─'.repeat(w)), p: '─'.repeat(w) },
    ...p.before.map(l => ({ a: paint(l), p: plainOf(l) })), ...tlRows, ...p.after.map(l => ({ a: paint(l), p: plainOf(l) }))]
  let status = ''
  if (req.press) {
    const hit = flat.flat().find(x => x.hk === req.press && x.p)
    if (!hit) status = `no [${req.press}] button on this frame`
    else { hit.p(); status = `[${req.press}] → ${said.join(' · ') || '(nothing)'}${v.t === null ? '' : '  (replay: the real pane has actions off)'}` }
  }
  return { ansi: frame.map(x => x.a), plain: frame.map(x => x.p.trimEnd()), status, patch, idx, n, w, tab: v.ui.tab, buttons: flat.flat().filter(x => x.hk).map(x => x.hk) }
}

// ---------- parent ----------
const run = req => new Promise(res => {
  const c = spawn(process.execPath, [...FLAGS, ME, '--child', JSON.stringify(req)], { cwd: ROOT }), o = [], e = []
  c.stdout.on('data', d => o.push(d)); c.stderr.on('data', d => e.push(d))
  c.on('close', () => { try { res(JSON.parse(Buffer.concat(o).toString().split('\n').filter(l => l.startsWith('{')).at(-1))) } catch { res({ error: Buffer.concat(e).toString() || Buffer.concat(o).toString() || 'child died' }) } })
})
const names = () => readdirSync(join(ROOT, 'scenarios')).filter(f => f.endsWith('.ts') && !['base.ts', 'index.ts'].includes(f)).map(f => f.slice(0, -3)).sort()

async function main(argv) {
  const opt = (k, d) => { const i = argv.indexOf(k); return i < 0 ? d : argv[i + 1] }
  const has = k => argv.includes(k), pos = argv.filter((a, i) => !a.startsWith('--') && !['--width', '--tab'].includes(argv[i - 1]))[0]
  let st = { name: pos ?? 'epic-p3', w: opt('--width') ? Number(opt('--width')) : undefined, tab: opt('--tab'), idx: undefined, ui: {} }
  if (argv[0] === '--dump') { const r = await run({ name: argv[1], dump: true }); if (r.error) { console.error(r.error); process.exit(1) } console.log(JSON.stringify(r)); return }
  if (has('--all')) {   // CI: every scenario x tab x {60,120} renders
    let bad = 0
    for (const name of names()) for (const w of [60, 120]) for (const tab of ['epic', 'plan', 'doctor', 'card']) {
      const r = await run({ name, w, tab, skipEmpty: true }); if (r.error) { bad++; console.error(`FAIL ${name} ${tab} ${w}\n${r.error}`) }
    }
    console.log(bad ? `${bad} failed` : `ok: ${names().length} scenarios`); process.exit(bad ? 1 : 0)
  }
  if (!existsSync(join(ROOT, 'scenarios', `${st.name}.ts`))) { console.error(`no scenario "${st.name}". have: ${names().join(', ')}`); process.exit(2) }
  if (has('--once') || !process.stdout.isTTY || !process.stdin.isTTY) {
    const r = await run(st); if (r.error) { console.error(r.error); process.exit(1) }
    console.log((process.stdout.isTTY && !process.env.NO_COLOR ? r.ansi : r.plain).join('\n')); return
  }
  const out = x => process.stdout.write(x)
  let last = null, status = 'q quit · ←/→ events · 1/7/8/0 tabs · w width · s save golden · a x c y r k n p buttons', busy = false, again = false, errs = ''
  const draw = async () => {
    if (busy) { again = true; return } busy = true
    do {
      again = false
      const r = await run(st), W = process.stdout.columns ?? 120, H = process.stdout.rows ?? 40
      let lines
      if (r.error) { errs = r.error; lines = ['\x1b[41;97m ERROR — fix the file and save, the loop keeps running \x1b[0m', ...r.error.split('\n').slice(0, H - 4).map(l => `\x1b[31m${l.slice(0, W)}\x1b[0m`)] }
      else { errs = ''; last = r; st.idx = r.idx; st.w = r.w; st.tab = r.tab; lines = r.ansi; if (r.w > W) status = `terminal is ${W} cols, frame is ${r.w}: widen it` }
      out(`\x1b[H${lines.join('\x1b[K\n')}\x1b[K\n\x1b[J\x1b[2m${status}\x1b[0m`)
    } while (again)
    busy = false
  }
  const press = async k => { const r = await run({ ...st, press: k }); if (r.error) return; status = r.status; Object.assign(st.ui, { ...r.patch, tab: undefined }); if (r.patch.tab) st.tab = r.patch.tab }
  let timer; const kick = () => { clearTimeout(timer); timer = setTimeout(draw, 40) }
  for (const d of ['ui', 'core', 'scenarios', 'tests/fixtures/ui']) watch(join(ROOT, d), { recursive: true }, (_e, f) => { if (!String(f).startsWith('dev') && !String(f).includes('/dev/')) { status = `reloaded ${f}`; kick() } })
  const done = () => { out('\x1b[?25h\x1b[?1049l'); process.stdin.setRawMode(false); process.exit(0) }
  out('\x1b[?1049h\x1b[?25l'); process.stdin.setRawMode(true); process.stdin.resume()
  process.stdin.on('data', async b => {
    const k = b.toString()
    if (k === 'q' || k === '\x03') return done()
    if (k === '\x1b[C') st.idx = Math.min((last?.n ?? 0), (st.idx ?? 0) + 1)
    else if (k === '\x1b[D') st.idx = Math.max(0, (st.idx ?? 0) - 1)
    else if (k === '\x1b[H' || k === '\x1b[1~') st.idx = 0
    else if (k === '\x1b[F' || k === '\x1b[4~') st.idx = last?.n ?? 0
    else if (k in TABS) st.tab = TABS[k]
    else if (k === '9') status = '9 is reserved'
    else if (k === 'w') st.w = WIDTHS[(WIDTHS.indexOf(st.w) + 1) % WIDTHS.length]
    else if (k === 's' && last) {
      const f = join(ROOT, 'tests/fixtures/ui/dev', `${st.name}-${st.w}.txt`); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, last.plain.join('\n') + '\n'); status = `saved ${f.slice(ROOT.length + 1)}`
    } else if (/^[axcyrknp]$/.test(k)) await press(k)
    await draw()
  })
  process.stdout.on('resize', kick)
  await draw()
}

const argv = process.argv.slice(2)
if (argv[0] === '--child') {
  let r; try { r = await child(JSON.parse(argv[1])) } catch (e) { r = { error: String(e?.stack ?? e) } }
  process.stdout.write(`\n${JSON.stringify(r)}\n`)
} else await main(argv)
