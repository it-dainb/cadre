---
type: llm
focus: trace
---
Judge by the tool RESULTS, not by the subagent_type main requested (the mod retypes a spawn to the current step's agent). In order: a tester's report is answered "red ✓ ... red accepted" first; then a worker's report is answered "report accepted: commit ..., verify ✓"; then a reviewer's report is answered "verdict accepted: pass@...". The three answers appear in this order in the trace.
