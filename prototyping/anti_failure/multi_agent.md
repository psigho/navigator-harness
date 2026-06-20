---
skill_id: multi_agent
type: prototype
category: anti_failure
triggers:
  keywords: [multi, compose, composition, sources, merge, conflict, three, simultaneous, blend, integrate, parallel]
  error_patterns: ["conflicting instructions", "merged incompatible", "lost track of which source", "contradictory requirements"]
  languages: [all]
  platforms: [cross]
priority: 4
description: Discipline for composing a single output from three or more skill or instruction sources simultaneously without conflict, dilution, or loss of provenance.
---

# Anti-Failure: Multi-Source Composition

Composing from two sources is manageable; from three or more it degrades fast. The failure is not
that any single source is wrong — it is that when three skills, two reference files, and the user's
instructions all bear on one output, their rules **interleave, contradict, and dilute** each other.
The model averages them into something that satisfies none, silently drops the source it loaded
earliest, or applies a low-authority pattern where a high-authority rule should have won. This skill
imposes the structure that keeps multi-source composition correct and auditable.

"Multi-agent" here means *multiple instruction sources composed by one runtime* — the dominant case
in NAVIGATOR — and equally applies to literal multi-agent setups where sub-agent outputs are merged.

## The three failure modes

1. **Averaging.** Three sources give three styles/conventions; the output blends them into an
   inconsistent middle. E.g., one source mandates async, one sync, one is silent — the result mixes
   both incoherently.
2. **Silent precedence loss.** Two sources genuinely conflict; the model picks one with no record of
   the decision, often the *most recent* rather than the *highest authority*. The dropped rule may
   have been an anti-failure constraint.
3. **Provenance collapse.** By the end, the output cannot be traced to its sources. You can no longer
   answer "which skill said to do this?" — so you cannot verify it, cite it, or fix it.

## Composition discipline

### 1. Enumerate sources before composing
List every source bearing on the output with its `skill_id` and its conflict-authority rank:

```
SOURCES for this output:
  - hallucination_guards   rank 1 (anti-failure)   MANDATORY
  - <user instruction>     rank 2
  - example_cli_tool       rank 3 (project file)
  - python_build           rank 5 (build skill)
  - error_handling_patterns rank 7 (pattern library)
```

You cannot compose what you have not enumerated. This list is the audit trail.

### 2. Resolve conflicts by rank, explicitly
Where two sources prescribe incompatible things, the lower rank number wins — every time, no
averaging. **Record the resolution**, e.g. "build skill suggested bare except; anti-failure rule
forbids it → anti-failure wins; using typed result." A resolved conflict that is not recorded will
silently re-open later via drift.

### 3. Partition rather than blend where possible
Many apparent conflicts are actually *different concerns* that should occupy different parts of the
output (different files, functions, layers), not be merged into one. Give each source its lane. Two
sources only truly conflict when they prescribe contradictory things for the *same* decision. Reserve
rank-based override for genuine same-decision conflicts; partition everything else.

### 4. One source owns each decision
For every concrete decision (naming, error strategy, async-ness, file layout), name the single
owning source. Shared ownership is how averaging sneaks in. If two sources both claim a decision,
that is a rank conflict — resolve it per rule 2.

### 5. Verify the composite against each source
After composing, walk the output once per source and confirm nothing in the output *violates* that
source (a source can be silent on a point — that is fine — but it must never be contradicted unless
a higher-rank source overrode it, and that override must be in the record).

## Budget interaction

Holding 3+ full sources resident is expensive and pushes context level up (see `context_budget`).
Mitigation: load the highest-rank sources in full (they win conflicts, so their exact wording
matters), and load lower-rank sources as their *map/summary* unless a specific clause is contested.
You rarely need the full text of a rank-7 pattern library — you need its convention, which the map
carries.

## Worked example

Building a CLI command that must: never fabricate help text (hallucination_guards, r1), match the
user's "no third-party deps" rule (r2), follow the project's `example_cli_tool` arg-parsing style
(r3), use `python_build`'s typed signatures (r5), and apply `error_handling_patterns`' result-object
convention (r7).

- Enumerate (above).
- Conflict: `python_build` examples import `click`; user rule r2 forbids third-party deps → r2 wins,
  use stdlib `argparse`. **Recorded.**
- Partition: arg parsing owned by `example_cli_tool`; error returns owned by `error_handling_patterns`;
  type hints owned by `python_build`; factual help strings governed by `hallucination_guards` (only
  document flags that exist).
- Verify: output uses `argparse` (r2 ✓), typed (r5 ✓), result objects (r7 ✓), no invented flags
  (r1 ✓), project arg style (r3 ✓). No source contradicted.

## Anti-patterns

- **Composing without enumerating sources first.** You will lose one.
- **Resolving conflicts by recency or vibe instead of rank.** Recency is not authority.
- **Blending where you could partition.** Most "conflicts" are mislabeled concern-overlaps.
- **Discarding the resolution record.** Unrecorded resolutions re-open as drift.

## CROSS-REFERENCES
- [skills/rules/composition.md](../../skills/rules/composition.md) — the runtime composition order this skill operationalizes.
- [skills/rules/conflict_resolution.md](../../skills/rules/conflict_resolution.md) — the 9-rank authority ladder used to resolve same-decision conflicts.
- [skills/rules/skill_chaining.md](../../skills/rules/skill_chaining.md) — sequential composition (chaining) vs. the simultaneous composition this skill covers.
- [prototyping/anti_failure/context_budget.md](context_budget.md) — budget pressure from holding multiple full sources resident.

## END OF SKILL
