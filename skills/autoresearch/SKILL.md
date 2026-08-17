---
name: autoresearch
description: Answer a question about an unfamiliar library, API or codebase area by gathering evidence before deciding. Use when the right approach depends on facts you do not yet have.
---

# autoresearch

1. Check the repo first — a vendored copy or existing usage beats any external source, because it shows what this project actually does.
2. Dispatch `scout` for codebase questions. Give it a specific question, not a topic.
3. Go external only for what the repo cannot answer.

Report findings with their source: `path:line` for code, URL for docs. Separate what you verified from what you inferred — an inference presented as a finding is how a wrong plan gets built on confident-sounding ground.

If the answer stays unclear, say so and name what would settle it. That is more useful than a confident guess.
