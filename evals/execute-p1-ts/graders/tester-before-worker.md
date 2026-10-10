---
type: llm
focus: trace
---
Judge by the tool RESULTS main received, not by the subagent_type main requested (the mod retypes a spawn to the current step's agent). Each Agent result is a one-line card; in this order the cards read: `tester → worker` (red gate passed), then `worker → review · green ✓`, then `reviewer → review✓`. Nested subagent calls may be absent from the trace: the cards are the evidence. PASS when the three cards appear in that order.
