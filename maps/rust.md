---
skill_id: map_rust
type: map
category: null
triggers:
  keywords: [rust, cargo, crate, rustc, tokio, borrow, lifetime, trait]
  extensions: [.rs]
  languages: [rust]
priority: 10
description: Phase-based terrain map for Rust work — routes toolchain, ownership, and release phases to the right build/debug/anti-failure skill.
---

# DOMAIN MAP — RUST

This map is the **domain terrain** Navigator walks when a request resolves to the Rust domain
(router intent BUILD/DEBUG/PROJECT against the `rust` keyword set). It decomposes a Rust
deliverable into six sequential phases. Each phase is an **engagement-mode terrain checkpoint**:
the engagement engine announces the phase, names the active skill, and advances only when the
phase's exit criteria pass.

Rust is special among the demo domains because **the borrow checker is a compile-time quality
gate** — Phase 3 (Ownership Model) is not optional polish, it is a hard gate the compiler
enforces before Phase 4 can produce a runnable binary. Treat `cargo build` failures here as
terrain, not as defeat: the paired debug skill is designed for exactly these messages.

Authority: rank-8 (domain map). It governs *phase order*; rank-5 [rust_build](../skills/build/rust_build.md)
governs *concrete instructions*; rank-1 [rust_anti_failure](../prototyping/anti_failure/rust_anti_failure.md)
holds veto over unsafe shortcuts.

## PHASE FLOW

```
[1] Toolchain --> [2] Crate Layout --> [3] Ownership Model --> [4] Implement --> [5] Test/Bench --> [6] Release
   rustup/edition     Cargo.toml         borrow/lifetimes      tokio/traits     cargo test       cargo build --release
```

The Ownership-Model gate (3) sits *before* Implement (4) deliberately: in Rust you design the
ownership graph first, then fill in logic, because retrofitting ownership is the costliest rework.

---

## PHASE 1 — TOOLCHAIN

**Goals**
- A pinned toolchain (`rust-toolchain.toml`) and a declared edition (`edition = "2021"`).
- `cargo --version` / `rustc --version` reproducible across machines; `clippy` + `rustfmt` present.

**Techniques**
- `rustup` for toolchain management; pin the channel (`stable`/a dated nightly) per repo.
- Add `clippy` and `rustfmt` components; wire them as gates, not afterthoughts.

**Common pitfalls**
- Edition mismatch → syntax that compiles on one machine, not another.
- Relying on a globally-installed nightly feature without pinning it.

**Active skills & references**
- Build: [rust_build](../skills/build/rust_build.md) (`rust_build`) — toolchain bootstrap.
- Debug: [rust_debug](../skills/debug/rust_debug.md) (`rust_debug`) — toolchain/edition errors.
- Anti-failure: [rust_anti_failure](../prototyping/anti_failure/rust_anti_failure.md) (`rust_anti_failure`).

**Exit criteria:** `cargo build` on an empty `main` succeeds; clippy and fmt run clean.

---

## PHASE 2 — CRATE LAYOUT

**Goals**
- A coherent crate/module tree: `src/main.rs` or `src/lib.rs`, `mod` declarations, a workspace if multi-crate.
- Dependencies declared with explicit version requirements and feature flags.

**Techniques**
- Library-first: put logic in `lib.rs`, keep `main.rs` a thin binary shim — mirrors Python's src layout.
- Workspaces (`[workspace]`) for multi-crate projects; share a lockfile.
- Enable only the crate features you use (`tokio = { version = "1", features = ["rt-multi-thread", "macros"] }`).

**Common pitfalls**
- Over-broad feature flags pulling in heavy transitive deps and slowing builds.
- Module visibility confusion (`pub`/`pub(crate)`) surfacing as "private item" errors.

**Active skills & references**
- Build: [rust_build](../skills/build/rust_build.md) (`rust_build`) — module/workspace scaffold.
- ISA: [system_architecture](../prototyping/isa_diagrams/system_architecture.md).
- Wiring: [component_interaction](../prototyping/wiring_diagrams/component_interaction.md).

**Exit criteria:** crate tree compiles; modules resolve; features minimal and intentional.

---

## PHASE 3 — OWNERSHIP MODEL  (HARD GATE)

**Goals**
- A clear ownership graph: who owns what, what is borrowed, where lifetimes are needed.
- The borrow checker passes — the compile-time correctness gate is green.

**Techniques**
- Prefer borrowing (`&T`/`&mut T`) over cloning; reach for `Clone`/`Arc` only with a reason.
- Use lifetimes to relate references, not to silence the compiler; `'static` is a claim, not a fix.
- Interior mutability (`RefCell`/`Mutex`) is a deliberate design choice, not a default escape hatch.
- `Arc<Mutex<T>>` for shared mutable state across `tokio` tasks — and only then.

