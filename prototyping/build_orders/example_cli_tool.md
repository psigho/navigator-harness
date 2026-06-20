---
skill_id: project_example_cli_tool
type: prototype
category: build_order
status: active
current_phase: 2
total_phases: 4
triggers:
  keywords: [cli tool, example project, todo cli, argparse, command line, project, continue, resume]
  extensions: [.py]
  languages: [python]
  platforms: [cross]
depends_on: [master_skill, skill_chaining, context_management]
priority: 7
description: Worked example build order — a Python CLI task-tracker, mid-build at Phase 2 of 4.
---

# Project: `taskw` — a Python CLI Task Tracker

A **real, renderable** build order the Navigator UI parses end to end. It tracks an actual
toy project — `taskw`, a single-binary command-line task tracker (add / list / done /
remove, JSON-backed) built with the Python stdlib only. It exists so engineers studying the
framework can see what a *live, half-finished* project order looks like: Phase 1 fully
COMPLETE, Phase 2 IN PROGRESS with a mix of checked and unchecked steps, Phases 3 and 4
PENDING. With `current_phase: 2` and `total_phases: 4`, the overall progress bar should read
roughly 45% (8 of 18 steps checked) when this file is parsed.

Stack: Python 3.11+, `argparse` for parsing, `json` for storage, `pytest` for tests — no
third-party runtime deps. The domain is `python` (see `maps/python.md`), so the router warms
the python build/debug skills when this order is the active project. CLI structure follows the
patterns in `prototyping/func_encyclopedia/cli_patterns.md`; error surfaces follow
`error_handling_patterns.md`.

Resume hint for a future session: pick up at the first `- [ ]` in Phase 2 — wiring `argparse`
subcommands to the storage layer. The storage module and its tests already exist (Phase 1),
so no rehydration of that work is needed.

## Phase 1: Foundation (COMPLETE)

Project skeleton, storage layer, and a green test harness. This is the runnable baseline
every later phase builds on.

- [x] Create package layout: `taskw/__init__.py`, `taskw/storage.py`, `taskw/cli.py`, `tests/`
- [x] Pin toolchain: Python 3.11, `pytest` in `requirements-dev.txt`, `pyproject.toml` entry point `taskw = taskw.cli:main`
- [x] Implement `storage.py`: `load(path) -> list[Task]`, `save(path, tasks)`, atomic write via temp-file rename
- [x] Define the `Task` dataclass (`id: int`, `title: str`, `done: bool`, `created: str`)
- [x] Write `tests/test_storage.py` covering load-missing-file, round-trip, and atomic-write
- [x] Confirm `pytest` is green on the empty-but-runnable baseline

## Phase 2: Core Logic (IN PROGRESS)

The command surface itself — argparse subcommands wired to the storage layer. This is where
the project currently lives; resume here.

- [x] Build the top-level `argparse` parser with subcommand dispatch in `cli.py`
- [x] Implement `add <title>` — append a task, auto-increment id, persist
- [ ] Implement `list [--all]` — print open tasks (or all) in a padded, aligned table
- [ ] Implement `done <id>` — mark complete, with a clear error when the id is unknown
- [ ] Implement `remove <id>` — delete a task, confirm count change
- [ ] Add `tests/test_cli.py` exercising each subcommand via `capsys` and a temp data file

## Phase 3: Integration (PENDING)

Make `taskw` behave like a real installed tool: config discovery, exit codes, and the
end-to-end seam between CLI parsing and persisted state.

- [ ] Resolve the data-file path from `$TASKW_HOME`, then `$XDG_DATA_HOME`, then `~/.taskw/tasks.json`
- [ ] Return meaningful process exit codes (0 ok, 2 usage error, 1 runtime error)
- [ ] Add an integration test that runs the built entry point end to end in a subprocess
- [ ] Verify behavior on a cold start (no data file yet) and a corrupt-file recovery path

## Phase 4: Polish (PENDING)

Release readiness — docs, packaging, and the five quality gates.

- [ ] Write `README.md` with install, usage examples, and the data-file precedence rules
- [ ] Pass all five quality gates (completeness, correctness, safety, citation, compliance)
- [ ] Tag `v0.1.0` and confirm `pip install .` exposes the `taskw` command

## CROSS-REFERENCES

- [master_skill](../../master_skill.md) — routes "continue the cli tool" here, reads `current_phase: 2`, and assembles a resume prompt pointed at the first open Phase 2 step.
- [skill_chaining](../../skills/rules/skill_chaining.md) — each unchecked step expands into a python_build → test → (python_debug if red) chain.
- [context_management](../../skills/rules/context_management.md) — on resume, preloads `storage.py` context (done) only if a later phase touches it, keeping the budget GREEN.
- [build_order_template](./BUILD_ORDER_TEMPLATE.md) — the grammar this example follows verbatim.
- [cli_patterns](../func_encyclopedia/cli_patterns.md) — the argparse/subcommand patterns the core phase implements.
- [python (map)](../../maps/python.md) — domain map the router warms while this project is active.

## END OF SKILL
