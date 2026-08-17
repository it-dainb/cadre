# llm-self-review-as-gate — declined

Letting the worker certify its own output instead of running a reviewer pass.

**Why not.** Measured at roughly 50% accuracy. The reviewer exists as a separate read-only role for this reason, and `/automatron` removes the human gate without removing it. Watch for this creeping back as a "quick self-check before returning" in the worker prompt.
