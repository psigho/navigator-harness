---
skill_id: isa_system_architecture
type: prototype
category: isa
triggers:
  keywords: [architecture, isa, system, diagram, registry, router, rules, engine, pipeline, layers, overview, structure]
  languages: [all]
  platforms: [cross]
priority: 9
description: ASCII architecture diagram of the Navigator runtime — registry, router, rules engine, anti-failure layer, quality gates.
---

# Navigator System Architecture (ISA)

The Instruction-Set Architecture view of the Navigator runtime: the major components, the data
that flows between them, and where authority is enforced. Read this before tracing a single query
(see `wiring_component_interaction` for the dynamic sequence). The router selects this on
"architecture / overview / structure" lookups.

## Top-level data flow
```
                            ┌───────────────────────────────────────────────┐
        user query ───────► │                 NAVIGATOR RUNTIME              │
                            └───────────────────────────────────────────────┘
                                              │
        ┌─────────────────────────────────────┼──────────────────────────────────────┐
        ▼                                      ▼                                       ▼
┌───────────────┐   load manifests   ┌──────────────────┐   selected skills   ┌──────────────────┐
│  (1) REGISTRY │ ─────────────────► │   (2) ROUTER     │ ──────────────────► │ (3) RULES ENGINE │
│  manifest     │                    │  intent + domain │                     │  9-rank conflict │
│  index        │ ◄───── lookup ──── │  scoring         │ ◄─── rule files ─── │  resolution      │
└───────┬───────┘                    └────────┬─────────┘                     └────────┬─────────┘
        │  (frontmatter:                       │  intent ∈ {PROJECT,DEBUG,             │  ranks 1..9
        │   skill_id,type,                      │  BUILD,PROTOTYPE,TOOL,LOOKUP}         │  rank 1 wins
        │   triggers,priority)                  │  + domain ∈ {python,rust,web_api}     ▼
        ▼                                       ▼                            ┌──────────────────┐
┌───────────────┐                    ┌──────────────────┐                    │ (4) ANTI-FAILURE │
│ skills/  *.md │                    │   CONTEXT BUDGET │  ◄──── monitors ──►│  LAYER (rank 1)  │
│ maps/    *.md │                    │   GREEN ▒ YELLOW │                    │  fires BEFORE    │
│ prototyping/  │                    │   ORANGE ░ RED   │                    │  any build runs  │
└───────────────┘                    └──────────────────┘                    └────────┬─────────┘
                                                                                       │ guarded plan
                                                                                       ▼
                                                                             ┌──────────────────┐
                                                                             │ (5) QUALITY GATES│
                                                                             │ 1 completeness   │
                                                                             │ 2 correctness    │
                                                                             │ 3 safety         │
                                                                             │ 4 citation       │
                                                                             │ 5 compliance     │
                                                                             └────────┬─────────┘
                                                                                      ▼
                                                                                 delivery ───► user
```

## Component responsibilities
- **(1) Registry** — parses YAML frontmatter from every framework `.md` into a manifest index
  keyed by `skill_id`. Holds `type`, `category`, `triggers` (keywords/extensions/error_patterns/
  languages/platforms), `pairs_with`, `depends_on`, `priority`, `description`. The registry is the
  single source of truth for what skills exist; everything downstream reads from it.
- **(2) Router** — scores the query against trigger keywords to pick an **intent** and a **domain**.
  Intent priority on tie: `PROJECT > DEBUG > BUILD > PROTOTYPE > TOOL > LOOKUP`. Emits the ordered
  set of candidate skills plus the matched domain map. Consults the **Context Budget** monitor to
  decide how much detail to load (GREEN <40% → full; RED >80% → minimal, summarized).
- **(3) Rules Engine** — applies the rule files under `skills/rules/` (routing, error_routing,
  composition, chaining, context_management, conflict_resolution, escalation, quality_gates,
  engagement). When two skills disagree it resolves by the **9-rank authority** ladder.
- **(4) Anti-Failure Layer** — authority **rank 1**, so it overrides everything including user
  instructions on safety matters. It fires *before* any build skill executes, injecting the
  domain's failure-mode guards (python/rust/web_api) plus cross-cutting guards (context_budget,
  skill_drift, multi_agent, hallucination_guards, tool_execution, build_integrity, scope_lanes,
  compliance).
- **(5) Quality Gates** — the five-gate exit filter every response passes before delivery:
  completeness → correctness → safety(anti-failure) → citation → compliance. A failed gate routes
  back (escalation rules) rather than shipping a defective answer.

## Authority ladder (enforced by 3 + 4, rank 1 wins)
```
1 anti-failure rules   ┐ highest authority — safety overrides all
2 user instructions    │
3 project files        │
4 debug skills         │
5 build skills         ├─ decreasing authority
6 reference files      │   (this ISA diagram lives at rank 6: reference)
7 pattern libraries    │
8 domain maps          │
9 resource index       ┘ lowest
```

## Legend
```
 ┌─┐ │ └─┘   component boundary           ───►   data / control flow (direction of arrow)
 ◄───        request/response (bidir)      ▒ ░    context-budget fill (more fill = less headroom)
 (n)         numbered pipeline stage       rank N  position on the 9-rank authority ladder
```

## CROSS-REFERENCES
- [wiring_component_interaction](../wiring_diagrams/component_interaction.md) — the dynamic sequence for one query through these components.
- [routing](../../skills/rules/routing.md) and [error_routing](../../skills/rules/error_routing.md) — the router's selection logic (component 2).
- [conflict_resolution](../../skills/rules/conflict_resolution.md) and [escalation](../../skills/rules/escalation.md) — the rules engine's authority ladder (component 3).
- [context_budget](../anti_failure/context_budget.md) — the budget monitor feeding the router.
- [quality_gates](../../skills/rules/quality_gates.md) — the five-gate exit filter (component 5).

## END OF SKILL