**Common pitfalls**
- "cannot borrow as mutable more than once" → restructure scopes, don't reach for `unsafe`.
- "borrowed value does not live long enough" → lift ownership up or introduce a lifetime.
- Clone-spamming to dodge the checker — masks a real ownership-design problem.

**Active skills & references**
- Debug: [rust_debug](../skills/debug/rust_debug.md) (`rust_debug`) — E0502/E0597/E0382 borrow errors.
- Anti-failure: [rust_anti_failure](../prototyping/anti_failure/rust_anti_failure.md) (`rust_anti_failure`) — bans gratuitous `unsafe`.
- Pattern: [error_handling_patterns](../prototyping/func_encyclopedia/error_handling_patterns.md) (`Result`/`?` idioms).

**Exit criteria:** `cargo check` passes; no `unsafe` introduced solely to satisfy the checker.

---

## PHASE 4 — IMPLEMENT

**Goals**
- Working logic over the now-valid ownership graph: traits, generics, async tasks, `Result`-based errors.

**Techniques**
- Errors via `Result<T, E>` + `?`; model error types with `thiserror`, propagate at boundaries with `anyhow`.
- Trait-based polymorphism; generics with bounds over `dyn` unless you need a trait object.
- `tokio`: spawn tasks for real concurrency; never block the runtime with sync I/O.

**Common pitfalls**
- `.unwrap()`/`.expect()` on fallible paths in production code (anti-failure veto).
- Holding a `Mutex` guard across an `.await` — deadlock/contention risk.

**Active skills & references**
- Build: [rust_build](../skills/build/rust_build.md) (`rust_build`).
- Debug: [rust_debug](../skills/debug/rust_debug.md) (`rust_debug`) — trait-bound/async errors.
- Pattern: [error_handling_patterns](../prototyping/func_encyclopedia/error_handling_patterns.md) (`error_handling_patterns`).

**Exit criteria:** binary runs the happy path; fallible paths return `Result`, not `unwrap`.

---

## PHASE 5 — TEST / BENCH

**Goals**
- `cargo test` covering happy + error paths; benchmarks where performance is a stated requirement.

**Techniques**
- Inline `#[cfg(test)] mod tests` for units; `tests/` dir for integration across the public API.
- `#[tokio::test]` for async; `criterion` for statistically sound benchmarks.
- Assert error variants, not just `is_err()`.

**Common pitfalls**
- Benchmarking debug builds — always bench `--release`.
- Async tests that never `.await` the future under test.

**Active skills & references**
- Build: [rust_build](../skills/build/rust_build.md) (`rust_build`) — test/bench scaffold.
- Debug: [rust_debug](../skills/debug/rust_debug.md) (`rust_debug`).
- Quality gates: [quality_gates](../skills/rules/quality_gates.md) (gate 1, gate 2).

**Exit criteria:** `cargo test` green; error variants asserted; benches (if required) run in release.

---

## PHASE 6 — RELEASE

**Goals**
- An optimized, reproducible artifact: `cargo build --release` → a binary or a publishable crate.

**Techniques**
- `--release` enables optimizations; verify the release binary, not just the debug one.
- Tune `[profile.release]` (`lto`, `codegen-units`) only with measured justification.
- For libraries: `cargo publish --dry-run` before tagging.

**Common pitfalls**
- Shipping the debug binary; behavior/perf divergence vs the release profile.
- Forgetting `Cargo.lock` commit for binaries (it should be committed for reproducibility).

**Active skills & references**
- Build: [rust_build](../skills/build/rust_build.md) (`rust_build`) — release section.
- Anti-failure: [build_integrity](../prototyping/anti_failure/build_integrity.md) (`build_integrity`).
- Build order: [example_cli_tool](../prototyping/build_orders/example_cli_tool.md).

**Exit criteria:** `cargo build --release` succeeds; release binary verified; lockfile committed.

## CROSS-REFERENCES
- [rust_build](../skills/build/rust_build.md) — `rust_build`: concrete build steps for every phase.
- [rust_debug](../skills/debug/rust_debug.md) — `rust_debug`: paired debug skill; owns borrow-checker errors.
- [rust_anti_failure](../prototyping/anti_failure/rust_anti_failure.md) — `rust_anti_failure`: bans gratuitous `unsafe`/`unwrap`.
- [error_handling_patterns](../prototyping/func_encyclopedia/error_handling_patterns.md) — `Result`/`?`/`thiserror` idioms.
- [system_architecture](../prototyping/isa_diagrams/system_architecture.md) — crate/module decomposition.
- [build_integrity](../prototyping/anti_failure/build_integrity.md) — release-artifact verification.
- [routing](../skills/rules/routing.md) — how a request reaches this map.
- [end_to_end_example](../examples/end_to_end_example.md) — a full walk through these phases.

## END OF SKILL
