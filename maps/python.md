---
skill_id: map_python
type: map
category: null
triggers:
  keywords: [python, py, pip, venv, pytest, asyncio, pandas, script]
  extensions: [.py]
  languages: [python]
priority: 10
description: Phase-based terrain map for Python work — routes each build phase to the right build/debug/anti-failure skill and reference.
---

# DOMAIN MAP — PYTHON

This map is the **domain terrain** Navigator walks when a request resolves to the Python
domain (router intent BUILD/DEBUG/PROJECT against the `python` keyword set). It decomposes
a Python deliverable into five sequential phases. Each phase is an **engagement-mode terrain
checkpoint**: the engagement engine announces the phase, names the active skill, and only
advances when that phase's exit criteria are met.

Use this file as rank-8 authority (domain map) under the conflict ladder — it is advisory
terrain. Concrete build steps come from rank-5 build skills; safety vetoes come from rank-1
anti-failure rules. When a map phase and a build skill disagree on *order*, the map wins;
when they disagree on *a concrete instruction*, the build skill wins.

## PHASE FLOW

```
[1] Environment Setup --> [2] Project Structure --> [3] Implement --> [4] Test --> [5] Package/Distribute
        venv/pip              src layout            handlers          pytest         wheel / pipx
```

Each arrow is gated. A failing phase routes to the paired debug skill, fixes, then re-enters
the same checkpoint — it does NOT skip forward.

---

## PHASE 1 — ENVIRONMENT SETUP

**Goals**
- A reproducible, isolated interpreter: a `venv` (or `uv`/`virtualenv`) plus a pinned
  dependency manifest (`requirements.txt` / `pyproject.toml`).
- Deterministic `python --version` and a clean `pip list` baseline.

**Techniques**
- `python -m venv .venv` then activate; never install into the system interpreter.
- Pin direct dependencies; let a lock file (`uv.lock`, `pip-tools`) pin transitives.
- Record the interpreter version in `pyproject.toml` (`requires-python = ">=3.11"`).

**Common pitfalls**
- Mixing global and venv packages → `ModuleNotFoundError` for an installed package.
- Activating the wrong venv across shells (PowerShell vs bash activation scripts differ).
- Trusting `pip install` without pinning → non-reproducible builds.

**Active skills & references**
- Build: [python_build](../skills/build/python_build.md) (`python_build`) — env bootstrap section.
- Debug: [python_debug](../skills/debug/python_debug.md) (`python_debug`) — import/venv errors.
- Anti-failure: [python_anti_failure](../prototyping/anti_failure/python_anti_failure.md) (`python_anti_failure`).
- Reference: [python_stdlib_reference](../prototyping/dev_reference/python_stdlib_reference.md).

**Exit criteria:** venv activates, `pip install -e .` (or `-r requirements.txt`) succeeds, imports resolve.

---

## PHASE 2 — PROJECT STRUCTURE

**Goals**
- A `src/` layout (`src/pkg/__init__.py`) that prevents accidental top-level imports.
- An entry point declared in `pyproject.toml` (`[project.scripts]`).

**Techniques**
- Adopt the **src layout** so tests import the installed package, not loose modules.
- Separate concerns: `cli.py` (argparse/click), `core.py` (logic), `io.py` (side effects).
- Keep `__main__.py` thin — parse args, delegate to `core`.

**Common pitfalls**
- Flat layout → tests pass locally but the published wheel is missing modules.
- Circular imports from a god-module; break with dependency-inversion at `core`.

**Active skills & references**
- Build: [python_build](../skills/build/python_build.md) (`python_build`) — layout scaffold.
- Pattern: [cli_patterns](../prototyping/func_encyclopedia/cli_patterns.md) (`cli_patterns`).
- ISA: [system_architecture](../prototyping/isa_diagrams/system_architecture.md).

**Exit criteria:** package importable as `import pkg`; entry point resolves via `python -m pkg`.

---

## PHASE 3 — IMPLEMENT

**Goals**
- Working handlers with explicit error handling and typed signatures.
- No silent `except:` — every catch either handles, re-raises, or logs with context.

