---
skill_id: web_api_debug
type: debug
category: null
triggers:
  keywords: [api, rest, http, endpoint, route, fastapi, express, json, server, cors, 500, 404, 401, timeout]
  error_patterns: ["500 Internal Server Error", "404 Not Found", "CORS", "Connection refused", "401 Unauthorized", "timeout"]
  languages: [python, rust, all]
  platforms: [linux, win, cross]
pairs_with: web_api_build
priority: 14
description: HTTP failure-signature diagnosis playbook — keyed by the status code or network error you actually saw.
---

# WEB_API DEBUG SKILL

Diagnosis playbook for the `web_api` domain. Fires on DEBUG intent
(`error|fix|crash|broken|fail|exception|traceback|bug|why does`) with an HTTP keyword, OR on a
literal error-pattern match against the signatures below. Debug skills sit at rank 4 — above build
(rank 5), below user instructions and anti-failure rules. On a BUILD/DEBUG tie, DEBUG wins and you
land here, not in `web_api_build`.

## HOW TO USE THIS PLAYBOOK

Find the signature you actually observed (status line, log string, or curl error). Each entry gives
the **likely causes in priority order**, the **fastest discriminating probe**, and the **fix**.
Diagnose from the layer the error came from outward: client → network → server framework →
handler → dependency. Do not "fix" by raising a timeout or adding `try/except: pass` — that hides
the failure, it doesn't resolve it (see web_api_anti_failure, rank 1).

## FIRST PROBE — ALWAYS

```bash
curl -i -sS -X <METHOD> http://HOST:PORT/path -H 'Content-Type: application/json' -d '<body>'
```

`-i` shows the status line + headers; `-sS` keeps it quiet but still prints errors. The status line
tells you which entry below to read. If curl itself errors before any HTTP response, it's a network
signature (`Connection refused` / `timeout`), not a server-code signature.

---

## SIGNATURE: `500 Internal Server Error`

Meaning: the server reached your handler and the handler threw. This is your bug, never the caller's.
- **Cause 1 — unhandled exception in the handler.** Most common: `KeyError`/`TypeError` from
  trusting unvalidated input, `None` deref, a failed DB call surfaced as a raw exception.
  Probe: read the SERVER log/traceback (the 500 body is intentionally blank — the detail is
  server-side). The last frame names the line.
  Fix: add the missing validation (push it to the request-model boundary, see web_api_build), wrap
  the dependency call and translate its failure to a deliberate 4xx/5xx.
- **Cause 2 — dependency raised (DB/cache/upstream).** Probe: does the traceback bottom out in a
  driver/socket call? Fix: catch it, log it server-side, return 503 if it's "dependency down" or
  500 if truly unexpected — with a safe body, never the exception text.
- **Cause 3 — serialization failure on the way out.** Returning a non-JSON-serializable object
  (datetime, Decimal, ORM model). Probe: traceback mentions the JSON encoder. Fix: serialize
  explicitly (`.model_dump()`, custom encoder).
ANTI-FIX: do not blanket `except Exception: return 200`. That converts a visible 500 into silent
data corruption.

## SIGNATURE: `404 Not Found`

Two very different roots — disambiguate first.
- **Cause 1 — route not registered / wrong path.** The framework never matched a handler. Probe:
  hit a route you KNOW exists; list registered routes (`app.routes`, `app.url_map`,
  `Router::routes`). Trailing-slash mismatch (`/users` vs `/users/`) and method mismatch
  (POST-only route hit with GET → may surface as 404 or 405) are classic. Fix: correct the path,
  register the router, add the redirect-slash setting.
- **Cause 2 — route matched, resource genuinely absent.** Your handler looked up `id` and found
  nothing, correctly returning 404. Probe: does the same route work for a known-good id? Fix:
  nothing to fix in the API — the caller asked for a row that doesn't exist. (Confirm you're not
  404-ing because a typo'd column made the lookup always miss.)
Tell them apart: a path typo 404s for ALL ids; a missing row 404s for SOME ids.

## SIGNATURE: `CORS` (browser console: "blocked by CORS policy")

Meaning: the browser made a cross-origin request and the server didn't return the headers that
authorize it. The request often SUCCEEDS server-side — the browser just refuses to expose the
response to JS. curl never shows this (curl ignores CORS).
- **Cause 1 — no CORS middleware.** Fix: add it. FastAPI: `CORSMiddleware` with explicit
  `allow_origins`. Express: the `cors` middleware. Set the real frontend origin, methods, and
  headers.
