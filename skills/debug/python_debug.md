---
skill_id: python_debug
type: debug
category: null
triggers:
  keywords: [python, py, error, traceback, exception, crash, fix, broken, fail, bug]
  extensions: [.py]
  error_patterns: ["Traceback (most recent call last)", "ModuleNotFoundError", "IndentationError", "TypeError", "AttributeError", "ImportError", "KeyError", "RuntimeError: asyncio.run() cannot be called from a running event loop"]
  languages: [python]
pairs_with: python_build
depends_on: [python_anti_failure]
priority: 30
description: Signature-keyed diagnosis playbook for Python failures, each entry pointing at the prevention rule it implies.
---

# PYTHON DEBUG SKILL

Fires when Navigator resolves intent to **DEBUG** in the `python` domain (router words: error, fix,
crash, broken, fail, exception, traceback, bug, why does). Debug skills are **rank 4** — they
outrank build/reference skills but yield to anti-failure rules and explicit user instructions.

## HOW TO USE THIS PLAYBOOK

1. **Read the LAST line of the traceback first.** Python puts the exception type and message there;
   everything above is the call path. The exception type is your index key below.
2. **Match the signature** to a section. Each section gives: what it means, the fast diagnosis,
   the fix, and the **prevention rule** in `python_anti_failure` that would have stopped it.
3. **Reproduce before fixing.** A fix you cannot trigger is a guess. Get a minimal repro, then edit.
4. **After the fix, add the regression test** (the bug becomes a pytest case) — see `python_build`.

The error_patterns in the manifest are exactly the substrings the router scans incoming error text
for, so pasting a raw traceback routes straight here.

---

## SIGNATURE: `Traceback (most recent call last)`

The generic envelope of every uncaught exception. Triage:
- Jump to the final line for the exception class — switch to that section below.
- Read frames **bottom-up**: the bottom frame is where it raised, the top is your entry point.
- The frame just above the raise, inside *your* code, is usually the real fix site even if the
  raise happens deep in a library.
- **Prevention:** AF-1 (handle every fallible call) — an uncaught traceback reaching the user means
  a fallible call escaped its handler.

## SIGNATURE: `ModuleNotFoundError: No module named 'X'`

Meaning: the import system could not locate package `X` on `sys.path`.
Diagnosis, in order:
1. Are you in the right venv? `python -c "import sys; print(sys.prefix)"` must point inside `.venv`.
2. Is it installed there? `python -m pip show X`. If empty, `pip install` ran against a different
   interpreter (classic system-vs-venv split).
3. Is it a **local** module not on the path? With src layout you must `pip install -e .` so the
   package is importable; running a bare script from the wrong cwd will not find `src/`.
4. Name vs import mismatch: the install name and import name can differ (`pip install pillow` →
   `import PIL`).
**Fix:** activate the venv, `pip install -e ".[dev]"`, re-run. **Prevention:** AF-5 (pin + install
into an explicit venv) and AF-6 (install editable for local packages).

## SIGNATURE: `ImportError: cannot import name 'Y' from 'X'`

The package exists but the symbol does not — almost always a **version mismatch** (the API moved or
was renamed) or a **circular import**.
**Fix:** check the installed version against the code's expectation (`pip show X`); pin it. For
circular imports, defer the import inside the function or restructure so the cycle breaks.
**Prevention:** AF-5 (pin exact versions) — unpinned deps cause silent API drift.

## SIGNATURE: `IndentationError` / `TabError`

Python's block structure is whitespace. Causes: mixed tabs and spaces, a misaligned `else`/`except`,
or a body that is empty where a statement was expected.
**Fix:** run the file through `python -m py_compile file.py` to get the exact line; convert tabs to
4 spaces uniformly. **Prevention:** AF-7 (lint/format on save — `ruff`/`black` make this class of
error impossible).

## SIGNATURE: `TypeError`

The operation got an object of the wrong type, or a call got wrong/missing args. Common shapes:
- `TypeError: 'NoneType' object is not subscriptable` → a function returned `None` (often a missing
  `return`, or a method that mutates in place and returns `None` like `list.sort()`).
- `TypeError: f() missing 1 required positional argument` → signature/caller drift.
- `unsupported operand type(s)` → mixing `str` and `int`, often unparsed input.
**Fix:** print/inspect the actual type at the failing line; validate or coerce inputs at the
boundary. **Prevention:** AF-4 (validate external input at the boundary) and AF-8 (type-hint public
functions so the mismatch is caught statically).

## SIGNATURE: `AttributeError: 'T' object has no attribute 'a'`

The object is not what you think it is. Top causes:
- It is `None` (`AttributeError: 'NoneType' object has no attribute ...`) — a prior call returned
  `None` and you chained off it.
- Typo in the attribute name.
- Wrong version of a library where the attribute moved.
**Fix:** at the failing line, `print(type(obj), obj)` to confirm identity; guard against `None`
returns explicitly. **Prevention:** AF-1 (handle the failing call) + AF-8 (type hints surface the
`Optional` you forgot to narrow).

## SIGNATURE: `KeyError: 'k'`

A dict lookup for a key that is absent. **Fix:** use `.get('k', default)` when absence is valid, or
validate the schema when it is not. **Prevention:** AF-4 — never index untrusted/external data
without checking membership first.

## SIGNATURE: `RuntimeError: asyncio.run() cannot be called from a running event loop`

You called `asyncio.run()` from inside code already running under a loop (e.g. a Jupyter cell or a
framework that owns the loop). **Fix:** `await` the coroutine directly, or use the existing loop;
reserve `asyncio.run()` for the single top-level entry point. **Prevention:** AF-3 (one loop entry,
bounded awaits) from `python_build`'s async rules.

## SIGNATURE: `RecursionError: maximum recursion depth exceeded`

A base case is never hit, or the recursion is genuinely too deep. **Fix:** verify the terminating
condition; convert to an iterative form for deep data. Do **not** just raise the recursion limit —
that masks the missing base case. **Prevention:** AF-9 (every recursive function states its base
case first).

---

## GENERAL DIAGNOSIS LOOP

1. Reproduce with the smallest input that still fails.
2. Read the final traceback line → index into the matching section.
3. Inspect actual types/values at the raise site (`print(type(x), x)` or a breakpoint).
4. Apply the section's fix.
5. Add a pytest regression test that fails before / passes after.
6. Re-run the full suite (`python -m pytest -q`) — a local fix must not break a sibling.

## QUALITY GATES FOR A DEBUG DELIVERY

1. **Completeness** — root cause named, not just symptom suppressed.
2. **Correctness** — repro confirmed, fix verified against it.
3. **Safety** — the fix adds the missing handler/validation, it does not widen an `except` to hide it.
4. **Citation** — exception semantics match `python_stdlib_reference.md`.
5. **Compliance** — a regression test accompanies the fix.

## CROSS-REFERENCES

- [python_build](../build/python_build.md) — paired build skill; the fix usually ends by adding a test there.
- [python_anti_failure](../../prototyping/anti_failure/python_anti_failure.md) — the AF-N rules every section cites; the prevention authority.
- [map_python](../../maps/python.md) — domain map locating which skill owns which failure class.
- [error_handling_patterns](../../prototyping/func_encyclopedia/error_handling_patterns.md) — the correct try/except shapes to apply, not bare-except suppression.
- [python_stdlib_reference](../../prototyping/dev_reference/python_stdlib_reference.md) — exception-type semantics for citation.

## END OF SKILL
