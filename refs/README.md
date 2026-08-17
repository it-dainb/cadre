# refs/ — prior art, not shipped

Everything in this directory except this file is gitignored. Nothing here is
part of cadre, and nothing here is needed to *use* cadre — only to reproduce
the measurements in the root README.

These were git submodules until a GitHub install proved they break one. `claude
plugin marketplace add` clones the repository with `--recurse-submodules`,
because `marketplace.json` lives at the repo root and `"source": "./src"` is
resolved inside that clone. With the submodules declared, the add pulled ~110M
and then failed outright:

```
warning: Clone succeeded, but checkout failed.
```

No marketplace was registered. Cloning ~110M of reference material to deliver an
833-token plugin was already the wrong trade; failing while doing it settled it.

## Getting them back

Only needed if you intend to run the harness. Clone what you need:

```bash
git clone https://github.com/tctinh/agent-hive.git                 refs/agent-hive
git clone https://github.com/gastownhall/beads.git                 refs/beads
git clone https://github.com/deepseek-ai/deepseek-harness.git      refs/deepseek-harness
git clone https://github.com/Yeachan-Heo/oh-my-claudecode.git      refs/oh-my-claudecode
git clone https://github.com/thevibeworks/claude-code-docs.git     refs/claude
```

The commits these were pinned at, for reproducing a specific measurement:

| path | repo | pinned commit |
|---|---|---|
| `refs/agent-hive` | tctinh/agent-hive | `7eb9020` (v1.4.5-13) |
| `refs/beads` | gastownhall/beads | `7505e173f` (v1.2.0-12) |
| `refs/deepseek-harness` | deepseek-ai/deepseek-harness | `47f943859` |
| `refs/oh-my-claudecode` | Yeachan-Heo/oh-my-claudecode | `5aa678c6f` (v4.15.10-22) |
| `refs/claude` | thevibeworks/claude-code-docs | `faf3d0d75` |

`refs/claude` was `docs/claude` until this change; the directory moved so that
every untracked reference tree lives under one ignored path.

## What needs which

Only `refs/oh-my-claudecode` is load-bearing:

- `harness/spawn-cost.sh` stages it as both arms of the `tools:` measurement —
  the 22,035-vs-9,482 token figure in the root README. It exits non-zero with a
  clone command if the directory is absent.
- `harness/bench/run.sh` mounts it as the `omc` benchmark arm.

`./harness/ci.sh` does not need any of them and passes on a bare clone. The rows
that check harness mount paths report `skipped` rather than failing when the
reference trees are not present, so a contributor who only touches `src/` is
never asked to download 66M to get a green board.

The rest — `agent-hive`, `beads`, `deepseek-harness`, `claude` — are read, not
executed. `out-of-scope/` cites agent-hive and beads for decisions that were
made by reading what they did and declining to repeat it.
