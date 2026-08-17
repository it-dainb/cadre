# Harbor adapters

Harbor's built-in `claude-code` agent has no plugin mechanism. `cadre_agent.py`
subclasses it and installs a local plugin during `install()`, then asserts the
plugin actually loaded — installing and loading are different, and a plugin
that installs but fails to load turns the arm into plain Claude Code while
still being labelled as the plugin.

Works unchanged against **Terminal-Bench 2.0** and **frontier-bench**: both run
on the same `harbor` CLI and the same `claude_code.py` adapter.

## Auth (one-time, must be run by a human)

    claude setup-token          # opens a browser, prints a token
    export CLAUDE_CODE_OAUTH_TOKEN=<token>
    export CLAUDE_FORCE_OAUTH=1 # base adapter prefers ANTHROPIC_API_KEY otherwise

No ANTHROPIC_API_KEY is needed; a Max subscription is enough.

## Run

    export PYTHONPATH=$PWD
    harbor run \
      -d terminal-bench/terminal-bench-2 \
      -a harness.bench.harbor.cadre_agent:CadreClaudeCode \
      --ak plugin_dir=$PWD/cadre \
      --n-tasks 2 --n-concurrent 2 --jobs-dir .omc/bench/tb2

Swap `-d harbor-framework/frontier-bench` for the other benchmark. Drop `-a`
back to plain `claude-code` for the control arm — same command otherwise, which
is the point.

Harbor reports per-task `total_cost_usd` parsed from Claude Code's own
stream-json output, so cost is authoritative rather than estimated.

## Notes

- `CadreClaudeCode` writes `.cadre/config.json` with `mode=automatron`. Harbor
  is headless and cadre's default `adaptive` mode strands work in a worktree
  waiting for an approval nobody can give — measured locally at 4 of 5 tasks.
- deep-swe runs on **Pier**, a Harbor fork with its own copy of the adapter.
  `PluginClaudeCode` should port with an import-path change, but it is not the
  same class and has not been tried.
