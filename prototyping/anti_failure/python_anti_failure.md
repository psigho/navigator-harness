---
skill_id: python_anti_failure
type: prototype
category: anti_failure
triggers:
  keywords: [python, py, pip, venv, pytest, asyncio, pandas, script]
  extensions: [.py]
  languages: [python]
pairs_with: python_build
priority: 100
description: Known Python failure patterns, the prevention rules that block them, and a pre-delivery review checklist.
---

# PYTHON ANTI-FAILURE RULES

**Rank-1 authority.** In the Navigator 9-rank conflict order, anti-failure rules win over
everything — user convenience, build skills, reference files. When this skill conflicts with a
build instruction, **this skill wins**, and the agent must say so. `python_build` and `python_debug`
both declare `depends_on: [python_anti_failure]`; the runtime loads these rules into the working set
before any python code is generated or repaired.

Each rule below is `AF-N` and is cited by id from the build and debug skills. The format is:
**pattern observed → rule → why**.

---

## AF-1 — Error handling is required on every fallible call

**Pattern:** an uncaught exception reaches the user as a raw traceback.
**Rule:** every call that can raise — file I/O, network, parsing, dict/list indexing, type
coercion, subprocess — is wrapped in a `try/except` that handles a **specific** exception, or is
deliberately allowed to propagate to a single documented top-level handler.
**Why:** an unhandled fallible call is the single most common Python defect. "It worked on my
input" is not coverage.

```python
try:
    data = json.loads(raw)
except json.JSONDecodeError as exc:
    raise ConfigError(f"invalid config: {exc}") from exc   # narrow + chained
```

## AF-2 — No bare `except`

**Pattern:** `except:` or `except Exception:` swallowing everything, hiding the real failure and
catching `KeyboardInterrupt`/`SystemExit`.
**Rule:** catch the **narrowest** exception that you can actually handle. Never `except:`. If you
must catch broadly (a top-level supervisor), catch `Exception` (not bare), **log it**, and re-raise
or exit non-zero — never silently `pass`.
**Why:** a bare except turns a loud, locatable bug into a silent wrong answer. It also traps Ctrl-C.

## AF-3 — Bound every await; one event-loop entry point

**Pattern:** a network `await` with no timeout hangs forever; `asyncio.run()` called inside a
running loop raises `RuntimeError`.
**Rule:** every awaitable that touches the network or a subprocess takes an explicit timeout. There
is exactly **one** `asyncio.run()` at the program's top level. Fan-out uses
`asyncio.gather(..., return_exceptions=True)`.
**Why:** unbounded awaits are undetectable hangs in production; double loop-entry is an immediate
crash.

## AF-4 — Validate external input at the boundary

**Pattern:** `KeyError`, `TypeError`, `IndexError` from trusting a file/response/argument that did
not have the assumed shape.
**Rule:** the moment data crosses into your program (CLI arg, file, HTTP body, env var), validate
type, presence, and range **before** using it. Use `.get()` with defaults for optional keys; raise
a clear domain error for required-but-missing.
**Why:** the boundary is the only place you can give a useful error message; ten frames later it is
just a cryptic `KeyError`.

## AF-5 — Pin every direct dependency

**Pattern:** `ImportError: cannot import name ...` or behavior change after an unrelated `pip
install` — an unpinned dep silently moved.
**Rule:** every direct dependency in `pyproject.toml` uses an exact `==` version. Commit a
`requirements.lock` (`pip freeze`) for the full resolved tree.
**Why:** "works today" with a floating range is a time bomb; reproducibility requires exact pins.

## AF-6 — Install local packages editable; isolate in a venv

**Pattern:** `ModuleNotFoundError` for your own package, or polluting the system interpreter.
**Rule:** create a `.venv` for every project; `pip install -e ".[dev]"` so the local package is
importable from anywhere; verify `sys.prefix` is inside `.venv` before installing.
**Why:** the system-vs-venv split is the #1 cause of "it imports for me but not in CI."

## AF-7 — Format and lint on save

