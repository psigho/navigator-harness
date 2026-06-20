---
skill_id: quality_gates
type: rules
category: engine
triggers:
  keywords: [quality, gate, validation, completeness, correctness, safety, citation, compliance, review, pre-delivery, checklist]
  languages: [all]
  platforms: [cross]
depends_on: [routing, conflict_resolution]
priority: 21
description: The five pre-delivery gates every response passes through, with per-intent checklists; gate failures are fixed before delivery, not flagged to the user.
---

# Quality Gates Engine

Every response Navigator emits passes five gates before it reaches the user. The gates run
*last*, after the build/debug skill has produced output, as a final self-check. The
governing rule: **a gate failure is a defect to fix, not a caveat to disclose.** If a gate
fails, fix the output and re-run the gate. The user sees the corrected result, not an
apology about what almost shipped.

## The five gates

| # | Gate | Question it answers | On failure |
|---|---|---|---|
| 1 | Completeness | Did I do everything the request actually asked? | Finish the missing part, re-run gate 1 |
| 2 | Correctness | Does it actually work / is it actually true? | Fix the defect, re-run gates 1-2 |
| 3 | Safety | Did I honor every anti-failure rule (rank 1)? | Remove the unsafe construct, re-run all gates |
| 4 | Citation | Is every nontrivial claim grounded in a file/source? | Add the citation or soften the claim, re-run gate 4 |
| 5 | Compliance | Did I stay in scope and follow standing instructions? | Realign to scope/instruction, re-run all gates |

Gates run in order. A failure at gate N re-runs from gate 1 (a correctness fix can
reintroduce an incompleteness; a safety fix can break a citation). Only when all five pass
clean in a single sweep does the response ship.

### Gate 1 — Completeness

The request is a contract. Enumerate every clause — explicit asks, implied sub-tasks, and
the "and obviously also" parts a competent engineer would include. Completeness fails when
any clause is unaddressed, even if what's present is excellent.

- Did each verb in the request produce an artifact? ("add validation **and** tests" = two.)
- Are edge cases the spec implied actually handled, or silently dropped?
- If the task had N items, are all N done — not N-1 with a "the rest are similar"?

### Gate 2 — Correctness

Output must be true and must run. Correctness is the gate most often faked by confidence.

- Code: does it parse, import, and pass the tests you ran? Did you *run* them, not imagine them?
- Logic: trace one real input end-to-end. Does the output match the claim?
- Facts: is every assertion verifiable against a file or a fetched source, not memory?

### Gate 3 — Safety

Safety binds the rank-1 anti-failure rules to the output. This gate cannot be waived by any
user instruction below rank 2, and the anti-failure rules themselves sit at rank 1.

- No language-specific footguns the relevant `*_anti_failure` skill forbids (e.g. mutable
  default args in Python, `unwrap()` on fallible Rust paths in shipped code).
- No destructive operation slipped in without the escalation this engine's sibling requires.
- No hallucinated API, flag, or import — cross-checked against `hallucination_guards`.

### Gate 4 — Citation

Trust requires traceability. Every nontrivial claim must point to where it came from.

