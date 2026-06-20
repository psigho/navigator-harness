---
skill_id: routing
type: rules
category: engine
triggers:
  keywords: [route, routing, intent, classify, dispatch, select skill, which skill, match]
  languages: [all]
  platforms: [cross]
pairs_with: error_routing
depends_on: [conflict_resolution, quality_gates]
priority: 1
description: The core four-tier router loaded every boot; turns a raw user request into a ranked skill load-set.
---

# NAVIGATOR ROUTER (core engine)

The router is the always-resident entry point. On every turn it converts the raw
request into a **load-set**: an ordered list of skill files to read, plus the
anti-failure rules that must be active. It runs four tiers in strict order. Tiers
are additive — later tiers refine, they never discard a higher-tier decision.

The router is cheap by design. It reads only frontmatter `triggers` blocks (never
full skill bodies) to score candidates, then loads the winning bodies. Loading a
full skill body is the expensive step; the router exists to load as few as
correctness allows. See `context_management.md` for the budget it answers to.

---

## TIER 1 — INTENT CLASSIFICATION

Scan the request for trigger words. Each intent owns a fixed vocabulary. A request
may fire several intents; the tie-break priority picks the lane that drives skill
selection. Intent is *what the user wants done*, independent of domain.

| Intent | Trigger words | Drives toward |
|---|---|---|
| PROJECT | project, continue, resume, build order | build-order file, TODO, state recovery |
| DEBUG | error, fix, crash, broken, fail, exception, traceback, bug, why does | a `debug/` skill + `error_routing` |
| BUILD | build, create, write, make, implement, generate, add | a `build/` skill |
| PROTOTYPE | design, plan, architecture, scaffold, structure | `prototyping/` (isa/wiring/build_orders) |
| TOOL | tool, library, resource, install | `tool_repo.md` |
| LOOKUP | how, what, explain, describe, when, which | `dev_reference/`, `maps/`, `func_encyclopedia/` |

**Tie-break priority (highest wins):**

```
PROJECT > DEBUG > BUILD > PROTOTYPE > TOOL > LOOKUP
```

Rationale for the order:
- **PROJECT** wins first because resuming work restores prior state; acting without
  that state risks duplicating or contradicting committed decisions.
- **DEBUG** outranks BUILD because a request that contains both a build verb and an
  error signature ("fix the function I'm writing") is a repair, not green-field work;
  repairs carry anti-failure rules that green-field work does not.
- **LOOKUP** is the floor: a question with no action verb is the lowest-commitment lane.

Worked example — "why does my build crash when I add the new route":
fires DEBUG (`why does`, `crash`) + BUILD (`add`) + PROJECT? no. DEBUG wins → load a
debug skill and `error_routing`, not a build skill.

---

## TIER 2 — DOMAIN CLASSIFICATION

Independent of intent, score the request against the three demo domains. **Multiple
domains may match** — a FastAPI service in Python matches both `python` and `web_api`.
Keep every domain whose score > 0; do not collapse to one prematurely.

| Domain | Keywords | Extensions | Languages |
|---|---|---|---|
| python | python, py, pip, venv, pytest, asyncio, pandas, script | .py | python |
| rust | rust, cargo, crate, rustc, tokio, borrow, lifetime, trait | .rs | rust |
| web_api | api, rest, http, endpoint, route, fastapi, express, json, server | — | python, rust, all |

**Scoring:** +2 per keyword hit, +3 per extension hit (extensions are a strong
signal — a `.rs` path almost always means rust), +1 per language/platform hit.
Tie between two domains with equal score → keep both and let TIER 3 load both build
or debug skills; the conflict authority in `conflict_resolution.md` resolves any
contradictory guidance between them.

Worked example — "add a POST endpoint to my FastAPI app in app.py":
web_api scores `api`+`endpoint`+`fastapi` (and `route` implied) = 6+; python scores
`py` via `app.py` extension (+3) and `fastapi` is a python framework. Both kept →
load `web_api_build` and consult `python` map.

---

## TIER 3 — SKILL SELECTION PER INTENT

With (intent, domain-set) fixed, select the concrete files. The mapping:

