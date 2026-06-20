---
skill_id: skill_chaining
type: rules
category: engine
triggers:
  keywords: [chain, workflow, state, machine, transition, retry, abort, rebuild, resume, phase]
  languages: [all]
  platforms: [cross]
pairs_with: composition
depends_on: [routing, error_routing, quality_gates]
priority: 4
description: Workflow state machines that sequence skills across turns - build/debug/rebuild recovery loops, lookup-to-build, prototype-to-test, and project-resume phase advance.
---

# SKILL CHAINING ENGINE

A single router decision answers one question. Real work is multi-step: build something, hit
an error, fix it, rebuild; or design first, then build, then test; or resume a project and
advance its phase. Skill chaining is the layer that sequences individual skill invocations
into a workflow with explicit STATE, explicit TRANSITIONS, and explicit TERMINATION.

Each chain is a small state machine. For every transition we are precise about three things:
- **Carried state** — what context survives the transition into the next skill.
- **Discarded state** — what is dropped so the context budget (`context_management.md`) does
  not balloon turn over turn.
- **Termination** — the condition(s) under which the chain stops, successfully or by abort.

Chaining sits above composition: each NODE in a chain is itself a composed answer (see
`composition.md`), and each EDGE is a router re-entry (see `routing.md`) carrying forward the
minimal state below.

## STATE-CARRY DISCIPLINE (applies to every chain)

ALWAYS carried across a transition:
- The original user goal (the invariant the whole chain serves).
- The artifact-under-construction (code, file path, design) — by reference, not re-pasted.
- The failure/quality signal that triggered the transition (error text, gate verdict).

ALWAYS discarded at a transition:
- Verbose tool output already distilled into the signal (full tracebacks once the error
  class is identified, full file dumps once the relevant span is located).
- Superseded drafts of the artifact (keep the latest, drop the prior).
- Reference-file bodies already applied — keep the citation, drop the text.

This discipline is what keeps a 3-iteration BUILD->DEBUG->REBUILD loop from crossing into the
ORANGE/RED budget band. If carried state grows each loop, the chain is leaking — see
`context_management.md` for the compaction trigger.

## CHAIN 1 — BUILD -> DEBUG -> REBUILD (error-recovery loop)

The core loop. Build produces an artifact; if it errors, route to debug; debug yields a fix;
rebuild applies it; re-test. Bounded by a hard retry limit with an Abort Protocol.

```
        +-----------+      pass gate 1+2       +----------+
        |  BUILD    | -----------------------> | COMPLETE |
        +-----------+                          +----------+
            |  ^                                     
   error /  |  |  fix applied                        
   gate fail|  | (attempt++)                         
            v  |                                      
        +-----------+   no fix found / attempt==3     +--------+
        |  DEBUG    | ------------------------------> | ABORT  |
        +-----------+                                 +--------+
```

- **States:** BUILD, DEBUG, REBUILD (BUILD re-entered with a patch), COMPLETE, ABORT.
- **Transition BUILD->DEBUG:** fires when the built artifact raises an error or fails quality
  gate 1 (completeness) or 2 (correctness). Carried: goal, artifact ref, the exact error
  text / failing gate. The error text is matched by `error_routing.md` `error_patterns` to
  select the right debug skill. Discarded: build skill's prose rationale (the code stands).
- **Transition DEBUG->REBUILD:** fires when debug produces a concrete fix. Carried: goal,
  artifact ref, the patch, and `attempt` (incremented). Discarded: the full traceback now
  that the fix is identified.
- **Retry limit:** `attempt` starts at 0, increments on each DEBUG->REBUILD. The same root
  error recurring after a rebuild does NOT reset the counter.
- **Termination — success:** REBUILD passes gates 1 and 2 → COMPLETE.
- **Termination — Abort Protocol:** after **3** failed fix attempts on the same root cause,
  STOP. Do not loop a fourth time. Emit: (a) what was tried each attempt, (b) the persistent
  error, (c) the narrowest hypothesis remaining, (d) an explicit ask for user input or a
  fallback skill. Abort is a defined, clean exit — not a crash. See
  `prototyping/anti_failure/build_integrity.md` for why the cap exists (thrash prevents
  the model from "fixing" by rewriting working code).

## CHAIN 2 — LOOKUP -> BUILD

A question that turns into a build once the user has the answer. "What is asyncio.gather?"
→ explanation → "ok, use it to fetch three URLs concurrently."

- **States:** LOOKUP, BUILD.
- **Transition LOOKUP->BUILD:** fires when the follow-up carries a BUILD intent word
  (build/create/write/make/implement) referencing the just-explained concept.