**Techniques**
- Type hints + `mypy`/`pyright` as a structural gate.
- `asyncio` only where I/O concurrency is real; never `asyncio.run()` inside a running loop.
- `pandas`: vectorize; avoid `iterrows` on hot paths; assign with `.loc`, not chained indexing.

**Common pitfalls**
- Bare `except Exception: pass` swallowing real failures (anti-failure veto).
- Mutable default args (`def f(x=[])`); blocking calls inside `async def`.

**Active skills & references**
- Build: [python_build](../skills/build/python_build.md) (`python_build`).
- Debug: [python_debug](../skills/debug/python_debug.md) (`python_debug`) — tracebacks, async errors.
- Pattern: [error_handling_patterns](../prototyping/func_encyclopedia/error_handling_patterns.md) (`error_handling_patterns`).
- Anti-failure: [hallucination_guards](../prototyping/anti_failure/hallucination_guards.md), [tool_execution](../prototyping/anti_failure/tool_execution.md).

**Exit criteria:** code runs end-to-end on a happy path; type checker clean; no bare excepts.

---

## PHASE 4 — TEST

**Goals**
- `pytest` suite covering happy path + at least one failure path per public function.
- Deterministic tests (no network/clock dependence without fixtures/mocks).

**Techniques**
- Arrange-Act-Assert; `pytest.raises` for the failure paths Phase 3 introduced.
- Fixtures for setup; `monkeypatch`/`tmp_path` to isolate I/O.
- Coverage as a signal, not a target — assert behavior, not lines.

**Common pitfalls**
- Tests that import from a flat layout (Phase 2 debt surfaces here).
- Hidden ordering dependence between tests; flaky time/UUID assertions.

**Active skills & references**
- Build: [python_build](../skills/build/python_build.md) (`python_build`) — test scaffold.
- Debug: [python_debug](../skills/debug/python_debug.md) (`python_debug`) — fixture/collection errors.
- Quality gates: [quality_gates](../skills/rules/quality_gates.md) (gate 1 completeness, gate 2 correctness).

**Exit criteria:** `pytest` green; failure paths asserted; suite reruns deterministically.

---

## PHASE 5 — PACKAGE / DISTRIBUTE

**Goals**
- A buildable, installable artifact (wheel/sdist) or a `pipx`-installable CLI.

**Techniques**
- `python -m build` → `dist/*.whl`; validate with `pip install dist/*.whl` in a fresh venv.
- Declare metadata once in `pyproject.toml`; verify console scripts post-install.
- For CLIs, prefer `pipx` distribution so the tool gets its own isolated venv.

**Common pitfalls**
- Missing `MANIFEST.in`/`package-data` → data files absent from the wheel.
- Entry point string typo (`pkg.cli:main`) only surfaces after install.

**Active skills & references**
- Build: [python_build](../skills/build/python_build.md) (`python_build`) — packaging section.
- Anti-failure: [build_integrity](../prototyping/anti_failure/build_integrity.md) (`build_integrity`).
- Build order: [example_cli_tool](../prototyping/build_orders/example_cli_tool.md).

**Exit criteria:** clean-venv install succeeds; entry point runs; artifact reproducible.

## CROSS-REFERENCES
- [python_build](../skills/build/python_build.md) — `python_build`: concrete build steps for every phase.
- [python_debug](../skills/debug/python_debug.md) — `python_debug`: paired debug skill, gates each phase.
- [python_anti_failure](../prototyping/anti_failure/python_anti_failure.md) — `python_anti_failure`: rank-1 vetoes.
- [python_stdlib_reference](../prototyping/dev_reference/python_stdlib_reference.md) — stdlib lookup during implement.
- [cli_patterns](../prototyping/func_encyclopedia/cli_patterns.md) — argument-parsing structure for Phase 2/3.
- [error_handling_patterns](../prototyping/func_encyclopedia/error_handling_patterns.md) — Phase 3 try/except idioms.
- [routing](../skills/rules/routing.md) — how a request reaches this map.
- [end_to_end_example](../examples/end_to_end_example.md) — a full Python walk through these five phases.

## END OF SKILL