| Intent | Selection rule |
|---|---|
| BUILD | load `skills/build/<domain>_build.md` for each matched domain |
| DEBUG | load `skills/debug/<domain>_debug.md` + `error_routing.md`; let error_routing pick the section |
| PROTOTYPE | load `prototyping/isa_diagrams/`, `wiring_diagrams/`, and a `build_orders/` template |
| PROJECT | load the project's `build_orders/` file + `TODO.md`; recover state before any edit |
| TOOL | load `tool_repo.md`; filter by domain |
| LOOKUP | load `maps/<domain>.md` first; descend to `dev_reference/` or `func_encyclopedia/` on demand |

**Pairing:** every build skill declares `pairs_with` its debug sibling and vice
versa. When the router loads a build skill for an edit-then-run task, it pre-warms
the paired debug skill's *frontmatter* (not body) so a failure on first run routes
in one hop instead of two.

**Multi-domain load:** if TIER 2 kept N domains, TIER 3 loads N build (or N debug)
skills. The composition rules in `composition.md` govern how their guidance merges;
ties in contradictory advice fall to `conflict_resolution.md` rank 5 (build) / rank 4
(debug).

---

## TIER 4 — ANTI-FAILURE TIER ATTACHMENT

After functional skills are chosen, attach anti-failure rules in three bands. These
are **always layered on top** — they are rank-1 authority and cannot be overridden by
any skill selected above.

1. **Mandatory band (load every boot, every request):**
   `hallucination_guards`, `tool_execution`, `build_integrity`, `compliance`,
   `context_budget`, `scope_lanes`. These guard failure modes orthogonal to domain.

2. **Domain-matched band (load per matched domain):**
   `prototyping/anti_failure/<domain>_anti_failure.md` for each domain TIER 2 kept.
   Python's guards differ from Rust's; load the ones the request can actually trip.

3. **Context-triggered band (load on signal):**
   - `skill_drift.md` — when >3 skills already loaded this turn, or the active skill no
     longer matches the live intent.
   - `multi_agent.md` — when the request spawns sub-agents or parallel lanes.
   - `context_budget.md` escalation — when budget crosses YELLOW (40%); see thresholds.

Anti-failure attachment is non-negotiable: a BUILD request that skips its domain
anti-failure band fails quality gate 3 (safety) in `quality_gates.md`.

---

## BUDGET INTERACTION

The router reports the projected load-set size before reading bodies. Levels of the
~200K window: **GREEN <40% / YELLOW 40-65% / ORANGE 65-80% / RED >80%**. At ORANGE the
router drops the LOOKUP-tier reference bodies and keeps only build/debug + anti-failure.
At RED it loads anti-failure + the single highest-priority functional skill only, and
emits a context-management warning. Full policy: `context_management.md`.

## WORKED END-TO-END

Request: "my rust server keeps panicking on startup, fix it".
- T1: DEBUG (`panicking`≈crash, `fix`) beats BUILD → DEBUG lane.
- T2: rust (`rust`, `server`→web_api too) → {rust, web_api}.
- T3: load `rust_debug.md` + `web_api_debug.md` + `error_routing.md`.
- T4: mandatory band + `rust_anti_failure` + `web_api_anti_failure`; `error_routing`
  maps the panic signature to `rust_debug` § Runtime Panics and names the likely rule.

## CROSS-REFERENCES
- [error_routing.md](./error_routing.md) — DEBUG-lane dispatch tables this router hands off to (skill_id: error_routing).
- [conflict_resolution.md](./conflict_resolution.md) — the 9-rank authority that resolves multi-domain contradictions (skill_id: conflict_resolution).
- [composition.md](./composition.md) — how multiple loaded skills merge (skill_id: composition).
- [context_management.md](./context_management.md) — budget levels TIER 4 and the body-loading step obey (skill_id: context_management).
- [quality_gates.md](./quality_gates.md) — gate 3 enforces the anti-failure attachment (skill_id: quality_gates).
- [../../master_skill.md](../../master_skill.md) — the boot file that loads this router first (skill_id: master_skill).
- [../build/python_build.md](../build/python_build.md), [../build/rust_build.md](../build/rust_build.md), [../build/web_api_build.md](../build/web_api_build.md) — BUILD-lane targets.
- [../debug/python_debug.md](../debug/python_debug.md), [../debug/rust_debug.md](../debug/rust_debug.md), [../debug/web_api_debug.md](../debug/web_api_debug.md) — DEBUG-lane targets.

## END OF SKILL
