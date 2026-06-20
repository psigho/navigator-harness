---
skill_id: error_routing
type: rules
category: engine
triggers:
  keywords: [error, traceback, panic, exception, crash, fail, stack trace, dispatch, diagnose]
  error_patterns: ["Traceback (most recent call last)", "cannot borrow", "does not live long enough", "panicked at", "500 Internal Server Error", "Connection refused", "ECONNREFUSED", "thread 'main' panicked", "error[E0", "ModuleNotFoundError"]
  languages: [all]
  platforms: [cross]
pairs_with: routing
depends_on: [routing, quality_gates]
priority: 1
description: Error-signature dispatch tables mapping observed failures to the responsible debug skill, section, and the anti-failure rule most likely violated.
---

# NAVIGATOR ERROR ROUTING (DEBUG-lane engine)

When `routing.md` resolves the DEBUG intent, control passes here. The job: take an
**error signature** — the most specific recognizable string in the failure — and emit
a three-part verdict:

```
(responsible debug skill, specific section, anti-failure rule likely violated)
```

This is a one-hop lookup. The signature is matched against the dispatch tables below
in **class order** (a single failure often presents at several classes; the earliest
matching class wins because it is closest to root cause).

## ERROR CLASS ORDER (earliest match wins)

1. **Compile-time** — source rejected before producing an artifact (syntax, type, trait).
2. **Link-time** — compilation passed; symbol resolution / linking failed.
3. **Runtime** — artifact ran, then faulted (panic, uncaught exception, segfault).
4. **Logic** — ran to completion, produced a wrong answer (no crash).
5. **Environment** — failure outside the code (missing dep, bad path, perms, ports).
6. **Timeout** — no terminal error; the operation never completed in budget.

A traceback that is really a missing-module problem is an *environment* failure
surfacing as runtime — class 5 outranks class 3 when both match, because fixing the env
makes the runtime symptom vanish. Always ask "what is upstream" before dispatching.

---

## TABLE A — PYTHON

| Signature (literal) | Class | → Debug skill / section | Likely anti-failure rule violated |
|---|---|---|---|
| `Traceback (most recent call last)` ... `NameError` | Runtime | python_debug § Name & Scope | hallucination_guards (invented symbol) |
| `ModuleNotFoundError: No module named 'X'` | Environment | python_debug § Imports & Env | tool_execution (unverified install) |
| `ImportError: cannot import name` | Compile-time | python_debug § Imports & Env | build_integrity (stale package) |
| `IndentationError` / `SyntaxError` | Compile-time | python_debug § Syntax | build_integrity (truncated edit) |
| `TypeError: ... takes N positional arguments but M given` | Runtime | python_debug § Type & Signature | hallucination_guards (wrong signature) |
| `AttributeError: 'NoneType' object has no attribute` | Runtime | python_debug § None & Optionals | python_anti_failure (None-propagation) |
| `KeyError` / `IndexError` | Runtime | python_debug § Containers | python_anti_failure (unchecked access) |
| `RuntimeError: This event loop is already running` | Runtime | python_debug § Asyncio | python_anti_failure (nested loop) |
| assertion in `pytest` output (`assert X == Y`) | Logic | python_debug § Test Failures | quality_gates (gate 2 correctness) |
| process hangs, no traceback | Timeout | python_debug § Hangs & Deadlocks | python_anti_failure (await/blocking-call mix) |

## TABLE B — RUST

| Signature (literal) | Class | → Debug skill / section | Likely anti-failure rule violated |
|---|---|---|---|
| `error[E0382]: borrow of moved value` | Compile-time | rust_debug § Ownership & Moves | rust_anti_failure (use-after-move) |
| `error[E0502]: cannot borrow ... as mutable ... also borrowed as immutable` | Compile-time | rust_debug § Borrow Checker | rust_anti_failure (aliasing rules) |
| `error[E0499]: cannot borrow ... as mutable more than once` | Compile-time | rust_debug § Borrow Checker | rust_anti_failure (double mut borrow) |
| `does not live long enough` / `error[E0597]` | Compile-time | rust_debug § Lifetimes | rust_anti_failure (dangling reference) |
| `error[E0277]: the trait bound ... is not satisfied` | Compile-time | rust_debug § Traits & Bounds | hallucination_guards (assumed impl) |
| `error[E0308]: mismatched types` | Compile-time | rust_debug § Type Mismatch | build_integrity (wrong type literal) |
| `undefined reference to` / linker error | Link-time | rust_debug § Linking & FFI | tool_execution (missing native lib) |
| `thread 'main' panicked at ... unwrap()` | Runtime | rust_debug § Panics & unwrap | rust_anti_failure (unchecked unwrap) |
| `index out of bounds` panic | Runtime | rust_debug § Panics & unwrap | rust_anti_failure (slice bounds) |
| deadlock, no panic | Timeout | rust_debug § Async & Deadlock | rust_anti_failure (Mutex held across await) |

