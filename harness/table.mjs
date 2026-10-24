
import fs from "node:fs"
// Verdict table of one matrix run (see matrix.sh). A cell with RUNS=N has dirs <name>.r1..rN: one row, PASS only if every run passes.
const run = process.argv[2], runs = []
for (const c of fs.readdirSync(run)) { if (!fs.existsSync(`${run}/${c}.line`)) continue; const f = `${run}/${c}/verdict.json`; if (!fs.existsSync(f)) { if (fs.statSync(`${run}/${c}`).isDirectory()) runs.push([c, "-", "NO VERDICT", "", "", "", "", ""]); continue }
  const v = JSON.parse(fs.readFileSync(f)), s = v.stats, envs = fs.readFileSync(`${run}/${c}.env`, "utf8"), own = ["not-landed", (envs.match(/(?:^| )ORACLE=(\S+)/) ?? [])[1]]
  const known = v.fails.every(f => own.includes(f.invariant)) && (envs.match(/(?:^| )KNOWN=(\S+)/) ?? [])[1]   // known masks only the cell own oracle and its landing, never a leak or an error
  runs.push([c, v.pass ? "PASS" : known ? `known:${known}` : "FAIL", v.pass ? "" : [...new Set(v.fails.map(f => f.invariant))].join(","), s.secsToPlan ?? "-", s.dialogs, s.turns, s.usd, Math.round(s.secs / 60), v.pass ? "" : v.fails[0].evidence.slice(0, 90)]) }
const rows = [], by = new Map()
for (const r of runs) { const k = r[0].replace(/\.r\d+$/, ""); by.set(k, [...(by.get(k) ?? []), r]) }
for (const [k, g] of by) { const bad = g.find(r => r[1] === "FAIL" || r[2] === "NO VERDICT") ?? g.find(r => r[1] !== "PASS"); const r = [...(bad ?? g[0])]; r[0] = k; if (g.length > 1) { r[6] = +g.reduce((a, x) => a + (+x[6] || 0), 0).toFixed(2); r[7] = g.reduce((a, x) => a + (+x[7] || 0), 0) } rows.push(r) }   // a real failure outranks a known one, so the exit code sees it
const head = ["cell", "verdict", "failing invariant", "s to plan", "dialogs", "turns", "US$", "min", "evidence"]
const w = head.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i] ?? "").length)))
for (const r of [head, ...rows]) console.log(r.map((x, i) => String(x ?? "").padEnd(w[i])).join(" | "))
for (const r of rows) { const twin = rows.find(x => x[0] === `${r[0]}-live`); if (twin && twin[1] !== "-" && r[1] !== "-" && (r[1] === "PASS") !== (twin[1] === "PASS")) console.log(`${r[0]} | FAIL | twin-disagree | S ${r[1]}, L ${twin[1]}`) }
const t = rows.reduce((a, r) => a + (+r[6] || 0), 0); console.log(`total US$ ${t.toFixed(2)} · ${rows.filter(r => r[1] === "PASS").length}/${rows.length} pass`)