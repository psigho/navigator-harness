---
skill_id: rust_build
type: build
category: null
triggers:
  keywords: [rust, cargo, crate, rustc, tokio, borrow, lifetime, trait]
  extensions: [.rs]
  languages: [rust]
pairs_with: rust_debug
depends_on: [rust_anti_failure]
priority: 10
description: Construct Rust crates and binaries with disciplined ownership, Result-based errors, and tokio async.
---

# RUST BUILD SKILL

Operator playbook for producing a compiling, idiomatic Rust artifact in one pass. This skill is BUILD-class
(authority rank 5). It defers to `rust_anti_failure` (rank 1) on every safety question and hands off to
`rust_debug` (rank 4) the moment `cargo build` fails. Load this when the router classifies intent as BUILD
on a Rust target (keywords `build/create/write/make/implement/generate/add` co-occurring with the rust trigger set).

## WHEN THIS SKILL FIRES
- New crate or binary scaffold (`cargo new`, `cargo init`, workspace member add).
- Adding a module, trait, async task, or dependency to an existing crate.
- Refactoring ownership/borrowing so the borrow checker accepts the design.
- Wiring a tokio runtime, async fn, or `Result`-returning API surface.

If the prompt instead contains a compiler error string, STOP — that is `rust_debug` territory; see CROSS-REFERENCES.

## CARGO WORKFLOW (the canonical loop)
1. `cargo new <name>` (binary) or `cargo new --lib <name>` (library). Workspaces: add `[workspace] members = [...]` to the root `Cargo.toml`.
2. Declare deps with versions pinned to a minor: `tokio = { version = "1", features = ["full"] }`, `anyhow = "1"`, `thiserror = "1"`, `serde = { version = "1", features = ["derive"] }`.
3. Edit. Then ALWAYS run the fast gate first: `cargo check`. Only run `cargo build` when `check` is clean.
4. Lint gate: `cargo clippy --all-targets -- -D warnings`. Treat clippy warnings as build failures for delivery.
5. Format gate: `cargo fmt --check` (CI) / `cargo fmt` (local fix).
6. Test gate: `cargo test`. For async tests use `#[tokio::test]`.
7. Release artifact only after gates pass: `cargo build --release`.

Never deliver a crate whose `cargo check` you have not run. That is QUALITY GATE 1 (completeness) + GATE 2 (correctness).

## OWNERSHIP & BORROWING DISCIPLINE
The borrow checker is a design constraint, not an obstacle. Encode these rules at WRITE time so `rust_debug` never has to:

- **One owner, many borrows.** A value has exactly one owner; `&T` shares, `&mut T` is exclusive. Never hold a `&mut`
  and any other reference to the same value simultaneously — that is the E0502 shape.
- **Prefer borrowing parameters.** Take `&str` not `String`, `&[T]` not `Vec<T>`, unless the function must own/store the value.
- **Move, then stop using.** After `let b = a;` for a non-`Copy` type, `a` is gone (E0382). Clone explicitly when you truly need two owners: `let b = a.clone();` — and justify the clone.
- **Return owned data from constructors, borrow inside methods.** A method that returns `&self.field` ties the borrow to `&self`.
- **Reach for `Rc<RefCell<T>>` (single-thread) or `Arc<Mutex<T>>` (multi-thread) only when shared mutability is genuinely required** — not as a reflex to dodge the borrow checker. Shared-mutable is the lifetime-soup trap; see `rust_anti_failure`.

## ERROR HANDLING WITH RESULT
- **Libraries** return a concrete error enum via `thiserror`:
  ```rust
  #[derive(thiserror::Error, Debug)]
  pub enum StoreError {
      #[error("key not found: {0}")]
      NotFound(String),
      #[error("io failure")]
      Io(#[from] std::io::Error),
  }
  ```