## TABLE C — WEB_API (HTTP / network)

| Signature (literal) | Class | → Debug skill / section | Likely anti-failure rule violated |
|---|---|---|---|
| `500 Internal Server Error` | Runtime | web_api_debug § 5xx & Handler Crash | web_api_anti_failure (unhandled handler exc) |
| `502 Bad Gateway` / `503 Service Unavailable` | Environment | web_api_debug § Upstream & Proxy | web_api_anti_failure (no readiness check) |
| `Connection refused` / `ECONNREFUSED` | Environment | web_api_debug § Connectivity | tool_execution (server not started) |
| `422 Unprocessable Entity` (FastAPI/pydantic) | Logic | web_api_debug § Request Validation | web_api_anti_failure (schema mismatch) |
| `404 Not Found` on a route you defined | Logic | web_api_debug § Routing & Mounts | web_api_anti_failure (path/method typo) |
| `405 Method Not Allowed` | Logic | web_api_debug § Routing & Mounts | web_api_anti_failure (wrong verb) |
| `CORS ... has been blocked` | Environment | web_api_debug § CORS & Headers | web_api_anti_failure (missing middleware) |
| request never returns | Timeout | web_api_debug § Timeouts & Backpressure | web_api_anti_failure (blocking call in async route) |
| `401 Unauthorized` / `403 Forbidden` | Logic | web_api_debug § Auth | compliance (missing/leaked credential handling) |

---

## DISPATCH PROCEDURE

1. **Extract the signature.** Take the most specific literal token — an `error[E0xxx]`
   code, an HTTP status, an exception class name. Specific beats generic.
2. **Match in class order** (compile → link → runtime → logic → environment → timeout),
   but apply the upstream rule: if an environment cause explains a runtime symptom, route
   to environment.
3. **Emit the triple** and load the named debug skill body at the named section only
   (not the whole body — section anchors keep the budget low; see `context_management.md`).
4. **Pre-activate the named anti-failure rule.** The "likely violated" column is a
   prior, not a verdict — confirm it against the code before asserting it as the fix.
5. **Cite.** The fix must cite the debug-skill section and the anti-failure rule per
   quality gate 4 (citation) in `quality_gates.md`.

## MULTI-MATCH & UNKNOWN SIGNATURES

- **Multi-domain failure** (e.g. a Rust web server panics: Table B *and* Table C match):
  load both debug skills; `conflict_resolution.md` ranks debug skills at tier 4, and the
  *closest-to-root-cause* class wins. A panic (runtime, Table B) upstream of the 500
  (Table C symptom) means Table B is the real target.
- **Unknown signature:** fall back to the class heuristic — classify by *when* it failed
  (before/at link/at run/after run/outside code/never), route to that domain debug skill's
  general section, and raise `skill_drift` if no domain matches at all.

## CROSS-REFERENCES
- [routing.md](./routing.md) — the core router that hands DEBUG-lane control here (skill_id: routing).
- [conflict_resolution.md](./conflict_resolution.md) — resolves which debug skill owns a multi-domain failure (skill_id: conflict_resolution).
- [quality_gates.md](./quality_gates.md) — gate 2 (correctness) and gate 4 (citation) bind every fix emitted here (skill_id: quality_gates).
- [../debug/python_debug.md](../debug/python_debug.md) — target of Table A (skill_id: python_debug).
- [../debug/rust_debug.md](../debug/rust_debug.md) — target of Table B (skill_id: rust_debug).
- [../debug/web_api_debug.md](../debug/web_api_debug.md) — target of Table C (skill_id: web_api_debug).
- [../../master_skill.md](../../master_skill.md) — boot file; loads this engine alongside the router (skill_id: master_skill).

## END OF SKILL
