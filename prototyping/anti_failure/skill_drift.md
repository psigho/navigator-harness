---
skill_id: skill_drift
type: prototype
category: anti_failure
triggers:
  keywords: [drift, anchor, re-anchor, forget, instructions, long, conversation, adherence, compliance, fidelity]
  error_patterns: ["ignored the loaded skill", "stopped following", "reverted to default behavior", "lost the instructions"]
  languages: [all]
  platforms: [cross]
priority: 3
description: Prevent the model from drifting away from loaded skill instructions over long conversations; mandate periodic re-anchoring.
---

# Anti-Failure: Skill Drift

A skill loaded at turn 3 is not a skill obeyed at turn 40. Across a long conversation the model's
behavior is pulled toward (a) its own pretrained defaults, (b) the most *recent* user message, and
(c) the local flavor of whatever it was just doing. The loaded skill's instructions, sitting far
back in the window, lose salience. The output still *looks* plausible, which is exactly why drift is
dangerous: nothing errors, the work just quietly stops conforming to the skill's rules, conventions,
and safety constraints. This skill detects and corrects that.

## What drift looks like

- A `python_build` skill mandated `pathlib` and type hints at turn 5; by turn 30 new functions use
  `os.path` and untyped signatures — the model reverted to its default style.
- A skill specified a project's error-handling pattern (typed result objects, no bare `except`);
  later code silently swallows exceptions because that is the model's habit, not the skill's rule.
- The user's "never call external network in tests" constraint, set early, is forgotten and a later
  test hits a live endpoint.
- After a context compaction, the skill's body was summarized to a title and its actual rules
  evaporated — the most abrupt form of drift.

## Why it happens

1. **Recency gradient.** Recent tokens dominate attention. Old instructions compete poorly with the
   immediate task context.
2. **Default-attractor pull.** When the active instruction is faint, the model falls back to
   pretrained conventions, which feel "natural" and therefore go unquestioned.
3. **Compaction erosion.** Lossy compaction can reduce a skill from its full rule set to a one-line
   reference, removing the very text that constrained behavior (see `context_budget`).
4. **Task-local momentum.** Whatever you did last turn biases what you do this turn, independent of
   the governing skill.

## Re-anchoring rules

Re-anchoring = re-reading the active skill's binding rules and explicitly restating the constraints
before producing output. It is cheap and it is the only reliable antidote.

1. **Anchor cadence.** Re-anchor every ~10 turns of active work, or whenever the task shifts
   sub-goals — whichever comes first. Don't wait to "feel" drift; by then it has already shipped.
2. **Re-anchor on every compaction.** Immediately after any compaction, re-read the active skill
   file from disk and re-pin its rules. This is mandatory, not cadence-based — compaction is the
   highest-risk drift event.
3. **Re-anchor before irreversible or safety-relevant output.** Before writing files, running
   commands, or emitting a final deliverable, restate the governing constraints and check the output
   against them. This is the join point with `quality_gates` (gate 5, compliance).
4. **Constraint ledger.** Maintain a short, durable list of active hard constraints (user
   instructions + anti-failure rules) in the checkpoint shared with `context_budget`. The ledger is
   re-read on every anchor; it is the canonical record that survives compaction.
5. **Pin the rank-1 and rank-2 authorities.** Anti-failure rules and explicit user instructions
   (conflict ranks 1 and 2) are never allowed to drift. If lower-rank task momentum conflicts with
   them, the higher rank wins — re-anchoring is how you notice the conflict exists.

## The anchor checklist (run at each cadence point)

- Which skill(s) are governing this work right now? Name them by `skill_id`.
- What are their non-negotiable rules? State them in one line each.
- What user constraints are active? Read them from the ledger, not from memory.
- Does the last 10 turns of output actually conform? Name any divergence.
- If diverged: stop, correct the divergence, and note the correction before continuing.

## Worked example

Turn 28 of a `rust_build` session. Anchor cadence fires. The governing skill mandated `Result<T, E>`
returns with a project error enum and forbade `.unwrap()` outside tests. Re-reading the skill and
scanning recent output reveals three `.unwrap()` calls added at turns 22-26 — classic
default-attractor drift (the model's habit is to unwrap for brevity). Correction: replace with `?`
propagation, restate the rule in the ledger, continue. Cost: one re-read. Averted: a panic-prone
binary that passed local tests but violated the skill's reliability contract.

## Anti-patterns

- **Trusting that "I loaded it, so I follow it."** Loading is necessary, not sufficient.
- **Re-anchoring only when something breaks.** Drift's failure mode is *not* breaking — it is
  plausible non-compliance. Anchor on a schedule.
- **Re-anchoring from memory instead of disk.** The whole point is that your memory of the rule has
  decayed. Re-read the file.
- **Letting compaction silently drop skill bodies.** Always re-pin after compaction.

## CROSS-REFERENCES
- [skills/rules/context_management.md](../../skills/rules/context_management.md) — compaction protocol; compaction is the top drift trigger this skill guards.
- [prototyping/anti_failure/context_budget.md](context_budget.md) — shares the checkpoint and constraint ledger that survive compaction.
- [skills/rules/composition.md](../../skills/rules/composition.md) — how multiple loaded skills compose; drift corrupts composition silently.
- [skills/rules/quality_gates.md](../../skills/rules/quality_gates.md) — gate 5 (compliance) is the pre-output re-anchor checkpoint.

## END OF SKILL
