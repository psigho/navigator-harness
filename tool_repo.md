---
skill_id: tool_repo
type: custom
category: dev_ref
triggers:
  keywords: [tool, library, resource, install, toolchain, dependency, pip, cargo, curl, availability]
  languages: [all]
  platforms: [cross]
priority: 9
description: Consolidated resource index of demo toolchains with install hints and availability notes; consulted by the router's Stage 4 Resource Check.
---

# TOOL REPO — The Consolidated Resource Index

This is the lowest-authority source in the framework (rank 9). It is not a how-to; it is a
**lookup table of toolchains** the build/debug skills depend on. The master skill consults it
during **Stage 4 (Resource Check)** to confirm a tool exists before starting a build, and to
report missing tools with an install hint instead of crashing mid-step.

Each entry lists: the command the skill invokes, what it is for, how to install it, and an
**availability note** (how the router probes for it). Availability is probed with a cheap
version/`--help` call; the router never assumes presence.

---

## PYTHON TOOLCHAIN  (domain: python)

| Tool | Purpose | Install hint | Availability probe |
|---|---|---|---|
| `python3` | Interpreter; all `.py` execution | OS package / python.org; Windows: `py -3` | `python3 --version` (or `py -V`) |
| `pip` | Package installer | ships with python3; `python3 -m ensurepip` | `python3 -m pip --version` |
| `venv` | Isolated environments | stdlib `python3 -m venv .venv` | `python3 -m venv --help` |
| `pytest` | Test runner used by build test steps | `pip install pytest` | `pytest --version` |
| `ruff` | Lint + format gate | `pip install ruff` | `ruff --version` |

Notes: prefer `python3 -m pip` over a bare `pip` shim (avoids the wrong-interpreter trap).
On Windows the launcher is `py`; the router maps `python3` -> `py -3` when only the launcher
is present. A build step that needs `pytest`/`ruff` but finds them absent is reported at
Stage 4, not at execution — see `prototyping/anti_failure/python_anti_failure.md`.

---

## RUST TOOLCHAIN  (domain: rust)

| Tool | Purpose | Install hint | Availability probe |
|---|---|---|---|
| `rustc` | The compiler | via `rustup` (rustup.rs) | `rustc --version` |
| `cargo` | Build/dep/test driver | bundled with `rustup` | `cargo --version` |
| `clippy` | Lint gate | `rustup component add clippy` | `cargo clippy --version` |
| `rustfmt` | Format gate | `rustup component add rustfmt` | `cargo fmt --version` |

Notes: `cargo` is the single entry point — `cargo build`, `cargo test`, `cargo clippy`. The
router treats a missing `cargo` as a hard block for any rust BUILD path and surfaces the
`rustup` install hint. Toolchain channel (stable/nightly) is recorded if `rust-toolchain.toml`
is present. See `prototyping/anti_failure/rust_anti_failure.md`.

---

## WEB_API TOOLCHAIN  (domain: web_api)

| Tool | Purpose | Install hint | Availability probe |
|---|---|---|---|
| `curl` | Raw HTTP probing of endpoints | OS-bundled on most platforms | `curl --version` |
| `httpie` | Ergonomic HTTP client for manual checks | `pip install httpie` | `http --version` |
| `openapi` tooling | Validate/generate from OpenAPI specs | `pip install openapi-spec-validator` / `npx @redocly/cli` | `openapi-spec-validator --help` |
| (server libs) | FastAPI (py) / express (node) / actix-axum (rust) | `pip install fastapi uvicorn` · `npm i express` · `cargo add axum` | per-domain probe |

Notes: web_api spans all three languages, so the router resolves the *server* toolchain from
the domain of the chosen build skill, but always offers `curl`/`httpie` for endpoint
verification at the quality-gate step. HTTP status semantics used during verification live in
`prototyping/dev_reference/http_status_reference.md`. See
`prototyping/anti_failure/web_api_anti_failure.md`.

---

## AGENT-ISA REFERENCE  (domain: agent / harness)

The execution-ISA subsystem ships runnable references under
`prototyping/agent_isa/reference/`. These are *reference implementations*, not installed
toolchains — the router surfaces them for TOOL/PROTOTYPE lookups about agent loops, gating,
or the VM, and points at the spec docs rather than probing for a binary.

| Tool | Purpose | Install hint | Availability probe |
|---|---|---|---|
| `isa_vm.py` | Reference AGENT-ISA interpreter (the executable spec); runs the F/G-block demos | stdlib only | `python prototyping/agent_isa/reference/isa_vm.py` |
| `vm.zep` | Zephir/Phalcon 1:1 port of the interpreter | `zephir build` (ext skeleton) | source reference (compiled into a PHP ext) |
| `schema.sql` | Postgres storage/audit DDL (programs/instructions/runs/transcript/approvals) | `psql -f …/schema.sql` | source reference |
| `agent_loop.c` | Bare agent loop in C | `gcc agent_loop.c -lcurl -ljansson -o agent` | `curl`, `jansson` present |
| `notify_mcp_server.py` | Minimal MCP server (ntfy notify + read-only status) | `pip install "mcp[cli]" httpx` | `python …/notify_mcp_server.py` (serves :9000) |

Notes: these back the `agent_execution_isa`, `gated_agent_loop`, and `agent_isa_storage` skills.
They describe the runtime the AETERNAE harness uses; see `prototyping/agent_isa/README.md`.

---

## HOW STAGE 4 (RESOURCE CHECK) CONSULTS THIS INDEX

1. The master skill resolves the domain + skill at Stage 3 and reads that skill's required
   tool list (declared via `triggers.extensions`/`depends_on` and the build skill body).
2. For each required tool the master runs the **availability probe** above (cheap, idempotent).
3. **All present** -> proceed to Stage 5 (Execute).
4. **One or more missing** -> the master does NOT start the build. It reports each missing
   tool with its install hint, marks the build step blocked in the active build order, and
   asks the user to install or to approve an auto-install path. This converts a mid-build
   crash into a clean, actionable pre-flight message.
5. Availability results are cached for the session so repeated steps don't re-probe.

Authority reminder: because this index is rank 9, anything it says is overridden by every
other source — it informs the Resource Check, it does not dictate build decisions.

## CROSS-REFERENCES
- [master_skill](master_skill.md) — Stage 4 Resource Check consumer (`master_skill`).
- [quality_gates](skills/rules/quality_gates.md) — gate 1 completeness depends on tools present (`quality_gates`).
- [python_anti_failure](prototyping/anti_failure/python_anti_failure.md) — venv/pip traps (`python_anti_failure`).
- [rust_anti_failure](prototyping/anti_failure/rust_anti_failure.md) — cargo/toolchain traps (`rust_anti_failure`).
- [web_api_anti_failure](prototyping/anti_failure/web_api_anti_failure.md) — server/client traps (`web_api_anti_failure`).
- [http_status_reference](prototyping/dev_reference/http_status_reference.md) — verification status codes (`http_status_reference`).

## END OF SKILL
