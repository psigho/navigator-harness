---
skill_id: scope_lanes
type: prototype
category: anti_failure
triggers:
  keywords: [scope, creep, lane, boundary, requested, refactor, while-im-here, gold-plating, in-scope, out-of-scope]
  error_patterns: ["unrelated change", "unexpected modification", "diff too large", "touched files outside"]
  languages: [all]
  platforms: [cross]
priority: 3
description: Prevent scope creep on broad projects — stay in the requested lane, change only what the task asked for, defer everything else.
---

# SCOPE LANES

An **anti-failure rule** (conflict rank 1) that keeps work inside the boundary the user
actually requested. On a broad project there is always an adjacent improvement within reach:
a nearby function that "could be cleaner", a dependency that "should be upgraded", a pattern
that "would be better as X". Acting on those without being asked is scope creep — and on a
multi-file system it is one of the most expensive and trust-eroding failure modes there is.

## WHY THIS EXISTS

A request defines a lane. The lane has edges. Every edit outside those edges is a decision
the user did not make and may not want: it enlarges the diff, hides the requested change in
noise, risks breaking working code, and burns budget the user allocated to something else.
"While I was in there I also fixed…" is how a one-line task becomes a 400-line review nobody
asked for. Worse, on operator-class work an unrequested change can have consequences the
agent cannot see. The discipline is: do exactly the requested thing, well, and stop.

## DEFINING THE LANE

At the start of a task, write down the lane explicitly:
- **In-lane:** the precise change requested, the files it must touch, the behavior it must
  produce.
- **Lane edges:** the files and behaviors adjacent to the request that you will NOT touch.
- **Out-of-lane:** everything else.

If the request is ambiguous about its edges, the lane is the *narrowest* reasonable reading,
not the broadest. When in doubt, ask — do not assume the wider lane.

## THE THREE-QUESTION GATE

Before making any change, run it through:
1. **Did the user ask for this?** If yes → in-lane. If no → continue.
2. **Is it strictly required to make the requested change work?** (e.g. you must touch an
   import because you renamed the thing it imports.) If yes → in-lane, minimal form only.
3. **Is it merely nearby, tempting, or "better"?** → OUT-OF-LANE. Do not do it. Note it for
   the user instead.

Only changes that pass 1 or 2 are permitted. Question 3 is the scope-creep trap; everything
that lands there gets deferred, not done.

## THE "BY THE WAY" CHANNEL

Out-of-lane observations are valuable — they're just not *yours to act on unprompted*. Park
them. When the requested work is done, surface them as a short, plain list: "While doing X I
noticed Y (a real issue) and Z (a possible cleanup) — want me to take either next?" This
preserves the signal without polluting the diff. The user decides whether the adjacent work
becomes a new lane. This is the one safe outlet for the "while I'm here" instinct.

## GOLD-PLATING IS ALSO SCOPE CREEP

Scope creep is not only touching extra files — it is also over-building the requested one.
Adding configuration options nobody asked for, generalizing a concrete request into a
framework, handling inputs that cannot occur: all of it inflates the surface and the
maintenance burden. Build the thing requested at the altitude requested. A CLI tool asked
for as a script does not need a plugin architecture.

## INTERACTION WITH PARALLEL BUILDERS

When multiple agents build concurrently, each agent's file assignment IS its lane. An agent
reshaping a shared interface "to improve it" breaks the seam contracts other agents depend
on (see build_integrity.md). Staying in lane is what makes parallel building safe: agents
coordinate through declared interfaces, not through each other's internals.

## CONFLICT BEHAVIOR

If staying in lane conflicts with a build skill that wants to "do it properly" by also
refactoring neighbors, the lane wins — this is a rank-1 rule overriding rank-5 build skills.
If the user explicitly widens the lane ("clean up the whole module"), the new lane is the
new boundary; widen it only on an explicit instruction, never on inference.

## CROSS-REFERENCES
- [quality_gates.md](../../skills/rules/quality_gates.md) — gate 5 (compliance) checks the delivered diff matches the requested lane, no more.
- [escalation.md](../../skills/rules/escalation.md) — when the lane is genuinely ambiguous, escalate for clarification instead of guessing wide.
- [conflict_resolution.md](../../skills/rules/conflict_resolution.md) — staying in lane (rank 1) overrides build skills (rank 5) that want to refactor neighbors.
- [build_integrity.md](./build_integrity.md) — per-file lanes are honored by respecting shared seam contracts, not reshaping them.
- [tool_execution.md](./tool_execution.md) — never run a command that mutates files outside the active lane.

## END OF SKILL