- **Binaries / application glue** use `anyhow::Result<T>` and `.context("...")` to attach human-readable trail.
- Propagate with `?`. NEVER `.unwrap()` / `.expect()` in library code paths — that is the top entry in the
  `rust_anti_failure` review checklist. `expect("invariant: ...")` is tolerable only for genuine programmer invariants in `main`.
- Convert at boundaries with `#[from]` or `map_err`. Keep the public error surface small and `#[non_exhaustive]` if it may grow.

See `func_encyclopedia/error_handling_patterns.md` for the full Result/Option/`?`/`From` decision matrix.

## ASYNC WITH TOKIO
- Annotate the entrypoint: `#[tokio::main] async fn main() -> anyhow::Result<()> { ... }`. For a fixed pool use
  `#[tokio::main(flavor = "multi_thread", worker_threads = 4)]`.
- `await` every future — a future does nothing until polled. A bare `some_async_call();` is a silent no-op.
- **Never block the async executor.** No `std::thread::sleep`, no synchronous file/network I/O, no CPU-bound loops on an
  async task. Use `tokio::time::sleep`, `tokio::fs`, and offload CPU work with `tokio::task::spawn_blocking`. This is a
  hard `rust_anti_failure` rule — blocking the runtime starves every other task.
- Concurrency primitives: `tokio::spawn` for independent tasks (returns a `JoinHandle`), `tokio::select!` to race,
  `tokio::sync::{mpsc, Mutex, RwLock}` for cross-task state. Prefer message passing over shared locks.
- Cancellation is drop-based: dropping a `JoinHandle` does NOT cancel; use `handle.abort()` or a `CancellationToken`.

## MINIMAL REFERENCE SKELETON
```rust
use anyhow::Context;
use tokio::sync::mpsc;

#[derive(Debug, Clone)]
struct Job { id: u64, payload: String }

async fn worker(mut rx: mpsc::Receiver<Job>) -> anyhow::Result<()> {
    while let Some(job) = rx.recv().await {
        process(&job).await.with_context(|| format!("job {}", job.id))?;
    }
    Ok(())
}

async fn process(job: &Job) -> anyhow::Result<()> {
    // borrow the job, own nothing; real work returns Result and uses `?`
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    if job.payload.is_empty() { anyhow::bail!("empty payload"); }
    Ok(())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let (tx, rx) = mpsc::channel(32);
    let h = tokio::spawn(worker(rx));
    tx.send(Job { id: 1, payload: "x".into() }).await?;
    drop(tx);                 // close channel so worker loop ends
    h.await??;                // join, then propagate worker's Result
    Ok(())
}
```

## DELIVERY GATES (run before declaring done)
- [ ] `cargo check` clean (GATE 1/2).
- [ ] `cargo clippy -- -D warnings` clean (GATE 2).
- [ ] No `unwrap`/`expect`/`panic!` in library code paths (GATE 3, enforced by `rust_anti_failure`).
- [ ] Every `await` point intentional; no blocking call on an async task (GATE 3).
- [ ] Public errors documented; `?` used for propagation (GATE 2/4).
- [ ] `cargo test` green (GATE 1).

On ANY gate failure that is a compiler error, escalate to `rust_debug` rather than guessing.

## CROSS-REFERENCES
- [rust_debug](../debug/rust_debug.md) — pair skill; diagnosis playbook for `cargo build` failures (borrow/lifetime/type errors).
- [rust_anti_failure](../../prototyping/anti_failure/rust_anti_failure.md) — rank-1 safety rules this build must obey (unwrap, blocking-in-async, lifetime soup).
- [map_rust](../../maps/rust.md) — domain map: where crates, traits, async, and error types live in the Rust mental model.
- [error_handling_patterns](../../prototyping/func_encyclopedia/error_handling_patterns.md) — Result/Option/`?`/`From` patterns reused above.
- [cli_patterns](../../prototyping/func_encyclopedia/cli_patterns.md) — argument parsing and exit-code conventions for Rust binaries.
- [routing](../rules/routing.md) — how the router selects BUILD intent and lands here.

## END OF SKILL