- **Carried:** the concept identified in LOOKUP (so the build skill starts grounded) and the
  reference citation already pulled. Discarded: the full explanatory prose — the build does
  not re-explain, it applies.
- **Termination:** BUILD reaches COMPLETE (gates pass) or enters CHAIN 1 if it errors. A
  LOOKUP that gets no build follow-up simply terminates at LOOKUP.

## CHAIN 3 — PROTOTYPE -> BUILD -> TEST

Design before code. Used for non-trivial features where structure must be settled first.

- **States:** PROTOTYPE, BUILD, TEST.
- **Transition PROTOTYPE->BUILD:** fires when a structure/scaffold (from
  `isa_diagrams/` or `wiring_diagrams/`, or a `BUILD_ORDER_TEMPLATE`) is accepted. Carried:
  the agreed component boundaries and interfaces. Discarded: rejected design alternatives.
- **Transition BUILD->TEST:** fires when the artifact is built and passes gate 1. Carried:
  artifact ref + the acceptance criteria named during PROTOTYPE (these become the test
  oracle). Discarded: intermediate build scaffolding notes.
- **Termination — success:** TEST confirms the artifact meets the PROTOTYPE acceptance
  criteria → COMPLETE.
- **Termination — failure:** a TEST failure routes into CHAIN 1 (BUILD->DEBUG->REBUILD) with
  the failing criterion as the signal; the same 3-attempt Abort Protocol applies.

## CHAIN 4 — PROJECT-RESUME -> BUILD -> PHASE-ADVANCE

Stateful, multi-session work driven by a build order (`prototyping/build_orders/*`). This is
the chain behind composition class C5.

- **States:** RESUME, BUILD, PHASE-ADVANCE.
- **Transition RESUME->BUILD:** fires on a PROJECT intent (continue/resume/build order). RESUME
  reads the project file, finds the current phase pointer, and composes that phase's
  `depends_on` chain (a C4 build). Carried: the phase pointer, completed-phase summary, and
  any project-level constraints/decisions recorded in the build order. Discarded: full detail
  of already-completed phases — only their summary and outputs carry forward.
- **Transition BUILD->PHASE-ADVANCE:** fires when the current phase passes its gates. PHASE-
  ADVANCE writes the phase result back into the project file and moves the pointer to the next
  phase. Carried: the updated pointer + accumulated project outputs. Discarded: the just-
  finished phase's working scratch.
- **Termination — success:** PHASE-ADVANCE finds no next phase (build order exhausted) →
  PROJECT COMPLETE. Each phase boundary is a natural compaction point (`context_management.md`).
- **Termination — blocked:** a phase that cannot pass after the CHAIN 1 Abort Protocol leaves
  the pointer ON that phase, records the blocker in the build order, and surfaces it — so the
  next RESUME picks up exactly where it stalled rather than silently skipping.

## INVARIANTS ACROSS ALL CHAINS

- A chain never advances past a node whose quality gates failed; it either loops (within the
  retry cap) or aborts. No "good enough, move on."
- The retry/Abort cap of 3 is global to any embedded BUILD->DEBUG->REBUILD loop, including the
  loops nested inside CHAINS 3 and 4.
- Every transition obeys the state-carry discipline; a chain that re-pastes full prior context
  on each edge is malformed and will breach the budget — fix the chain, not the budget.

## CROSS-REFERENCES

- [routing.md](./routing.md) — each chain edge is a router re-entry; intent priority (PROJECT>DEBUG>BUILD>PROTOTYPE>TOOL>LOOKUP) selects the next node.
- [error_routing.md](./error_routing.md) — supplies the debug-skill selection for the BUILD->DEBUG transition via `error_patterns`.
- [conflict_resolution.md](./conflict_resolution.md) — resolves same-rank source ties when a chain node composes multiple skills.
- [quality_gates.md](./quality_gates.md) — every transition is gated; gate verdicts are the signals that drive advance/loop/abort.
- [composition.md](./composition.md) — each chain node is itself a composed answer; class C5 is driven by CHAIN 4 (`pairs_with`).
- [../../prototyping/anti_failure/build_integrity.md](../../prototyping/anti_failure/build_integrity.md) — justifies the 3-attempt Abort Protocol and anti-thrash rule.
- [../../prototyping/anti_failure/context_budget.md](../../prototyping/anti_failure/context_budget.md) — the state-carry discipline keeps multi-loop chains inside the budget bands.

## END OF SKILL
