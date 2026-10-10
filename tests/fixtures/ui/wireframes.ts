// Band wireframes from design/artifact/wireframes.json (UI-DESIGN 6.1), minus the engine's [-] mark. Tests compare modulo whitespace.
export const WIRE: Record<string, string[]> = {
 "Band, working|120": [
  "[RUN] cadre · p3 auth-login · strict · contained ✓ · drive ▶ 12/100 · ctx 34% · cache 87% · pm ✓",
  "  ✓a1 ✓a4 ✓a7 │ ▶a2 ✓a3 │ ⏸a6 ◌a5   4/7 done · ▶1 ⏸1 ◌1   ↻1"
 ],
 "Band, attention (approval)|120": [
  "[ATTN] ⚑ NEEDS YOU · approve plan p3 · 7 tasks · 12 scenarios · 3 new / 2 changed symbols   1: open sheet",
  "  type  /cadre approve p3@ab12cd34   (or press 1, then a)                                d: Epic view",
  "[WAIT] cadre · p3 · drive ⏸ approval · ctx 34% · cache 87%"
 ],
 "Band, attention (critical flag)|120": [
  "[ATTN] ⚑ NEEDS YOU · [CRIT] ✗ git:dev:agent · dev moved outside a cadre merge · merges blocked   1: open",
  "  ✓a1 ✓a4 ✓a7 │ ✓a2 ✓a3 │ ✗a6 ◌a5   5/7 done · ▶0 ⏸0 ◌1"
 ],
 "Band, epic landed|120": [
  "[OK] cadre · p3 auth-login · done-on-dev ✓ · ✓✓✓│✓✓│✓◌ 7 tasks · ctx 41% · cache 88% · [WARN] release? v1.4.0"
 ],
 "Band, working (narrow)|60": [
  "[RUN] p3 ✓✓✓│▶✓│⏸◌ 4/7 ▶1 ⏸1 · ctx34%"
 ],
 "Band, attention (narrow)|60": [
  "[ATTN] ⚑ approve p3 (7 tasks)         1: open sheet",
  "  /cadre approve p3@ab12cd34",
  "[WAIT] p3 ○○○│○○│⏸○ 0/7 · drive ⏸"
 ]
}
