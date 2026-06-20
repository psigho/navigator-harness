---
skill_id: python_build
type: build
category: null
triggers:
  keywords: [python, py, pip, venv, pytest, asyncio, pandas, script]
  extensions: [.py]
  languages: [python]
pairs_with: python_debug
depends_on: [python_anti_failure]
priority: 20
description: Construct production-grade Python programs, modules, CLIs, and async code with disciplined layout, dependency hygiene, and pytest coverage.
---

# PYTHON BUILD SKILL

Authoritative procedure for the Navigator router when intent resolves to **BUILD** in the
`python` domain (router trigger words: build, create, write, make, implement, generate, add).
This skill is rank-5 authority (build skill). It is **outranked** by `python_anti_failure`
(rank 1) — load that skill's prevention rules into the working set BEFORE emitting any code.

## WHEN THIS SKILL FIRES

Router matches on keyword overlap with the python set above plus a BUILD intent word.
Examples that route here:
- "write a python CLI that ingests a CSV and prints summary stats"
- "create an asyncio worker pool"
- "make a pip-installable package with pytest tests"

If the request contains a DEBUG word (error, traceback, crash, fix), intent priority sends it
to `python_debug` instead — see CROSS-REFERENCES.

## DECISION ORDER (follow top to bottom)

1. **Classify the artifact.** One of: single script, importable module, installable package,
   CLI, async service, data pipeline. The artifact class fixes the layout (next section).
2. **Pin the runtime.** State the target Python (3.11+ unless told otherwise). Never assume the
   interpreter on PATH; the build must declare `requires-python` in `pyproject.toml`.
3. **Establish isolation.** A venv is mandatory for anything with third-party deps. Emit the
   exact create/activate commands for the user's platform.
4. **Write the smallest correct skeleton**, then fill it. Every fallible call gets error handling
   per `python_anti_failure` rule AF-1. No bare `except`.
5. **Add tests in the same pass.** Code without a pytest file fails quality gate 1 (completeness).
6. **Self-review against the anti-failure checklist** before declaring done.

## PROJECT LAYOUT (src layout — the default)

```
myproject/
├── pyproject.toml          # single source of build + dep metadata (PEP 621)
├── README.md
├── src/
│   └── myproject/
│       ├── __init__.py     # exports the public API surface
│       ├── __main__.py     # enables `python -m myproject`
│       ├── cli.py          # argument parsing only; delegates to core
│       └── core.py         # business logic, no I/O side effects at import
└── tests/
    ├── conftest.py         # shared fixtures
    └── test_core.py
```

