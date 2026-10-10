// Regression goldens for renders the wireframes do not show (ascii, stubs, band variants); the epic and the approval sheet are asserted against design/artifact/wireframes.json in tests/ui.test.ts. Trailing spaces trimmed; the engine's [-] mark is not drawn by us.
export const GOLDEN: Record<string, string[]> = {
 "epic stubs|118": [
  "1: Epic  7: Plan  ·  p3 · epic/p3-auth-login · 4/8 done · ▶1 ⏸2 ◌1 · [LIVE] 62m",
  "──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
  " ┌────────────────┐     ┏━━━━━━━━━━━━━━━━┓     ┌────────────────┐     ┌────────────────┐  ╭────────────╮ │ SELECTED  a2 · feat      [RUN] ▶",
  " │a1 feat    [OK]✓│     ┃a2 feat   [RUN]▶┃     │a6 feat  [WAIT]⏸│     │a8 docs  [WAIT]⏸│  │  epic/p3   │ │ Session refresh",
  " │Add login       │━━┳━▶┃Session refresh ┃──┬─▶│Remember me     │────▶│Ship docs       │  │   [RUN]▶   │ │ spec● red● impl◉ green○",
  " │●●●●●● merged   │↷a┃8 ┃●●◉○○○ implement┃  ┃  │○○○○○○ waits a2 │ a 1↷│○○○ waits a6    │  ╰────────────╯ │ review○ merged○   (rework)",
  " └────────────────┘  ┃  ┗━━━━━━━━━━━━━━━━┛  ┃  └────────────────┘     └────────────────┘         │       │ after a1 [OK] ━ live edge",
  "                     ┃                      ┃                                                    ▼       │ unblocks a6 (with a3)",
  " ┌────────────────┐  ┃  ┌────────────────┐  ┃  ┌────────────────┐                         ╭────────────╮ │ worker 1 · 23m · ctx 41%",
  " │a4 docs    [OK]✓│  ┃  │a3 fix     [OK]✓│  ┃  │a5 fix   [IDLE]◌│                         │    dev     │ │ ─────────────────────────────────",
  " │README auth     │  ┗━▶│Token clock skew│━━┻┄▷│Rate-limit fall…│                         │  [WAIT]⏸   │ │ LOG  latest first",
  " │●●● merged      │     │●●●●●● merged   │     │○○○○○○ skipped  │                         ╰────────────╯ │ 58m o rev a2 changes → resumed",
  " └────────────────┘     └────────────────┘     └────────────────┘                                │       │ 54m * syn pm back · 1 conflict",
  "                                                                                                 ▼       │ 53m o rev a3 pass · merged",
  " ┌────────────────┐                                                                       ╭────────────╮ │ 40m * syn pm offline · 2 pending",
  " │a7 spike   [OK]✓│                                                                       │    main    │ │ 31m o rev a1 pass · fan-out a2 a3",
  " │Spike: passkeys │                                                                       │  [WAIT]⏸   │ │ 24m o w1  a1 green ✓ · test 41s",
  " │●● reported     │                                                                       ╰────────────╯ │",
  " └────────────────┘                                                                                      │",
  "──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────",
  "TIMELINE  [LIVE] now 62m · █ work ▒ review ░ offline · . silent o band * toast ! notify · t: hide"
 ],
 "band working|115": [
  "[RUN] cadre · p3 auth-login · strict · contained ✓ · drive ▶ 12/100 · ctx 34% · cache 87% · pm ✓",
  "  ✓a1 ✓a4 ✓a7 │ ▶a2 ✓a3 │ ⏸a6 ◌a5   4/7 done · ▶1 ⏸1 ◌1"
 ],
 "band working|55": [
  "[RUN] p3 ✓✓✓│▶✓│⏸◌ 4/7 ▶1 ⏸1 ctx34%"
 ],
 "band working ascii|115": [
  "[RUN] cadre · p3 auth-login · strict · contained + · drive > 12/100 · ctx 34% · cache 87% · pm +",
  "  +a1 +a4 +a7 | >a2 +a3 | =a6 .a5   4/7 done · >1 =1 .1"
 ],
 "band attention|115": [
  "[ATTN] ⚑ NEEDS YOU · approve plan p3 · 7 tasks · 12 scenarios · 3 new / 2 changed symbols             1: open sheet",
  "  type  /cadre approve p3@ab12cd34   (or press 1, then a)                                              d: Epic view",
  "[WAIT] cadre · p3 · drive ⏸ approval · ctx 34% · cache 87%"
 ],
 "band attention|55": [
  "[ATTN] ⚑ approve p3 (7 tasks)             1: open sheet",
  "  /cadre approve p3@ab12cd34",
  "[WAIT] p3 ○○○│⏸⏸│⏸⏸ 0/7 · drive ⏸ ctx34%"
 ],
 "band critical|115": [
  "[ATTN] ⚑ NEEDS YOU · [CRIT] ✗ git:dev:agent · dev moved outside a cadre merge · merges blocked              1: open",
  "  ✓a1 ✓a4 ✓a7 │ ✓a2 ✓a3 │ ✗a6 ◌a5   5/7 done · ▶0 ⏸0 ◌1"
 ],
 "band landed|115": [
  "[OK] cadre · p3 auth-login · done-on-dev ✓ · ✓✓✓│✓✓│✓◌ 7 tasks · ctx 41% · cache 88% · [WARN] release? v1.4.0"
 ],
 "epic live wide ascii|118": [
  "1: Epic  7: Plan  ·  p3 · epic/p3-auth-login · 4/7 done · >1 =1 .1 · [LIVE] 62m",
  "----------------------------------------------------------------------------------------------------------------------",
  " +----------------+     +================+     +----------------+  +------------+ | SELECTED  a2 · feat      [RUN] >",
  " |a1 feat    [OK]+|     |a2 feat   [RUN]>|     |a6 feat  [WAIT]=|  |  epic/p3   | | Session refresh",
  " |Add login       |==+=>|Session refresh |--+->|Remember me     |  |   [RUN]>   | | spec# red# impl@ green-",
  " |###### merged   |  |  |##@--- implement|  |  |------ waits a2 |  +------------+ | review- merged-   (rework)",
  " +----------------+  |  +================+  |  +----------------+         |       | after a1 [OK] = live edge",
  "                     |                      |                             v       | unblocks a6 (with a3)",
  " +----------------+  |  +----------------+  |  +----------------+  +------------+ | worker 1 · 23m · ctx 41%",
  " |a4 docs    [OK]+|  |  |a3 fix     [OK]+|  |  |a5 fix   [IDLE].|  |    dev     | | ---------------------------------",
  " |README auth     |  +=>|Token clock skew|==+.>|Rate-limit fall…|  |  [WAIT]=   | | LOG  latest first",
  " |### merged      |     |###### merged   |     |------ skipped  |  +------------+ | 58m o rev a2 changes → resumed",
  " +----------------+     +----------------+     +----------------+         |       | 54m * syn pm back · 1 conflict",
  "                                                                          v       | 53m o rev a3 pass · merged",
  " +----------------+                                                +------------+ | 40m * syn pm offline · 2 pending",
  " |a7 spike   [OK]+|                                                |    main    | | 31m o rev a1 pass · fan-out a2 a3",
  " |Spike: passkeys |                                                |  [WAIT]=   | | 24m o w1  a1 green + · test 41s",
  " |## reported     |                                                +------------+ |",
  " +----------------+                                                               |",
  "----------------------------------------------------------------------------------------------------------------------",
  "TIMELINE  [LIVE] now 62m · # work % review : offline · . silent o band * toast ! notify · t: hide",
  "          0m        10m       20m       30m       40m       50m       60v       70m       80m       90m",
  "human      !                                                            |",
  "main                                                                    |",
  "tester       ######o                      ########                      |",
  "worker 1             #############o              #############      #####",
  "worker 2       #########                          ######                |",
  "reviewer                %%%%o       %%%%%o                %%%%%o%%%%o   |",
  "explorer        ##########o                                             |",
  "sync                                              *:::::::::::::*       |",
  "----------------------------------------------------------------------------------------------------------------------",
  "n: next  p: prev  h: back  l: fwd  b: prev !  f: next !  e: live  t: timeline  g: go to id"
 ],
}
