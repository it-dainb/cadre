"""Harbor agent adapters that install a Claude Code plugin before the run.

Harbor's built-in `claude-code` agent installs the CLI and runs it. It has no
plugin mechanism — the adapter copies skills, memory, MCP config and
settings.json, but not plugin bundles. These subclasses add that step.

Works against any Harbor benchmark, since Terminal-Bench 2.0 and frontier-bench
share this exact adapter machinery. Point Harbor at one of these classes:

    harbor run -d terminal-bench/terminal-bench-2 \
      -a harness.bench.harbor.cadre_agent:CadreClaudeCode \
      --ak plugin_dir=/abs/path/to/cadre --n-tasks 2

Auth: set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) and
CLAUDE_FORCE_OAUTH=1. The base adapter prefers ANTHROPIC_API_KEY unless forced.
"""

from __future__ import annotations

from pathlib import Path

from harbor.agents.installed.claude_code import ClaudeCode
from harbor.environments.base import BaseEnvironment

# Every command runs through a login-less shell, so the CLI's install location
# is not on PATH by default.
_PATH = 'export PATH="$HOME/.local/bin:$PATH"; '


class PluginClaudeCode(ClaudeCode):
    """Claude Code with a local plugin installed from a directory."""

    def __init__(
        self,
        *args,
        plugin_dir: str | None = None,
        plugin_id: str | None = None,
        **kwargs,
    ) -> None:
        super().__init__(*args, **kwargs)
        if not plugin_dir:
            raise ValueError(
                "plugin_dir is required — pass --ak plugin_dir=/abs/path/to/plugin"
            )
        self._plugin_dir = Path(plugin_dir).expanduser().resolve()
        if not (self._plugin_dir / ".claude-plugin" / "marketplace.json").is_file():
            raise ValueError(
                f"{self._plugin_dir} has no .claude-plugin/marketplace.json — "
                "point plugin_dir at the marketplace root"
            )
        self._plugin_id = plugin_id or f"{self._plugin_dir.name}@{self._plugin_dir.name}"

    async def install(self, environment: BaseEnvironment) -> None:
        await super().install(environment)
        await self._install_plugin(environment)
        await self._configure(environment)

    async def _install_plugin(self, environment: BaseEnvironment) -> None:
        target = "/tmp/plugin-src"
        await environment.upload_dir(self._plugin_dir, target)

        await self.exec_as_agent(
            environment,
            command=(
                f"{_PATH}set -euo pipefail; "
                f"claude plugin marketplace add {target} && "
                f"claude plugin install {self._plugin_id}"
            ),
        )

        # Installing is not loading. This plugin once installed cleanly and then
        # failed to load on a duplicate hooks declaration, which would silently
        # turn this arm into plain Claude Code — a null result wearing the label
        # of a real one. Fail the run instead.
        result = await self.exec_as_agent(
            environment, command=f"{_PATH}claude plugin list 2>&1"
        )
        listing = _text(result)
        if "enabled" not in listing:
            raise RuntimeError(
                f"{self._plugin_id} installed but is not enabled:\n{listing}"
            )
        self.logger.info("plugin %s enabled", self._plugin_id)

    async def _configure(self, environment: BaseEnvironment) -> None:
        """Hook for per-plugin setup. Base implementation does nothing."""


class CadreClaudeCode(PluginClaudeCode):
    """cadre, configured to run without a human in the loop.

    Harbor runs headless, so cadre's default `adaptive` mode is unusable: the
    merge gate correctly asks for approval on anything past the file threshold,
    nobody answers, and finished work is stranded in a worktree. Measured on a
    local harness — 4 of 5 tasks merged nothing. `automatron` waives the human
    approval and keeps the review step.
    """

    def __init__(
        self,
        *args,
        plugin_dir: str | None = None,
        plugin_id: str = "cadre@cadre",
        mode: str = "automatron",
        threshold: int = 3,
        **kwargs,
    ) -> None:
        super().__init__(*args, plugin_dir=plugin_dir, plugin_id=plugin_id, **kwargs)
        self._mode = mode
        self._threshold = int(threshold)

    async def _configure(self, environment: BaseEnvironment) -> None:
        config = f'{{"mode":"{self._mode}","threshold":{self._threshold}}}'
        await self.exec_as_agent(
            environment,
            command=(
                "set -euo pipefail; "
                "mkdir -p .cadre && "
                f"printf '%s' '{config}' > .cadre/config.json"
            ),
        )


def _text(result) -> str:
    """Harbor exec results vary by environment backend; get at the output."""
    for attr in ("output", "stdout", "text"):
        value = getattr(result, attr, None)
        if value:
            return value.decode() if isinstance(value, bytes) else str(value)
    return str(result)
