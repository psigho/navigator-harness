---
skill_id: web_api_build
type: build
category: null
triggers:
  keywords: [api, rest, http, endpoint, route, fastapi, express, json, server]
  languages: [python, rust, all]
pairs_with: web_api_debug
depends_on: [web_api_anti_failure]
priority: 12
description: Construct correct, safe REST endpoints — routing, validation, status codes, auth boundaries, idempotency.
---

# WEB_API BUILD SKILL

Build skill for the `web_api` demo domain. Activates on BUILD-intent requests touching HTTP
surfaces: "create an endpoint", "add a route", "write a FastAPI server", "make a REST API".
This skill produces an endpoint that validates its input, returns honest status codes, never
leaks internals, and is safe to retry. Before generating, the runtime loads `web_api_anti_failure`
(rank 1, anti-failure) — its rules OVERRIDE anything here on conflict.

## WHEN THIS SKILL FIRES

Router math: a request scores BUILD intent (`build|create|write|make|implement|add`) AND carries
a web_api keyword (`api|rest|http|endpoint|route|fastapi|express|json|server`). On a tie with
DEBUG, DEBUG wins and `web_api_debug` loads instead (see rules/routing.md). If the user says
"design the API" with no concrete build verb, PROTOTYPE wins and you scaffold first.

## THE ENDPOINT CONTRACT (build every route to satisfy all six)

1. **Method + path are semantically correct.** GET reads (no body, no side effects), POST creates,
   PUT replaces (idempotent), PATCH partially updates, DELETE removes (idempotent). Never mutate on GET.
2. **Input is validated before use.** Parse → validate → only then touch business logic. A handler
   that indexes `body["email"]` without checking is a bug, not a feature.
3. **Status code reflects reality.** 2xx only on real success. 4xx for caller mistakes, 5xx for
   server faults. See dev_reference/http_status_reference.md for the full table.
4. **Errors are structured and safe.** Return `{"error": {"code": ..., "message": ...}}` — never a
   raw stack trace, SQL string, or internal path.
5. **Auth boundary is explicit.** Every route is either public-by-decision or guarded. There is no
   "I forgot to add auth" state.
6. **Writes are idempotent or explicitly not.** A retried POST must not silently double-charge.

## ROUTING — DESIGN THE SURFACE FIRST

Group by resource noun, not verb. `/users`, `/users/{id}`, `/users/{id}/orders`. Keep path params
for identity, query params for filtering/pagination, body for payload.

```
GET    /users            -> list (paginated)        200
POST   /users            -> create                  201 + Location header
GET    /users/{id}       -> read one                200 / 404
PUT    /users/{id}       -> replace                 200 / 404
PATCH  /users/{id}       -> partial update          200 / 404
DELETE /users/{id}       -> remove                  204 / 404
```

Pagination is a `limit`/`offset` (or cursor) query pair with a hard server-side cap on `limit`
(unbounded limit = the resource-exhaustion failure mode in web_api_anti_failure).

## REQUEST VALIDATION — PARSE, DON'T TRUST

FastAPI (Python) — let Pydantic be the validation boundary:

```python
from fastapi import FastAPI, HTTPException, status
from pydantic import BaseModel, EmailStr, field_validator

app = FastAPI()

class CreateUser(BaseModel):
    email: EmailStr
    display_name: str
    age: int

    @field_validator("display_name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("display_name must not be blank")
        return v

    @field_validator("age")
    @classmethod
    def age_in_range(cls, v: int) -> int:
        if not (0 < v < 150):
            raise ValueError("age out of range")
        return v

@app.post("/users", status_code=status.HTTP_201_CREATED)
def create_user(payload: CreateUser):
    if store.email_exists(payload.email):
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered")
    user = store.insert(payload.model_dump())
    return {"id": user.id, "email": user.email}
```

Pydantic rejects malformed bodies with a 422 automatically — that is the desired default, not an
error to suppress. The handler only runs on already-valid data.

Express (Node, Rust-equivalent pattern below) — validate explicitly because Express won't:

