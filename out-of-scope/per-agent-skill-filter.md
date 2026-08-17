# per-agent-skill-filter — unnecessary

slim's hook stripping `<skill>` blocks from the prompt per agent.

**Why not.** Claude Code already ships name + description only and loads a skill body on invocation. The savings slim built a hook to win are the host's default here. Narrowing what an agent can reach is done declaratively in frontmatter instead.
