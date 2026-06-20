---
skill_id: rust_debug
type: debug
category: null
triggers:
  keywords: [rust, cargo, crate, rustc, tokio, borrow, lifetime, trait, error, fix]
  extensions: [.rs]
  error_patterns: ["cannot borrow", "does not live long enough", "mismatched types", "trait bound", "E0382", "E0502"]
  languages: [rust]
  platforms: [cross]
pairs_with: rust_build
depends_on: [rust_anti_failure]
priority: 12
description: Diagnosis playbook keyed by Rust borrow-checker, lifetime, type, and trait-bound errors.
---

# RUST DEBUG SKILL

DEBUG-class skill (authority rank 4) — outranks `rust_build` so that when a compiler error surfaces, diagnosis
drives the next edit. It still defers to `rust_anti_failure` (rank 1): a fix that re-introduces an `unwrap` in
library code or blocks the async runtime is NOT a valid fix. The router lands here when DEBUG intent words
(`error/fix/crash/broken/fail/exception/traceback/bug/why does`) co-occur with the rust trigger set, OR when any
`error_pattern` above appears verbatim in the pasted compiler output.

## HOW TO USE THIS PLAYBOOK
1. Read the FULL `rustc` block, not just the first line. The error code (`E0xxx`), the primary span, the `note:` and
   `help:` lines together pin the cause. `rustc --explain E0382` gives the canonical writeup.
2. Match the error to a section below by code or message substring.
3. Apply the smallest ownership/lifetime/type change that resolves it WITHOUT violating an anti-failure rule.
4. Re-run `cargo check` (fast gate). Repeat. Only `cargo build` when `check` is clean.

---

## E0382 — "borrow of moved value" / "use of moved value"
**Message shape:** `error[E0382]: use of moved value: \`x\`` after a non-`Copy` value was moved.
**Cause:** a value with move semantics was consumed (passed by value, assigned, or returned) and then used again.
**Fixes, in order of preference:**
- Borrow instead of move: change the callee to take `&T` / `&mut T`, or pass `&x`.
- Restructure so the last use is the move (reorder statements).
- If two independent owners are genuinely needed, `x.clone()` — and justify the clone (it is a real cost).
- For `Copy` types this never fires; if you expected `Copy`, derive it: `#[derive(Clone, Copy)]`.
**Trap:** cloning everywhere to silence E0382 is the clone-spam anti-pattern — see `rust_anti_failure`.

## E0502 — "cannot borrow as mutable because also borrowed as immutable"
**Message shape:** `error[E0502]: cannot borrow \`v\` as mutable because it is also borrowed as immutable`.
**Cause:** an active shared borrow (`&v`) overlaps with an exclusive borrow (`&mut v`). Classic with
`v.push(v[0])` or holding an iterator over a collection while mutating it.
**Fixes:**
- Shrink the borrow's scope: compute the immutable read into a local `let first = v[0];` BEFORE the mutable op.
- Split the borrow: index/`split_at_mut`, or copy the needed value out first.
- Use indices instead of references inside loops that mutate the container.
- For shared-mutable-by-design, move to `RefCell`/`Mutex` — but that is a design change, not a patch.

## "cannot borrow ... as mutable, as it is not declared as mutable"
**Cause:** `let x = ...;` then `x.mutate()` or `&mut x`. Binding is immutable by default.
**Fix:** `let mut x = ...;`. If the value is behind `&`, the reference itself must be `&mut`.

## E0597 / "does not live long enough"
**Message shape:** `error[E0597]: \`tmp\` does not live long enough` — a reference outlives the value it points to.
**Cause:** returning or storing a reference into data that drops at end of scope; or a temporary borrowed past its life.
**Fixes:**
- Return owned data (`String`/`Vec`) instead of a borrow, OR tie the output lifetime to an input: `fn f<'a>(s: &'a str) -> &'a str`.
- Bind the temporary to a `let` so it lives long enough: `let owned = make(); let r = &owned;`.
- Don't store short-lived borrows in long-lived structs; store owned data or `Arc`.
- Reach for explicit lifetime params only when the relationship is real — over-annotating creates "lifetime soup" (anti-failure).