```js
app.post("/users", (req, res) => {
  const { email, displayName, age } = req.body ?? {};
  if (typeof email !== "string" || !email.includes("@"))
    return res.status(400).json({ error: { code: "BAD_EMAIL", message: "valid email required" } });
  if (typeof displayName !== "string" || !displayName.trim())
    return res.status(400).json({ error: { code: "BAD_NAME", message: "display_name required" } });
  if (!Number.isInteger(age) || age <= 0 || age >= 150)
    return res.status(400).json({ error: { code: "BAD_AGE", message: "age out of range" } });
  // ...only now touch the store
});
```

Rust (axum + serde) — the type system is your validator; `Json<T>` rejects non-conforming bodies:

```rust
#[derive(serde::Deserialize)]
struct CreateUser { email: String, display_name: String, age: u8 }

async fn create_user(Json(p): Json<CreateUser>) -> Result<(StatusCode, Json<UserOut>), ApiError> {
    if !p.email.contains('@') { return Err(ApiError::bad_request("valid email required")); }
    if p.display_name.trim().is_empty() { return Err(ApiError::bad_request("name required")); }
    let user = store.insert(p).await.map_err(ApiError::internal)?;
    Ok((StatusCode::CREATED, Json(user.into())))
}
```

## STATUS CODES — THE SHORT TABLE (full table in dev_reference)

| Code | Use exactly when |
|------|------------------|
| 200  | success with body |
| 201  | resource created (add a `Location` header) |
| 204  | success, no body (DELETE) |
| 400  | malformed/invalid request the client must fix |
| 401  | no/invalid credentials — challenge to authenticate |
| 403  | authenticated but not allowed |
| 404  | resource (or route) does not exist |
| 409  | conflict with current state (duplicate, version clash) |
| 422  | well-formed but semantically invalid (validation) |
| 429  | rate limited (include `Retry-After`) |
| 500  | unexpected server fault — never the caller's fault |
| 503  | dependency down / shutting down |

Distinguish 401 vs 403: 401 = "who are you?", 403 = "I know who you are, no." Distinguish 400 vs 422:
400 = couldn't parse, 422 = parsed fine but values are wrong.

## AUTH BOUNDARY

Put auth in a dependency/middleware, not copied into each handler. Validate the token, attach the
principal to the request, and let handlers read it. Missing/expired token → 401 (with
`WWW-Authenticate`). Valid token, insufficient scope → 403. Never return 404 to hide an auth
failure unless you have an explicit existence-hiding requirement.

## IDEMPOTENCY

PUT/DELETE are idempotent by HTTP semantics — make your implementation honor that (DELETE on an
already-gone resource still returns 204 or 404 deterministically, never 500). For POST that must
be safe to retry, accept an `Idempotency-Key` header, persist the first result against that key,
and replay it on duplicate keys instead of re-executing the side effect.

## SELF-REVIEW BEFORE EMITTING (quality gate 1: completeness)

- [ ] Every route has an explicit auth decision (guarded or public-by-choice).
- [ ] Input validated before the store/business layer is touched.
- [ ] Success and every failure path return a deliberate status code.
- [ ] No internal detail (stack/SQL/path/secret) in any error body.
- [ ] List endpoints are paginated with a capped `limit`.
- [ ] Retry-safe writes have an idempotency story.

## CROSS-REFERENCES
- [web_api_debug](../debug/web_api_debug.md) — paired diagnosis playbook (`web_api_debug`); load when a built endpoint misbehaves.
- [web_api_anti_failure](../../prototyping/anti_failure/web_api_anti_failure.md) — `web_api_anti_failure`; rank-1 rules this build must obey.
- [maps/web_api.md](../../maps/web_api.md) — `map_web_api`; domain map of HTTP concepts and where each lives.
- [http_status_reference](../../prototyping/dev_reference/http_status_reference.md) — full status-code table cited above.
- [error_handling_patterns](../../prototyping/func_encyclopedia/error_handling_patterns.md) — structured error envelope patterns reused here.
- [routing](../rules/routing.md) — how this skill gets selected vs `web_api_debug`.

## END OF SKILL