Rationale for **src/** layout: it makes the installed package — not the working directory — the
thing under test. This catches missing-package-data and import-shadowing bugs that a flat layout
hides. (A flat layout silently imports from cwd, so `pytest` passes even when the wheel is broken.)

### Minimal `pyproject.toml`

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "myproject"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "httpx==0.27.2",     # PINNED — see python_anti_failure AF-5
]

[project.scripts]
myproject = "myproject.cli:main"

[project.optional-dependencies]
dev = ["pytest==8.3.3", "pytest-asyncio==0.24.0"]
```

## DEPENDENCY & VENV DISCIPLINE

```bash
python -m venv .venv
# Linux/macOS:
source .venv/bin/activate
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
python -m pip install -U pip
python -m pip install -e ".[dev]"
```

Hard rules (enforced by `python_anti_failure`):
- **Pin every direct dependency** to an exact `==` version. Ranges drift; a passing build today
  becomes a `ModuleNotFoundError` or signature mismatch tomorrow.
- **Never** `pip install` into the system interpreter. If `which python` points outside `.venv`,
  stop and re-activate.
- Record the resolved set with `pip freeze > requirements.lock` for reproducible CI.

## CONSTRUCTING A CLI

Keep parsing thin; push logic into a testable pure function.

```python
# src/myproject/cli.py
import argparse
import sys
from . import core


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="myproject", description="Summarize a CSV.")
    p.add_argument("path", help="input CSV path")
    p.add_argument("-c", "--column", required=True, help="numeric column to summarize")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        stats = core.summarize(args.path, args.column)
    except FileNotFoundError:
        print(f"error: no such file: {args.path}", file=sys.stderr)
        return 2
    except core.ColumnError as exc:        # specific, not bare except (AF-2)
        print(f"error: {exc}", file=sys.stderr)
        return 3
    print(core.format_stats(stats))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

The `main(argv)` signature with an explicit return code is what makes the CLI unit-testable
without a subprocess. See `prototyping/func_encyclopedia/cli_patterns.md` for the full pattern set
(subcommands, `--version`, exit-code contract, `KeyboardInterrupt` handling).

## CONSTRUCTING ASYNC CODE

```python
import asyncio
from collections.abc import Iterable


async def fetch_one(client, url: str) -> dict:
    resp = await client.get(url, timeout=10.0)   # always bound the await (AF-3)
    resp.raise_for_status()
    return resp.json()


async def fetch_all(urls: Iterable[str]) -> list[dict]:
    import httpx
    async with httpx.AsyncClient() as client:
        tasks = [fetch_one(client, u) for u in urls]
        # return_exceptions keeps one failure from cancelling the batch
        results = await asyncio.gather(*tasks, return_exceptions=True)
    return [r for r in results if not isinstance(r, Exception)]
```

Async rules: one `asyncio.run()` at the top level only; never call it from inside a running loop
(that raises `RuntimeError: asyncio.run() cannot be called from a running event loop` — a signature
`python_debug` keys on). Always set a timeout on every network await. Use `asyncio.gather` with
`return_exceptions=True` for fan-out so a single failure does not sink the whole batch.

## TESTING WITH PYTEST

```python
# tests/test_core.py
import pytest
from myproject import core


def test_summarize_happy_path(tmp_path):
    csv = tmp_path / "d.csv"
    csv.write_text("x\n1\n2\n3\n")
    stats = core.summarize(str(csv), "x")
    assert stats.mean == pytest.approx(2.0)


def test_summarize_missing_column(tmp_path):
    csv = tmp_path / "d.csv"
    csv.write_text("x\n1\n")
    with pytest.raises(core.ColumnError):
        core.summarize(str(csv), "nope")
```

Test discipline:
- Use the `tmp_path` fixture for filesystem tests — never write into the repo or `/tmp` directly
  (Windows has no `/tmp`).
- Assert on **behavior and error type**, not on log strings.
- For async, mark with `@pytest.mark.asyncio` (requires `pytest-asyncio`).
- Run with `python -m pytest -q`. Coverage of the happy path AND at least one failure path is the
  minimum to clear quality gate 1.

## QUALITY GATES (must pass before delivery)

1. **Completeness** — code + tests + a runnable command. No `...` / `TODO` left in.
2. **Correctness** — imports resolve in the declared venv; `python -m pytest` is green.
3. **Safety** — every fallible call handled; no bare `except`; deps pinned (`python_anti_failure`).
4. **Citation** — stdlib/3rd-party APIs referenced match `prototyping/dev_reference/python_stdlib_reference.md`.
5. **Compliance** — layout and naming match this skill; CLI exposes the documented exit-code contract.

## CROSS-REFERENCES

- [python_anti_failure](../../prototyping/anti_failure/python_anti_failure.md) — rank-1 prevention rules this build MUST satisfy; load first.
- [python_debug](../debug/python_debug.md) — paired debug skill; route here when an error signature appears.
- [map_python](../../maps/python.md) — domain map: which skill owns which python concern.
- [error_handling_patterns](../../prototyping/func_encyclopedia/error_handling_patterns.md) — canonical try/except and result-type patterns referenced above.
- [cli_patterns](../../prototyping/func_encyclopedia/cli_patterns.md) — full CLI scaffolding (subcommands, exit codes, signals).
- [python_stdlib_reference](../../prototyping/dev_reference/python_stdlib_reference.md) — stdlib API citations for quality gate 4.

## END OF SKILL
