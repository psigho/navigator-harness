---
skill_id: wiring_component_interaction
type: prototype
category: wiring
triggers:
  keywords: [wiring, sequence, interaction, flow, trace, query, lifecycle, pipeline, dispatch, walkthrough, request]
  languages: [all]
  platforms: [cross]
priority: 9
description: ASCII sequence diagram tracing one query from input through the router to delivery.
---

# Component Interaction (Wiring / Sequence)

The dynamic counterpart to `isa_system_architecture`. Where the ISA diagram shows the static box
layout, this traces a single query as it moves through the components in time. The router selects
this on "sequence / trace / flow / lifecycle" lookups. Worked example used throughout:

> **Query:** `"why does my fastapi endpoint return 500 on POST"`

## Sequence diagram
```
 User      Router        Registry     RulesEngine   AntiFailure   Build/Debug   QualityGates
  │           │              │             │             │             │              │
  │  query    │              │             │             │             │              │
  ├──────────►│              │             │             │             │              │
  │           │ load index   │             │             │             │              │
  │           ├─────────────►│             │             │             │              │
  │           │◄─ manifests ─┤             │             │             │              │
  │           │  score intent+domain       │             │             │              │
  │           │  DEBUG (error,why,500,fail)│             │             │              │
  │           │  domain=web_api (fastapi,endpoint,POST)  │             │              │
  │           │  ── tie? PROJECT>DEBUG>BUILD… → DEBUG wins│             │              │
  │           │  match error_patterns ["Internal Server Error","500"] │              │
  │           ├──────────────────────────►│             │             │              │
  │           │   candidate: web_api_debug │             │             │              │
  │           │   pairs_with: web_api_build│             │             │              │
  │           │              │  resolve conflicts (9-rank)│             │              │
  │           │              │  rank4 debug > rank5 build │             │              │
  │           │              ├────────────────────────►│ inject guards │              │
  │           │              │             │  web_api_anti_failure (rank1, BEFORE build)│
  │           │              │             │  ▸ no 200-on-error  ▸ no stack-trace leak │
  │           │              │             ├───────────►│ run debug skill              │
  │           │              │             │             │  diagnose: unhandled exc    │
  │           │              │             │             │  → map to 500, add handler  │
  │           │              │             │             │  cite ref_http_status,      │
  │           │              │             │             │       pattern_error_handling│
  │           │              │             │             ├─────────────►│ 5 gates       │
  │           │              │             │             │             │ 1 complete ✔  │
  │           │              │             │             │             │ 2 correct  ✔  │
  │           │              │             │             │             │ 3 safety   ✔  │
  │           │              │             │             │             │ 4 cite     ✔  │
  │           │              │             │             │             │ 5 comply   ✔  │
  │◄───────────────────────────  answer + citations  ─────────────────────────────────┤
  │           │              │             │             │             │              │
```

## Step-by-step narrative
1. **Ingest.** The query arrives. The router asks the **Registry** for the manifest index (all
   parsed frontmatter) so it can score against every skill's `triggers`.
2. **Intent scoring.** Keywords `why` (LOOKUP), `error`/`fail`/`500` (DEBUG), `fastapi`/`endpoint`
   (domain signal). Both DEBUG and LOOKUP fire; the **intent priority** `PROJECT > DEBUG > BUILD >
   PROTOTYPE > TOOL > LOOKUP` resolves the tie to **DEBUG**.
3. **Domain scoring.** `fastapi`, `endpoint`, `POST`, `500` map to **web_api**. The router also
   matches the debug skill's `error_patterns` (`"Internal Server Error"`, literal `500`), which
   boosts `web_api_debug` above generic candidates.
4. **Candidate set.** Router emits `web_api_debug` as primary; its `pairs_with: web_api_build`
   surfaces the build partner in case a fix requires new code. The `map_web_api` domain map is
   attached for orientation.
5. **Conflict resolution.** The **Rules Engine** orders candidates by the 9-rank ladder. The debug
   skill (rank 4) outranks the build skill (rank 5), so diagnosis leads; building follows only if
   needed.
6. **Anti-failure injection (rank 1, pre-execution).** Before any build/debug body runs, the
   **Anti-Failure Layer** injects `web_api_anti_failure` guards: never return `200` with an error
   body, never leak a stack trace to the client. These constraints bind the skill output.
7. **Execution.** `web_api_debug` runs: the 500 is an unhandled exception; the fix adds a boundary
   handler that maps the internal error to the correct status and returns a safe body. It cites
   `ref_http_status` (which code) and `pattern_error_handling` (W1: edge mapping).
8. **Quality gates.** The answer passes the five-gate filter — completeness, correctness, safety
   (anti-failure honored), citation (sources present), compliance. Any gate failure would loop
   back via the **escalation** rules instead of shipping.
9. **Delivery.** The user receives the diagnosis, the fix, and the citations.

## Context-budget interaction (runs in parallel with every step)
```
 budget level ──► router behavior
   GREEN  <40%  ── load full skill bodies + all cross-refs
   YELLOW 40-65 ── load primary skill fully, summarize secondaries
   ORANGE 65-80 ── load only the top candidate; defer maps/refs to on-demand
   RED    >80%  ── minimal: cite skill_ids, emit a compact answer, suggest a fresh context
```
The router consults the budget monitor at step 1 and again before loading any secondary skill, so
a long session degrades gracefully instead of overflowing.

## Failure-path branch (a gate fails)
If gate 3 (safety) detects a leaked stack trace in the draft, the **escalation** rule fires: the
draft is rejected, the anti-failure guard is re-applied, and the debug skill re-runs with the
violated constraint highlighted — the answer never ships in its defective form.

## CROSS-REFERENCES
- [isa_system_architecture](../isa_diagrams/system_architecture.md) — the static component layout this sequence animates.
- [web_api_debug](../../skills/debug/web_api_debug.md) — the debug skill executed in the worked example.
- [web_api_build](../../skills/build/web_api_build.md) — the build partner surfaced via pairs_with.
- [routing](../../skills/rules/routing.md), [skill_chaining](../../skills/rules/skill_chaining.md), [escalation](../../skills/rules/escalation.md) — the rules driving steps 2–8.
- [ref_http_status](../dev_reference/http_status_reference.md) and [pattern_error_handling](../func_encyclopedia/error_handling_patterns.md) — the references cited at step 7.

## END OF SKILL
