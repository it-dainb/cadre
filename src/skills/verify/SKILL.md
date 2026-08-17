---
name: verify
description: Check that a completed task actually did what its spec asked, by exercising the change rather than re-reading it. Use before merge, after the reviewer pass.
---

# verify

Read `spec.md` for what was asked, then drive the change and observe it.

Run the project's own checks — tests, build, typecheck — and read the output rather than the exit code alone. A green run that never exercised the changed path proves nothing.

Report what you actually observed. "Tests pass" is weaker than "the new branch is reached and returns the expected value, confirmed by X". If you could not exercise something, say which part and why, rather than implying full coverage.
