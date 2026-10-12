# 0016: risk-sized review

Status: accepted (0.10.0). Learned from OMC's verification tiers.

**Decision.** When a task reaches review, `core/admission.review` sizes the reviewer from `git diff --numstat <base>..<sourceCommit>` plus path globs (`core/risk.reviewTier`, pure):

| tier | when | model | brief adds |
|---|---|---|---|
| light | < `light.files` (5) files and < `light.lines` (100) lines, no risky path | sonnet | short checklist |
| standard | default | sonnet | nothing (today's review) |
| thorough | > `thorough.files` (20) files or > `thorough.lines` (500) lines, a `risky` glob, a declared core path, or a `review.deepLabels` label | opus (`models.deep`) | security + structure checklist |

**Floor.** The reviewer is never below sonnet: `roles.reviewer.tier: fast` is raised to `standard`.

**Config** (`review.tiers`): thresholds and `risky` globs (auth/security/crypto/permissions, migrations, CI, dependency manifests). A repo file may only tighten: lower numbers win (`min`), `risky` only grows (`grow`); the user layer may set anything above the floor.

**Record.** Task meta `cadre.reviewTier`; `agent.bound` carries `tier` (optional) and Activity shows "<tier> review started on <id>".

**Model-visible text.** The brief gets a `Check` section from `risk.FOCUS` in task language; no tier names reach the reviewer. Standard adds no section.

Deterministic: no model call decides the tier. Numstat failure surfaces as a spawn error like the existing diff reads.
