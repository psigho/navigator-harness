---
skill_id: web_api_anti_failure
type: prototype
category: anti_failure
triggers:
  keywords: [api, rest, http, endpoint, route, fastapi, express, json, server]
  languages: [python, rust, all]
  platforms: [linux, win, cross]
pairs_with: web_api_build
priority: 100
description: Rank-1 anti-failure rules for HTTP services — input trust, error leakage, timeouts/retries, rate limiting.
---

# WEB_API ANTI-FAILURE RULES

These are **rank-1 authority** in Navigator's 9-rank conflict model: they override build skills,
reference files, patterns, and maps. When `web_api_build` generates an endpoint, the runtime loads
this file first; any conflict resolves in favor of the rule here. This is quality gate 3 (safety).
Each rule is stated as a failure mode → why it bites → the prevention rule → how to verify.

The shared spirit: **a web service is an adversarial boundary.** Every byte from the network is
hostile until validated, every error is a potential information leak, every outbound call can hang
forever, and any endpoint can be hammered. Build as if all four are happening right now.

---

## FAILURE 1 — UNVALIDATED INPUT (the root failure)

**Mode:** the handler reads `body["x"]`, coerces a query param to int, or interpolates a value into
a query/path/command without checking it. Symptoms downstream: 500s (web_api_debug Cause 1),
injection, type confusion, oversized-payload DoS.
**Why it bites:** the network is anonymous and untrusted. "It works in my test" uses well-formed
input; attackers and buggy clients don't.
**RULE:** validate at the boundary, before any business/store/dependency call runs. Parse into a
typed model (Pydantic / serde / explicit checks), reject non-conforming input with 400/422.
Whitelist allowed shapes; never blacklist bad ones. Enforce a max body size at the server.
Never build SQL/shell/path strings by concatenation — use parameterized queries / safe APIs.
**Verify:** send a missing field, a wrong type, an oversized body, and a hostile string
(`'; DROP`, `../../etc/passwd`); each must get a clean 4xx, never a 500 and never execution.

## FAILURE 2 — LEAKING ERRORS (internal detail in the response)

**Mode:** an exception's message, a stack trace, a SQL statement, a filesystem path, a stack frame,
or a secret ends up in the HTTP response body (or in `debug=true` mode left on in production).
**Why it bites:** it hands an attacker your schema, your framework versions, your file layout, and
sometimes credentials. It also confuses legitimate clients with noise they can't act on.
**RULE:** the response body for an error is a deliberate, minimal, structured envelope:
`{"error": {"code": "MACHINE_CODE", "message": "human, non-sensitive"}}`. Full detail goes to the
SERVER log with a correlation id; the client gets the id, not the detail. Disable debug/reloader and
verbose error pages in production. A 500 body is intentionally generic.
**Verify:** force an internal error and confirm the response contains no stack, no SQL, no path, no
version string, no secret — only a code, a safe message, and optionally a correlation id.

## FAILURE 3 — MISSING TIMEOUTS / NAIVE RETRIES

**Mode (timeouts):** an outbound call (DB, cache, upstream API) has no timeout, so a slow dependency
pins the worker forever; under load every worker is stuck and the whole service hangs (web_api_debug
`timeout` Cause 3). **Mode (retries):** code retries a failed call immediately and unconditionally,
amplifying load on an already-struggling dependency (retry storm) and re-running non-idempotent
side effects.
**Why it bites:** without a timeout, one slow dependency cascades into total outage. Without
backoff/idempotency, retries turn a blip into an outage and can double-charge/double-write.
**RULE:** every outbound call carries an explicit, finite timeout. Every retry uses bounded attempts
with exponential backoff + jitter, retries ONLY idempotent or idempotency-keyed operations, and only
on retryable failures (network/5xx/429 — never on 4xx). Pair with a circuit breaker on chronic
failure. Fail fast with 503/504 rather than hanging.
**Verify:** point the dependency at a black hole — the endpoint must return an error within its
timeout, not hang. Confirm retries stop after the cap and never replay a non-idempotent write.

## FAILURE 4 — NO RATE LIMITING / NO RESOURCE BOUNDS

**Mode:** any caller can send unlimited requests, request unbounded page sizes (`?limit=1000000`),
or upload unbounded bodies. One client (or one bug, or one attacker) exhausts CPU, memory, DB
connections, or your upstream quota.
**Why it bites:** absent limits, capacity is first-come-first-served and a single bad actor degrades
the service for everyone. It's also how a cheap endpoint becomes an expensive DoS amplifier.
**RULE:** rate-limit per principal/IP and return 429 with `Retry-After` when exceeded. Cap every
list endpoint's `limit` server-side. Cap request body size. Bound concurrency to your dependency's
capacity (connection pool sizing). Prefer cursor pagination for large collections.
**Verify:** exceed the rate limit → 429 + `Retry-After`. Request an absurd `limit` → it's clamped,
not honored. Post an oversized body → rejected before it's buffered into memory.

---

## SECONDARY HARDENING (apply by default)

- **Auth is explicit on every route.** No route ships in an "I forgot auth" state (see web_api_build
  rule 5). Default-deny; public routes are public by an explicit decision.
- **CORS is allowlisted, never `*` in production**, and never wildcard-origin with credentials
  (web_api_debug CORS Cause 3).
- **Methods are semantically honest.** GET never mutates; mutating verbs are idempotent where HTTP
  says they must be.
- **Security headers** where relevant: `Content-Type` set correctly, no reflected user input into
  headers, HSTS/secure cookies for browser-facing services.
- **Log without leaking.** Server logs may hold detail, but never log secrets/tokens/passwords in
  cleartext.

## REVIEW CHECKLIST (run before any web_api endpoint is considered done)

- [ ] Every input validated at the boundary; oversized bodies capped; queries parameterized.
- [ ] No error path leaks stack/SQL/path/version/secret; structured envelope + server-side detail.
- [ ] Every outbound call has a finite timeout; retries are bounded + backed-off + idempotent-only.
- [ ] Rate limiting present (429 + Retry-After); list `limit` capped; body size capped.
- [ ] Auth decision explicit on every route; CORS allowlisted; debug mode off in production.
- [ ] Mutating verbs idempotent where required; GET is side-effect free.

If any box is unchecked, the endpoint fails quality gate 3 and must not be emitted — this rule
outranks the build skill's desire to "just ship it."

## CROSS-REFERENCES
- [web_api_build](../../skills/build/web_api_build.md) — paired build skill (`web_api_build`); these rules constrain what it emits.
- [web_api_debug](../../skills/debug/web_api_debug.md) — `web_api_debug`; each failure here maps to a debug signature and its anti-fix.
- [maps/web_api.md](../../maps/web_api.md) — `map_web_api`; where each concern (auth/validation/limits) sits in the request lifecycle.
- [http_status_reference](../dev_reference/http_status_reference.md) — codes used by these rules (400/422/429/503/504).
- [compliance](compliance.md) — cross-domain compliance/safety rules that compose with these.
- [tool_execution](tool_execution.md) — anti-failure rules for executing outbound/tool calls safely.

## END OF SKILL
