---
skill_id: rust_anti_failure
type: prototype
category: anti_failure
triggers:
  keywords: [rust, cargo, crate, rustc, tokio, borrow, lifetime, trait, unwrap, panic]
  extensions: [.rs]
  error_patterns: ["called `Result::unwrap()`", "called `Option::unwrap()`", "blocking", "deadlock"]
  languages: [rust]
  platforms: [cross]
pairs_with: rust_build
priority: 1
description: Rust failure patterns, prevention rules, and a review checklist that outrank build and debug skills.
---

# RUST ANTI-FAILURE RULES

This file is RANK 1 in the 9-rank conflict authority — it wins over user convenience, build skills, and even a
"working" fix from `rust_debug` if that fix re-introduces a banned pattern. The purpose is preventive: encode the
ways Rust code silently or loudly fails, and the rule that stops each one BEFORE it ships. `rust_build` writes
against these; `rust_debug` fixes within these. None of them may be relaxed without an explicit, logged user override.

## THE FAILURE CATALOG (pattern -> why it fails -> the rule)

### 1. `unwrap()` / `expect()` in library code
**Failure:** a `None`/`Err` turns a recoverable condition into a process-wide panic. In a library this hijacks the
caller's error handling and crashes their program.
**Rule:** library and reusable-module code returns `Result`/`Option` and propagates with `?`. Banned: `.unwrap()`,
`.expect()`, `panic!`, `unreachable!`, `todo!`, `unimplemented!`, slice indexing that can panic (`v[i]` on untrusted i),
integer `/`/`%` on possibly-zero divisors. Allowed ONLY in: tests, `examples/`, `build.rs`, and `main` for genuine
startup invariants — and there `expect("invariant: <reason>")` must state the invariant.

### 2. Blocking the async runtime
**Failure:** `std::thread::sleep`, synchronous `std::fs`/`std::net` I/O, or a CPU-bound loop on a tokio task stalls
the executor thread, starving every other task — symptoms: hangs, missed timeouts, "tasks not making progress".
**Rule:** on any async task use `tokio::time::sleep`, `tokio::fs`, `tokio::net`; offload CPU/blocking work with
`tokio::task::spawn_blocking`. Never hold a `std::sync::MutexGuard` across `.await` — use `tokio::sync::Mutex` or drop
the guard first.

### 3. Lifetime soup
**Failure:** reflexively sprinkling `'a` annotations and self-referential structs to dodge the borrow checker yields
code that compiles but is unmaintainable and often unsound to extend.
**Rule:** prefer owned data at struct boundaries; introduce a named lifetime only when an output genuinely borrows an
input. If a struct needs to "hold a reference to its own field", that is the signal to redesign (own the data, or use
`Arc`/an index/an id), not to annotate harder.

### 4. Clone-spam to silence the borrow checker
**Failure:** `.clone()` scattered to make E0382/E0502 disappear hides ownership-model mistakes and adds real
allocation/copy cost on hot paths.
**Rule:** every `.clone()` in non-test code must be defensible ("we need two owners because ..."). First try borrowing,
scoping, or restructuring. Reach for `Rc`/`Arc` for cheap shared ownership before deep-cloning large structures.

### 5. Ignoring `Result` / unused `#[must_use]`
**Failure:** a `let _ = fallible();` or a dropped `Result` swallows errors silently; a missing `.await` makes an async
call a no-op.
**Rule:** handle or propagate every `Result`. Deny the lint: `#![deny(unused_must_use)]`. Treat `cargo clippy -- -D warnings`
as a hard gate. Every `Future` is `.await`ed.

### 6. `unsafe` without an invariant comment
**Failure:** an `unsafe` block whose safety contract is undocumented becomes unauditable UB waiting to happen.
**Rule:** avoid `unsafe` in application code. Where unavoidable, every `unsafe` block carries a `// SAFETY: <why the
invariants hold>` comment, and the surrounding safe API must uphold those invariants. Prefer a vetted crate over hand-rolled `unsafe`.

### 7. Panicking across an FFI / catch boundary; integer/overflow surprises
**Failure:** unwinding across `extern "C"` is UB; release builds wrap on overflow silently (debug builds panic),
causing diverging behavior.
**Rule:** never let a panic cross an FFI boundary (`catch_unwind` at the edge). For arithmetic that can overflow use
`checked_*` / `saturating_*` / `wrapping_*` explicitly rather than relying on build profile.

### 8. Unbounded channels / leaked tasks
**Failure:** `mpsc::unbounded_channel` under backpressure grows memory without limit; spawned tasks whose handles are
dropped run detached and are never joined or cancelled.
**Rule:** prefer bounded `mpsc::channel(n)`. Keep `JoinHandle`s and `.await`/`.abort()` them on shutdown; use a
`CancellationToken` for cooperative cancellation.

## PREVENTION POSTURE (apply at write time)
- Crate-level lints in `lib.rs`/`main.rs`:
  ```rust
  #![deny(unused_must_use)]
  #![warn(clippy::all, clippy::pedantic)]
  #![forbid(unsafe_code)]   // drop to allow(...) only where a documented unsafe block is required
  ```
- Errors modeled with `thiserror` (libraries) / `anyhow` (binaries); public error enums `#[non_exhaustive]`.
- Async tasks are `Send`-clean; no `Rc`/`RefCell`/`MutexGuard` held across `.await`.
- Dependencies pinned; `cargo audit` run on the lockfile for known-vuln crates.

## REVIEW CHECKLIST (gate before merge — maps to QUALITY GATE 3: safety)
- [ ] No `unwrap`/`expect`/`panic!`/`todo!`/`unreachable!` in library code paths (exceptions logged).
- [ ] No blocking call (sync I/O, `thread::sleep`, CPU loop) on any async task.
- [ ] No `std::sync` guard held across `.await`; futures all `.await`ed.
- [ ] Every `.clone()` justified; no clone-spam to appease the borrow checker.
- [ ] No reference stored into a struct's own field; lifetimes annotate real borrows only.
- [ ] Every `Result` handled or propagated; `unused_must_use` denied.
- [ ] Every `unsafe` block has a `// SAFETY:` invariant note; `forbid(unsafe_code)` where possible.
- [ ] Channels bounded; spawned tasks joined or cancelled on shutdown.
- [ ] `cargo clippy -- -D warnings` and `cargo fmt --check` clean.

A failure on any safety checkbox BLOCKS delivery — this skill outranks the build/debug skills that would otherwise call the work "done".

## CROSS-REFERENCES
- [rust_build](../../skills/build/rust_build.md) — pair skill; constructs code that satisfies these rules from the first line.
- [rust_debug](../../skills/debug/rust_debug.md) — diagnosis playbook; its fixes must not violate any rule here.
- [map_rust](../../maps/rust.md) — domain map placing ownership, async, and unsafe in the Rust mental model.
- [error_handling_patterns](../func_encyclopedia/error_handling_patterns.md) — the Result/`?`/`From` patterns that replace banned `unwrap`s.
- [tool_execution](./tool_execution.md) — runtime/execution anti-failures (blocking, hangs) that overlap with rule 2.
- [quality_gates](../../skills/rules/quality_gates.md) — the 5 gates; this file is the engine of GATE 3 (safety).

## END OF SKILL
