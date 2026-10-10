---
type: llm
focus: trace
---
After the reviewer returned verdict "changes", the worker was RESUMED with the same agentId (the trace shows the same agentId in later worker events or a SendMessage/resume path), NOT replaced by a newly spawned worker. A fresh worker is acceptable only if the trace shows the binding was retired for context over reuse.maxContextPct or an idle gap above the cache TTL.
