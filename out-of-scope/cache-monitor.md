# cache-monitor — not buildable as a plugin

slim's runtime watchdog warning when a session never hits the provider cache.

**Why not.** It reads per-message `cache.read` / `cache.write` telemetry. No Claude Code hook streams that to a plugin. Only viable if cadre ever wraps the SDK directly.
