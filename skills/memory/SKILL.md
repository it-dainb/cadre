---
name: memory
description: Keep durable notes about this project that survive across sessions — decisions, constraints, and hard-won facts not derivable from the code. Use when something learned now would be expensive to rediscover later.
---

# memory

A file convention, not a tool. Notes live at `.cadre/memory/<key>.md` and you read and write them with Read and Write.

```markdown
---
key: db-choice
summary: Postgres, not MySQL — the ltree extension is load-bearing.
---

Long form goes here.
```

`summary` is the index: keep it one line and make it the point, not a preamble. Reading the directory listing plus summaries should tell you what is known without opening every file — if you have to read every body to find anything, the index has failed.

Store what the repo cannot tell you: why an approach was rejected, a constraint imposed from outside, a fact that took real work to establish. Do not store what `git log` already says.

Deliberately no MCP tools and no helper module. Each MCP tool costs ~341 tokens of schema on *every* worker spawn, and a JS wrapper around `writeFileSync` buys nothing over Write — it just adds a second way to do the same thing, which then has to be kept in sync with the convention.