- Statements about *this* codebase cite the file (and ideally line) they're drawn from.
- Statements about external behavior (a library's API, an HTTP status) cite the reference
  file under `prototyping/dev_reference/` or a fetched source.
- A claim with no citation must be either grounded or downgraded to a flagged assumption —
  never asserted as fact. "I believe" is not a citation; it is a defect.

### Gate 5 — Compliance

The response must obey the standing frame: the active scope (see
[engagement.md](engagement.md)), the user's persistent instructions, and the project's
conventions captured in its `AGENT_NOTES.md` / project files.

- Did the output stay inside the declared scope, or drift into uncommissioned work?
- Were standing user instructions (rank 2) honored — style, stack, "always/never" rules?
- Do new files follow the project's existing naming, layout, and manifest conventions?

## Per-intent checklists

The gates are universal; what they *check* depends on the router's intent classification.
A BUILD output and a LOOKUP answer fail completeness for different reasons.

### BUILD — `build, create, write, make, implement, generate, add`
1. **Completeness** — every requested file/function exists; tests included if implied; no stubs or TODOs left.
2. **Correctness** — code runs, imports resolve, the test suite you executed is green.
3. **Safety** — no anti-failure footguns; destructive steps gated; deps justified.
4. **Citation** — patterns drawn from `func_encyclopedia`/`dev_reference` are linked; project conventions referenced.
5. **Compliance** — matches the requested stack/style; stays in the commissioned scope.

### DEBUG — `error, fix, crash, broken, fail, exception, traceback, bug`
1. **Completeness** — root cause named, fix applied, **and** a regression check added/described.
2. **Correctness** — the fix actually resolves the reported symptom; verified by re-running the failing case.
3. **Safety** — fix doesn't introduce a new footgun or paper over the cause with a broad `except`.
4. **Citation** — the error signature is mapped to the matched `*_debug` skill's `error_patterns`.
5. **Compliance** — minimal, targeted change; no opportunistic refactor outside the bug's scope.

### LOOKUP — `how, what, explain, describe, when, which`
1. **Completeness** — the actual question answered, plus the immediately-next question pre-empted.
2. **Correctness** — facts verified against a reference file or fetched source, not recalled.
3. **Safety** — no advice that, if followed, violates an anti-failure rule.
4. **Citation** — *every* factual claim links to its source; this gate is strictest for LOOKUP.
5. **Compliance** — answer pitched at the asked scope; no unrequested 2,000-word essay.

### PROTOTYPE — `design, plan, architecture, scaffold, structure`
1. **Completeness** — components, their interactions, and the build order are all present.
2. **Correctness** — the design is internally consistent; interfaces actually compose.
3. **Safety** — failure modes called out; anti-failure constraints baked into the design.
4. **Citation** — references the relevant `isa_diagrams` / `wiring_diagrams` and domain maps.
5. **Compliance** — scoped to what was asked; doesn't silently expand the system's mandate.

### TOOL — `tool, library, resource, install`
1. **Completeness** — the tool, install command, and a minimal usage example provided.
2. **Correctness** — install command and version are current (verified), not stale recall.
3. **Safety** — no untrusted source; supply-chain caveats noted where relevant.
4. **Citation** — sourced from `tool_repo` or a fetched canonical page.
5. **Compliance** — fits the project's existing stack; doesn't introduce a conflicting dep.

### PROJECT — `project, continue, resume, build order`
1. **Completeness** — current state read, next step identified, build order updated.
2. **Correctness** — the resumed state matches reality on disk, not an assumed checkpoint.
3. **Safety** — resuming doesn't re-run a destructive step already applied.
4. **Citation** — references the project's build-order file and prior session notes.
5. **Compliance** — continues the established plan; doesn't quietly re-scope the project.

## Failure handling: fix, don't flag

The defining discipline of this engine: **gate failures are repaired before delivery.**

- ✗ "Here's the function — note I didn't run the tests." → ran the tests; either it's green
  or you fixed it. Don't ship the disclaimer.
- ✗ "This should work but I'm not sure the import path is right." → verify the import path,
  then assert. Uncertainty is a gate-2 failure to resolve, not a hedge to pass along.
- ✓ The *only* thing that surfaces to the user is a genuine fork the
  [escalation.md](escalation.md) engine flagged — a decision that needs *their* input, not
  a defect you could have fixed yourself.

The user's experience of quality gates is invisible: they simply receive output that is
complete, correct, safe, cited, and compliant — because everything that wasn't got fixed
before it reached them.

## CROSS-REFERENCES

- [routing.md](routing.md) — `routing`: supplies the intent classification that selects which per-intent checklist applies.
- [escalation.md](escalation.md) — `escalation`: the boundary between a gate-fixable defect (fix silently) and a genuine fork (surface).
- [conflict_resolution.md](conflict_resolution.md) — `conflict_resolution`: gate 3 (safety) binds the rank-1 anti-failure authority.
- [engagement.md](engagement.md) — `engagement`: gate 5 (compliance) reads the active scope from the engagement state.
- [../../master_skill.md](../../master_skill.md) — `master_skill`: runs all five gates as the final stage of every dispatch.

## END OF SKILL