## E0308 — "mismatched types"
**Message shape:** `error[E0308]: mismatched types  expected \`X\`, found \`Y\``.
**Cause / fixes by pair:**
- `expected String, found &str` → `.to_string()` / `.to_owned()` / `String::from`.
- `expected &str, found String` → borrow with `&s` or `s.as_str()`.
- `expected u64, found i32` (etc.) → cast `as u64` or fix the literal type; beware lossy casts.
- `expected (), found <T>` → a trailing expression where a statement was wanted (stray missing `;`), or vice-versa.
- `expected Result<_, _>, found <T>` → wrap with `Ok(..)`, or you forgot `?` on a `Result`-returning call.
- Future-typed mismatch under async → you forgot `.await` (a `Future`, not its `Output`, is in hand).

## "the trait bound `T: Trait` is not satisfied"
**Message shape:** `error[E0277]: the trait bound \`Foo: Display\` is not satisfied`.
**Cause:** a generic/dyn call requires a trait the concrete type does not implement.
**Fixes:**
- Add the bound where the function is generic: `fn show<T: std::fmt::Display>(t: T)`.
- `derive` the trait if derivable: `#[derive(Debug, Clone, PartialEq)]`. `Display` is NOT derivable — implement it.
- For serde: `#[derive(Serialize, Deserialize)]` and ensure the `derive` feature is on.
- For `?` on a foreign error: implement `From<OtherErr>` for your error (or use `thiserror` `#[from]`, or `anyhow`).
- `dyn Trait` needs object safety; if the trait has generic methods it can't be `dyn` — use an enum or generics instead.

## "future cannot be sent between threads safely" / `Send`/`Sync` errors
**Cause:** a non-`Send` value (e.g. `Rc`, `RefCell`, a `MutexGuard`) is held across an `.await` inside a `tokio::spawn`ed task.
**Fixes:**
- Don't hold a `std::sync::MutexGuard` across `.await`; use `tokio::sync::Mutex`, or drop the guard before awaiting.
- Replace `Rc<RefCell<T>>` with `Arc<Mutex<T>>` / `Arc<RwLock<T>>` for cross-thread shared state.
- Confine non-`Send` work to a block that ends before any await point.

## RUNTIME (not compile) FAILURES
- **`thread 'main' panicked ... called \`Option::unwrap()\` on a \`None\` value`** → an `unwrap`/`expect` hit the bad case.
  Replace with `?`, `match`, `if let`, or `unwrap_or(_else/_default)`. This is the #1 `rust_anti_failure` violation.
- **`index out of bounds`** → use `.get(i)` returning `Option`, validate length first.
- **Tokio hang / "tasks not making progress"** → a blocking call on an async task (sync I/O, `std::thread::sleep`, CPU loop).
  Move it to `spawn_blocking` or use the async equivalent. See `tool_execution` anti-failure.
- **`RUST_BACKTRACE=1`** on the run command to get the panic stack.

## ESCALATION
If three diagnosis cycles do not clear the error, capture the minimal failing snippet and hand back to `rust_build`
for a structural redesign (often the ownership model itself is wrong). Conflict-resolution and escalation rules:
see CROSS-REFERENCES.

## CROSS-REFERENCES
- [rust_build](../build/rust_build.md) — pair skill; ownership/error/async patterns that PREVENT these errors at write time.
- [rust_anti_failure](../../prototyping/anti_failure/rust_anti_failure.md) — rank-1 rules a fix must not violate (no unwrap, no blocking-in-async).
- [map_rust](../../maps/rust.md) — domain map locating the borrow checker, lifetimes, and trait system in context.
- [error_handling_patterns](../../prototyping/func_encyclopedia/error_handling_patterns.md) — canonical Result/`?`/`From` conversions referenced in E0277/E0308 fixes.
- [error_routing](../rules/error_routing.md) — how an error string is routed to this debug skill via error_patterns.

## END OF SKILL
