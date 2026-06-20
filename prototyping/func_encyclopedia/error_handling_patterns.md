---
skill_id: pattern_error_handling
type: prototype
category: func_pattern
triggers:
  keywords: [error, exception, handling, result, panic, traceback, retry, try, catch, recover, raise]
  extensions: [.py, .rs]
  error_patterns: ["unhandled exception", "panicked at", "Traceback (most recent call last)", "unwrap() on a None", "called `Result::unwrap()`"]
  languages: [python, rust, all]
  platforms: [cross]
priority: 11
description: Reusable error-handling patterns across Python, Rust, and web_api boundaries.
---

# Error-Handling Patterns

A pattern library (authority rank 7) of error-handling shapes the build/debug skills compose.
The router picks this on lookups about exceptions, `Result`, retries, or panics. Patterns are
language-grouped; the closing section gives the cross-language principles that hold everywhere.

## Principle: errors are values, not surprises
Treat a failure as a normal return path with a defined shape, not an afterthought. The three
questions every error site must answer: **(1) can I recover here? (2) if not, who can? (3) what
context travels with the error so they can?** Catch where you can act; otherwise add context and
re-raise toward a layer that can.

---

## Python patterns

### P1 — Narrow catch, act, or re-raise
```python
try:
    data = json.loads(text)
except json.JSONDecodeError as e:
    log.warning("bad config at %s: %s", path, e)
    raise ConfigError(f"{path} is not valid JSON") from e   # chain, don't swallow
```
Catch the *specific* exception. Bare `except:` hides `KeyboardInterrupt` and bugs. `from e`
preserves the cause chain so the traceback shows root + context.

### P2 — Custom exception hierarchy
```python
class AppError(Exception): ...
class ConfigError(AppError): ...
class UpstreamError(AppError): ...
```
One root per app lets callers write `except AppError` to catch *your* failures while letting
unexpected bugs propagate. Carry data on the instance (`self.status`, `self.retryable`).

### P3 — Cleanup that always runs
```python
with open(path) as fh:        # context manager: file closed on success or exception
    process(fh)
try:
    acquire()
finally:
    release()                 # runs even if the body raises
```

### P4 — Retry with backoff (transient failures only)
```python
import time, random
def with_retry(fn, attempts=3, base=0.2):
    for i in range(attempts):
        try:
            return fn()
        except UpstreamError as e:
            if not e.retryable or i == attempts - 1:
                raise
            time.sleep(base * 2 ** i + random.random() * 0.1)  # exp backoff + jitter
```
Only retry idempotent operations on transient (5xx/429/timeout) errors. Never retry a 4xx.

---

## Rust patterns

### R1 — Propagate with `?`
```rust
fn load(path: &Path) -> Result<Config, AppError> {
    let text = std::fs::read_to_string(path)?;     // io::Error -> AppError via From
    let cfg: Config = serde_json::from_str(&text)?;
    Ok(cfg)
}
```
`?` returns early on `Err`, converting via the `From` trait. This is Rust's `raise`-and-propagate.

### R2 — Rich error enums (thiserror style)
```rust
#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error("config not found: {0}")]
    NotFound(PathBuf),
    #[error("parse failed")]
    Parse(#[from] serde_json::Error),   // auto From impl enables `?`
}
```
Libraries return typed enums; binaries can collapse to `anyhow::Result` for ergonomic context
(`.context("loading config")?`).

### R3 — Handle, don't `unwrap`, on the happy-path-but-fallible
```rust
match risky() {
    Ok(v) => use_it(v),
    Err(e) => { eprintln!("recovered: {e}"); default() }
}
let port = env::var("PORT").ok().and_then(|s| s.parse().ok()).unwrap_or(8080);
```
`unwrap`/`expect` are acceptable only where a failure is genuinely a programmer bug. In request
paths and I/O, `unwrap` is the #1 panic source — see `rust_anti_failure`.

### R4 — Option vs Result
Use `Option<T>` for "absence is normal" (lookup miss); `Result<T, E>` for "this can fail with a
reason." Convert with `ok_or(err)` / `ok_or_else(|| ...)`.

---

## web_api patterns

### W1 — Map internal errors to status codes at the edge
```python
@app.exception_handler(AppError)
async def handle(_req, exc: AppError):
    code = {ConfigError: 400, UpstreamError: 502}.get(type(exc), 500)
    return JSONResponse(status_code=code, content={"error": exc.public_message})
```
One boundary handler turns the internal exception tree into HTTP. Internal detail never leaks
into the client body (anti-failure: no stack traces over the wire). See `ref_http_status`.

### W2 — Validation errors are 400/422, not 500
Reject bad input *before* business logic with a structured field-level body. A validation failure
is the client's fault (4xx); only an unhandled bug is 5xx.

### W3 — Idempotency + retry contract
Honor an `Idempotency-Key` for unsafe verbs so client retries (W4 in error handling) don't
double-charge. Return `429` + `Retry-After` so clients back off deterministically.

---

## Cross-language principles
1. **Fail loud at the boundary, recover quietly inside.** Swallowed errors become silent data corruption.
2. **Attach context as the error climbs** (`raise ... from`, `.context(...)`) — a bare error message with no path/operation is undebuggable.
3. **Distinguish bug vs expected failure.** Bugs should crash visibly in dev; expected failures get typed handling.
4. **Retry only the transient and idempotent.** Backoff with jitter; cap attempts; never retry 4xx.
5. **One translation layer to the user-facing channel** (HTTP status / exit code / log) — don't scatter formatting.

## CROSS-REFERENCES
- [python_debug](../../skills/debug/python_debug.md) — applying P1–P4 to live Python tracebacks.
- [rust_debug](../../skills/debug/rust_debug.md) — applying R1–R4 to panics and `Result` flows.
- [web_api_debug](../../skills/debug/web_api_debug.md) — applying W1–W3 to endpoint failures.
- [ref_http_status](../dev_reference/http_status_reference.md) — the status codes W1/W2 map onto.
- [python_anti_failure](../anti_failure/python_anti_failure.md) and [rust_anti_failure](../anti_failure/rust_anti_failure.md) — the failure classes these patterns prevent.

## END OF SKILL