**Pattern:** `IndentationError`, `TabError`, undefined-name slips.
**Rule:** run `ruff` (lint) and `black`/`ruff format` (format) before delivery; never mix tabs and
spaces. CI runs `ruff check` as a gate.
**Why:** whitespace and undefined-name errors are entirely preventable by tooling — there is no
excuse for shipping them.

## AF-8 — Type-hint public functions

**Pattern:** `TypeError`/`AttributeError` from signature drift or a forgotten `Optional` narrowing.
**Rule:** annotate every public function's parameters and return type. Run `mypy` (or `pyright`) on
the package. Narrow `Optional` before dereferencing.
**Why:** static types catch the wrong-type and `None`-deref classes before runtime, where the debug
skill would otherwise have to.

## AF-9 — Every recursive function states its base case first

**Pattern:** `RecursionError: maximum recursion depth exceeded`.
**Rule:** write the terminating condition as the first lines of any recursive function; for
unbounded-depth data, prefer iteration. Never raise `sys.setrecursionlimit` to mask a missing base
case.
**Why:** a missing/incorrect base case is a logic bug; raising the limit hides it until it crashes
deeper.

## AF-10 — No side effects at import time

**Pattern:** importing a module opens a file, hits the network, or mutates global state, breaking
tests and tooling.
**Rule:** module top level defines only declarations. All work goes behind functions / `if __name__
== "__main__":`. Tests import the module without triggering I/O.
**Why:** import-time side effects make a module untestable and make tooling (linters, doc builders)
fail unpredictably.

## AF-11 — Close resources deterministically

**Pattern:** leaked file handles / sockets; `ResourceWarning`.
**Rule:** acquire files, connections, and locks with `with` (context managers). For async,
`async with`. Never rely on the GC to close.
**Why:** leaked resources cause flaky, environment-dependent failures that do not reproduce locally.

---

## PRE-DELIVERY REVIEW CHECKLIST

Run this list against any python artifact before declaring it done. Each item maps to an AF rule and
to a Navigator quality gate.

- [ ] **AF-1** Every file/network/parse/index call is inside a specific `try/except` or has a
      documented top-level handler. (gate 3 — safety)
- [ ] **AF-2** Zero bare `except:`; no broad `except Exception` that silently `pass`es. (gate 3)
- [ ] **AF-3** Every network/subprocess await has a timeout; exactly one `asyncio.run()`. (gate 2)
- [ ] **AF-4** All external inputs validated at the boundary; optional dict keys use `.get`. (gate 2)
- [ ] **AF-5** Every direct dependency pinned `==`; `requirements.lock` present. (gate 2)
- [ ] **AF-6** `.venv` used; local package installed `-e`; `sys.prefix` verified. (gate 2)
- [ ] **AF-7** `ruff check` clean; consistent formatting; no tab/space mix. (gate 1)
- [ ] **AF-8** Public functions type-hinted; `mypy`/`pyright` clean. (gate 2)
- [ ] **AF-9** Recursive functions have a base case first, or are iterative. (gate 2)
- [ ] **AF-10** No import-time side effects; tests import cleanly. (gate 1)
- [ ] **AF-11** All resources acquired via `with` / `async with`. (gate 3)
- [ ] **Tests** At least one happy-path and one failure-path pytest case; `python -m pytest -q` green. (gate 1)
- [ ] **No stubs** Zero `TODO` / `...` / `pass`-as-placeholder in delivered code. (gate 1)

A failed checkbox is a **blocking** defect: do not deliver until it is green or the deviation is
explicitly justified to the user (gate 5 — compliance).

## CROSS-REFERENCES

- [python_build](../../skills/build/python_build.md) — the build skill that must satisfy every AF rule above.
- [python_debug](../../skills/debug/python_debug.md) — debug playbook; each signature section cites the AF rule it implies.
- [map_python](../../maps/python.md) — domain map; shows anti-failure as the rank-1 layer over python skills.
- [error_handling_patterns](../func_encyclopedia/error_handling_patterns.md) — concrete try/except and result-type shapes that implement AF-1/AF-2.
- [cli_patterns](../func_encyclopedia/cli_patterns.md) — exit-code and signal handling that implements AF-1 at the CLI boundary.
- [context_budget](context_budget.md) — sibling anti-failure rule for token-budget discipline.

## END OF SKILL
