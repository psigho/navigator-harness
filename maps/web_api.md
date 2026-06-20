---
skill_id: map_web_api
type: map
category: null
triggers:
  keywords: [api, rest, http, endpoint, route, fastapi, express, json, server]
  languages: [python, rust, all]
priority: 10
description: Phase-based terrain map for web API work — routes contract, routing, auth, handlers, errors, and deploy to the right build/debug/anti-failure skill.
---

# DOMAIN MAP — WEB API

This map is the **domain terrain** Navigator walks when a request resolves to the web-API
domain (router intent BUILD/DEBUG/PROJECT against the `web_api` keyword set). It is the only
**cross-language** demo map — its phases apply whether the implementation lands in Python
(`fastapi`/`flask`) or Rust (`axum`/`actix`), so Phases 4–6 hand off to the language map
(`map_python` or `map_rust`) for the in-language mechanics.

It decomposes an API deliverable into six sequential phases. Each phase is an **engagement-mode
terrain checkpoint** with explicit exit criteria. The defining property of this domain: **the
contract precedes the code**. Phase 1 produces the spec that every later phase is measured
against, and Phase 5 (Error Handling) is a first-class phase, not an afterthought — for an API,
the error surface IS part of the contract.

Authority: rank-8 (domain map), governs phase order. Concrete handler code comes from
[web_api_build](../skills/build/web_api_build.md); the HTTP error surface is constrained by
rank-1 anti-failure rules and the status-code reference.

## PHASE FLOW

```
[1] Contract/Spec --> [2] Routing --> [3] Validation/Auth --> [4] Implement Handlers --> [5] Error Handling --> [6] Test/Deploy
   OpenAPI/schema      paths+verbs     input + identity        business logic            status+problem+json     contract tests
```

---

## PHASE 1 — CONTRACT / SPEC

**Goals**
- A written contract before code: resource model, paths, verbs, request/response schemas, status codes.
- Agreement on representation (JSON shape, field names, nullability, pagination).

**Techniques**
- Author OpenAPI (or a typed schema: `pydantic` models / Rust structs with `serde`) as the source of truth.
- Model resources and their state transitions first; map verbs (GET/POST/PUT/PATCH/DELETE) to them.
- Decide the error envelope now (e.g. RFC 7807 `application/problem+json`) — it is part of the contract.

**Common pitfalls**
- Coding handlers before the schema is settled → churn and breaking changes.
- Verb misuse (POST that should be idempotent PUT); inconsistent field casing across endpoints.

**Active skills & references**
- Build: [web_api_build](../skills/build/web_api_build.md) (`web_api_build`) — spec/scaffold section.
- Reference: [http_status_reference](../prototyping/dev_reference/http_status_reference.md).
- Prototype: [system_architecture](../prototyping/isa_diagrams/system_architecture.md).

**Exit criteria:** spec exists and is reviewed; every endpoint has request/response/error shapes named.

---

## PHASE 2 — ROUTING

**Goals**
- Routes wired to the spec: each path+verb maps to exactly one handler; no orphan or duplicate routes.

**Techniques**
- Group routes with routers/blueprints (`APIRouter` in FastAPI, `Router` in axum, `express.Router`).
- Stable, hierarchical paths (`/v1/users/{id}/orders`); version at the prefix.
- Reserve a 404/405 fallthrough that returns the standard error envelope, not a framework default page.

**Common pitfalls**
- Route ordering bugs (greedy/dynamic segment shadowing a static one).
- Trailing-slash inconsistency producing accidental redirects.

**Active skills & references**
- Build: [web_api_build](../skills/build/web_api_build.md) (`web_api_build`) — routing section.
- Debug: [web_api_debug](../skills/debug/web_api_debug.md) (`web_api_debug`) — 404/405/routing errors.
- Wiring: [component_interaction](../prototyping/wiring_diagrams/component_interaction.md).

**Exit criteria:** every spec endpoint resolves to one handler; fallthrough returns the standard envelope.

---

## PHASE 3 — VALIDATION / AUTH

**Goals**
- Inputs validated against the schema at the boundary; identity established before business logic runs.

**Techniques**
- Validate with the schema layer (`pydantic` / `serde` + a validator); reject with `400`/`422` early.
- AuthN (who) then AuthZ (allowed): `401` for missing/invalid credentials, `403` for forbidden.
- Treat all client input as hostile — never interpolate it into queries/commands (anti-failure veto).

**Common pitfalls**
- Validating in the handler body instead of at the boundary → inconsistent error shapes.
- Returning `403` where `401` is correct (or leaking existence via the wrong code).
- Trusting client-supplied IDs without an ownership/authorization check.

