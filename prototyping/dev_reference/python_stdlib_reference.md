---
skill_id: ref_python_stdlib
type: prototype
category: dev_ref
triggers:
  keywords: [python, py, stdlib, argparse, pathlib, json, csv, asyncio, dataclasses, logging, import, module]
  extensions: [.py]
  languages: [python]
  platforms: [cross]
priority: 12
description: Quick reference to high-value Python standard-library modules with one-line usage notes.
---

# Python Standard Library Quick Reference

The batteries that ship with CPython. Reach for these before adding a third-party dependency —
fewer deps means fewer supply-chain risks and a smaller anti-failure surface. The router selects
this file for Python build/lookup queries naming a stdlib module. Each module below has a
one-line "what it's for" plus the canonical idiom.

## argparse — command-line interfaces
Declarative CLI parsing with auto-generated `--help`, type coercion, and subcommands.
```python
import argparse
p = argparse.ArgumentParser(description="resize images")
p.add_argument("path", type=str, help="input file")
p.add_argument("--width", type=int, default=800)
p.add_argument("-v", "--verbose", action="store_true")
args = p.parse_args()          # exits 2 with usage on bad input
```
> Subcommands: `sub = p.add_subparsers(dest="cmd", required=True)` then `sub.add_parser("build")`.
> See `pattern_cli` for the full subcommand + exit-code pattern.

## pathlib — filesystem paths as objects
Cross-platform path manipulation. Replaces most `os.path` string juggling.
```python
from pathlib import Path
cfg = Path.home() / ".config" / "app.toml"
cfg.parent.mkdir(parents=True, exist_ok=True)   # idempotent
for f in Path("src").rglob("*.py"):             # recursive glob
    print(f.read_text(encoding="utf-8"))
```
> `Path(__file__).resolve().parent` is the rock-solid "where am I" idiom (avoid relative cwd).

## json — JSON encode/decode
Serialize/deserialize between Python objects and JSON text.
```python
import json
data = json.loads('{"a": 1}')                       # str -> dict
text = json.dumps(data, indent=2, ensure_ascii=False)  # dict -> pretty str
with open("out.json", "w", encoding="utf-8") as fh:
    json.dump(data, fh)
```
> `default=str` lets you dump non-native types (datetimes) without a custom encoder.
> Catch `json.JSONDecodeError` on parse — see `pattern_error_handling`.

## csv — delimited text
Reader/writer that handles quoting and escaping correctly (do NOT hand-split on commas).
```python
import csv
with open("data.csv", newline="", encoding="utf-8") as fh:
    for row in csv.DictReader(fh):     # row is a dict keyed by header
        print(row["name"])
with open("out.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=["name", "age"])
    w.writeheader(); w.writerow({"name": "Ada", "age": 36})
```
> Always pass `newline=""` on open — omitting it corrupts line endings on Windows.

## asyncio — async I/O and concurrency
Single-threaded cooperative concurrency for I/O-bound work (network, disk).
```python
import asyncio
async def fetch(n): await asyncio.sleep(n); return n
async def main():
    results = await asyncio.gather(*(fetch(i) for i in range(3)))  # run concurrently
    return results
asyncio.run(main())          # one event loop per program entry
```
> Never call a blocking function inside a coroutine — offload via `await asyncio.to_thread(fn)`.
> `asyncio.run` is the only entry point you need; avoid manual loop juggling.

## dataclasses — boilerplate-free value types
Auto-generates `__init__`, `__repr__`, `__eq__` from typed fields.
```python
from dataclasses import dataclass, field
@dataclass(frozen=True)               # frozen -> hashable, immutable
class Point:
    x: int
    y: int = 0
    tags: list[str] = field(default_factory=list)  # never use a mutable default literal
```
> `field(default_factory=list)` is mandatory for mutable defaults — a bare `[]` is shared state.

## logging — structured, leveled diagnostics
Configurable logging that beats `print` for anything beyond a throwaway script.
```python
import logging
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger(__name__)
log.info("started"); log.warning("retrying"); log.error("failed", exc_info=True)
```
> `exc_info=True` inside an `except` logs the full traceback. Configure once at the entry point;
> get a module-named logger everywhere else. Never log secrets — see `hallucination_guards`/`compliance`.

## Honorable mentions (one line each)
- `subprocess` — run external programs; use `subprocess.run([...], check=True, capture_output=True)`.
- `collections` — `defaultdict`, `Counter`, `deque` for ergonomic data structures.
- `itertools` — lazy combinatorics: `chain`, `groupby`, `islice`, `product`.
- `functools` — `lru_cache`, `partial`, `reduce`, `cached_property`.
- `enum` — named constant sets via `class Color(Enum): RED = 1`.
- `typing` — `Optional`, `Union`/`X | Y`, `Protocol`, `TYPE_CHECKING` guard for import cycles.
- `tempfile` — `TemporaryDirectory()` for scratch space (Windows-safe; never hardcode `/tmp`).

## CROSS-REFERENCES
- [python_build](../../skills/build/python_build.md) — assembling Python programs from these modules.
- [python_debug](../../skills/debug/python_debug.md) — diagnosing import, encoding, and async pitfalls.
- [pattern_cli](../func_encyclopedia/cli_patterns.md) — argparse-based CLI construction patterns.
- [pattern_error_handling](../func_encyclopedia/error_handling_patterns.md) — exception idioms for json/csv/subprocess.
- [map_python](../../maps/python.md) — how stdlib fits the Python domain map.

## END OF SKILL
