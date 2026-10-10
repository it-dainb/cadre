---
type: llm
focus: trace
---
After a worker ended a turn without calling mcp__cadre__report, the mod nudged it (a resume with a reminder to report) and, if it still did not report, recorded an auto-reported result (text such as "auto-reported" or a computed commit card). The pipeline then continued to review rather than hanging.
