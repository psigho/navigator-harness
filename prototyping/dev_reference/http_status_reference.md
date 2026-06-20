---
skill_id: ref_http_status
type: prototype
category: dev_ref
triggers:
  keywords: [http, status, code, rest, api, endpoint, response, header, 404, 500, 401, 429]
  extensions: [.py, .rs]
  languages: [python, rust, all]
  platforms: [cross]
priority: 12
description: Compact HTTP status-code reference (2xx-5xx) with when-to-use guidance for API builders.
---

# HTTP Status Code Reference

A working reference for API authors. The router reaches this file when a query mentions
`status`, `code`, `404`, `500`, `header`, or an HTTP verb in a `web_api` context. Pair it with
the build/debug skills below — this file tells you *which* code to return; those skills tell you
*how* to wire it.

> Rule of thumb: the status line is the API's primary contract. Get the *class* right (2/4/5),
> then refine the specific code. A wrong class (e.g. 200 with an error body) breaks every
> well-behaved client and every retry/circuit-breaker downstream.

## 1xx — Informational (rarely emitted by app code)
| Code | Name | When to use |
|------|------|-------------|
| 100 | Continue | Client may send the request body; emitted by the server stack, not handlers. |
| 101 | Switching Protocols | Upgrade handshake (WebSocket). Framework-level, not your handler. |

## 2xx — Success
| Code | Name | When to use |
|------|------|-------------|
| 200 | OK | Default success for GET/PUT with a body to return. |
| 201 | Created | A POST created a resource. Return a `Location` header to the new URL. |
| 202 | Accepted | Work was queued, not finished. Pair with a status/polling endpoint. |
| 204 | No Content | Success with an intentionally empty body — DELETE, or a PUT that returns nothing. |
| 206 | Partial Content | Range request honored (downloads, video). Requires `Content-Range`. |

## 3xx — Redirection
| Code | Name | When to use |
|------|------|-------------|
| 301 | Moved Permanently | Resource has a new canonical URL forever; clients should update bookmarks. |
| 302 | Found | Temporary redirect; method may change to GET. Prefer 307 to preserve method. |
| 304 | Not Modified | Conditional GET (`If-None-Match`/`ETag`) — client cache is still valid. No body. |
| 307 | Temporary Redirect | Like 302 but the method and body are preserved. |
| 308 | Permanent Redirect | Like 301 but method/body preserved. |

## 4xx — Client errors (the request is wrong; do not retry unchanged)
| Code | Name | When to use |
|------|------|-------------|
| 400 | Bad Request | Malformed syntax / failed validation the client must fix. Include a field-level error body. |
| 401 | Unauthorized | Missing or invalid credentials. MUST send `WWW-Authenticate`. (Misnamed — means *unauthenticated*.) |
| 403 | Forbidden | Authenticated but not allowed. Do not reveal whether the resource exists if that itself is sensitive. |
| 404 | Not Found | Resource absent, or hidden on purpose (use instead of 403 to avoid leaking existence). |
| 405 | Method Not Allowed | Route exists, verb does not. MUST send an `Allow` header listing valid verbs. |
| 409 | Conflict | State conflict — duplicate key, edit on a stale version, optimistic-lock failure. |
| 410 | Gone | Resource existed and was permanently removed. Stronger signal than 404. |
| 415 | Unsupported Media Type | `Content-Type` the endpoint cannot parse. |
| 422 | Unprocessable Entity | Syntactically valid but semantically invalid (common for JSON validation in FastAPI/Rails). |
| 429 | Too Many Requests | Rate limit hit. SHOULD send `Retry-After`. Clients back off on this. |

## 5xx — Server errors (the server failed; the request may be retryable)
| Code | Name | When to use |
|------|------|-------------|
| 500 | Internal Server Error | Unhandled exception / a bug. Never leak a stack trace to the client body. |
| 501 | Not Implemented | The server does not support the functionality at all (e.g. unknown method). |
| 502 | Bad Gateway | This server is a proxy and got a bad response from upstream. |
| 503 | Service Unavailable | Overloaded or in maintenance. SHOULD send `Retry-After`. Health checks watch this. |
| 504 | Gateway Timeout | Upstream did not answer in time. |

## Decision guide (fast path)
1. Did the handler succeed? → 2xx. Created a thing? 201 + `Location`. Nothing to return? 204.
2. Is the *caller* at fault? → 4xx. Unauthenticated? 401. Authenticated-but-denied? 403.
   Shape wrong? 400/422. Too fast? 429 + `Retry-After`.
3. Did *we* break? → 5xx. Our bug? 500 (generic body). Upstream dependency down? 502/503/504.
4. When unsure between two adjacent codes, pick the one whose **retry semantics** match reality:
   4xx tells clients "don't retry until you change something"; 5xx and 429 tell them "retry later".

## Anti-failure ties
- Returning `200` with an error payload is a top web_api failure mode — see
  `web_api_anti_failure`. Clients, caches, and retry layers all trust the status line over the body.
- Always emit the mandatory companion header (`Location`, `Allow`, `WWW-Authenticate`,
  `Retry-After`) — omission is a silent contract break that debuggers chase for hours.

## CROSS-REFERENCES
- [web_api_build](../../skills/build/web_api_build.md) — building endpoints that return these codes.
- [web_api_debug](../../skills/debug/web_api_debug.md) — diagnosing wrong-status and missing-header bugs.
- [web_api_anti_failure](../anti_failure/web_api_anti_failure.md) — the "200-on-error" failure class and how to avoid it.
- [pattern_error_handling](../func_encyclopedia/error_handling_patterns.md) — mapping internal errors to status codes.
- [map_web_api](../../maps/web_api.md) — where status handling sits in the web_api domain.

## END OF SKILL