- **Cause 2 — preflight (OPTIONS) not handled.** Non-simple requests send an OPTIONS preflight
  first; if it isn't answered with the right `Access-Control-Allow-*` headers, the real request
  never fires. Probe: `curl -i -X OPTIONS` the endpoint and inspect headers.
- **Cause 3 — `allow_origins=["*"]` with credentials.** The spec forbids wildcard origin together
  with `allow_credentials=true`. Fix: name the exact origin.
ANTI-FIX: never ship `allow_origins=["*"]` to production to "make CORS go away" — that's the
permissive-CORS failure in web_api_anti_failure.

## SIGNATURE: `Connection refused`

Meaning: nothing is listening at that host:port — the request died before HTTP. Pure network/process
layer.
- **Cause 1 — server not running / crashed on boot.** Probe: `curl http://HOST:PORT/` — same error?
  Check the process is alive and didn't exit on an import error. Fix: start it; read its startup log.
- **Cause 2 — wrong port or host.** Server bound to `127.0.0.1` but you hit it from another
  container/host expecting `0.0.0.0`. Probe: `ss -ltnp` / `netstat -ano` for the listening port.
  Fix: bind `0.0.0.0` for external reach, or correct the client's port.
- **Cause 3 — firewall / container port not published.** Probe: works from inside the box but not
  outside. Fix: publish the port (`-p`), open the firewall rule.

## SIGNATURE: `401 Unauthorized`

Meaning: the auth layer rejected the credential (or none was sent). This is the EXPECTED response
to bad auth — the "bug" is usually in how the credential is sent or validated.
- **Cause 1 — missing/malformed `Authorization` header.** Probe: echo the exact header the client
  sends; confirm `Authorization: Bearer <token>` form. Fix: send it correctly.
- **Cause 2 — expired or wrong-audience token.** Probe: decode the JWT (`exp`, `aud`, `iss`). Fix:
  refresh the token / correct the audience.
- **Cause 3 — clock skew on `exp`/`nbf` validation.** Server and token issuer disagree on time.
  Probe: compare `exp` to server clock. Fix: sync clocks (NTP) or add small leeway.
- **Cause 4 — secret/key mismatch.** Server validates with a different signing key than the issuer
  used. Probe: signature-verification error in the auth log. Fix: align the key/JWKS.
Don't confuse with 403: 401 = credential rejected; 403 = credential fine, permission denied.

## SIGNATURE: `timeout` (client hangs, gateway 504, or read-timeout)

Meaning: a response didn't arrive in the allotted window. Locate WHERE it stalls.
- **Cause 1 — slow/blocking dependency.** A DB query, upstream HTTP call, or lock the handler waits
  on. Probe: add timing around the dependency call; check slow-query logs. Fix: optimize the query
  (index!), and add a CLIENT timeout on every outbound call so one slow dependency can't pin a worker.
- **Cause 2 — event-loop blocked by sync work.** In async frameworks, a synchronous CPU/IO call in
  an async handler blocks ALL requests. Probe: latency spikes across unrelated endpoints. Fix: move
  blocking work to a thread/executor or make it truly async.
- **Cause 3 — no timeout configured anywhere.** The handler will wait forever, so will the client.
  Fix: set server request timeouts AND outbound-call timeouts (the missing-timeout failure in
  web_api_anti_failure). A timeout that returns 504 fast beats one that hangs.
ANTI-FIX: bumping the client timeout to 5 minutes is not a fix — find what's slow.

---

## ESCALATION

If two passes through the matching signature don't resolve it, escalate per rules/escalation.md:
re-read the server logs from the boot line, reproduce with the minimal curl above, and state the
exact observed-vs-expected gap rather than guessing a third fix.

## CROSS-REFERENCES
- [web_api_build](../build/web_api_build.md) — paired build skill (`web_api_build`); the contract whose violations produce these signatures.
- [web_api_anti_failure](../../prototyping/anti_failure/web_api_anti_failure.md) — `web_api_anti_failure`; the anti-fixes called out above live here as rank-1 rules.
- [http_status_reference](../../prototyping/dev_reference/http_status_reference.md) — authoritative meaning of every code in the signatures.
- [maps/web_api.md](../../maps/web_api.md) — `map_web_api`; layer model (client/network/framework/handler/dependency) used to localize faults.
- [error_routing](../rules/error_routing.md) — how an error string routes into this playbook.
- [escalation](../rules/escalation.md) — what to do when two diagnosis passes fail.

## END OF SKILL
