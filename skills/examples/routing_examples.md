---
skill_id: routing_examples
type: custom
category: null
triggers:
  keywords: [routing, example, intent, domain, classify, dispatch, worked]
  languages: [all]
  platforms: [cross]
priority: 7
description: Worked routing examples, at least one per intent, each showing query -> intent -> domain -> selected sources -> anti-failure tier.
---

# ROUTING EXAMPLES — Worked Traces, One Per Intent

Each example shows how the master skill resolves a query. Format is fixed:
**query -> intent -> domain -> selected sources -> anti-failure tier.** These are the
canonical regression cases for the router; if a change to `routing.md` breaks one of these,
the change is wrong.

---

## 1. BUILD — "create a REST endpoint for user signup"
- **Intent:** `create` -> BUILD. No DEBUG/PROTOTYPE words. No tie.
- **Domain:** `rest`, `endpoint` hit `web_api.triggers.keywords` -> **web_api**. (No `.py`/
  `.rs` extension named, so server language is left to the build skill's default / a follow-up.)
- **Selected sources:** `web_api_build` (+ standby `web_api_debug` via `pairs_with`),
  `map_web_api`, `prototyping/func_encyclopedia/error_handling_patterns.md`,
  `prototyping/dev_reference/http_status_reference.md` (for correct 201/409 semantics).
- **Anti-failure tier:** *mandatory* `hallucination_guards` + `tool_execution` + `compliance`;
  *domain-matched* `web_api_anti_failure`; *context-triggered* `build_integrity` (ship guard).

## 2. DEBUG — "fix: ModuleNotFoundError: No module named requests"
- **Intent:** `fix` + `error` -> DEBUG. (DEBUG outranks BUILD on the priority ladder, so even
  the implicit "make it work" reads as DEBUG.)
- **Domain:** `ModuleNotFoundError` / `module` is a Python signal -> **python**. The literal
  string also matches `python_debug.triggers.error_patterns`, giving the DEBUG fast-path.
- **Selected sources:** `python_debug` (matched by error_pattern, not just keyword),
  `map_python`, `prototyping/func_encyclopedia/error_handling_patterns.md`; `python_build`
  available via `pairs_with` to re-run the build after the fix.
- **Anti-failure tier:** *mandatory* trio; *domain-matched* `python_anti_failure` (venv/pip
  isolation — the usual root cause); *context-triggered* `tool_execution` re-probes `pip`.

## 3. LOOKUP — "what does the borrow checker do in rust"
- **Intent:** `what` -> LOOKUP (lowest priority, but nothing else fires).
- **Domain:** `rust`, `borrow` hit `rust.triggers.keywords` -> **rust**.
- **Selected sources:** `maps/rust.md` (`map_rust`) as primary; `rust_build` body NOT
  executed (LOOKUP doesn't build); `prototyping/func_encyclopedia/error_handling_patterns.md`
  only if the answer needs `Result`/`?` context.
- **Anti-failure tier:** *mandatory* `hallucination_guards` (LOOKUP's chief risk is a confident
  wrong fact) + `compliance`; no build/ship guards (nothing is executed).

## 4. PROTOTYPE — "design the architecture for a CSV-ingest CLI tool"
- **Intent:** `design`, `architecture` -> PROTOTYPE.
- **Domain:** `cli`, `csv` lean python but the task is design-first -> **python** (provisional;
  confirmed when build steps are emitted).
- **Selected sources:** `prototyping/isa_diagrams/system_architecture.md`,
  `prototyping/wiring_diagrams/component_interaction.md`,
  `prototyping/build_orders/BUILD_ORDER_TEMPLATE.md` (to emit an ordered plan),
  `prototyping/func_encyclopedia/cli_patterns.md`; `map_python` for ecosystem fit.
- **Anti-failure tier:** *mandatory* trio; *context-triggered* `scope_lanes` (keeps the design
  inside the stated lane) and `build_integrity` (so the plan's ship step is real).

## 5. TOOL — "what library should I install to test python code"
- **Intent:** `library`, `install` -> TOOL.
- **Domain:** `python` -> **python**.
- **Selected sources:** `tool_repo.md` (the resource index — authoritative for this intent),
  which returns `pytest` (+ install hint `pip install pytest`) and `ruff` for lint.
- **Anti-failure tier:** *mandatory* `hallucination_guards` (don't invent a package name) +
  `tool_execution` (probe availability before recommending); `compliance`.

## 6. PROJECT — "continue the build order"
- **Intent:** `continue`, `build order` -> PROJECT. PROJECT tops the priority ladder, so even
  if other intent words appear, an active build order wins.
- **Domain:** inherited from the active build order's current step (e.g. python).
- **Selected sources:** `prototyping/build_orders/TODO.md` (current open step) +
  `prototyping/build_orders/example_cli_tool.md` if that is the active order; the step itself
  names the build/debug skill + domain to resume (e.g. `python_build`).
- **Anti-failure tier:** whatever the resumed step declares; `build_integrity` always attaches
  before the order's ship step.

---

## 7. TIE-BREAK — "the build is broken, why does create fail"
- **Competing intents:** `build`/`create` (BUILD) vs `broken`/`fail`/`why does` (DEBUG).
- **Resolution:** DEBUG > BUILD on the ladder -> **DEBUG** wins.
- **Domain:** resolved from surrounding context (extension / keywords) — say **rust** if
  `cargo`/`.rs` present.
- **Selected sources:** `rust_debug` (+ `rust_build` via `pairs_with`), `map_rust`,
  `skills/rules/error_routing.md` for the error-pattern match.
- **Anti-failure tier:** *mandatory* trio; *domain-matched* `rust_anti_failure`;
  *context-triggered* `escalation` is primed (this is the kind of query that can hit the
  3-retry Abort Protocol).

## 8. CONTEXT-TRIGGERED GUARD — "build a python service AND a rust client"
- **Intent:** BUILD. **Domain:** spans python + web_api/rust.
- **Selected sources:** `python_build` + `rust_build` (and/or `web_api_build`), both maps.
- **Anti-failure tier:** because the task crosses domains, the *context-triggered* guards
  `scope_lanes` (keep each domain in its lane) and `multi_agent` (parallelize the two builds)
  attach in addition to both *domain-matched* guards. `context_budget` is watched since two
  full build paths can push the budget toward YELLOW.

## CROSS-REFERENCES
- [routing](../rules/routing.md) — the intent/domain rules these exercise (`routing`).
- [error_routing](../rules/error_routing.md) — DEBUG fast-path used in #2 and #7 (`error_routing`).
- [conflict_resolution](../rules/conflict_resolution.md) — tie/authority logic in #7 (`conflict_resolution`).
- [master_skill](../../master_skill.md) — the flow being exercised (`master_skill`).
- [end_to_end_example](../../examples/end_to_end_example.md) — one example expanded fully (`example_end_to_end`).

## END OF SKILL