**Active skills & references**
- Build: [web_api_build](../skills/build/web_api_build.md) (`web_api_build`) — validation/auth section.
- Debug: [web_api_debug](../skills/debug/web_api_debug.md) (`web_api_debug`) — 401/403/422 errors.
- Anti-failure: [web_api_anti_failure](../prototyping/anti_failure/web_api_anti_failure.md) (`web_api_anti_failure`), [compliance](../prototyping/anti_failure/compliance.md).
- Reference: [http_status_reference](../prototyping/dev_reference/http_status_reference.md).

**Exit criteria:** invalid input rejected at the boundary with the right code; protected routes enforce identity.

---

## PHASE 4 — IMPLEMENT HANDLERS

**Goals**
- Business logic behind each route, returning the contract's success representations.

**Techniques**
- Keep handlers thin: parse → call a service layer → serialize. Push logic out of the transport layer.
- Hand off in-language mechanics to the language map:
  Python → [map_python](python.md) Phase 3; Rust → [map_rust](rust.md) Phase 4.
- Make side effects explicit and idempotent where the verb demands it (PUT/DELETE).

**Common pitfalls**
- Fat handlers mixing transport, validation, and logic — untestable and inconsistent.
- Blocking I/O inside an async handler stalling the event loop / runtime.

**Active skills & references**
- Build: [web_api_build](../skills/build/web_api_build.md) (`web_api_build`).
- Language maps: [map_python](python.md), [map_rust](rust.md).
- Pattern: [error_handling_patterns](../prototyping/func_encyclopedia/error_handling_patterns.md) (`error_handling_patterns`).

**Exit criteria:** each handler returns the spec's success shape; logic lives in a testable service layer.

---

## PHASE 5 — ERROR HANDLING

**Goals**
- A consistent, complete error surface: correct status codes + a single error envelope across all endpoints.

**Techniques**
- One central error handler maps domain exceptions → HTTP status + `problem+json` body.
- Use the right code: `400/422` client input, `401/403` auth, `404` missing, `409` conflict, `429` rate limit, `500` server.
- Never leak stack traces or internals to clients; log them server-side with a correlation id.

**Common pitfalls**
- Returning `200` with an error body (breaks every well-behaved client).
- Inconsistent envelopes per route; `500` for what is really a `400`.

**Active skills & references**
- Debug: [web_api_debug](../skills/debug/web_api_debug.md) (`web_api_debug`) — 5xx/error-mapping issues.
- Anti-failure: [web_api_anti_failure](../prototyping/anti_failure/web_api_anti_failure.md) (`web_api_anti_failure`), [hallucination_guards](../prototyping/anti_failure/hallucination_guards.md).
- Reference: [http_status_reference](../prototyping/dev_reference/http_status_reference.md) — the authoritative code table.

**Exit criteria:** every failure path returns the correct code + standard envelope; no internals leak.

---

## PHASE 6 — TEST / DEPLOY

**Goals**
- Contract tests proving the running API matches the spec; a deployable, health-checkable service.

**Techniques**
- Test against the contract: assert status, headers, and body schema per endpoint (happy + error).
- Use the framework test client (`TestClient`/`reqwest`); add a `/health` endpoint and structured logs.
- Validate auth and rate-limit paths, not just the happy path.

**Common pitfalls**
- Testing only 200s; the error surface (Phase 5) goes unverified and regresses silently.
- Config/secret divergence between local and deployed environments.

**Active skills & references**
- Build: [web_api_build](../skills/build/web_api_build.md) (`web_api_build`) — test/deploy section.
- Debug: [web_api_debug](../skills/debug/web_api_debug.md) (`web_api_debug`).
- Quality gates: [quality_gates](../skills/rules/quality_gates.md) (all five gates apply to APIs).
- Anti-failure: [build_integrity](../prototyping/anti_failure/build_integrity.md) (`build_integrity`).

**Exit criteria:** contract tests green for success + error paths; `/health` responds; deploy reproducible.

## CROSS-REFERENCES
- [web_api_build](../skills/build/web_api_build.md) — `web_api_build`: concrete build steps for every phase.
- [web_api_debug](../skills/debug/web_api_debug.md) — `web_api_debug`: paired debug skill; owns HTTP-status errors.
- [web_api_anti_failure](../prototyping/anti_failure/web_api_anti_failure.md) — `web_api_anti_failure`: input-trust and error-surface vetoes.
- [http_status_reference](../prototyping/dev_reference/http_status_reference.md) — authoritative status-code table for Phases 1/3/5.
- [map_python](python.md) — `map_python`: in-language handler mechanics when the API is Python.
- [map_rust](rust.md) — `map_rust`: in-language handler mechanics when the API is Rust.
- [error_handling_patterns](../prototyping/func_encyclopedia/error_handling_patterns.md) — error-envelope idioms.
- [routing](../skills/rules/routing.md) — how a request reaches this map.
- [end_to_end_example](../examples/end_to_end_example.md) — a full API walk through these six phases.

## END OF SKILL
